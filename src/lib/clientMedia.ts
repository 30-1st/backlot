import { supabase } from './supabase';

// The Library: each client's real photos and videos in a private bucket, with tags.
// Files live at <workspace id>/<client id>/<random name>. The database only lets the team
// and that client read or add them, and only the server's daily job ever deletes them.
// The app shows a file through a signed link that stops working after an hour.

export type LibraryItem = {
  id: string;
  clientId: string;
  path: string;
  kind: 'photo' | 'video';
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationS: number | null;
  tags: string[];
  note: string | null;
  createdAt: string;
  removedAt: string | null;
  status: MediaStatus;
  /** Only files with this on may ever appear on the client's Kris page. */
  krisOk: boolean;
};

export type MediaStatus = 'new' | 'approved' | 'retired';

export const MAX_BYTES = 50 * 1024 * 1024;
const KEEP_REMOVED_DAYS = 7;
const TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

/** Tags offered on every file. The client's own post types and most-used tags join these. */
export const BASE_TAGS = [
  'selfie',
  'mirror selfie',
  'face',
  'full body',
  'close up',
  'outfit',
  'at home',
  'night out',
  'gym',
  'travel',
  'food',
  'lifestyle',
  'behind the scenes',
  'talking to camera',
  'product',
  'b-roll',
];

function db() {
  if (!supabase) throw new Error('This build is offline. The Library needs the hosted app.');
  return supabase;
}

/** The type a file really is, from the browser or, failing that, its extension. */
export function mimeOf(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const t = file.type || TYPES[ext] || '';
  return Object.values(TYPES).includes(t) ? t : null;
}

/** A sentence saying why a file cannot be added, or null when it can. */
export function refuse(file: File): string | null {
  if (!mimeOf(file)) return `"${file.name}" is not a photo or video Backlot can keep (JPG, PNG, WEBP, HEIC, GIF, MP4, MOV or WEBM).`;
  if (file.size > MAX_BYTES) return `"${file.name}" is larger than 50 MB, the limit for one file.`;
  if (file.size === 0) return `"${file.name}" is empty.`;
  return null;
}

function row(r: Record<string, unknown>): LibraryItem {
  return {
    id: String(r.id),
    clientId: String(r.client_id),
    path: String(r.path),
    kind: r.kind === 'video' ? 'video' : 'photo',
    mime: String(r.mime),
    bytes: Number(r.bytes),
    width: r.width == null ? null : Number(r.width),
    height: r.height == null ? null : Number(r.height),
    durationS: r.duration_s == null ? null : Number(r.duration_s),
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    note: (r.note as string | null) ?? null,
    createdAt: String(r.created_at),
    removedAt: (r.removed_at as string | null) ?? null,
    status: r.status === 'approved' || r.status === 'retired' ? r.status : 'new',
    krisOk: Boolean(r.kris_ok),
  };
}

/** A client's files, newest first, plus anything removed in the last 7 days. */
export async function listLibrary(clientId: string): Promise<LibraryItem[]> {
  const since = new Date(Date.now() - KEEP_REMOVED_DAYS * 86_400_000).toISOString();
  const { data, error } = await db()
    .from('library_items')
    .select('id, client_id, path, kind, mime, bytes, width, height, duration_s, tags, note, created_at, removed_at, status, kris_ok')
    .eq('client_id', clientId)
    .or(`removed_at.is.null,removed_at.gt.${since}`)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).map(row);
}

/** The client's post types, offered as tags so files line up with how Bil plans. */
export async function postTypeTags(clientId: string): Promise<string[]> {
  const { data } = await db().from('post_type_libraries').select('library').eq('client_id', clientId).maybeSingle();
  const types: Array<{ name?: string }> = (data?.library as { types?: Array<{ name?: string }> } | null)?.types ?? [];
  return types
    .map((t) => String(t.name ?? '').toLowerCase().trim())
    .filter((t) => /^[a-z0-9][a-z0-9 -]{0,31}$/.test(t))
    .slice(0, 12);
}

