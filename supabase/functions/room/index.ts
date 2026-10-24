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
// links only) and a short-lived link to a hero file marked OK for Kris (in adult rooms,
// only one the team confirmed is not explicit). Never client or
// workspace ids, never the brand kit beyond those links.
//
// Actions (POST JSON with "action"):
//   open     { slug, preview? }                         the room as visitors see it
//   verify   { slug, token, preview? }                  a Turnstile pass starts a visit: a 2-hour ticket with a random visit id
//   tap      { slug, kind: faq|link, preview? }         counts a tap (no ticket, nothing about the visitor kept)
//   history  { slug, ticket, preview? }                 this visit's messages, after a reload
//   chat     { slug, ticket, text, after, preview? }    one message; code checks first, the AI only for what is left (K2)
//   (tap also takes after: "handoff" for a link tapped from a warm handoff)
//   delete   { slug, ticket, preview? }                 deletes this visit's chat at once
//
// Chat is live when the room's chat switch is on. Before that, a preview link can still
// chat as a test, paid from the separate $1 test budget.

import { serviceClient, SpendLimitError } from '../_shared/spend.ts';
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

type Room = { client_id: string; workspace_id: string; slug: string; status: string; preset: string; accent: string; greeting: string; buttons: unknown; hero_id: string | null; hero_clean_by: string | null; chat_on: boolean };

/** The room if this caller may see it: anyone for an open room, otherwise a valid preview ticket. */
async function viewable(slug: string, preview: string | undefined): Promise<{ room: Room; previewed: boolean } | null> {
  const { data, error } = await serviceClient()
    .from('rooms')
    .select('client_id, workspace_id, slug, status, preset, accent, greeting, buttons, hero_id, hero_clean_by, chat_on')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(`Could not read the room: ${error.message}`);
  if (!data) return null;
  const previewed = Boolean(await readTicket(preview, 'preview', slug));
  if (data.status !== 'open' && !previewed) return null;
  return { room: data as Room, previewed };
}

/** How Kris chats here: live, as a test on the test budget (preview links only), or not yet. */
const chatMode = (v: { room: Room; previewed: boolean }): 'room' | 'test' | null => (v.room.chat_on ? 'room' : v.previewed ? 'test' : null);

async function view(v: { room: Room; previewed: boolean }) {
  const { room } = v;
  const db = serviceClient();
  const { data: client, error } = await db.from('clients').select('x_handle, profile').eq('id', room.client_id).eq('owner_id', room.workspace_id).maybeSingle();
  if (error || !client) throw new Error('Could not read the client');
  const profile = (client.profile ?? {}) as { displayName?: string; links?: Array<{ label?: string; url?: string }>; adultContent?: boolean; faq?: Array<{ q?: string; a?: string }> };
  const adult = Boolean(profile.adultContent);
  const links = (Array.isArray(profile.links) ? profile.links : [])
    .slice(0, 12)
    .map((l) => ({ label: String(l?.label ?? '').slice(0, 60), url: typeof l?.url === 'string' && /^https:\/\/[^\s]+$/.test(l.url) ? l.url : '' }));
  const buttons = (Array.isArray(room.buttons) ? room.buttons : [])
    .map((b: any) => {
      const link = links[Number(b?.link)];
      return link?.url ? { label: String(b.label).slice(0, 40), url: link.url } : null;
    })
    .filter(Boolean);
  // The FAQ comes with the room, so tapping a question costs nothing and needs no AI.
  const faq = (Array.isArray(profile.faq) ? profile.faq : [])
    .map((f) => ({ q: String(f?.q ?? '').slice(0, 200), a: String(f?.a ?? '').slice(0, 500) }))
    .filter((f) => f.q && f.a)
    .slice(0, 6);

  let hero: { kind: 'photo' | 'video'; url: string } | null = null;
  // Adult rooms show a file only if the team confirmed it shows no nudity or sexual activity.
  if (room.hero_id && (!adult || room.hero_clean_by)) {
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
    preset: room.preset,
    accent: room.accent,
    greeting: room.greeting,
    buttons,
    links: links.map((l) => (l.url ? l : null)),
    faq,
    hero,
    ageGate: adult,
    chat: chatMode(v) ?? 'off',
  };
}

const WANTS_DELETE = /\b(delete|erase|remove|wipe|clear) (my|this|the|our) (chat|messages?|data|conversation|history)\b|\bforget (me|this chat|everything)\b/i;
const MAX_TEXT = 500;
const VISIT_AI_CAP = 40;

