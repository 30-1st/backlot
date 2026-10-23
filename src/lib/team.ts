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
export type ReinTrend = {
  topic: string;
  summary: string;
  whyNow: string;
  momentum: string;
  hashtags: string[];
  touchesFinance: boolean;
  sources: { url: string; title: string | null }[];
};
export type ReinBrief = { briefId: string; niche: string; createdAt: string; notFound: string | null; trends: ReinTrend[] };
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
  reinSearch: (niche: string, region: ReinRegion) => call<{ brief: ReinBrief; reused: boolean }>('team', 'rein_search', { niche, region }),
  reinClient: (clientId: string, region: ReinRegion) =>
    call<{ latest: ClientBrief | null; niche?: string | null; preview?: { free: boolean; costUsd: number; checkedAt: string | null } | null }>('team', 'rein_client', { clientId, region }),
  reinClientUpdate: (clientId: string, region: ReinRegion) => call<{ latest: ClientBrief; reused: boolean }>('team', 'rein_client_update', { clientId, region }),
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

export type Decision = 'approved' | 'changes' | 'posted' | 'pending';

export const bil = {
  review: (campaignId: string, slot: number, decision: Decision, note?: string) =>
    call<{ review: Decision }>('bil', 'review_post', { campaignId, slot, decision, note }),
  /** Saves brand kit edits: straight in for the team, waiting for the team's OK for a client. */
  brandSave: (clientId: string, edits: Record<string, unknown>) => call<{ saved: boolean; waiting: boolean }>('bil', 'brand_save', { clientId, edits }),
  /** The team takes or drops a client's suggested brand kit changes. */
  brandReview: (clientId: string, approve: boolean) => call<{ approved: boolean }>('bil', 'brand_review', { clientId, approve }),
  /** Gives a held post the detail it was waiting on; Bil rewrites that one post. */
  fillDetail: (campaignId: string, slot: number, detail: string) =>
    call<{ status: 'ok' | 'blocked'; reasons: string[]; spentUsd: number }>('bil', 'fill_detail', { campaignId, slot, detail }),
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
    call<{ campaignUsd: number; reinUsd: number; totalUsd: number }>('bil', 'estimate', { clientId, posts, useTrends }),
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
