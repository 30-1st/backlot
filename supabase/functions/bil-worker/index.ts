// Runs Bil's queued campaign steps. Called every 10 seconds by pg_cron, only while a step
// is waiting (see migration bil_pipeline), and by the bil function right after a campaign
// is queued.
//
// The caller must present the worker token from public.internal_config. The platform's
// JWT check is off because the scheduler has no user session.
//
// The function answers at once and works in the background (EdgeRuntime.waitUntil), so
// the scheduler's 5-second request timeout never cuts a step short. Supabase stops a
// worker 150 seconds after it starts, so a step is claimed only if its time budget fits
// in what this worker has left; otherwise a fresh worker picks it up on the next tick.

import { drain } from '../_shared/bil.ts';
import { sameSecret, workerToken } from '../_shared/worker-token.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

/** When this worker started; Supabase's wall-clock limit counts from here. */
const BOOT_AT = Date.now();
/** Steps one worker runs side by side, at most. */
const MAX_DRAINS = 2;
let draining = 0;

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
  await req.body?.cancel();

  if (draining >= MAX_DRAINS) return reply(202, { accepted: false, reason: 'busy', uptimeMs: Date.now() - BOOT_AT });
  draining++;
  EdgeRuntime.waitUntil(
    drain(BOOT_AT)
      .catch((err) => console.error('bil-worker: drain failed', err instanceof Error ? err.message : err))
      .finally(() => draining--),
  );
  return reply(202, { accepted: true, uptimeMs: Date.now() - BOOT_AT });
});
