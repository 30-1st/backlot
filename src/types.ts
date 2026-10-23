export type MediaKind = 'image' | 'video';

/** One photo or video. Uploaded files live in the browser's media store under `id`;
 *  example media carries its picture inline in `src`. */
export interface MediaItem {
  id: string;
  kind: MediaKind;
  src?: string;
}

export interface Post {
  id: string;
  /** Media ids, in carousel order. The first one is the grid cover. */
  media: string[];
  caption: string;
  location: string;
  /** When the post went (or goes) live, in ms. Drafts keep a date so they sit where they would land. */
  date: number;
  draft: boolean;
  /** Set when pinned. Pinned posts lead the grid in the order they were pinned. */
  pinnedAt: number | null;
  likes: number;
  comments: number;
  /** X only: reposts and views. Missing on older narrations, read as 0. */
  reposts?: number;
  views?: number;
  /** X only: the media is marked sensitive, so visitors see it behind a content warning. */
  sensitive?: boolean;
}

export interface Highlight {
  id: string;
  title: string;
  cover: string | null;
}

export interface Profile {
  username: string;
  name: string;
  category: string;
  bio: string;
  link: string;
  avatar: string | null;
  followers: number;
  following: number;
  /** null means "count the posts a visitor can see". */
  postCount: number | null;
  /** X only: the header image across the top of the profile. */
  banner?: string | null;
  /** X only: the account posts adult content, so its media must be marked sensitive. */
  adult?: boolean;
}

export interface Settings {
  lighting: 'light' | 'dark';
  tile: 'portrait' | 'square';
}

export interface Sandbox {
  version: 1;
  isExample: boolean;
  profile: Profile;
  highlights: Highlight[];
  posts: Post[];
  media: Record<string, MediaItem>;
  settings: Settings;
}

export interface SavePoint {
  sandbox: Sandbox;
  savedAt: number;
}

export type PostStatus = 'live' | 'scheduled' | 'draft';

export type Selection =
  | { type: 'profile' }
  | { type: 'post'; id: string }
  | { type: 'highlight'; id: string }
  | null;

export type View = 'creator' | 'visitor';
