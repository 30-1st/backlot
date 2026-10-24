// The public door for client rooms (K1). The rooms site calls nothing else.
//
// Visitors have no Backlot login, so this function checks everything itself:
//   * only the rooms site may call it from a browser (its own CORS rule, apart from the app's)
//   * limits per visitor and per room; a visitor is a hash of their address with a secret
//     that changes daily, never the address itself
//   * an open room is public; draft, preview and closed rooms need a signed preview ticket
//   * the bot check (Cloudflare Turnstile) is verified here, never trusted from the page
//
// It returns only what a room shows: name, handle, look, greeting, buttons (approved
// links only) and a short-lived link to a hero file marked OK for Kris. Never client or
// workspace ids, never the brand kit beyond those links.
//
// Actions (POST JSON with "action"):
//   open    { slug, preview? }           the room as visitors see it
//   verify  { slug, token, preview? }    checks a Turnstile pass and gives a 2-hour visit ticket

import { serviceClient } from '../_shared/spend.ts';
import { secret } from '../_shared/secrets.ts';
import { readTicket, ROOMS_SITE, signTicket, VISIT_HOURS } from '../_shared/rooms.ts';

const MAX_BODY = 4_096;
const MEDIA_SECONDS = 900;
const SLUG = /^[a-z0-9_]{3,30}$/;

function allowed(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol === 'https:' && (u.hostname === ROOMS_SITE || u.hostname.endsWith(`.${ROOMS_SITE}`))) return true;
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

