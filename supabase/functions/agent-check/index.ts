// Setup check for Backlot's agents. Admin only.
//
// POST {"action":"run"}
//   Confirms the function secrets are set (names only, never values), looks up
//   one public X profile with X_BEARER_TOKEN, asks Grok for a one-line reply
//   with XAI_API_KEY, and records the whole run as one Langfuse trace.
//   Replies with what passed and the trace id.
//
// POST {"action":"trace","traceId":"..."}
//   Reads that trace back from Langfuse so it can be checked against
//   Langfuse's best practices without anyone handling the Langfuse keys.
//
// Every call spends a little real money (one X lookup, one small Grok reply),
// so the caller must send the admin token in the x-backlot-admin header. Only
// the token's SHA-256 fingerprint lives here; the token itself is kept outside
// the repo. To rotate it, make a new token and replace ADMIN_TOKEN_SHA256.
// The platform JWT check is on as well.

import { generateText } from 'npm:ai@7.0.126';
import { createXai } from 'npm:@ai-sdk/xai@5.0.14';
import { getActiveTraceId, propagateAttributes, startActiveObservation } from 'npm:@langfuse/tracing@5.11.1';
import { ENVIRONMENT, startTracing, withTracing } from '../_shared/observability.ts';
import { MODELS } from '../_shared/models.ts';

const SECRET_NAMES = [
  'XAI_API_KEY',
  'X_BEARER_TOKEN',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
] as const;

const ADMIN_TOKEN_SHA256 = 'c6de2175bc82d4308dc8a532aec9ee6f690a49ab9b42f649b4f114ac7bf8b864';

/** A public account that will always exist: X's own developer account. */
const CHECK_HANDLE = 'XDevelopers';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-backlot-admin',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

/** True when the token's SHA-256 matches. Compared in constant time. */
async function isAdmin(token: string): Promise<boolean> {
  if (!token) return false;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  let diff = hex.length ^ ADMIN_TOKEN_SHA256.length;
  for (let i = 0; i < ADMIN_TOKEN_SHA256.length; i++) diff |= hex.charCodeAt(i) ^ ADMIN_TOKEN_SHA256.charCodeAt(i);
  return diff === 0;
}

type XProfile = { username: string; name: string; followers: number; posts: number; verified: boolean };

/** Tool step: one X API user lookup. */
function lookUpXProfile(username: string): Promise<XProfile> {
  return startActiveObservation(
    'look-up-x-profile',
    async (tool) => {
      tool.update({ input: { username } });
      const token = Deno.env.get('X_BEARER_TOKEN');
      if (!token) throw new Error('X_BEARER_TOKEN is not set');
      const url = new URL(`https://api.x.com/2/users/by/username/${encodeURIComponent(username)}`);
      url.searchParams.set('user.fields', 'public_metrics,verified,description,profile_image_url');
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.data) {
        const why = body?.title ?? body?.detail ?? body?.errors?.[0]?.message ?? `HTTP ${res.status}`;
        tool.update({ level: 'ERROR', statusMessage: `X API: ${why}`, metadata: { httpStatus: res.status } });
        throw new Error(`X API lookup failed: ${why} (HTTP ${res.status})`);
      }
      const d = body.data;
      const profile: XProfile = {
        username: d.username,
        name: d.name,
        followers: d.public_metrics?.followers_count ?? 0,
        posts: d.public_metrics?.tweet_count ?? 0,
        verified: Boolean(d.verified),
      };
      tool.update({ output: profile, metadata: { httpStatus: res.status } });
      return profile;
    },
    { asType: 'tool' },
  );
}

/** Model step: one short Grok reply. The AI SDK integration records it as a generation. */
async function askGrok(profile: XProfile): Promise<string> {
  const key = Deno.env.get('XAI_API_KEY');
  if (!key) throw new Error('XAI_API_KEY is not set');
  const xai = createXai({ apiKey: key });
  const { text } = await generateText({
    model: xai.responses(MODELS.light),
    system: 'You are a setup check for Backlot. Reply with one short sentence and nothing else.',
    prompt: `The X account @${profile.username} has ${profile.followers} followers. Confirm you can read this by restating the follower count.`,
    maxOutputTokens: 200,
    telemetry: { functionId: 'confirm-grok-reply' },
  });
  return text.trim();
}