type Msg = { seq: number; role: 'visitor' | 'kris'; body: string; links: number[]; source: string };

async function visitMessages(visitId: string, limit = 40): Promise<Msg[]> {
  const { data, error } = await serviceClient()
    .from('room_messages')
    .select('seq, role, body, links, source')
    .eq('visit_id', visitId)
    .order('seq', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not read the chat: ${error.message}`);
  return ((data ?? []) as Msg[]).reverse();
}

async function count(clientId: string, field: string, n = 1) {
  const { error } = await serviceClient().rpc('room_count', { p_client: clientId, p_field: field, p_n: n });
  if (error) console.error('room count failed', field, error.message);
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
      const v = await viewable(slug, preview);
      // A room that does not exist and one that is private look the same from outside.
      if (!v) return reply(404, { state: 'private' });
      return reply(200, await view(v));
    }

    if (body.action === 'verify') {
      const ok = await withinLimits([
        { key: `v:${who}:verify`, window: 60, limit: 10 },
        { key: `v:${who}:day`, window: 86_400, limit: 1_000 },
      ]);
      if (!ok) return reply(429, { error: 'Too many tries. Try again in a minute.' });
      const token = typeof body.token === 'string' ? body.token : '';
      if (!token || token.length > 2_048) return reply(400, { error: 'Missing the bot check' });
      const v = await viewable(slug, preview);
      if (!v) return reply(404, { state: 'private' });
      const mode = chatMode(v);
      if (!mode) return reply(403, { error: 'Chat is not open here yet.' });
      const check = await verifyTurnstile(token, req);
      if (!check.ok) return reply(check.why === 'not_set_up' ? 503 : 403, { error: check.why === 'not_set_up' ? 'The bot check is not set up yet.' : 'The bot check did not pass. Try again.', why: check.why });
      // A new visit: a random id, nothing about the person.
      const vid = crypto.randomUUID();
      const { error } = await serviceClient().from('room_visits').insert({ id: vid, client_id: v.room.client_id, workspace_id: v.room.workspace_id, test: mode === 'test' });
      if (error) throw new Error(`Could not start the visit: ${error.message}`);
      if (mode === 'room') await count(v.room.client_id, 'visits');
      const exp = Date.now() + VISIT_HOURS * 3_600_000;
      return reply(200, { ticket: await signTicket({ kind: 'visit', slug, exp, vid }), expiresAt: new Date(exp).toISOString() });
    }

    // Counts a tap on an FAQ question or a link. Nothing about the visitor is kept.
    if (body.action === 'tap') {
      const ok = await withinLimits([{ key: `v:${who}:tap`, window: 60, limit: 60 }]);
      if (!ok) return reply(429, { error: 'Slow down a little.' });
      const v = await viewable(slug, preview);
      if (!v) return reply(404, { state: 'private' });
      if (v.room.status === 'open') {
        await count(v.room.client_id, body.kind === 'faq' ? 'faq_taps' : 'link_taps');
        // A link tapped right after a warm handoff, so we can see whether handoffs turn into clicks.
        if (body.kind === 'link' && body.after === 'handoff') await count(v.room.client_id, 'handoff_taps');
      }
      return reply(200, { ok: true });
    }

    // Everything below needs a visit ticket.
    const ticket = await readTicket(typeof body.ticket === 'string' ? body.ticket : undefined, 'visit', slug);
    if (body.action === 'history' || body.action === 'delete' || body.action === 'chat') {
      if (!ticket?.vid) return reply(401, { error: 'This chat ended. Start again.', reverify: true });
      const v = await viewable(slug, preview);
      if (!v) return reply(404, { state: 'private' });
      const { data: visit, error: vErr } = await serviceClient()
        .from('room_visits')
        .select('id, client_id, ai_replies, minor, crisis, spending, test')
        .eq('id', ticket.vid)
        .maybeSingle();
      if (vErr) throw new Error(`Could not read the visit: ${vErr.message}`);
      if (!visit || visit.client_id !== v.room.client_id) return reply(401, { error: 'This chat ended. Start again.', reverify: true });

      if (body.action === 'history') return reply(200, { messages: await visitMessages(visit.id) });

      if (body.action === 'delete') {
        await serviceClient().from('room_visits').delete().eq('id', visit.id);
        return reply(200, { deleted: true });
      }

      // ---------- chat ----------
      const mode = chatMode(v);
      if (!mode) return reply(403, { error: 'Chat is not open here yet.' });
      const adult = await (async () => {
        const { data } = await serviceClient().from('clients').select('profile').eq('id', v.room.client_id).maybeSingle();
        return Boolean((data?.profile as { adultContent?: boolean } | null)?.adultContent);
      })();
      if (visit.minor && adult) return reply(403, { error: 'This room is for adults only.', closed: true });
      const text = String(body.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
      if (!text) return reply(400, { error: 'Type a message first.' });
      const ok = await withinLimits([
        { key: `v:${who}:chat`, window: 60, limit: 12 },
        { key: `r:${slug}:chat:day`, window: 86_400, limit: 3_000 },
      ]);
      if (!ok) return reply(429, { error: 'That is a lot of messages. Try again in a minute.' });

      if (WANTS_DELETE.test(text)) {
        await serviceClient().from('room_visits').delete().eq('id', visit.id);
        return reply(200, { deleted: true });
      }

      const recent = await visitMessages(visit.id, 16);
      const last = recent.length ? recent[recent.length - 1].seq : 0;
      if (Number(body.after ?? -1) !== last) return reply(409, { error: 'This chat changed in another tab.', resync: true, messages: await visitMessages(visit.id) });

      const host = await import('../_shared/kris-host.ts');
      const kit = await host.loadRoomKit(serviceClient(), v.room.client_id, v.room.workspace_id);
      const resting = { body: `I am taking a short break. Here is where to find ${kit.name}:`, links: visit.spending || visit.minor || visit.crisis ? [] : kit.links.slice(0, 3).map((_, i) => i), source: 'fixed' as const };
      const flags = { crisis: visit.crisis, minor: visit.minor, spending: visit.spending };
      let rep: import('../_shared/kris-host.ts').Reply | null = host.codeReply(text, kit, flags);
      if (!rep) {
        const aiOk = visit.ai_replies < VISIT_AI_CAP &&
          (await withinLimits([
            { key: `v:${who}:ai:day`, window: 86_400, limit: 80 },
            { key: `r:${slug}:ai:day`, window: 86_400, limit: 400 },
          ]));
        if (!aiOk) {
          rep = resting;
        } else {
          try {
            rep = await host.aiReply({
              kit,
              history: recent.map((m) => ({ role: m.role, body: m.body })),
              text,
              flags,
              clientId: v.room.client_id,
              mode,
            });
          } catch (err) {
            if (err instanceof SpendLimitError) rep = resting;
            else {
              console.error('kris room reply failed', err instanceof Error ? err.message : err);
              rep = { body: 'I lost my words for a second. Try asking again?', links: [], source: 'fixed' };
            }
          }
        }
      }

      const { data: saved, error: sErr } = await serviceClient()
        .from('room_messages')
        .insert([
          { visit_id: visit.id, seq: last + 1, role: 'visitor', body: text, links: [], source: 'visitor' },
          { visit_id: visit.id, seq: last + 2, role: 'kris', body: rep.body, links: rep.links, source: rep.source },
        ])
        .select('seq, role, body, links, source');
      if (sErr) {
        if (sErr.code === '23505') return reply(409, { error: 'This chat changed in another tab.', resync: true, messages: await visitMessages(visit.id) });
        throw new Error(`Could not save the chat: ${sErr.message}`);
      }
      await serviceClient()
        .from('room_visits')
        .update({
          last_at: new Date().toISOString(),
          ai_replies: visit.ai_replies + (rep.source === 'ai' ? 1 : 0),
          ...(rep.flag === 'crisis' ? { crisis: true } : {}),
          ...(rep.flag === 'minor' ? { minor: true } : {}),
          ...(rep.flag === 'spending' ? { spending: true } : {}),
        })
        .eq('id', visit.id);
      if (mode === 'room') {
        if (last === 0) await count(v.room.client_id, 'chats');
        if (rep.source === 'ai') await count(v.room.client_id, 'ai_replies');
        if (rep.source === 'redirect') await count(v.room.client_id, 'redirects');
        if (rep.source === 'handoff') await count(v.room.client_id, 'handoffs');
      }
      return reply(200, { messages: saved, closed: Boolean(rep.closeChat) });
    }

    return reply(400, { error: 'Unknown action. Use open, verify, tap, history, chat or delete.' });
  } catch (err) {
    console.error('room failed', err instanceof Error ? err.message : err);
    return reply(500, { error: 'Something went wrong. Try again.' });
  }
});
