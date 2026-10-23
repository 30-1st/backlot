import { supabase } from './supabase';

// The inspiration board: X posts and screenshots the client or team want more of, or less
// of, each with a short note. Bil reads the verdict and the note, never the image and never
// the linked post. Items fade after 28 days unless pinned; the daily cleanup job deletes
// unpinned items at 90 days and removed ones after 7.

export type Verdict = 'more' | 'not';
export type BoardItem = {
  id: string;
  clientId: string;
  kind: 'link' | 'shot';
  url: string | null;
  path: string | null;
  verdict: Verdict;
  note: string;
  pinned: boolean;
  createdAt: string;
  removedAt: string | null;
};

export const FADE_DAYS = 28;
export const MAX_SHOT_BYTES = 10 * 1024 * 1024;
const KEEP_REMOVED_DAYS = 7;
const SHOT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
};

function db() {
  if (!supabase) throw new Error('This build is offline. The board needs the hosted app.');
  return supabase;
}

/** An X post link, cleaned to https://x.com/<handle>/status/<id>, or null if it is not one. */
export function cleanPostUrl(raw: string): string | null {
  const m = raw.trim().match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{1,25})/i);
  return m ? `https://x.com/${m[1]}/status/${m[2]}` : null;
}

export function handleOf(url: string): string {
  return url.match(/x\.com\/([A-Za-z0-9_]{1,15})\//)?.[1] ?? '';
}

/** True when Bil no longer reads this item: older than 28 days and not pinned. */
export function isFaded(item: BoardItem, now = Date.now()): boolean {
  return !item.pinned && now - Date.parse(item.createdAt) > FADE_DAYS * 86_400_000;
}

/** Whole days left before an item fades, never below 0. */
export function daysLeft(item: BoardItem, now = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(item.createdAt) + FADE_DAYS * 86_400_000 - now) / 86_400_000));
}

function row(r: Record<string, unknown>): BoardItem {
  return {
    id: String(r.id),
    clientId: String(r.client_id),
    kind: r.kind === 'shot' ? 'shot' : 'link',
    url: (r.url as string | null) ?? null,
    path: (r.path as string | null) ?? null,
    verdict: r.verdict === 'not' ? 'not' : 'more',
    note: String(r.note ?? ''),
    pinned: Boolean(r.pinned),
    createdAt: String(r.created_at),
    removedAt: (r.removed_at as string | null) ?? null,
  };
}

/** A client's board, newest first, plus anything removed in the last 7 days. */
export async function listBoard(clientId: string): Promise<BoardItem[]> {
  const since = new Date(Date.now() - KEEP_REMOVED_DAYS * 86_400_000).toISOString();
  const { data, error } = await db()
    .from('inspiration_items')
    .select('id, client_id, kind, url, path, verdict, note, pinned, created_at, removed_at')
    .eq('client_id', clientId)
    .or(`removed_at.is.null,removed_at.gt.${since}`)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map(row);
}

/** Signed links for screenshots, good for an hour. */
export async function shotUrls(paths: string[]): Promise<Record<string, string>> {
  const list = [...new Set(paths)];
  if (!list.length) return {};
  const { data, error } = await db().storage.from('board').createSignedUrls(list, 3600);
  if (error) throw new Error(error.message);
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}

export function refuseShot(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const type = file.type || SHOT_TYPES[ext] || '';
  if (!Object.values(SHOT_TYPES).includes(type)) return 'Screenshots can be JPG, PNG, WEBP, HEIC or GIF.';
  if (file.size > MAX_SHOT_BYTES) return 'That screenshot is larger than 10 MB.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}

function randomName(ext: string): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}.${ext}`;
}

export async function addLink(clientId: string, url: string, verdict: Verdict, note: string): Promise<void> {
  const clean = cleanPostUrl(url);
  if (!clean) throw new Error('Paste a link to one X post, like x.com/handle/status/123.');
  const { error } = await db().rpc('board_add', { p_client: clientId, p_kind: 'link', p_url: clean, p_path: null, p_verdict: verdict, p_note: note });
  if (error) throw new Error(error.message);
}

export async function addShot(workspaceId: string, clientId: string, file: File, verdict: Verdict, note: string): Promise<void> {
  const why = refuseShot(file);
  if (why) throw new Error(why);
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const type = file.type || SHOT_TYPES[ext];
  const name = randomName(Object.entries(SHOT_TYPES).find(([, t]) => t === type)?.[0] ?? 'png');
  const path = `${workspaceId}/${clientId}/${name}`;
  const { error: up } = await db().storage.from('board').upload(path, file, { contentType: type, upsert: false, cacheControl: '3600' });
  if (up) throw new Error('The screenshot could not be uploaded. Check your connection and try again.');
  const { error } = await db().rpc('board_add', { p_client: clientId, p_kind: 'shot', p_url: null, p_path: path, p_verdict: verdict, p_note: note });
  if (error) throw new Error(error.message);
}

export async function setItem(id: string, verdict: Verdict, note: string, pinned: boolean): Promise<void> {
  const { error } = await db().rpc('board_set', { p_id: id, p_verdict: verdict, p_note: note, p_pinned: pinned });
  if (error) throw new Error(error.message);
}

export async function removeItem(id: string, removed: boolean): Promise<void> {
  const { error } = await db().rpc('board_remove', { p_id: id, p_removed: removed });
  if (error) throw new Error(error.message);
}
