// Bil's front door for the app. Every request needs a signed-in Backlot login.
//
// The platform's JWT check is off (config.toml) so the browser's CORS preflight, which
// carries no login, can be answered; this code verifies the login itself on every POST
// (getClaims checks the token's signature). Reads happen through the user's own access
// rules; writes go through the server, scoped to the verified owner.
//
// Actions (POST JSON with "action"):
//   lookup         { handle }                 public profile facts to pre-fill intake ($0.01)
//   onboard        OnboardRequest             voice card + post-type library (about $0.30)
//   approve_voice  { clientId, edits? }       the client approves their card (free)
//   estimate       { clientId, posts, useTrends }   upper-bound campaign cost (free)
//   campaign       CampaignRequest            queues a campaign and returns at once
//   resume         { campaignId }             resumes a campaign paused at the month's budget

import {
  ApproveVoiceRequest,
  approveVoice,
  BilInputError,
  CampaignRequest,
  estimateCampaign,
  loadKit,
  LookupRequest,
  lookupHandle,
  MAX_POSTS,
  OnboardRequest,
  onboardClient,
  resumeCampaign,
  startCampaign,
} from '../_shared/bil.ts';
import { userContextFromRequest } from '../_shared/toolbox.ts';
import { serviceClient, SpendLimitError } from '../_shared/spend.ts';
import { kickWorker } from '../_shared/worker-token.ts';
import { id, z } from '../_shared/schemas/common.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const CORS = {
  'Access-Control-Allow-Origin': '*',
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  const user = await userContextFromRequest(req);
  if (!user) return reply(401, { error: 'Sign in first' });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return reply(400, { error: 'Send a JSON body with an action' });
  const { action, ...input } = body as { action?: string };

  try {
    switch (action) {
      case 'lookup':
        return reply(200, await lookupHandle(parse(LookupRequest, input).handle));
      case 'onboard':
        return reply(200, await onboardClient(user.userDb, user.ownerId, parse(OnboardRequest, input)));
      case 'approve_voice':
        return reply(200, await approveVoice(user.ownerId, parse(ApproveVoiceRequest, input)));
      case 'estimate': {
        const r = parse(EstimateRequest, input);
        const kit = await loadKit(serviceClient(), r.clientId, user.ownerId);
        return reply(200, estimateCampaign(r.posts, r.useTrends, JSON.stringify([kit.profile, kit.card, kit.library]).length + 200));
      }
      case 'campaign': {
        const started = await startCampaign(user.ownerId, parse(CampaignRequest, input));
        if (!started.repeated) EdgeRuntime.waitUntil(kickWorker());
        return reply(202, started);
      }
      case 'resume': {
        const r = await resumeCampaign(user.ownerId, parse(ResumeRequest, input).campaignId);
        if (r.resumed) EdgeRuntime.waitUntil(kickWorker());
        return reply(200, r);
      }
      default:
        return reply(400, { error: 'Unknown action. Use lookup, onboard, approve_voice, estimate, campaign or resume.' });
    }
  } catch (err) {
    if (err instanceof BilInputError) return reply(err.status, { error: err.message });
    if (err instanceof SpendLimitError) return reply(402, { error: err.message, reason: err.reason });
    console.error(`bil: ${action} failed`, err instanceof Error ? err.message : err);
    return reply(500, { error: err instanceof Error ? err.message.slice(0, 400) : 'failed' });
  }
});
