import { useEffect, useState } from 'react';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { isGuest } from './mode';

// The app's calls to Backlot's server doors: team (who you are, people, invites,
// passwords) and bil (Bil's actions). Errors come back as plain sentences.

export type Role = 'owner' | 'team' | 'client' | 'visitor';

/** Owner and team: everyone who works on clients. Clients and visitors are not. */
export const isTeamRole = (r: Role | undefined | null): boolean => r === 'owner' || r === 'team';

export type Me = {
  userId: string;
  username: string | null;
  role: Role;
  workspaceId: string;
  clientId: string | null;
  clientHandle: string | null;
  mustChangePassword: boolean;
  budget: { used: number; cap: number } | null;
};

export type ReinRegion = 'worldwide' | 'us' | 'uk' | 'canada';
/** The one next step Bil offers from the agent bar. Nothing runs until the person confirms. */
export type AskAction = { clientId: string; handle: string } & (
  | { type: 'trends'; region: ReinRegion }
  | { type: 'report'; month: string }
  | { type: 'desk' }
  | { type: 'measure' }
  | { type: 'plan'; goal: string }
  | { type: 'open'; screen: 'brand' | 'board' | 'library' | 'approvals' | 'reports' | 'desk' | 'insights' | 'campaigns' }
);
export type ReinTrend = {
  topic: string;
  summary: string;
  whyNow: string;
  momentum: string;
  hashtags: string[];
  touchesFinance: boolean;
  sources: { url: string; title: string | null }[];
};
/** One post doing well in the niche. account is gone 24 hours after the brief was made; the embed still shows it. */
export type ViralPostView = {
  postId: string;
  createdAt: string;
  ageHours: number;
  numbers: { likes: number; reposts: number; replies: number; quotes: number; bookmarks: number; views: number | null };
  media: string[];
  sensitive: boolean;
  perHour: number;
  vsUsual: number | null;
  bucket: 'rising' | 'proven';
  account: { handle: string; name: string; followers: number; excerpt: string | null } | null;
};
export type ViralCreatorView = { handle: string; name: string; followers: number; bestPostId: string; postsSeen: number; medianScore: number; bestScore: number };
export type ViralView = {
  posts: ViralPostView[];
  creators: ViralCreatorView[];
  detailsExpired: boolean;
  patterns: { pattern: string; why: string; postIds: string[] }[];
  ideas: { idea: string; pattern: string }[];
  queries: string[];
  stats: { postsRead: number; offNicheDropped: number; sensitive: number; verifiedOnly: boolean } | null;
};
export type ReinBrief = { briefId: string; niche: string; createdAt: string; notFound: string | null; trends: ReinTrend[]; viral?: ViralView | null };
/** A brief saved as one client's trends: when, for which region, and whether a campaign or an update made it. */
export type ClientBrief = ReinBrief & { savedAt: string; region: ReinRegion; source: 'update' | 'campaign' };

/** An error from a door, with the HTTP status and whether payment is what stopped it. */
export class DoorError extends Error {
  constructor(message: string, readonly status: number, readonly pay = false) {
    super(message);
  }
}

export type Person = {
  userId: string;
  username: string | null;
  role: Role;
  clientId: string | null;
  clientHandle: string | null;
  isYou: boolean;
};

export type People = {
  people: Person[];
  clients: { clientId: string; handle: string; hasLogin: boolean }[];
  /** The executive only: which team member sees which client. */
  grants?: { memberId: string; clientId: string }[];
};

export type KrisMessage = {
  id: number;
  role: 'kris' | 'client' | 'team';
  kind: 'chat' | 'note' | 'pitch';
  body: string;
  cards: Array<{ campaignId: string; slot: number }> | null;
  link: string | null;
  createdAt: string;
};

async function call<T>(fn: 'team' | 'bil', action: string, input: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error('This build is offline.');
  const { data, error } = await supabase.functions.invoke(fn, { body: { action, ...input } });
  if (error) {
    if (error instanceof FunctionsFetchError) throw new Error('Backlot cannot reach the server. Check your connection and try again.');
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => ({}));
      throw new DoorError(body?.error ?? `The server answered ${error.context.status}.`, error.context.status, Boolean(body?.pay));
    }
    throw new Error(error.message);
  }
  return data as T;
}

export const team = {
  me: () => call<Me>('team', 'me'),
  people: () => call<People>('team', 'people'),
  invite: (role: 'team' | 'client', clientId?: string) =>
    call<{ code: string; expiresAt: string }>('team', 'invite_create', { role, clientId }),
  resetPassword: (userId: string) => call<{ temporaryPassword: string }>('team', 'password_reset', { userId }),
  accessSet: (memberId: string, clientId: string, on: boolean) => call<{ on: boolean }>('team', 'access_set', { memberId, clientId, on }),
  clientStage: (clientId: string, stage: 'onboarding' | 'active' | 'paused', note?: string) => call<{ stage: string }>('team', 'client_stage', { clientId, stage, note }),
  reinSearch: (niche: string, region: ReinRegion) => call<{ brief: ReinBrief; reused: boolean }>('team', 'rein_search', { niche, region }),
  /** A signed link to a client's room preview, good for 24 hours. */
  roomPreview: (clientId: string) => call<{ url: string; expiresAt: string }>('team', 'room_preview', { clientId }),
  reinClient: (clientId: string, region: ReinRegion) =>
    call<{ latest: ClientBrief | null; clientFollowers?: number | null; niche?: string | null; preview?: { free: boolean; costUsd: number; checkedAt: string | null } | null }>('team', 'rein_client', { clientId, region }),
  reinClientUpdate: (clientId: string, region: ReinRegion) => call<{ latest: ClientBrief; clientFollowers?: number | null; reused: boolean }>('team', 'rein_client_update', { clientId, region }),
  reinHistory: () => call<{ freeLeft: number | null; searches: { niche: string; region: string; at: string }[]; last: ReinBrief | null }>('team', 'rein_history'),
  setPassword: (password: string, currentPassword?: string) =>
    call<{ ok: true }>('team', 'password_set', { password, currentPassword }),
};

