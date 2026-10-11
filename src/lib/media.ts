import { createContext, useContext, useEffect, useState } from 'react';
import type { MediaItem } from '../types';
import { blobDelete, blobGet, blobKeys, blobPut } from './db';
import { currentUserId, hosted, supabase } from './supabase';

// Photos and videos.
//
// Offline build: files live in this browser's own storage and nowhere else.
// Hosted build: files are uploaded to the creator's private folder in
// Supabase Storage, and this browser's storage is only a cache that makes
// them appear instantly the next time.

const BUCKET = 'media';
/** Largest single photo or video the hosted build accepts. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Unused files are only cleaned off the server once they are this old, so a
 *  file added on another device a moment ago is never mistaken for unused. */
const SERVER_CLEANUP_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Whose folder the media on screen lives in. Null means the signed-in
 * creator's own. A narration someone shared keeps its files in the author's
 * folder, so anything drawn from it is wrapped in this with the author's id.
 */
export const MediaOwner = createContext<string | null>(null);

// New files go to the signed-in creator's folder, unless a shared narration is
// open for editing. Then they go next to the rest of that narration.
let uploadFolder: string | null = null;
export function setUploadFolder(owner: string | null): void {
  uploadFolder = owner;
}

const urls = new Map<string, string>();
// Files from someone else's folder that this visit has shown or added. They
// are not in the creator's own library, so tidying must leave them alone
// while they may still be on screen.
const borrowed = new Set<string>();
const pending = new Map<string, Promise<string | undefined>>();

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** A name for a stored file that cannot be guessed. */
function fileId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `m_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function isMediaFile(file: File): boolean {
  return file.type.startsWith('image/') || file.type.startsWith('video/');
}

/** Why a file could not be kept. */
export class MediaError extends Error {
  constructor(
    public reason: 'too_large' | 'upload',
    public fileName: string,
  ) {
    super(reason);
  }

  /** A sentence the creator can act on. */
  get sentence(): string {
    return this.reason === 'too_large'
      ? `"${this.fileName}" is larger than 50 MB, which is the limit for one file.`
      : `"${this.fileName}" could not be uploaded. Check your connection and add it again.`;
  }
}

/**
 * Take a file the creator picked and keep it.
 * Offline this always succeeds. Hosted, it fails if the upload fails, because
 * a file that only exists in this browser would vanish everywhere else.
 */
export async function storeFile(file: File): Promise<MediaItem> {
  const id = fileId();
  if (supabase) {
    if (file.size > MAX_UPLOAD_BYTES) throw new MediaError('too_large', file.name);
    const owner = uploadFolder ?? (await currentUserId());
    if (!owner) throw new MediaError('upload', file.name);
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(`${owner}/${id}`, file, { contentType: file.type, cacheControl: '31536000' });
    if (error) throw new MediaError('upload', file.name);
  }
  if (uploadFolder) borrowed.add(id);
  urls.set(id, URL.createObjectURL(file));
  try {
    await blobPut(id, file);
  } catch {
    // Offline: still usable for this visit; the app shows a "not saved" notice separately.
    // Hosted: the copy on the server is the real one, so a missing cache entry is harmless.
  }
  return { id, kind: file.type.startsWith('video/') ? 'video' : 'image' };
}

/** Keep several files, reporting the ones that could not be kept instead of stopping at the first. */
export async function storeFiles(files: File[]): Promise<{ items: MediaItem[]; problems: string[] }> {
  const items: MediaItem[] = [];
  const problems: string[] = [];
  for (const file of files) {
    try {
      items.push(await storeFile(file));
    } catch (err) {
      problems.push(err instanceof MediaError ? err.sentence : `"${file.name}" could not be added.`);
    }
  }
  return { items, problems };
}

async function fetchBlob(id: string, folder: string | null): Promise<Blob | undefined> {
  const cached = await blobGet(id).catch(() => undefined);
  if (cached || !supabase) return cached;
  const owner = folder ?? (await currentUserId());
  if (!owner) return undefined;
  const { data } = await supabase.storage.from(BUCKET).download(`${owner}/${id}`);
  if (!data) return undefined;
  void blobPut(id, data).catch(() => undefined);
  return data;
}

function load(id: string, folder: string | null): Promise<string | undefined> {
  let job = pending.get(id);
  if (!job) {
    if (folder) borrowed.add(id);
    job = fetchBlob(id, folder)
      .then((blob) => {
        if (!blob) return undefined;
        const url = URL.createObjectURL(blob);
        urls.set(id, url);
        return url;
      })
      .catch(() => undefined)
      .finally(() => pending.delete(id));
    pending.set(id, job);
  }
  return job;
}

/** A URL the browser can show for this media item, or undefined while it loads or if it is gone. */
export function useMediaUrl(item: MediaItem | undefined): string | undefined {
  const [, bump] = useState(0);
  const folder = useContext(MediaOwner);
  const id = item?.id;
  const inline = item?.src;

  useEffect(() => {
    if (!id || inline || urls.has(id)) return;
    let alive = true;
    void load(id, folder).then((url) => {
      if (alive && url) bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [id, inline, folder]);

  if (!item) return undefined;
  return item.src ?? urls.get(item.id);
}

function forget(id: string) {
  const url = urls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urls.delete(id);
  }
}

/** Delete stored files that no narration or save point uses any more. */
export async function pruneMedia(keep: Set<string>): Promise<void> {
  try {
    for (const key of await blobKeys()) {
      if (keep.has(key) || borrowed.has(key)) continue;
      await blobDelete(key);
      forget(key);
    }
  } catch {
    // Leaving a few unused files behind is harmless.
  }
  if (hosted) await pruneServerMedia(keep).catch(() => undefined);
}

async function pruneServerMedia(keep: Set<string>): Promise<void> {
  if (!supabase) return;
  const owner = await currentUserId();
  if (!owner) return;
  const cutoff = Date.now() - SERVER_CLEANUP_AGE_MS;
  const unused: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(owner, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error || !data) return;
    for (const file of data) {
      const created = file.created_at ? new Date(file.created_at).getTime() : Date.now();
      if (!keep.has(file.name) && created < cutoff) unused.push(`${owner}/${file.name}`);
    }
    if (data.length < 1000) break;
  }
  for (let i = 0; i < unused.length; i += 100) {
    await supabase.storage.from(BUCKET).remove(unused.slice(i, i + 100));
  }
}

/** Empty this browser's copy of the media. Used on sign-out so the next person starts clean. */
export async function clearMediaCache(): Promise<void> {
  try {
    borrowed.clear();
    uploadFolder = null;
    for (const key of await blobKeys()) {
      await blobDelete(key);
      forget(key);
    }
  } catch {
    // Nothing more to do if the browser will not let us.
  }
}
