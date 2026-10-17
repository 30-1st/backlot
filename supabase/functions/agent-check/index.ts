// Setup check for Backlot's agents. Admin only.
//
// POST {"action":"run"}
//   Confirms the function secrets are set (never their values), looks up one
//   public X profile with the X bearer token, asks Grok for a one-line reply
//   with the xAI key, and records the whole run as one Langfuse trace.
//   Replies with what passed and the trace id.
//
// POST {"action":"names"}
//   Lists the names of the secrets that are set (never their values).
//
// POST {"action":"spend"}
//   This month's agent spending against the caps in private.spend_limits.
//
// POST {"action":"prices"}
//   Saves the prices in _shared/models.ts to Langfuse as model definitions, so
//   every traced Grok call shows its cost. Safe to repeat: it replaces by id.
//
// POST {"action":"toolbox"}
//   Live check of the toolbox on real public data (about $0.08): one profile lookup,
//   one 10-post search, and one Grok call mixing X Search with our own tool.
//
// POST {"action":"algorithm","questions":["..."]}
//   Free check of the algorithm index: status, default weights, top hits per question.
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

import { generateText, stepCountIs } from 'npm:ai@7.0.142';
import { createXai } from 'npm:@ai-sdk/xai@5.0.23';
import { getActiveTraceId, propagateAttributes, startActiveObservation } from 'npm:@langfuse/tracing@6.0.0';
import { ENVIRONMENT, langfuseAuth, startTracing, withTracing } from '../_shared/observability.ts';
import { secret, secretsPresent } from '../_shared/secrets.ts';
import { MODELS, PRICES, X_PRICES, grokBilled, grokCost, grokEstimate } from '../_shared/models.ts';
import { Budget, SpendLimitError } from '../_shared/spend.ts';
import { grokOptions, xaiClient } from '../_shared/grok.ts';
import { agentTools, impl, type ToolContext } from '../_shared/toolbox.ts';
import { indexStatus } from '../_shared/algorithm.ts';
import { callRein } from '../_shared/rein-client.ts';

const ADMIN_TOKEN_SHA256 = 'ba110c1c1376ab186539560a37c24e9499904d71de23faade47fb53bb15127d2';

/** A Grok call that takes longer than this is stopped (and its estimate kept, to be safe). */
const GROK_TIMEOUT_MS = 60_000;

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

/** Tool step: one X API user lookup, metered. */
function lookUpXProfile(budget: Budget, username: string): Promise<XProfile> {
  return startActiveObservation(
    'look-up-x-profile',
    async (tool) => {
      tool.update({ input: { username } });
      const token = secret('xBearerToken');
      if (!token) throw new Error('The X bearer token secret is not set');
      const url = new URL(`https://api.x.com/2/users/by/username/${encodeURIComponent(username)}`);
      url.searchParams.set('user.fields', 'public_metrics,verified,description,profile_image_url');
      const res = await budget.charge(
        'x_user_lookup',
        X_PRICES.userLookup,
        async () => {
          const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
          // X bills successful reads only; a refused request is released, not charged.
          if (!r.ok) throw new Error(`X API HTTP ${r.status}`, { cause: r });
          return r;
        },
        () => X_PRICES.userLookup,
        { resource: `x_user:${username.toLowerCase()}` },
      ).catch((err) => (err?.cause instanceof Response ? err.cause : Promise.reject(err)));
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

/** Model step: one short Grok reply, metered. The AI SDK integration records it as a generation. */
async function askGrok(budget: Budget, profile: XProfile): Promise<string> {
  const key = secret('xaiApiKey');
  if (!key) throw new Error('The xAI API key secret is not set');
  const xai = createXai({ apiKey: key });
  const system = 'You are a setup check for Backlot. Reply with one short sentence and nothing else.';
  const prompt = `The X account @${profile.username} has ${profile.followers} followers. Confirm you can read this by restating the follower count.`;
  const maxOutputTokens = 200;
  const result = await budget.charge(
    'grok',
    grokEstimate(MODELS.light, system.length + prompt.length, maxOutputTokens),
    () =>
      generateText({
        model: xai.responses(MODELS.light),
        system,
        prompt,
        maxOutputTokens,
        providerOptions: grokOptions('check', 'none'),
        abortSignal: AbortSignal.timeout(GROK_TIMEOUT_MS),
        telemetry: { functionId: 'confirm-grok-reply' },
      }),
    (r) => grokBilled(r) ?? grokCost(MODELS.light, r.usage),
  );
  return result.text.trim();
}

type Step = { ok: boolean; detail: string };

async function runCheck() {
  const secrets = secretsPresent();
  const langfuseBase = await startTracing();
  const budget = new Budget('check');

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
              profile = await lookUpXProfile(budget, CHECK_HANDLE);
              steps.x = { ok: true, detail: `@${profile.username}: ${profile.followers} followers, ${profile.posts} posts` };
            } catch (err) {
              steps.x = { ok: false, detail: err instanceof Error ? err.message : String(err) };
            }

            try {
              const text = await askGrok(
                budget,
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
              runId: budget.runId,
              spend: await budget.summary().catch((e) => ({ error: e.message })),
            };
          },
        ),
      { asType: 'agent' },
    )
  );
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Live check of the toolbox, on real public data only (about $0.08):
 *   1. one X profile lookup through the toolbox (check budget)
 *   2. one 10-post topic search through the toolbox (rein budget)
 *   3. one Grok call that mixes Grok's own X Search with one of our function tools in
 *      the same request, to settle the conflict between xAI's docs (allowed) and the
 *      AI SDK docs (not allowed). Billed cost comes from xAI's own report.
 */
