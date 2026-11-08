// Phone notifications (approved by Khma, Nov 7, 2026): Web Push to the installed app.
//
// Something happens (Bil finishes a plan, a post needs a detail, Xev spots a ready buyer, a
// post is due within the hour, a client reviews posts) -> notify() queues one notice per
// person who should know, then tries to send it straight away. A person gets at most one
// push every 15 minutes; anything else waiting is combined into the next one. In their quiet
// hours (9 PM to 9 AM by default, their own time) everything waits, except a buyer who is
// ready to buy or book. The push says what happened in a few words and opens the right
// screen; it never carries post text, DM text or a buyer's details.
//
// The VAPID key pair is made here on first use and kept in Vault (push_vapid_init), so the
// private key never sits in the repo, a secret setting or a chat.

import { buildPushPayload } from 'npm:@block65/webcrypto-web-push@2.0.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import { z } from './schemas/common.ts';
import { serviceClient } from './spend.ts';
import type { Member } from './workspace.ts';

export type PushKind = 'plan_ready' | 'next_ready' | 'needs_detail' | 'buyer' | 'due_soon' | 'client_review' | 'test';
type Audience = 'client' | 'team' | 'both';

const GAP_MS = 15 * 60_000;
/** Who the push says it is from, for the push services (a page, never a person's email). */
const SUBJECT = 'https://backlot-as9.pages.dev';

type Vapid = { publicKey: string; privateKey: string };
let cached: Vapid | null = null;

/** The hour (0 to 23) right now in a time zone, or null if the zone is unknown. */
function localHour(timeZone: string): number | null {
  try {
    const n = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date()));
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
  } catch {
    return null;
  }
}
/** True inside quiet hours. A window like 21 to 9 wraps past midnight. */
function inQuiet(hour: number, from: number, to: number): boolean {
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The app's VAPID key pair, made once and kept in Vault. */
export async function vapidKeys(db: SupabaseClient = serviceClient()): Promise<Vapid> {
  if (cached) return cached;
  const { data, error } = await db.rpc('push_vapid_get');
  if (error) throw new Error(`Could not read the push key: ${error.message}`);
  let pair = data as Vapid | null;
  if (!pair?.publicKey) {
    const key = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair;
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key.publicKey));
    const jwk = await crypto.subtle.exportKey('jwk', key.privateKey);
    const { data: saved, error: sError } = await db.rpc('push_vapid_init', { p_pair: { publicKey: b64url(raw), privateKey: jwk.d } });
    if (sError) throw new Error(`Could not save the push key: ${sError.message}`);
    pair = saved as Vapid;
  }
  cached = { publicKey: pair.publicKey, privateKey: pair.privateKey };
  return cached;
}

/** The people who should hear about a client: the client's own login, and/or the owner and the team granted that client. */
async function audienceOf(db: SupabaseClient, clientId: string, workspaceId: string, who: Audience): Promise<string[]> {
  const ids = new Set<string>();
  if (who !== 'team') {
    const { data } = await db.from('workspace_members').select('user_id').eq('workspace_id', workspaceId).eq('role', 'client').eq('client_id', clientId);
    for (const r of data ?? []) ids.add(r.user_id);
  }
  if (who !== 'client') {
    const [{ data: owners }, { data: granted }] = await Promise.all([
      db.from('workspace_members').select('user_id').eq('workspace_id', workspaceId).eq('role', 'owner'),
      db.from('client_access').select('member_id').eq('client_id', clientId).eq('workspace_id', workspaceId),
    ]);
    for (const r of owners ?? []) ids.add(r.user_id);
    for (const r of granted ?? []) ids.add(r.member_id);
  }
  return [...ids];
}

export type Notice = {
  clientId: string;
  workspaceId: string;
  audience: Audience;
  kind: PushKind;
  title: string;
  body: string;
  /** The app screen to open, like "campaigns.<id>.2" or "xev". */
  path: string;
  /** One notice per thing: the same ref is never sent twice to the same person. */
  ref: string;
  /** A buyer ready to buy or book: comes through in quiet hours and without the 15-minute wait. */
  urgent?: boolean;
  /** Leave this person out (they did the thing themselves). */
  except?: string;
};

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s).replace(/\s*—\s*/g, ', ');

/**
 * Queues a notice for everyone who should know, then sends what it can right away.
 * Never throws: a notification must never break the work that caused it.
 */
