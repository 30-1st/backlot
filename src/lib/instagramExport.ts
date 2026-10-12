import { BlobReader, BlobWriter, TextWriter, ZipReader, configure, type Entry, type FileEntry } from '@zip.js/zip.js';
import type { MediaItem, Sandbox } from '../types';
import { newPost } from '../state';
import { MAX_UPLOAD_BYTES, MediaError, storeFile } from './media';
import { hosted } from './supabase';

// Reads the download Instagram gives every account holder (Accounts Center,
// "Export your information", JSON format) and turns it into a sandbox.
//
// Everything happens in this browser. Only the profile, the posts and their
// photos and videos are read; messages, comments, likes and the rest of the
// download are never opened.
//
// Instagram has changed this download's layout over the years, so files are
// found by name wherever they sit, and every field is read defensively.

// Inflating on the page is plenty for this, and avoids shipping a worker file.
configure({ useWebWorkers: false });

export interface ExportMedia {
  path: string;
  kind: MediaItem['kind'];
}

export interface ExportPost {
  date: number;
  caption: string;
  media: ExportMedia[];
}

export interface ExportProfile {
  username: string;
  name: string;
  bio: string;
  link: string;
  avatar: ExportMedia | null;
  followers: number | null;
  following: number | null;
}

export interface OpenedExport {
  profile: ExportProfile;
  /** Newest first. */
  posts: ExportPost[];
  /** Files the download points at that are not in it, for example in another part of a split download. */
  missing: number;
  /** Photos in a format browsers cannot show (such as HEIC). */
  unsupported: number;
  /** Look up a file inside the download. */
  file: (path: string) => FileEntry | undefined;
  close: () => Promise<void>;
}

export type ExportProblemReason = 'not_zip' | 'html' | 'no_posts';

export class ExportProblem extends Error {
  constructor(public reason: ExportProblemReason) {
    super(reason);
  }

  get sentence(): string {
    switch (this.reason) {
      case 'not_zip':
        return 'That file could not be opened. Choose the .zip file Instagram sent you, exactly as it downloaded, without unzipping it.';
      case 'html':
        return 'This download is in HTML format, and Backlot needs JSON. Ask Instagram for a new export with Format set to JSON (step 4).';
      case 'no_posts':
        return 'No posts were found in this download. Make sure "Your Instagram activity" was ticked and the date range was "All time" (step 4). If Instagram split it into parts, add all of them together.';
    }
  }
}

/* ---------- small helpers ---------- */

/**
 * Instagram writes text in its download byte by byte, so "café" arrives as
 * "cafÃ©" and emoji arrive as runs of odd letters. Put the real text back.
 */