async function runToolboxCheck() {
  await startTracing();
  const checkBudget = new Budget('check');
  const reinBudget = new Budget('rein');
  const ctx: ToolContext = { budget: reinBudget };

  return await withTracing(() =>
    startActiveObservation(
      'check-toolbox',
      (root) =>
        propagateAttributes(
          { traceName: 'check-toolbox', userId: 'backlot-admin', tags: ['setup-check', 'toolbox'], environment: ENVIRONMENT },
          async () => {
            const steps: Record<string, unknown> = {};

            try {
              const p = await impl.x_profile_lookup({ budget: checkBudget }, { handle: CHECK_HANDLE });
              steps.profileLookup = { ok: true, handle: p.handle, userId: p.userId, followers: p.followers };
            } catch (err) {
              steps.profileLookup = { ok: false, detail: errText(err) };
            }

            try {
              const r = await impl.x_post_search(ctx, { query: 'AI agents', maxPosts: 10 });
              steps.postSearch = { ok: true, returned: r.posts.length, sample: r.posts.slice(0, 2) };
            } catch (err) {
              steps.postSearch = { ok: false, detail: errText(err) };
            }

            try {
              const xai = xaiClient();
              const fromDate = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
              const prompt =
                'Do both of these, then answer in two short lines. ' +
                '1) Call the cost_meter tool and report monthUsedUsd. ' +
                `2) Use X search to find the most recent post by @${CHECK_HANDLE} and give its link.`;
              const result = await reinBudget.charge(
                'grok',
                grokEstimate(MODELS.light, prompt.length + 2000, 400, 3000, 10),
                () =>
                  generateText({
                    model: xai.responses(MODELS.light),
                    prompt,
                    maxOutputTokens: 400,
                    tools: {
                      x_search: xai.tools.xSearch({ allowedXHandles: [CHECK_HANDLE], fromDate }),
                      ...agentTools(ctx, ['cost_meter']),
                    },
                    stopWhen: stepCountIs(4),
                    providerOptions: grokOptions('check', 'low', { maxTurns: 2 }),
                    abortSignal: AbortSignal.timeout(GROK_TIMEOUT_MS),
                    telemetry: { functionId: 'check-tool-mixing' },
                  }),
                (r) => grokBilled(r) ?? grokCost(MODELS.light, r.usage),
              );
              const called = result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
              steps.toolMixing = {
                ok: called.includes('cost_meter') && called.some((n) => n === 'x_search'),
                toolsCalled: called,
                billedUsd: grokBilled(result),
                tokenMathUsd: grokCost(MODELS.light, result.usage),
                cachedInputTokens: result.usage.inputTokenDetails?.cacheReadTokens ?? 0,
                sources: (result.sources ?? []).slice(0, 3).map((s: any) => s.url ?? s.title ?? s.id),
                warnings: (result.warnings ?? []).map((w: any) => w.feature ?? w.message ?? w.type),
                answer: result.text.trim().slice(0, 400),
              };
            } catch (err) {
              steps.toolMixing = { ok: false, detail: errText(err) };
            }

            root.update({ output: steps });
            return {
              steps,
              traceId: getActiveTraceId() ?? null,
              runs: { check: checkBudget.runId, rein: reinBudget.runId },
              spend: await checkBudget.summary().catch((e) => ({ error: e.message })),
            };
          },
        ),
      { asType: 'agent' },
    )
  );
}

/**
 * Checks the algorithm index (free): its status, the published default weights against
 * param.rs, and the top hits for real questions Bil will ask.
 */
async function runAlgorithmCheck(questions: string[]) {
  const ctx: ToolContext = { budget: new Budget('check') };
  const status = await indexStatus();
  const weights = await impl.algorithm_params(ctx, { contains: 'Weight', limit: 60 });
  const answers: Record<string, unknown> = {};
  for (const q of questions) {
    const r = await impl.algorithm_search(ctx, { question: q, limit: 5 });
    answers[q] = { search: r.search, hits: r.hits.map((h) => `${h.file}:${h.lines.start}-${h.lines.end}`) };
  }
  return {
    status,
    weights: weights.params.map((p) => `${p.name}=${p.value} (${p.source.label})`),
    changes: weights.changes.length,
    defaultsSyncedAt: weights.defaultsSyncedAt,
    answers,
  };
}