export async function notify(n: Notice, db: SupabaseClient = serviceClient()): Promise<void> {
  try {
    const users = (await audienceOf(db, n.clientId, n.workspaceId, n.audience)).filter((u) => u !== n.except);
    if (!users.length) return;
    // Only people with a device signed up; nobody else has anywhere to receive it.
    const { data: devs } = await db.from('push_devices').select('user_id').in('user_id', users);
    const reachable = [...new Set((devs ?? []).map((d: { user_id: string }) => d.user_id))];
    if (!reachable.length) return;
    const rows = reachable.map((user_id) => ({
      user_id,
      client_id: n.clientId,
      kind: n.kind,
      title: cut(n.title, 80),
      body: cut(n.body, 240),
      path: n.path.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 160) || 'today',
      ref: n.ref.slice(0, 160),
      urgent: Boolean(n.urgent),
    }));
    const { error } = await db.from('push_queue').upsert(rows, { onConflict: 'user_id,ref', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    await Promise.all(reachable.map((u) => flushUser(db, u)));
  } catch (err) {
    console.warn('push: notify failed', n.kind, err instanceof Error ? err.message : err);
  }
}

type Row = { id: number; kind: PushKind; title: string; body: string; path: string; urgent: boolean; created_at: string };

/** Sends what is due for one person, combining everything waiting into one push. */
export async function flushUser(db: SupabaseClient, userId: string): Promise<number> {
  const [{ data: waiting }, { data: prefs }, { data: last }] = await Promise.all([
    db.from('push_queue').select('id, kind, title, body, path, urgent, created_at').eq('user_id', userId).is('sent_at', null).order('created_at').limit(20),
    db.from('push_prefs').select('enabled, quiet_from, quiet_to, timezone').eq('user_id', userId).maybeSingle(),
    db.from('push_queue').select('sent_at').eq('user_id', userId).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  let rows = (waiting ?? []) as Row[];
  if (!rows.length) return 0;
  if (prefs && !prefs.enabled) {
    // Switched off: nothing waits around to arrive later in a burst.
    await db.from('push_queue').delete().eq('user_id', userId).is('sent_at', null);
    return 0;
  }
  const hour = localHour(prefs?.timezone ?? 'America/New_York');
  const quiet = hour !== null && inQuiet(hour, prefs?.quiet_from ?? 21, prefs?.quiet_to ?? 9);
  const recent = last?.sent_at ? Date.now() - Date.parse(last.sent_at) < GAP_MS : false;
  const urgent = rows.filter((r) => r.urgent);
  if (quiet || recent) {
    if (!urgent.length) return 0;
    rows = urgent;
  }
  // Claim the rows first, so two workers never send the same push.
  const { data: claimed } = await db.from('push_queue').update({ sent_at: new Date().toISOString() }).in('id', rows.map((r) => r.id)).is('sent_at', null).select('id');
  const ids = new Set((claimed ?? []).map((r: { id: number }) => r.id));
  rows = rows.filter((r) => ids.has(r.id));
  if (!rows.length) return 0;

  const top = urgent.find((r) => ids.has(r.id)) ?? rows[rows.length - 1];
  const message =
    rows.length === 1
      ? { title: top.title, body: top.body, path: top.path }
      : {
          title: top.urgent ? top.title : `${rows.length} updates in Backlot`,
          body: cut(top.urgent ? `${top.body} Plus ${rows.length - 1} more.` : rows.map((r) => r.title).join(' · '), 240),
          path: top.urgent ? top.path : 'today',
        };
  return await sendTo(db, userId, { ...message, tag: rows.length === 1 ? `bl-${top.kind}` : 'bl-updates' }, top.urgent);
}

/** Delivers one push to each of a person's devices; drops devices the push service says are gone. */
async function sendTo(db: SupabaseClient, userId: string, msg: { title: string; body: string; path: string; tag: string }, urgent: boolean): Promise<number> {
  const { data: devices } = await db.from('push_devices').select('id, endpoint, p256dh, auth, fails').eq('user_id', userId);
  if (!devices?.length) return 0;
  const vapid = await vapidKeys(db);
  let ok = 0;
  await Promise.all(
    devices.map(async (d: { id: string; endpoint: string; p256dh: string; auth: string; fails: number }) => {
      try {
        const payload = await buildPushPayload(
          { data: msg, options: { ttl: urgent ? 6 * 3600 : 24 * 3600, urgency: urgent ? 'high' : 'normal', topic: msg.tag.slice(0, 32) } },
          { endpoint: d.endpoint, expirationTime: null, keys: { p256dh: d.p256dh, auth: d.auth } },
          { subject: SUBJECT, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
        );
        const res = await fetch(d.endpoint, { ...payload, signal: AbortSignal.timeout(10_000) });
        if (res.status === 404 || res.status === 410) {
          await db.from('push_devices').delete().eq('id', d.id);
        } else if (res.ok) {
          ok++;
          await db.from('push_devices').update({ last_ok_at: new Date().toISOString(), fails: 0 }).eq('id', d.id);
        } else {
          console.warn('push: send refused', res.status, (await res.text().catch(() => '')).slice(0, 200));
          await db.from('push_devices').update({ fails: d.fails + 1 }).eq('id', d.id);
        }
      } catch (err) {
        console.warn('push: send failed', err instanceof Error ? err.message : err);
        await db.from('push_devices').update({ fails: d.fails + 1 }).eq('id', d.id);
      }
    }),
  );
  return ok;
}

/** The push tick: anything waiting that can go now, and posts due within the hour. */
export async function pushTick(): Promise<string> {
  const db = serviceClient();
  const due = await dueSoon(db).catch((err) => {
    console.warn('push: due-soon check failed', err instanceof Error ? err.message : err);
    return 0;
  });
  const { data } = await db.from('push_queue').select('user_id').is('sent_at', null).limit(500);
  const users = [...new Set((data ?? []).map((r: { user_id: string }) => r.user_id))];
  let sent = 0;
  for (const u of users) sent += await flushUser(db, u).catch(() => 0);
  return `${due} due soon, ${sent} sent, ${users.length} people waiting`;
}

/** Wall-clock time in a time zone to a real instant (the plan's windows are in the client's time). */
function zoned(date: string, hhmm: string, timeZone: string): number {
  const guess = Date.parse(`${date}T${hhmm}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return guess - (asIfUtc - guess);
}

/** Posts that start within the next hour and still have no yes. One notice per post. */
async function dueSoon(db: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - 21 * 86_400_000).toISOString();
  const { data: camps } = await db.from('campaigns').select('id, client_id, owner_id, plan').is('discarded_at', null).in('status', ['approved', 'ready']).gte('created_at', since).limit(200);
  if (!camps?.length) return 0;
  const { data: pend } = await db.from('campaign_posts').select('campaign_id, slot').in('campaign_id', camps.map((c: any) => c.id)).eq('status', 'ok').eq('review', 'pending');
  if (!pend?.length) return 0;
  const tzOf = new Map<string, string>();
  const { data: clients } = await db.from('clients').select('id, profile').in('id', [...new Set(camps.map((c: any) => c.client_id))]);
  for (const c of clients ?? []) tzOf.set(c.id, (c.profile as { timezone?: string } | null)?.timezone || 'America/New_York');
  const now = Date.now();
  let n = 0;
  for (const p of pend as Array<{ campaign_id: string; slot: number }>) {
    const c = camps.find((x: any) => x.id === p.campaign_id) as any;
    const slot = (c?.plan?.slots ?? []).find((s: any) => s.slot === p.slot);
    const start = String(slot?.postWindow ?? '').match(/^(\d{1,2}):(\d{2})/);
    if (!c?.plan?.startDate || !slot || !start) continue;
    const day = new Date(Date.parse(`${c.plan.startDate}T12:00:00Z`) + Number(slot.dayOffset ?? 0) * 86_400_000).toISOString().slice(0, 10);
    let at: number;
    try {
      at = zoned(day, `${start[1].padStart(2, '0')}:${start[2]}`, tzOf.get(c.client_id) ?? 'America/New_York');
    } catch {
      continue;
    }
    if (at <= now || at - now > 60 * 60_000) continue;
    const mins = Math.max(5, Math.round((at - now) / 60_000 / 5) * 5);
    await notify(
      {
        clientId: c.client_id,
        workspaceId: c.owner_id,
        audience: 'both',
        kind: 'due_soon',
        title: 'A post is due soon',
        body: `Post ${p.slot} of "${String(c.plan.title ?? 'your plan').slice(0, 60)}" goes up in about ${mins} minutes and still needs a yes.`,
        path: `campaigns.${c.id}.${p.slot}`,
        ref: `due:${c.id}:${p.slot}`,
      },
      db,
    );
    n++;
  }
  return n;
}

// ---------- what the app calls ----------

export const PushSubscribeRequest = z.object({
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith('https://'), 'Not a push address.'),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
  label: z.string().trim().max(80).optional(),
  timezone: z.string().trim().min(3).max(64).optional(),
});
export const PushUnsubscribeRequest = z.object({ endpoint: z.string().url().max(1000).optional() });
export const PushPrefsRequest = z.object({
  enabled: z.boolean().optional(),
  quietFrom: z.number().int().min(0).max(23).optional(),
  quietTo: z.number().int().min(0).max(23).optional(),
  timezone: z.string().trim().min(3).max(64).optional(),
});

const validZone = (tz?: string) => {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
};

/** The public key the app needs to sign a device up. */
export async function pushKey() {
  return { publicKey: (await vapidKeys()).publicKey };
}

/** Signs this device up for this person. A device moves to whoever signed in on it last. */
export async function pushSubscribe(m: Member, req: z.infer<typeof PushSubscribeRequest>) {
  const db = serviceClient();
  const { error } = await db
    .from('push_devices')
    .upsert({ user_id: m.userId, endpoint: req.endpoint, p256dh: req.keys.p256dh, auth: req.keys.auth, label: req.label ?? null, fails: 0 }, { onConflict: 'endpoint' });
  if (error) throw new Error(`Could not save this device: ${error.message}`);
  // A client with Backlot on their phone: their onboarding step ticks itself.
  if (m.role === 'client' && m.clientId) {
    await db.from('onboarding_steps').upsert({ client_id: m.clientId, workspace_id: m.workspaceId, step: 'phone', done_by: m.userId }, { onConflict: 'client_id,step', ignoreDuplicates: true });
  }
  const tz = validZone(req.timezone);
  await db.from('push_prefs').upsert({ user_id: m.userId, enabled: true, ...(tz ? { timezone: tz } : {}), updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  return pushStatus(m);
}

/** Takes this device off (or every device, with no endpoint). */
export async function pushUnsubscribe(m: Member, req: z.infer<typeof PushUnsubscribeRequest>) {
  const db = serviceClient();
  let q = db.from('push_devices').delete().eq('user_id', m.userId);
  if (req.endpoint) q = q.eq('endpoint', req.endpoint);
  const { error } = await q;
  if (error) throw new Error(`Could not remove this device: ${error.message}`);
  return pushStatus(m);
}

export async function pushPrefs(m: Member, req: z.infer<typeof PushPrefsRequest>) {
  const db = serviceClient();
  const tz = validZone(req.timezone);
  const { error } = await db.from('push_prefs').upsert(
    {
      user_id: m.userId,
      ...(req.enabled !== undefined ? { enabled: req.enabled } : {}),
      ...(req.quietFrom !== undefined ? { quiet_from: req.quietFrom } : {}),
      ...(req.quietTo !== undefined ? { quiet_to: req.quietTo } : {}),
      ...(tz ? { timezone: tz } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) throw new Error(`Could not save your notification settings: ${error.message}`);
  return pushStatus(m);
}

export async function pushStatus(m: Member) {
  const db = serviceClient();
  const [{ data: prefs }, { count }] = await Promise.all([
    db.from('push_prefs').select('enabled, quiet_from, quiet_to, timezone').eq('user_id', m.userId).maybeSingle(),
    db.from('push_devices').select('id', { count: 'exact', head: true }).eq('user_id', m.userId),
  ]);
  return { enabled: prefs?.enabled ?? true, quietFrom: prefs?.quiet_from ?? 21, quietTo: prefs?.quiet_to ?? 9, timezone: prefs?.timezone ?? 'America/New_York', devices: count ?? 0 };
}

/** Sends a test push to this person's devices right now (no quiet hours, no wait). */
export async function pushTest(m: Member) {
  const db = serviceClient();
  const sent = await sendTo(db, m.userId, { title: 'Backlot notifications are on', body: 'This is how Bil, Kris, Rein and Xev will reach you.', path: 'today', tag: 'bl-test' }, false);
  return { sent };
}