const signed = new Map<string, { url: string; until: number }>();

/** Signed links for a set of files, reused until shortly before they expire. */
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const fresh = [...new Set(paths)].filter((p) => (signed.get(p)?.until ?? 0) <= now);
  for (let i = 0; i < fresh.length; i += 100) {
    const chunk = fresh.slice(i, i + 100);
    const { data, error } = await db().storage.from('library').createSignedUrls(chunk, 3600);
    if (error) throw new Error(error.message);
    for (const d of data ?? []) if (d.path && d.signedUrl) signed.set(d.path, { url: d.signedUrl, until: now + 50 * 60_000 });
  }
  const out: Record<string, string> = {};
  for (const p of paths) {
    const s = signed.get(p);
    if (s) out[p] = s.url;
  }
  return out;
}

async function measure(file: File, kind: 'photo' | 'video'): Promise<{ width?: number; height?: number; duration?: number }> {
  try {
    if (kind === 'photo') {
      const bmp = await createImageBitmap(file);
      const out = { width: bmp.width, height: bmp.height };
      bmp.close();
      return out;
    }
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((resolve) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;
        const done = () => resolve({ width: v.videoWidth || undefined, height: v.videoHeight || undefined, duration: Number.isFinite(v.duration) ? Math.round(v.duration * 100) / 100 : undefined });
        v.onloadedmetadata = done;
        v.onerror = () => resolve({});
        window.setTimeout(() => resolve({}), 8000);
        v.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    // Some formats (HEIC in most browsers) cannot be measured here. Sizes stay blank.
    return {};
  }
}

function randomName(ext: string): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}.${ext}`;
}

/** Upload one file into a client's Library and record it. */
export async function addFile(workspaceId: string, clientId: string, file: File, tags: string[] = []): Promise<string> {
  const why = refuse(file);
  if (why) throw new Error(why);
  const mime = mimeOf(file)!;
  const kind = mime.startsWith('video/') ? 'video' : 'photo';
  const ext = Object.entries(TYPES).find(([, t]) => t === mime)?.[0] ?? 'bin';
  const path = `${workspaceId}/${clientId}/${randomName(ext)}`;
  const size = await measure(file, kind);
  const { error: upError } = await db().storage.from('library').upload(path, file, { contentType: mime, upsert: false, cacheControl: '3600' });
  if (upError) throw new Error(`"${file.name}" could not be uploaded. Check your connection and try again.`);
  const { data, error } = await db().rpc('library_add', {
    p_client: clientId,
    p_path: path,
    p_kind: kind,
    p_mime: mime,
    p_bytes: file.size,
    p_width: size.width ?? null,
    p_height: size.height ?? null,
    p_duration: size.duration ?? null,
    p_tags: tags,
    p_note: null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function setTags(id: string, tags: string[], note: string | null): Promise<void> {
  const { error } = await db().rpc('library_set', { p_id: id, p_tags: tags, p_note: note });
  if (error) throw new Error(error.message);
}

export async function setStatus(id: string, status: MediaStatus, krisOk: boolean): Promise<void> {
  const { error } = await db().rpc('library_status', { p_id: id, p_status: status, p_kris_ok: krisOk });
  if (error) throw new Error(error.message);
}

export async function removeFile(id: string): Promise<void> {
  const { error } = await db().rpc('library_remove', { p_id: id });
  if (error) throw new Error(error.message);
}

export async function restoreFile(id: string): Promise<void> {
  const { error } = await db().rpc('library_restore', { p_id: id });
  if (error) throw new Error(error.message);
}

/** Lowercase, single spaces, letters, digits, spaces and dashes, 32 characters at most. */
export function cleanTag(t: string): string | null {
  const c = t.toLowerCase().trim().replace(/\s+/g, ' ');
  return /^[a-z0-9][a-z0-9 -]{0,31}$/.test(c) ? c : null;
}