/** A public X profile as Backlot reads it through X's official API. Photo and banner are data URLs. */
export type XProfile = {
  handle: string;
  name: string;
  bio?: string;
  followers: number;
  following: number;
  posts: number;
  verified: boolean;
  premiumGuess: boolean;
  location?: string;
  link?: string;
  photo?: string;
  banner?: string;
};

/** A data URL from the server as a File the media store can keep. */
export function fileFromDataUrl(dataUrl: string, name: string): File | null {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = m[1].split('/')[1].replace('jpeg', 'jpg');
  return new File([bytes], `${name}.${ext}`, { type: m[1] });
}

/** True when the signed-in person is on the team, so paid lookups are theirs to make. */
export function useCanLookup(enabled = true): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!supabase || !enabled || isGuest()) return;
    let live = true;
    team.me().then(
      (m) => live && setOk(isTeamRole(m.role)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [enabled]);
  return ok && enabled;
}

export type Decision = 'approved' | 'changes' | 'posted' | 'not_posted' | 'pending';

export const bil = {
  review: (campaignId: string, slot: number, decision: Decision, note?: string, postUrl?: string, changed?: boolean) =>
    call<{ review: Decision; xPostId?: string | null }>('bil', 'review_post', { campaignId, slot, decision, note, ...(postUrl ? { postUrl } : {}), ...(changed ? { changed: true } : {}) }),
  /** One chat turn with Kris: returns what was saved (the person's message and hers). */
  kris: (clientId: string, text: string) =>
    call<{ messages: KrisMessage[]; costUsd: number }>('bil', 'kris', { requestId: crypto.randomUUID(), clientId, text }),
  /** Kris writes bio, pinned post and reply options for the ways into the room (about half a cent). */
  waysCopy: (clientId: string) =>
    call<{ bio: string[]; pinned: string[]; reply: string[]; links: Record<string, string>; costUsd: number }>('bil', 'ways_copy', { requestId: crypto.randomUUID(), clientId }),
  /** Approves every written post still waiting for a yes; leaves posts needing a detail or a change. */
  approveAll: (campaignId: string) => call<{ campaignId: string; approved: number; needDetail: number; changes: number }>('bil', 'approve_all', { campaignId }),
  discard: (campaignId: string) => call<{ campaignId: string; discarded: boolean }>('bil', 'discard', { campaignId }),
  restore: (campaignId: string) => call<{ campaignId: string; restored: boolean; drafting: boolean }>('bil', 'restore', { campaignId }),
  /** Saves brand kit edits: straight in for the team, waiting for the team's OK for a client. */
  brandSave: (clientId: string, edits: Record<string, unknown>) => call<{ saved: boolean; waiting: boolean }>('bil', 'brand_save', { clientId, edits }),
  /** The team takes or drops a client's suggested brand kit changes. */
  brandReview: (clientId: string, approve: boolean) => call<{ approved: boolean }>('bil', 'brand_review', { clientId, approve }),
  /** Gives a held post the detail it was waiting on; Bil rewrites that one post. */
  fillDetail: (campaignId: string, slot: number, detail: string) =>
    call<{ status: 'ok' | 'blocked'; reasons: string[]; spentUsd: number }>('bil', 'fill_detail', { campaignId, slot, detail }),
  /** The agent bar: Bil answers and may offer one next step, which the person confirms. */
  ask: (text: string, clientId: string | null) =>
    call<{ reply: string; action: AskAction | null; costUsd: number }>('bil', 'ask', { requestId: crypto.randomUUID(), text, ...(clientId ? { clientId } : {}) }),
  /** Fills a client's engagement desk: trend posts (free) and, with replies, who replied to them (paid). */
  desk: (clientId: string, replies: boolean) =>
    call<{ replies: number; conversations: number; costUsd: number; adult: boolean }>('bil', 'desk', { requestId: crypto.randomUUID(), clientId, replies }),
  /** The monthly report for one client and month (YYYY-MM). Replaces that month's report. */
  report: (clientId: string, month: string) =>
    call<{ id: string; costUsd: number }>('bil', 'report', { requestId: crypto.randomUUID(), clientId, month }),
  learn: (clientId: string) =>
    call<Record<string, unknown>>('bil', 'learn', { requestId: crypto.randomUUID(), clientId }),
  approveVoice: (clientId: string) => call<Record<string, unknown>>('bil', 'approve_voice', { clientId }),
  resume: (campaignId: string) => call<{ resumed: boolean }>('bil', 'resume', { campaignId }),
  lookup: (handle: string, images = false) =>
    call<XProfile>('bil', 'lookup', { handle, images }),
  onboard: (body: Record<string, unknown>) => call<Record<string, unknown>>('bil', 'onboard', body),
  estimate: (clientId: string, posts: number, useTrends: boolean) =>
    call<{ campaignUsd: number; reinUsd: number; dialsUsd?: number; totalUsd: number }>('bil', 'estimate', { clientId, posts, useTrends }),
  campaign: (r: {
    requestId: string;
    clientId: string;
    goal: string;
    startDate: string;
    lengthDays: number;
    posts: number;
    useTrends: boolean;
    region: 'worldwide' | 'us' | 'uk' | 'canada';
    reward: 'none' | 'draw' | 'guaranteed';
    rewardDetails?: string;
    notes?: string;
  }) => call<{ campaignId: string; status: string }>('bil', 'campaign', r),
};