export function fixText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  if (!/[\u0080-ÿ]/.test(raw) || /[^\u0000-ÿ]/.test(raw)) return raw;
  try {
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return raw;
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** Seconds or milliseconds, to milliseconds. */
const toMs = (v: number) => (v < 1e12 ? v * 1000 : v);

const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
const IMAGE = /\.(jpe?g|png|webp|gif)$/i;

function kindOf(path: string): MediaItem['kind'] | null {
  if (VIDEO.test(path)) return 'video';
  if (IMAGE.test(path)) return 'image';
  return null;
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

function mimeOf(path: string): string {
  return MIME[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

/** The first array found in a JSON value: the value itself, or one of its properties. */
function firstArray(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    for (const value of Object.values(json)) if (Array.isArray(value)) return value;
  }
  return [];
}

/**
 * Find a labelled text value anywhere in a JSON value. Older downloads use
 * { string_map_data: { Username: { value } } }; newer ones use
 * { label: "Username", value: "..." }.
 */
function findText(json: unknown, labels: string[]): string {
  const wanted = labels.map((l) => l.toLowerCase());
  let found = '';
  const walk = (node: unknown) => {
    if (found || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const obj = node as Record<string, unknown>;
    const map = obj.string_map_data;
    if (map && typeof map === 'object') {
      for (const [key, entry] of Object.entries(map as Record<string, unknown>)) {
        const value = (entry as { value?: unknown } | null)?.value;
        if (wanted.includes(key.toLowerCase()) && typeof value === 'string' && value) {
          found = value;
          return;
        }
      }
    }
    if (typeof obj.label === 'string' && wanted.includes(obj.label.toLowerCase()) && typeof obj.value === 'string' && obj.value) {
      found = obj.value;
      return;
    }
    Object.values(obj).forEach(walk);
  };
  walk(json);
  return fixText(found);
}

/** Find a file path stored under a label such as "Profile Photo". */
function findUri(json: unknown, label: RegExp): string {
  let found = '';
  const walk = (node: unknown, under: boolean) => {
    if (found || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, under));
    const obj = node as Record<string, unknown>;
    const here = under || (typeof obj.label === 'string' && label.test(obj.label));
    if (here && typeof obj.uri === 'string') {
      found = obj.uri;
      return;
    }
    if (here && typeof obj.href === 'string' && kindOf(obj.href)) {
      found = obj.href;
      return;
    }
    for (const [key, value] of Object.entries(obj)) walk(value, here || label.test(key));
  };
  walk(json, false);
  return found;
}

/* ---------- reading ---------- */

/** One post as Instagram writes it: either a single photo or a carousel. */
function readPost(raw: unknown): { date: number | null; caption: string; uris: string[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const post = raw as { media?: unknown; creation_timestamp?: unknown; title?: unknown };
  const media = Array.isArray(post.media) ? post.media : [];
  const items = media.filter(
    (m): m is { uri: string; creation_timestamp?: unknown; title?: unknown } =>
      !!m && typeof (m as { uri?: unknown }).uri === 'string',
  );
  if (items.length === 0) return null;
  // A carousel keeps its date and caption on the post. A single photo keeps
  // them on the photo itself.
  const stamps = items.map((m) => num(m.creation_timestamp)).filter((n): n is number => n !== null);
  const date = num(post.creation_timestamp) ?? (stamps.length ? Math.min(...stamps) : null);
  const caption = fixText(post.title) || fixText(items[0].title);
  return { date, caption, uris: items.map((m) => m.uri) };
}

async function readJson(entry: FileEntry): Promise<unknown> {
  try {
    return JSON.parse(await entry.getData(new TextWriter()));
  } catch {
    return null;
  }
}

/**
 * Open one or more downloaded zip files (Instagram sometimes splits a big
 * download into parts) and find the profile and the posts in them.
 */
export async function openExport(files: File[]): Promise<OpenedExport> {
  const readers: ZipReader<BlobReader>[] = [];
  const entries: FileEntry[] = [];
  for (const file of files) {
    try {
      const reader = new ZipReader(new BlobReader(file));
      const list = await reader.getEntries();
      readers.push(reader);
      for (const e of list as Entry[]) if (!e.directory) entries.push(e as FileEntry);
    } catch {
      // Not a zip. Reported below if nothing usable turns up.
    }
  }
  const close = async () => {
    await Promise.all(readers.map((r) => r.close().catch(() => undefined)));
  };
  if (entries.length === 0) {
    await close();
    throw new ExportProblem('not_zip');
  }

  // Paths, lower-cased, without any folder the zip was wrapped in.
  const byPath = new Map<string, FileEntry>();
  const byName = new Map<string, FileEntry>();
  for (const e of entries) {
    const path = e.filename.replace(/\\/g, '/');
    if (path.startsWith('__MACOSX/')) continue;
    byPath.set(path.toLowerCase(), e);
    byName.set(path.split('/').pop()!.toLowerCase(), e);
  }
  const file = (uri: string): FileEntry | undefined => {
    const want = uri.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
    const exact = byPath.get(want);
    if (exact) return exact;
    for (const [path, e] of byPath) if (path.endsWith(`/${want}`)) return e;
    return byName.get(want.split('/').pop() ?? '');
  };
  const named = (pattern: RegExp, skip?: RegExp) =>
    [...byPath.entries()].filter(([p]) => pattern.test(p) && !(skip && skip.test(p))).map(([, e]) => e);

  const jsons = named(/\.json$/);
  if (jsons.length === 0) {
    await close();
    throw new ExportProblem(named(/\.html?$/).length > 0 ? 'html' : 'not_zip');
  }

  // Posts and reels. Archived and deleted posts are not on the page, so they stay out.
  const hidden = /archived|recently_deleted|deleted/;
  const raw: Array<{ date: number | null; caption: string; uris: string[] }> = [];
  for (const entry of named(/(^|\/)posts_\d+\.json$/, hidden)) {
    for (const p of firstArray(await readJson(entry))) {
      const post = readPost(p);
      if (post) raw.push(post);
    }
  }
  for (const entry of named(/(^|\/)reels(_\d+)?\.json$/, hidden)) {
    for (const p of firstArray(await readJson(entry))) {
      const post = readPost(p);
      if (post) raw.push(post);
    }
  }

  let missing = 0;
  let unsupported = 0;
  const seen = new Set<string>();
  const posts: ExportPost[] = [];
  const now = Date.now();
  raw.forEach((post, i) => {
    const key = post.uris[0].toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const media: ExportMedia[] = [];
    for (const uri of post.uris) {
      const entry = file(uri);
      const kind = kindOf(uri);
      if (!entry) missing += 1;
      else if (!kind) unsupported += 1;
      else media.push({ path: entry.filename, kind });
    }
    if (media.length === 0) return;
    // A post without a date keeps its place, just behind the dated ones.
    posts.push({ date: post.date ? toMs(post.date) : now - (i + 1) * 60_000, caption: post.caption, media });
  });
  posts.sort((a, b) => b.date - a.date);

  if (posts.length === 0) {
    await close();
    throw new ExportProblem(named(/\.html?$/).length > 0 && named(/posts?_\d+\.json$/).length === 0 ? 'html' : 'no_posts');
  }

  // The profile.
  const info = named(/personal_information\.json$/)[0];
  const infoJson = info ? await readJson(info) : null;
  let avatarUri = infoJson ? findUri(infoJson, /profile photo|profile picture/i) : '';
  if (!avatarUri) {
    const photos = named(/profile_photos?\.json$/)[0];
    if (photos) {
      const list = firstArray(await readJson(photos)) as Array<{ uri?: unknown; creation_timestamp?: unknown }>;
      const latest = list
        .filter((p) => typeof p?.uri === 'string')
        .sort((a, b) => (num(b.creation_timestamp) ?? 0) - (num(a.creation_timestamp) ?? 0))[0];
      avatarUri = typeof latest?.uri === 'string' ? latest.uri : '';
    }
  }
  const avatarEntry = avatarUri ? file(avatarUri) : undefined;
  const avatarKind = avatarEntry ? kindOf(avatarEntry.filename) : null;

  // Follower and following counts come from the lists themselves.
  const count = async (pattern: RegExp): Promise<number | null> => {
    const found = named(pattern);
    if (found.length === 0) return null;
    let total = 0;
    for (const entry of found) total += firstArray(await readJson(entry)).length;
    return total;
  };

  const profile: ExportProfile = {
    username: findText(infoJson, ['Username', 'User name']).replace(/^@/, '').toLowerCase(),
    name: findText(infoJson, ['Name', 'Full name']),
    bio: findText(infoJson, ['Bio', 'Biography']),
    link: findText(infoJson, ['Website', 'External url', 'Link']),
    avatar: avatarEntry && avatarKind === 'image' ? { path: avatarEntry.filename, kind: 'image' } : null,
    followers: await count(/(^|\/)followers(_\d+)?\.json$/),
    following: await count(/(^|\/)following(_\d+)?\.json$/),
  };

  return { profile, posts, missing, unsupported, file: (path) => byPath.get(path.toLowerCase()) ?? file(path), close };
}

/* ---------- building ---------- */

export interface BuildProgress {
  done: number;
  total: number;
}

export interface BuiltFromExport {
  sandbox: Sandbox;
  /** Photos and videos that could not be kept, with a reason the creator can act on. */
  problems: string[];
}

/**
 * Copy the chosen posts and their photos and videos into Backlot and return
 * the finished sandbox. Several files are copied at once; each one that
 * fails is skipped and reported, never the whole import.
 */
export async function buildFromExport(
  opened: OpenedExport,
  choice: { posts: ExportPost[]; profile: ExportProfile },
  onProgress: (p: BuildProgress) => void,
  cancelled: () => boolean,
): Promise<BuiltFromExport> {
  const jobs: ExportMedia[] = [];
  if (choice.profile.avatar) jobs.push(choice.profile.avatar);
  for (const post of choice.posts) jobs.push(...post.media);

  const kept = new Map<string, MediaItem>();
  const problems: string[] = [];
  let tooLarge = 0;
  let failed = 0;
  let done = 0;
  onProgress({ done, total: jobs.length });

  let next = 0;
  const worker = async () => {
    while (next < jobs.length && !cancelled()) {
      const job = jobs[next++];
      const entry = opened.file(job.path);
      try {
        if (!entry) throw new Error('missing');
        // Skip a file that is over the upload limit before unpacking it.
        if (hosted && entry.uncompressedSize > MAX_UPLOAD_BYTES) throw new MediaError('too_large', job.path);
        const name = job.path.split('/').pop() ?? 'file';
        const blob = await entry.getData(new BlobWriter(mimeOf(name)));
        const item = await storeFile(new File([blob], name, { type: mimeOf(name), lastModified: Date.now() }));
        kept.set(job.path, item);
      } catch (err) {
        if (err instanceof MediaError && err.reason === 'too_large') tooLarge += 1;
        else failed += 1;
      }
      done += 1;
      onProgress({ done, total: jobs.length });
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  if (tooLarge) problems.push(`${tooLarge} ${tooLarge === 1 ? 'video was' : 'videos were'} over 50 MB, the limit for one file, and left out.`);
  if (failed) problems.push(`${failed} ${failed === 1 ? 'file' : 'files'} could not be copied. Check your connection and add them by hand if they matter.`);

  const media: Sandbox['media'] = {};
  for (const item of kept.values()) media[item.id] = item;

  const posts = choice.posts.flatMap((post) => {
    const ids = post.media.flatMap((m) => {
      const item = kept.get(m.path);
      return item ? [item.id] : [];
    });
    return ids.length ? [newPost(ids, { date: post.date, caption: post.caption })] : [];
  });

  const avatar = choice.profile.avatar ? kept.get(choice.profile.avatar.path) : undefined;
  const { profile } = choice;
  return {
    sandbox: {
      version: 1,
      isExample: false,
      profile: {
        username: profile.username,
        name: profile.name,
        category: '',
        bio: profile.bio.slice(0, 150),
        link: profile.link.replace(/^https?:\/\//, '').replace(/\/$/, ''),
        avatar: avatar?.id ?? null,
        followers: profile.followers ?? 0,
        following: profile.following ?? 0,
        postCount: null,
      },
      highlights: [],
      posts,
      media,
      settings: { lighting: 'light', tile: 'portrait' },
    },
    problems,
  };
}
