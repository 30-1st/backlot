// How Backlot's server code asks Rein for a brief: one HTTP call to the rein function, so
// Rein gets her own 150-second budget instead of sharing the caller's.

import { serverKey } from './spend.ts';
import type { ReinRequest } from './schemas/rein.ts';

/** What one fresh Rein brief costs at most, for previews and estimates. A reused brief is free. */
export const REIN_ESTIMATE_USD = 1.1;

/** Just under Supabase's 150 s request limit. */
const REIN_CALL_TIMEOUT_MS = 145_000;

export async function callRein(
  request: Partial<ReinRequest> & { niche: string },
  timeoutMs = REIN_CALL_TIMEOUT_MS,
): Promise<{ status: number; body: any }> {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/rein`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { apikey: serverKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  return { status: res.status, body };
}
