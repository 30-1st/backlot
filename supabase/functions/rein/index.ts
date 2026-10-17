// Rein's front door. Only Backlot's own server code (Bil, the admin checker) may call it,
// with a project server key in the `apikey` header. Supabase's platform JWT check is off
// for this function (config.toml) because server keys are not JWTs; this code checks the
// key itself, in constant time, against the keys in the function's own environment.
// Signed-in users and browsers are refused.

import { ReinRequest } from '../_shared/schemas/rein.ts';
import { ReinBusyError, runRein } from '../_shared/rein.ts';
import { serverKeys, SpendLimitError } from '../_shared/spend.ts';

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function digest(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

/** True when `given` equals one of the project's server keys. Compares hashes, so timing reveals nothing. */
async function isServerKey(given: string): Promise<boolean> {
  if (!given) return false;
  const g = await digest(given);
  let match = false;
  for (const key of serverKeys()) {
    const k = await digest(key);
    let diff = 0;
    for (let i = 0; i < k.length; i++) diff |= k[i] ^ g[i];
    if (diff === 0) match = true;
  }
  return match;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  if (!(await isServerKey(req.headers.get('apikey') ?? ''))) return reply(401, { error: 'not allowed' });

  const parsed = ReinRequest.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return reply(400, { error: 'bad request', issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) });

  try {
    return reply(200, await runRein(parsed.data));
  } catch (err) {
    if (err instanceof ReinBusyError) return reply(409, { error: err.message });
    if (err instanceof SpendLimitError) return reply(402, { error: err.message, reason: err.reason });
    console.error('rein failed', err instanceof Error ? err.message : err);
    return reply(500, { error: err instanceof Error ? err.message.slice(0, 500) : 'failed' });
  }
});
