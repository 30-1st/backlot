// Runs Bil's queued campaign steps. Called every 10 seconds by pg_cron, only while a step
// is waiting (see migration bil_pipeline), and by the bil function right after a campaign
// is queued.
//
// Every 15 minutes, while any stored file has not been checked, pg_cron calls it with
// { "job": "scrub_media" } to clean leftover photo and video metadata (migration media_scrub).
//
// Every 10 seconds, while an Opportunity Meeting stage is waiting, pg_cron calls it with
// { "job": "opportunity" } (see migration opportunity_meetings).
//
// Once an hour pg_cron also calls it with { "job": "kris_pitches" }, only when some client
// has an opening, so Kris can bring a pitch on her own (see migration kris_pitches).
//
// Every 5 minutes while an eval run is going, and once an hour otherwise, pg_cron calls it
// with { "job": "eval" }: a gate run when an agent's knowledge changed, the daily sample
// once a day (see migration wins_and_evals and eval_tick).
//
// Every 15 minutes, while some client has X connected, pg_cron calls it with
// { "job": "xev_inbox" } so Xev can check those DMs for buyers (migration x_connect).
//
// The caller must present the worker token from public.internal_config. The platform's
// JWT check is off because the scheduler has no user session.
//
// The function answers at once and works in the background (EdgeRuntime.waitUntil), so
// the scheduler's 5-second request timeout never cuts a step short. Supabase stops a
// worker 150 seconds after it starts, so a step is claimed only if its time budget fits
// in what this worker has left; otherwise a fresh worker picks it up on the next tick.

import { drain } from '../_shared/bil.ts';
import { drainOpportunities } from '../_shared/opportunity.ts';
import { krisPitches } from '../_shared/kris.ts';
import { scrubStoredMedia } from '../_shared/media-scrub.ts';
import { evalTick } from '../_shared/evals.ts';
import { inboxTick } from '../_shared/x-connect.ts';
import { sameSecret, workerToken } from '../_shared/worker-token.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

/** When this worker started; Supabase's wall-clock limit counts from here. */
const BOOT_AT = Date.now();
/** Steps one worker runs side by side, at most. */
const MAX_DRAINS = 2;
let draining = 0;
/** Opportunity Meeting stages one worker runs side by side, at most. */
const MAX_MEETINGS = 2;
let meeting = 0;

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  let expected: string;
  try {
    expected = await workerToken();
  } catch {
    return reply(500, { error: 'server' });
  }
  if (!(await sameSecret(req.headers.get('x-bil-token') ?? '', expected))) return reply(401, { error: 'not allowed' });
  const body = await req.json().catch(() => null);

  if (body && typeof body === 'object' && (body as { job?: unknown }).job === 'kris_pitches') {
    EdgeRuntime.waitUntil(
      krisPitches()
        .then((n) => console.log(`bil-worker: Kris sent ${n} pitch${n === 1 ? '' : 'es'}`))
        .catch((err) => console.error('bil-worker: Kris pitches failed', err instanceof Error ? err.message : err)),
    );
    return reply(202, { accepted: true, job: 'kris_pitches' });
  }

  if (body && typeof body === 'object' && (body as { job?: unknown }).job === 'eval') {
    EdgeRuntime.waitUntil(
      evalTick(BOOT_AT)
        .then((r) => console.log(`bil-worker: eval ${r}`))
        .catch((err) => console.error('bil-worker: eval failed', err instanceof Error ? err.message : err)),
    );
    return reply(202, { accepted: true, job: 'eval' });
  }

  if (body && typeof body === 'object' && (body as { job?: unknown }).job === 'xev_inbox') {
    EdgeRuntime.waitUntil(
      inboxTick(BOOT_AT)
        .then((r) => console.log(`bil-worker: xev inbox ${r}`))
        .catch((err) => console.error('bil-worker: xev inbox failed', err instanceof Error ? err.message : err)),
    );
    return reply(202, { accepted: true, job: 'xev_inbox' });
  }

  if (body && typeof body === 'object' && (body as { job?: unknown }).job === 'scrub_media') {
    // Stops 30 seconds before Supabase's 150-second limit; the next tick carries on.
    EdgeRuntime.waitUntil(
      scrubStoredMedia(BOOT_AT + 120_000)
        .then((r) => console.log(`bil-worker: media scrub checked ${r.checked}, cleaned ${r.cleaned}, skipped ${r.skipped}`))
        .catch((err) => console.error('bil-worker: media scrub failed', err instanceof Error ? err.message : err)),
    );
    return reply(202, { accepted: true, job: 'scrub_media' });
  }

  // Rein's Opportunity Meetings, one stage at a time (pg_cron's opportunity-tick, or a start).
  if (body && typeof body === 'object' && (body as { job?: unknown }).job === 'opportunity') {
    if (meeting >= MAX_MEETINGS) return reply(202, { accepted: false, reason: 'busy', job: 'opportunity' });
    meeting++;
    EdgeRuntime.waitUntil(
      drainOpportunities(BOOT_AT)
        .then((n) => n && console.log(`bil-worker: ran ${n} meeting stage${n === 1 ? '' : 's'}`))
        .catch((err) => console.error('bil-worker: meetings failed', err instanceof Error ? err.message : err))
        .finally(() => meeting--),
    );
    return reply(202, { accepted: true, job: 'opportunity' });
  }

  if (draining >= MAX_DRAINS) return reply(202, { accepted: false, reason: 'busy', uptimeMs: Date.now() - BOOT_AT });
  draining++;
  EdgeRuntime.waitUntil(
    drain(BOOT_AT)
      .catch((err) => console.error('bil-worker: drain failed', err instanceof Error ? err.message : err))
      .finally(() => draining--),
  );
  return reply(202, { accepted: true, uptimeMs: Date.now() - BOOT_AT });
});
