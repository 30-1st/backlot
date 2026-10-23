// Bil's front door for the app. Every request needs a signed-in Backlot login that belongs
// to the workspace.
//
// The platform's JWT check is off (config.toml) so the browser's CORS preflight, which
// carries no login, can be answered; this code verifies the login itself on every POST
// (getClaims checks the token's signature). Reads happen through the user's own access
// rules; writes go through the server, scoped to the verified workspace.
//
// Who may do what (see _shared/workspace.ts):
//   team (owner or team)  every action, for any client in the workspace
//   client                approve_voice and review_post, for their own client only.
//                         Clients never start paid work.
//
// Actions (POST JSON with "action"):
//   lookup         { handle }                 public profile facts to pre-fill intake ($0.01)       team
//   onboard        OnboardRequest             voice card + post-type library (about $0.30)           team
//   approve_voice  { clientId, edits? }       the client approves their card (free)                  team, client
//   learn          { requestId, clientId }    re-measures what performs on their page (about $0.25) team
//   estimate       { clientId, posts, useTrends }   upper-bound campaign cost (free)                 team
//   campaign       CampaignRequest            queues a campaign and returns at once                  team
//   resume         { campaignId }             resumes a campaign paused at the month's budget        team
//   review_post    { campaignId, slot, decision, note? }  approve, ask for changes, mark posted (free)  team, client
//   ask            { requestId, text, clientId? }  the agent bar: Bil answers and may offer one next step (a few cents)  team
//   desk           { requestId, clientId, replies? }  engagement desk: trend posts (free), replies to the client (about $0.005 a post)  team
//   report         { requestId, clientId, month }  monthly report from X numbers (about $0.005 a post + one Bil call)  team

import {
  askBil,
  AskRequest,
  deskCheck,
  DeskRequest,
  makeReport,
  ReportRequest,
  ApproveVoiceRequest,
  approveVoice,
  BilInputError,
  CampaignRequest,
  estimateCampaign,
  LearnRequest,
  learnWhatWorks,
  loadKit,
  LookupRequest,
  lookupHandle,
  MAX_POSTS,
  OnboardRequest,
  onboardClient,
  resumeCampaign,
  ReviewPostRequest,
  FillDetailRequest,
  fillDetail,
  BrandSaveRequest,
  BrandReviewRequest,
  saveBrand,
  reviewBrand,
  reviewPost,
  startCampaign,
} from '../_shared/bil.ts';
import { userContextFromRequest } from '../_shared/toolbox.ts';
import { serviceClient, SpendLimitError } from '../_shared/spend.ts';
import { kickWorker } from '../_shared/worker-token.ts';
import { AccessError, memberOf, requireClientAccess, requireOwnPassword, requireTeam } from '../_shared/workspace.ts';
import { id, z } from '../_shared/schemas/common.ts';
import { withCors } from '../_shared/cors.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const CORS = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const r = schema.safeParse(body);
  if (!r.success) throw new BilInputError(r.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'request'}: ${i.message}`).join('; '));
  return r.data;
}

const EstimateRequest = z.object({ clientId: id, posts: z.number().int().min(1).max(MAX_POSTS), useTrends: z.boolean().default(true) });
const ResumeRequest = z.object({ campaignId: id });

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  const user = await userContextFromRequest(req);
  if (!user) return reply(401, { error: 'Sign in first' });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return reply(400, { error: 'Send a JSON body with an action' });
  const { action, ...input } = body as { action?: string };

  try {
    const member = await memberOf(user.ownerId);
    if (!member) return reply(403, { error: 'Your login is not part of a Backlot team yet.' });
    requireOwnPassword(member);
    // From here on, ownerId means the workspace, never the individual login.
    const workspaceId = member.workspaceId;

    switch (action) {
      case 'lookup':
        requireTeam(member);
        return reply(200, await lookupHandle(parse(LookupRequest, input)));
      case 'onboard':
        requireTeam(member);
        return reply(200, await onboardClient(user.userDb, workspaceId, parse(OnboardRequest, input)));
      case 'ask':
        return reply(200, await askBil(member, parse(AskRequest, input)));
      case 'desk':
        return reply(200, await deskCheck(member, parse(DeskRequest, input)));
      case 'report':
        return reply(200, await makeReport(user.userDb, member, parse(ReportRequest, input)));
      case 'learn':
        requireTeam(member);
        return reply(200, await learnWhatWorks(user.userDb, workspaceId, parse(LearnRequest, input)));
      case 'approve_voice': {
        const r = parse(ApproveVoiceRequest, input);
        requireClientAccess(member, r.clientId);
        return reply(200, await approveVoice(workspaceId, r, member));
      }
      case 'estimate': {
        requireTeam(member);
        const r = parse(EstimateRequest, input);
        const kit = await loadKit(serviceClient(), r.clientId, workspaceId);
        return reply(200, estimateCampaign(r.posts, r.useTrends, JSON.stringify([kit.profile, kit.card, kit.library]).length + 200));
      }
      case 'campaign': {
        requireTeam(member);
        const started = await startCampaign(workspaceId, parse(CampaignRequest, input));
        if (!started.repeated) EdgeRuntime.waitUntil(kickWorker());
        return reply(202, started);
      }
      case 'resume': {
        requireTeam(member);
        const r = await resumeCampaign(workspaceId, parse(ResumeRequest, input).campaignId);
        if (r.resumed) EdgeRuntime.waitUntil(kickWorker());
        return reply(200, r);
      }
      case 'review_post':
        return reply(200, await reviewPost(member, parse(ReviewPostRequest, input)));
      case 'brand_save':
        return reply(200, await saveBrand(member, parse(BrandSaveRequest, input)));
      case 'brand_review':
        return reply(200, await reviewBrand(member, parse(BrandReviewRequest, input)));
      case 'fill_detail':
        return reply(200, await fillDetail(member, parse(FillDetailRequest, input)));
      default:
        return reply(400, { error: 'Unknown action. Use lookup, onboard, learn, report, desk, ask, approve_voice, estimate, campaign, resume, review_post, fill_detail, brand_save or brand_review.' });
    }
  } catch (err) {
    if (err instanceof AccessError) return reply(err.status, { error: err.message });
    if (err instanceof BilInputError) return reply(err.status, { error: err.message });
    if (err instanceof SpendLimitError) return reply(402, { error: err.message, reason: err.reason });
    console.error(`bil: ${action} failed`, err instanceof Error ? err.message : err);
    return reply(500, { error: err instanceof Error ? err.message.slice(0, 400) : 'failed' });
  }
}

Deno.serve(withCors(handle));
