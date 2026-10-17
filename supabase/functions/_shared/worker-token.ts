// The bil-worker's token lives in public.internal_config, which only server code can
// read (same pattern as the daily cleanup job). Callers send it in x-bil-token.

import { serviceClient } from './spend.ts';

let cached: { value: string; at: number } | null = null;

/** The token, cached for a minute per worker so each tick costs no extra query. */
export async function workerToken(): Promise<string> {
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  const { data, error } = await serviceClient().from('internal_config').select('value').eq('key', 'bil_worker_token').maybeSingle();
  if (error || !data?.value) throw new Error('The worker token is not set');
  cached = { value: data.value, at: Date.now() };
  return data.value;
}

async function digest(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

/** Compares hashes, so timing reveals nothing about the token. */
export async function sameSecret(given: string, expected: string): Promise<boolean> {
  if (!given || !expected) return false;
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Wakes the worker now instead of waiting for the next 10-second tick. Best effort. */
export async function kickWorker(): Promise<void> {
  try {
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/bil-worker`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bil-token': await workerToken() },
      body: '{}',
      signal: AbortSignal.timeout(5_000),
    });
    await res.body?.cancel();
  } catch (err) {
    console.warn('bil: could not wake the worker; the scheduler will', err instanceof Error ? err.message : err);
  }
}
