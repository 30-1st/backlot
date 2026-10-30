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
//                         Clients never start paid work, except chatting with Kris, which comes
//                         out of their own monthly Kris allowance.
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
//   ways_copy      { requestId, clientId }  Kris writes bio, pinned post and reply text for the ways in (about half a cent)  team, client
//   approve_all    { campaignId }  approve every written post still waiting for a yes (free)  team, client
//   discard        { campaignId }  take a campaign off the schedule and stop its drafting; restorable (free)  team, client
//   restore        { campaignId }  bring a discarded campaign back and resume drafting (free)  team, client
//   ask            { requestId, text, clientId? }  the agent bar: Bil answers and may offer one next step (a few cents)  team
//   desk           { requestId, clientId, replies? }  engagement desk: trend posts (free), replies to the client (about $0.005 a post)  team
//   kris           { requestId, clientId, text }  Kris, the client's publicist, answers in her chat (about half a cent)  team, client
//   report         { requestId, clientId, month }  monthly report from X numbers (about $0.005 a post + one Bil call)  team
//   game_plan_save / game_plan_meeting       the Game Plan inputs (free) and Bil's opportunity meeting    team, client
//   network_set / quotes_find / quote_decide the Network list (free), Find quotes now (about $0.15), quote outcomes  team, client
//   xev_status / xev_read / xev_feedback      Xev reads up to 3 screenshots (about 1 to 3 cents; 3 free)  team, client
//   xev_grant      { clientId, extra }       extra Xev reads, until payments open                       owner

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
  CampaignActionRequest,
  approveAll,
  discardCampaign,
  restoreCampaign,
  requireInGoodStanding,
  gamePlanSave,
  GamePlanSaveRequest,
  gamePlanMeeting,
  GamePlanMeetingRequest,
  networkSet,
  NetworkSetRequest,
  quotesFind,
  QuotesFindRequest,
  quoteDecide,
  QuoteDecideRequest,
} from '../_shared/bil.ts';
import { userContextFromRequest } from '../_shared/toolbox.ts';
import { xevFeedback, XevFeedbackRequest, xevGrant, XevGrantRequest, xevRead, XevReadRequest, xevStatus } from '../_shared/xev.ts';
import { krisChat, KrisChatRequest, waysCopy, WaysCopyRequest } from '../_shared/kris.ts';
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
      case 'game_plan_save':
        return reply(200, await gamePlanSave(member, parse(GamePlanSaveRequest, input)));
      case 'game_plan_meeting':
        return reply(200, await gamePlanMeeting(member, parse(GamePlanMeetingRequest, input)));
      case 'xev_status':
        return reply(200, await xevStatus(member, parse(z.object({ clientId: id }), input).clientId));
      case 'xev_read':
        return reply(200, await xevRead(member, parse(XevReadRequest, input)));
      case 'xev_feedback':
        return reply(200, await xevFeedback(member, parse(XevFeedbackRequest, input)));
      case 'xev_grant':
        return reply(200, await xevGrant(member, parse(XevGrantRequest, input)));
      case 'network_set':
        return reply(200, await networkSet(member, parse(NetworkSetRequest, input)));
      case 'quotes_find':
        return reply(200, await quotesFind(member, parse(QuotesFindRequest, input)));
      case 'quote_decide':
        return reply(200, await quoteDecide(member, parse(QuoteDecideRequest, input)));
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
        requireClientAccess(member, r.clientId);
        const kit = await loadKit(serviceClient(), r.clientId, workspaceId);
        return reply(200, estimateCampaign(r.posts, r.useTrends, JSON.stringify([kit.profile, kit.card, kit.library]).length + 200));
      }
      case 'campaign': {
        requireTeam(member);
        const req = parse(CampaignRequest, input);
        requireClientAccess(member, req.clientId);
        await requireInGoodStanding(req.clientId, workspaceId);
        const started = await startCampaign(workspaceId, req);
        if (!started.repeated) EdgeRuntime.waitUntil(kickWorker());
        return reply(202, started);
      }
      case 'resume': {
        requireTeam(member);
        const rq = parse(ResumeRequest, input);
        const { data: rc } = await serviceClient().from('campaigns').select('client_id').eq('id', rq.campaignId).eq('owner_id', workspaceId).maybeSingle();
        if (rc) requireClientAccess(member, rc.client_id);
        const r = await resumeCampaign(workspaceId, rq.campaignId);
        if (r.resumed) EdgeRuntime.waitUntil(kickWorker());
        return reply(200, r);
      }
      case 'kris':
        return reply(200, await krisChat(member, parse(KrisChatRequest, input)));
      case 'review_post':
        return reply(200, await reviewPost(member, parse(ReviewPostRequest, input)));
      case 'ways_copy':
        return reply(200, await waysCopy(member, parse(WaysCopyRequest, input)));
      case 'approve_all':
        return reply(200, await approveAll(member, parse(CampaignActionRequest, input)));
      case 'discard':
        return reply(200, await discardCampaign(member, parse(CampaignActionRequest, input)));
      case 'restore': {
        const r = await restoreCampaign(member, parse(CampaignActionRequest, input));
        if (r.drafting) EdgeRuntime.waitUntil(kickWorker());
        return reply(200, r);
      }
      case 'brand_save':
        return reply(200, await saveBrand(member, parse(BrandSaveRequest, input)));
      case 'brand_review':
        return reply(200, await reviewBrand(member, parse(BrandReviewRequest, input)));
      case 'fill_detail':
        return reply(200, await fillDetail(member, parse(FillDetailRequest, input)));
      default:
        return reply(400, { error: 'Unknown action. Use lookup, onboard, learn, report, desk, ask, approve_voice, estimate, campaign, resume, review_post, fill_detail, kris, brand_save, brand_review, approve_all, discard, restore or ways_copy.' });
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
