import { createContext, useContext, type Dispatch } from 'react';
import type {
  Highlight,
  MediaItem,
  Post,
  PostStatus,
  Profile,
  Sandbox,
  Selection,
  Settings,
  View,
} from './types';
import { uid } from './lib/media';

export const MAX_PINNED = 3;
export const MAX_CAROUSEL = 10;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type Action =
  | { type: 'load'; sandbox: Sandbox }
  | { type: 'profile'; patch: Partial<Profile> }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'media'; items: MediaItem[] }
  | { type: 'addPosts'; posts: Post[] }
  | { type: 'post'; id: string; patch: Partial<Post> }
  | { type: 'deletePost'; id: string }
  | { type: 'addHighlight'; highlight: Highlight }
  | { type: 'highlight'; id: string; patch: Partial<Highlight> }
  | { type: 'deleteHighlight'; id: string }
  | { type: 'moveHighlight'; id: string; dir: -1 | 1 };

export function reducer(s: Sandbox, a: Action): Sandbox {
  switch (a.type) {
    case 'load':
      return a.sandbox;
    case 'profile':
      return { ...s, profile: { ...s.profile, ...a.patch } };
    case 'settings':
      return { ...s, settings: { ...s.settings, ...a.patch } };
    case 'media': {
      const media = { ...s.media };
      for (const item of a.items) media[item.id] = item;
      return { ...s, media };
    }
    case 'addPosts':
      return { ...s, posts: [...a.posts, ...s.posts] };
    case 'post':
      return { ...s, posts: s.posts.map((p) => (p.id === a.id ? { ...p, ...a.patch } : p)) };
    case 'deletePost':
      return { ...s, posts: s.posts.filter((p) => p.id !== a.id) };
    case 'addHighlight':
      return { ...s, highlights: [...s.highlights, a.highlight] };
    case 'highlight':
      return { ...s, highlights: s.highlights.map((h) => (h.id === a.id ? { ...h, ...a.patch } : h)) };
    case 'deleteHighlight':
      return { ...s, highlights: s.highlights.filter((h) => h.id !== a.id) };
    case 'moveHighlight': {
      const i = s.highlights.findIndex((h) => h.id === a.id);
      const j = i + a.dir;
      if (i < 0 || j < 0 || j >= s.highlights.length) return s;
      const highlights = [...s.highlights];
      [highlights[i], highlights[j]] = [highlights[j], highlights[i]];
      return { ...s, highlights };
    }
  }
}

/** A blank profile, used as a placeholder while a narration loads. */
export function emptySandbox(): Sandbox {
  return {
    version: 1,
    isExample: false,
    profile: { username: '', name: '', category: '', bio: '', link: '', avatar: null, followers: 0, following: 0, postCount: null },
    highlights: [],
    posts: [],
    media: {},
    settings: { lighting: 'light', tile: 'portrait' },
  };
}

export function newPost(mediaIds: string[], patch: Partial<Post> = {}): Post {
  return {
    id: uid('p'),
    media: mediaIds,
    caption: '',
    location: '',
    date: Date.now(),
    draft: false,
    pinnedAt: null,
    likes: 0,
    comments: 0,
    ...patch,
  };
}

export function statusOf(post: Post, now: number): PostStatus {
  if (post.draft) return 'draft';
  return post.date > now ? 'scheduled' : 'live';
}

/** What a visitor on `asOf` can see: no drafts, nothing dated later. */
export function isPublic(post: Post, asOf: number): boolean {
  return !post.draft && post.date <= asOf;
}

const newestFirst = (a: Post, b: Post) => b.date - a.date || (a.id < b.id ? -1 : 1);

/** Grid order: pinned posts lead, then everything else newest first. */
export function orderPosts(posts: Post[]): { pinned: Post[]; rest: Post[] } {
  const pinned = posts
    .filter((p) => p.pinnedAt !== null)
    .sort((a, b) => (a.pinnedAt as number) - (b.pinnedAt as number));
  const rest = posts.filter((p) => p.pinnedAt === null).sort(newestFirst);
  return { pinned, rest };
}

/**
 * The grid is always in date order, so moving a post means giving it a date
 * that fits its new slot. `newer` and `older` are its neighbours there.
 */
export function dateBetween(newer: Post | undefined, older: Post | undefined, fallback: number): number {
  if (newer && older) return Math.round((newer.date + older.date) / 2);
  if (older) return older.date + HOUR;
  if (newer) return newer.date - DAY;
  return fallback;
}

/** The date a post takes when its status is switched by hand. */
export function patchForStatus(post: Post, status: PostStatus, now: number): Partial<Post> {
  if (status === 'draft') return { draft: true };
  if (status === 'live') return { draft: false, date: Math.min(post.date, now) };
  return { draft: false, date: post.date > now ? post.date : now + DAY };
}

export function referencedMedia(s: Sandbox): Set<string> {
  const ids = new Set<string>();
  if (s.profile.avatar) ids.add(s.profile.avatar);
  for (const h of s.highlights) if (h.cover) ids.add(h.cover);
  for (const p of s.posts) for (const id of p.media) ids.add(id);
  return ids;
}

/** Drop media entries nothing points at any more. */
export function compactSandbox(s: Sandbox): Sandbox {
  const keep = referencedMedia(s);
  const media: Record<string, MediaItem> = {};
  for (const id of keep) if (s.media[id]) media[id] = s.media[id];
  return { ...s, media };
}

export interface Stage {
  sandbox: Sandbox;
  dispatch: Dispatch<Action>;
  view: View;
  /** The real clock. */
  now: number;
  /** The moment the visitor view is looking from. Equals `now` unless the creator picked another day. */
  asOf: number;
  selection: Selection;
  select: (selection: Selection) => void;
  openPost: (id: string) => void;
  say: (message: string) => void;
}

export const StageContext = createContext<Stage | null>(null);

export function useStage(): Stage {
  const stage = useContext(StageContext);
  if (!stage) throw new Error('useStage must be used inside the app');
  return stage;
}
