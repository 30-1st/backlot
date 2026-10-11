import type { MediaItem, Sandbox, SavePoint } from '../types';
import type { Platform } from '../platforms';

// The library is everything a creator keeps in Backlot:
//
//   platform  ->  accounts  ->  narrations
//
// An account is one social profile. A narration is one telling of that profile:
// a full copy of the page that can be branded differently and compared with the
// others. Every narration has its own save point.

export interface NarrationMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** A few facts copied from the profile so lists can be drawn without opening it. */
  username: string;
  avatar: MediaItem | null;
  posts: number;
  isExample: boolean;
}

export interface Account {
  id: string;
  platform: Platform;
  createdAt: number;
  narrations: NarrationMeta[];
}

export interface OpenNarration {
  account: Account;
  meta: NarrationMeta;
  sandbox: Sandbox;
  savePoint?: SavePoint;
}

/** What any place that stores the library must be able to do. */
export interface Library {
  listAccounts(platform?: Platform): Promise<Account[]>;
  openNarration(id: string): Promise<OpenNarration | null>;
  /** A new account starts with one narration, and that first state is its save point. */
  createAccount(platform: Platform, sandbox: Sandbox, name?: string): Promise<NarrationMeta>;
  deleteAccount(accountId: string): Promise<void>;
  /** Copy a narration, save point included, into a new one on the same account. */
  duplicateNarration(sourceId: string, name: string): Promise<NarrationMeta | null>;
  renameNarration(id: string, name: string): Promise<void>;
  /** Removes one narration. An account always keeps at least one, so the last one stays. */
  deleteNarration(id: string): Promise<void>;
  saveSandbox(id: string, sandbox: Sandbox): Promise<void>;
  saveSavePoint(id: string, point: SavePoint): Promise<void>;
  /** Every photo and video some narration or save point still uses, optionally leaving one narration out. */
  mediaInUse(exceptNarrationId?: string): Promise<Set<string>>;
}

export const isSandbox = (v: unknown): v is Sandbox => !!v && (v as Sandbox).version === 1;
export const isSavePoint = (v: unknown): v is SavePoint => !!v && isSandbox((v as SavePoint).sandbox);

/** The facts about a profile that lists show without opening it. */
export function describe(sandbox: Sandbox): Pick<NarrationMeta, 'username' | 'avatar' | 'posts' | 'isExample'> {
  const avatarId = sandbox.profile.avatar;
  return {
    username: sandbox.profile.username,
    avatar: avatarId ? (sandbox.media[avatarId] ?? null) : null,
    posts: sandbox.posts.length,
    isExample: sandbox.isExample,
  };
}

/** The next free default name on an account: "Narration 2", "Narration 3", and so on. */
export function nextNarrationName(account: Account): string {
  const taken = new Set(account.narrations.map((n) => n.name.trim().toLowerCase()));
  let n = account.narrations.length + 1;
  while (taken.has(`narration ${n}`)) n += 1;
  return `Narration ${n}`;
}