type Step = { ok: boolean; detail: string };

async function runCheck() {
  const secrets = Object.fromEntries(SECRET_NAMES.map((n) => [n, Boolean(Deno.env.get(n))]));
  const langfuseBase = await startTracing();

  return await withTracing(() =>
    startActiveObservation(
      'check-agent-setup',
      (root) =>
        propagateAttributes(
          {
            traceName: 'check-agent-setup',
            userId: 'backlot-admin',
            tags: ['setup-check'],
            environment: ENVIRONMENT,
            metadata: { feature: 'setup-check' },
          },
          async () => {
            root.update({ input: { checks: ['x-profile-lookup', 'grok-reply'], handle: CHECK_HANDLE } });
            const steps: Record<string, Step> = {};
            let profile: XProfile | null = null;

            try {
              profile = await lookUpXProfile(CHECK_HANDLE);
              steps.x = { ok: true, detail: `@${profile.username}: ${profile.followers} followers, ${profile.posts} posts` };
            } catch (err) {
              steps.x = { ok: false, detail: err instanceof Error ? err.message : String(err) };
            }

            try {
              const text = await askGrok(
                profile ?? { username: CHECK_HANDLE, name: CHECK_HANDLE, followers: 0, posts: 0, verified: false },
              );
              steps.grok = { ok: true, detail: text };
            } catch (err) {
              steps.grok = { ok: false, detail: err instanceof Error ? err.message : String(err) };
            }

            const allOk = steps.x.ok && steps.grok.ok;
            root.update({
              output: { passed: allOk, x: steps.x.detail, grok: steps.grok.detail },
              ...(allOk ? {} : { level: 'ERROR' as const, statusMessage: 'One or more setup checks failed' }),
            });
            return {
              passed: allOk,
              secrets,
              langfuse: langfuseBase ? { ok: true, region: langfuseBase } : { ok: false, detail: 'tracing is off' },
              steps,
              traceId: getActiveTraceId() ?? null,
            };
          },
        ),
      { asType: 'agent' },
    )
  );
}

/** Reads one trace back from Langfuse, trimmed to what an audit needs. */
async function readTrace(traceId: string) {
  const base = await startTracing();
  if (!base) return { ok: false, detail: 'tracing is off' };
  const auth = 'Basic ' + btoa(`${Deno.env.get('LANGFUSE_PUBLIC_KEY')}:${Deno.env.get('LANGFUSE_SECRET_KEY')}`);
  const res = await fetch(`${base}/api/public/traces/${encodeURIComponent(traceId)}`, {
    headers: { Authorization: auth },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return { ok: false, detail: `Langfuse returned HTTP ${res.status}` };
  const t = await res.json();
  return {
    ok: true,
    trace: {
      id: t.id,
      name: t.name,
      userId: t.userId,
      sessionId: t.sessionId,
      tags: t.tags,
      environment: t.environment,
      release: t.release,
      input: t.input,
      output: t.output,
      metadata: t.metadata,
      totalCost: t.totalCost,
      latency: t.latency,
      htmlPath: t.htmlPath,
    },
    observations: (t.observations ?? []).map((o: Record<string, unknown>) => ({
      id: o.id,
      parentObservationId: o.parentObservationId,
      type: o.type,
      name: o.name,
      model: o.model,
      level: o.level,
      statusMessage: o.statusMessage,
      usageDetails: o.usageDetails,
      costDetails: o.costDetails,
      input: o.input,
      output: o.output,
      metadata: o.metadata,
    })),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  if (!(await isAdmin(req.headers.get('x-backlot-admin') ?? ''))) return reply(401, { error: 'not allowed' });

  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === 'run') return reply(200, await runCheck());
    if (body.action === 'trace' && typeof body.traceId === 'string' && /^[a-f0-9]{32}$/.test(body.traceId)) {
      return reply(200, await readTrace(body.traceId));
    }
    return reply(400, { error: 'action must be "run", or "trace" with a 32-character traceId' });
  } catch (err) {
    console.error('agent-check failed', err);
    return reply(500, { error: err instanceof Error ? err.message : 'failed' });
  }
});
