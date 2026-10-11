import { useEffect, useState } from 'react';
import type { MediaItem } from '../types';
import { blobDelete, blobGet, blobKeys, blobPut } from './db';

// Uploaded files are kept in memory for this visit and in the browser's media
// store for the next one. Components ask for a displayable URL by media item.

const urls = new Map<string, string>();
const pending = new Map<string, Promise<string | undefined>>();

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function isMediaFile(file: File): boolean {
  return file.type.startsWith('image/') || file.type.startsWith('video/');
}

/** Take a file the creator picked and keep it. Resolves even if the browser refuses to save it. */
export async function storeFile(file: File): Promise<MediaItem> {
  const id = uid('m');
  urls.set(id, URL.createObjectURL(file));
  try {
    await blobPut(id, file);
  } catch {
    // Still usable for this visit; the app shows a "not saved" notice separately.
  }
  return { id, kind: file.type.startsWith('video/') ? 'video' : 'image' };
}

function load(id: string): Promise<string | undefined> {
  let job = pending.get(id);
  if (!job) {
    job = blobGet(id)
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
  const id = item?.id;
  const inline = item?.src;

  useEffect(() => {
    if (!id || inline || urls.has(id)) return;
    let alive = true;
    void load(id).then((url) => {
      if (alive && url) bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [id, inline]);

  if (!item) return undefined;
  return item.src ?? urls.get(item.id);
}

/** Delete stored files that neither the sandbox nor its save point still uses. */
export async function pruneMedia(keep: Set<string>): Promise<void> {
  try {
    for (const key of await blobKeys()) {
      if (keep.has(key)) continue;
      await blobDelete(key);
      const url = urls.get(key);
      if (url) {
        URL.revokeObjectURL(url);
        urls.delete(key);
      }
    }
  } catch {
    // Leaving a few unused files behind is harmless.
  }
}