/**
 * Reads one trace's observations back from Langfuse, trimmed to what an audit needs.
 * Uses the v2 observations API; the old /traces endpoint answers 410 Gone on v4 projects.
 */
async function readTrace(traceId: string) {
  const base = await startTracing();
  if (!base) return { ok: false, detail: 'tracing is off' };
  const auth = langfuseAuth();
  if (!auth) return { ok: false, detail: 'Langfuse keys are not set' };
  const url = new URL(`${base}/api/public/v2/observations`);
  url.searchParams.set('traceId', traceId);
  url.searchParams.set('fields', 'core,basic,io,metadata,model,usage,trace_context');
  url.searchParams.set('fromStartTime', new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString());
  url.searchParams.set('toStartTime', new Date(Date.now() + 60 * 1000).toISOString());
  url.searchParams.set('limit', '100');
  const res = await fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    const why = await res.text().catch(() => '');
    return { ok: false, detail: `Langfuse returned HTTP ${res.status}`, body: why.slice(0, 400) };
  }
  const { data = [] } = await res.json();
  return {
    ok: true,
    count: data.length,
    observations: data.map((o: Record<string, unknown>) => ({
      id: o.id,
      parentObservationId: o.parentObservationId,
      isRoot: o.isRootObservation,
      type: o.type,
      name: o.name,
      traceName: o.traceName,
      environment: o.environment,
      userId: o.userId,
      tags: o.tags,
      level: o.level,
      statusMessage: o.statusMessage,
      model: o.model,
      usageDetails: o.usageDetails,
      totalCost: o.totalCost,
      input: o.input,
      output: o.output,
      metadata: o.metadata,
    })),
  };
}

/** Writes each model's prices to Langfuse (PUT replaces by id, so repeating is safe). */
async function syncPrices() {
  const base = await startTracing();
  const auth = langfuseAuth();
  if (!base || !auth) return { ok: false, detail: 'Langfuse is not set up' };
  const results: Record<string, string> = {};
  for (const [model, prices] of Object.entries(PRICES)) {
    const id = `backlot-${model.replace(/[^a-z0-9]+/gi, '-')}`;
    const res = await fetch(`${base}/api/public/models/${id}`, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        modelName: model,
        matchPattern: `(?i)^${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
        unit: 'TOKENS',
        pricingTiers: [{ name: 'Standard', isDefault: true, priority: 0, conditions: [], prices }],
      }),
    });
    const text = await res.text().catch(() => '');
    results[model] = res.ok ? 'saved' : `HTTP ${res.status}: ${text.slice(0, 300)}`;
  }
  return { ok: Object.values(results).every((r) => r === 'saved'), results };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  if (!(await isAdmin(req.headers.get('x-backlot-admin') ?? ''))) return reply(401, { error: 'not allowed' });

  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === 'run') return reply(200, await runCheck());
    if (body.action === 'toolbox') return reply(200, await runToolboxCheck());
    if (body.action === 'rein') {
      // Asks Rein over HTTP with the server key, exactly as Bil will. A real niche only.
      if (typeof body.niche !== 'string' || !body.niche.trim()) return reply(400, { error: 'rein needs a niche' });
      const r = await callRein({ niche: body.niche, region: body.region, video: body.video === true });
      return reply(200, { reinStatus: r.status, ...r.body });
    }
    if (body.action === 'algorithm') {
      const qs = Array.isArray(body.questions) ? body.questions.filter((q: unknown) => typeof q === 'string').slice(0, 5) : [];
      return reply(200, await runAlgorithmCheck(qs));
    }
    if (body.action === 'prices') return reply(200, await syncPrices());
    if (body.action === 'spend') return reply(200, await new Budget('check').summary());
    if (body.action === 'names') {
      // Names of the secrets you added, never their values. Platform defaults are left out.
      const builtIn = /^(SUPABASE_|SB_|DENO_|DENO$|HOME$|PATH$|HOSTNAME$|PWD$|LANG$|TZ$|EDGE_|EXECUTION_ID$|VERIFY_JWT$|OTEL_|NODE_)/;
      return reply(200, { names: Object.keys(Deno.env.toObject()).filter((n) => !builtIn.test(n)).sort() });
    }
    if (body.action === 'trace' && typeof body.traceId === 'string' && /^[a-f0-9]{32}$/.test(body.traceId)) {
      return reply(200, await readTrace(body.traceId));
    }
    return reply(400, { error: 'action must be "run", "toolbox", "algorithm", "rein", "names", "spend", "prices", or "trace" with a 32-character traceId' });
  } catch (err) {
    if (err instanceof SpendLimitError) return reply(402, { error: err.message, reason: err.reason });
    console.error('agent-check failed', err);
    return reply(500, { error: err instanceof Error ? err.message : 'failed' });
  }
});
