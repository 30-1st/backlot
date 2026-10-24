// Shared pieces for client rooms (K1): where the rooms site lives, and the signed
// preview links and visit tickets.
//
// Tickets are "<payload>.<signature>", the payload base64url JSON and the signature an
// HMAC-SHA256 with the server-only room key from public.internal_config. Nothing about a
// visitor is inside them: only the room name, what the ticket is for, and when it ends.

import { serviceClient } from './spend.ts';

/**
 * The rooms site's address on Cloudflare Pages. Set when the Pages project is made;
 * each deployment's preview address sits under it.
 */
export const ROOMS_SITE = 'backlot-rooms.pages.dev';
export const ROOMS_URL = `https://${ROOMS_SITE}`;

/** Preview links last a day, so the team can open them on a phone or in X's browser. */
export const PREVIEW_HOURS = 24;
/** A visit ticket, given after the bot check, lasts 2 hours. */
export const VISIT_HOURS = 2;

let cached: { key: CryptoKey; at: number } | null = null;

async function roomKey(): Promise<CryptoKey> {
  if (cached && Date.now() - cached.at < 300_000) return cached.key;
  const { data, error } = await serviceClient().from('internal_config').select('value').eq('key', 'room_key').maybeSingle();
  if (error || !data?.value) throw new Error('The room key is not set');
  const raw = new Uint8Array((data.value as string).match(/../g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  cached = { key, at: Date.now() };
  return key;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

export type Ticket = { kind: 'preview' | 'visit'; slug: string; exp: number };

export async function signTicket(t: Ticket, key?: CryptoKey): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify(t)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key ?? (await roomKey()), new TextEncoder().encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

/** The ticket if its signature is right, it is for this room and kind, and it has not ended. */
export async function readTicket(token: string | undefined, kind: Ticket['kind'], slug: string, key?: CryptoKey): Promise<Ticket | null> {
  if (!token || token.length > 600) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', key ?? (await roomKey()), fromB64url(sig), new TextEncoder().encode(payload));
    if (!ok) return null;
    const t = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Ticket;
    if (t.kind !== kind || t.slug !== slug || typeof t.exp !== 'number' || t.exp < Date.now()) return null;
    return t;
  } catch {
    return null;
  }
}

/** A preview link for a room, good for PREVIEW_HOURS. The ticket goes after the #, so it is never sent to any server. */
export async function previewUrl(slug: string): Promise<{ url: string; expiresAt: string }> {
  const exp = Date.now() + PREVIEW_HOURS * 3_600_000;
  const token = await signTicket({ kind: 'preview', slug, exp });
  return { url: `${ROOMS_URL}/k/${slug}#preview=${token}`, expiresAt: new Date(exp).toISOString() };
}