function headers(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (origin && allowed(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

/**
 * The visitor's address as Cloudflare saw it. Tested live on Oct 24, 2026 (positions and
 * test values only, no real addresses logged): the platform sits behind Cloudflare, which
 * sets CF-Connecting-IP and refused a request that tried to supply its own (403).
 * X-Forwarded-For arrived with three entries, the visitor first and internal hops after,
 * and an X-Forwarded-For sent by the caller was replaced, not kept. So the last entry is
 * an internal hop, never the visitor.
 */
function visitorAddress(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const first = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim();
  return first || 'unknown';
}

let saltCache: { day: string; salt: string } | null = null;

async function visitorKey(req: Request): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  if (saltCache?.day !== day) {
    const { data, error } = await serviceClient().rpc('room_salt');
    if (error || !data) throw new Error('Could not read the day\'s salt');
    saltCache = { day, salt: String(data) };
  }
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${saltCache.salt}:${visitorAddress(req)}`)));
  return Array.from(bytes.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function withinLimits(limits: Array<{ key: string; window: number; limit: number }>): Promise<boolean> {
  const { data, error } = await serviceClient().rpc('room_hit', { p_limits: limits });
  if (error) throw new Error(`Limits unavailable: ${error.message}`);
  return data === true;
}

type Room = { client_id: string; workspace_id: string; slug: string; status: string; preset: string; accent: string; greeting: string; buttons: unknown; hero_id: string | null };

/** The room if this caller may see it: anyone for an open room, otherwise a valid preview ticket. */
async function viewable(slug: string, preview: string | undefined): Promise<Room | null> {
  const { data, error } = await serviceClient()
    .from('rooms')
    .select('client_id, workspace_id, slug, status, preset, accent, greeting, buttons, hero_id')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(`Could not read the room: ${error.message}`);
  if (!data) return null;
  if (data.status === 'open') return data as Room;
  if (!(await readTicket(preview, 'preview', slug))) return null;
  return data as Room;
}

async function view(room: Room) {
  const db = serviceClient();
  const { data: client, error } = await db.from('clients').select('x_handle, profile').eq('id', room.client_id).eq('owner_id', room.workspace_id).maybeSingle();
  if (error || !client) throw new Error('Could not read the client');
  const profile = (client.profile ?? {}) as { displayName?: string; links?: Array<{ label?: string; url?: string }>; adultContent?: boolean };
  const adult = Boolean(profile.adultContent);
  const links = Array.isArray(profile.links) ? profile.links : [];
  const buttons = (Array.isArray(room.buttons) ? room.buttons : [])
    .map((b: any) => {
      const link = links[Number(b?.link)];
      const url = typeof link?.url === 'string' && /^https:\/\/[^\s]+$/.test(link.url) ? link.url : null;
      return url ? { label: String(b.label).slice(0, 40), url } : null;
    })
    .filter(Boolean);

  let hero: { kind: 'photo' | 'video'; url: string } | null = null;
  if (!adult && room.hero_id) {
    const { data: item } = await db
      .from('library_items')
      .select('path, kind, kris_ok, status, removed_at, client_id')
      .eq('id', room.hero_id)
      .maybeSingle();
    if (item && item.client_id === room.client_id && item.kris_ok && item.status !== 'retired' && !item.removed_at) {
      const { data: signed } = await db.storage.from('library').createSignedUrl(item.path, MEDIA_SECONDS);
      if (signed?.signedUrl) hero = { kind: item.kind, url: signed.signedUrl };
    }
  }

  return {
    state: room.status === 'open' ? 'open' : room.status === 'closed' ? 'closed' : 'preview',
    slug: room.slug,
    handle: String(client.x_handle),
    name: String(profile.displayName || client.x_handle).slice(0, 80),
    preset: adult ? 'creator_adult' : room.preset,
    accent: room.accent,
    greeting: room.greeting,
    buttons,
    hero,
    ageGate: adult,
  };
}

async function verifyTurnstile(token: string, req: Request): Promise<{ ok: boolean; why?: string }> {
  const key = secret('turnstileSecretKey');
  if (!key) return { ok: false, why: 'not_set_up' };
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: key, response: token, remoteip: visitorAddress(req), idempotency_key: crypto.randomUUID() }),
    signal: AbortSignal.timeout(8_000),
  });
  const out = (await res.json().catch(() => ({}))) as { success?: boolean; hostname?: string; action?: string; 'error-codes'?: string[] };
  if (!out.success) return { ok: false, why: (out['error-codes'] ?? ['failed']).join(',').slice(0, 100) };
  const host = String(out.hostname ?? '');
  if (!(host === ROOMS_SITE || host.endsWith(`.${ROOMS_SITE}`) || host === 'localhost')) return { ok: false, why: 'hostname' };
  if (out.action !== 'room') return { ok: false, why: 'action' };
  return { ok: true };
}

Deno.serve(async (req) => {
  const h = headers(req);
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: h });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  if (!h['Access-Control-Allow-Origin']) return reply(403, { error: 'Not allowed' });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return reply(413, { error: 'Too large' });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400, { error: 'Send JSON' });
  }
  const slug = String(body.slug ?? '').toLowerCase();
  if (!SLUG.test(slug)) return reply(404, { state: 'private' });
  const preview = typeof body.preview === 'string' ? body.preview : undefined;

  try {
    const who = await visitorKey(req);
    if (body.action === 'open') {
      const ok = await withinLimits([
        { key: `v:${who}:open`, window: 60, limit: 60 },
        { key: `v:${who}:day`, window: 86_400, limit: 1_000 },
        { key: `r:${slug}:day`, window: 86_400, limit: 20_000 },
      ]);
      if (!ok) return reply(429, { error: 'Too many visits. Try again in a minute.' });
      const room = await viewable(slug, preview);
      // A room that does not exist and one that is private look the same from outside.
      if (!room) return reply(404, { state: 'private' });
      return reply(200, await view(room));
    }

    if (body.action === 'verify') {
      const ok = await withinLimits([
        { key: `v:${who}:verify`, window: 60, limit: 10 },
        { key: `v:${who}:day`, window: 86_400, limit: 1_000 },
      ]);
      if (!ok) return reply(429, { error: 'Too many tries. Try again in a minute.' });
      const token = typeof body.token === 'string' ? body.token : '';
      if (!token || token.length > 2_048) return reply(400, { error: 'Missing the bot check' });
      const room = await viewable(slug, preview);
      if (!room) return reply(404, { state: 'private' });
      const check = await verifyTurnstile(token, req);
      if (!check.ok) return reply(check.why === 'not_set_up' ? 503 : 403, { error: check.why === 'not_set_up' ? 'The bot check is not set up yet.' : 'The bot check did not pass. Try again.', why: check.why });
      const exp = Date.now() + VISIT_HOURS * 3_600_000;
      return reply(200, { ticket: await signTicket({ kind: 'visit', slug, exp }), expiresAt: new Date(exp).toISOString() });
    }

    return reply(400, { error: 'Unknown action. Use open or verify.' });
  } catch (err) {
    console.error('room failed', err instanceof Error ? err.message : err);
    return reply(500, { error: 'Something went wrong. Try again.' });
  }
});
