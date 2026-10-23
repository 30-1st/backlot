import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

// The app's calls to Backlot's server doors: team (who you are, people, invites,
// passwords) and bil (Bil's actions). Errors come back as plain sentences.

export type Role = 'owner' | 'team' | 'client';

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
  reinHistory: () => call<{ freeLeft: number | null; searches: { niche: string; region: string; at: string }[]; last: ReinBrief | null }>('team', 'rein_history'),
  setPassword: (password: string, currentPassword?: string) =>
    call<{ ok: true }>('team', 'password_set', { password, currentPassword }),
};

export type Decision = 'approved' | 'changes' | 'posted' | 'pending';

export const bil = {
  review: (campaignId: string, slot: number, decision: Decision, note?: string) =>
    call<{ review: Decision }>('bil', 'review_post', { campaignId, slot, decision, note }),
  /** Gives a held post the detail it was waiting on; Bil rewrites that one post. */
  fillDetail: (campaignId: string, slot: number, detail: string) =>
    call<{ status: 'ok' | 'blocked'; reasons: string[]; spentUsd: number }>('bil', 'fill_detail', { campaignId, slot, detail }),
  learn: (clientId: string) =>
    call<Record<string, unknown>>('bil', 'learn', { requestId: crypto.randomUUID(), clientId }),
  approveVoice: (clientId: string) => call<Record<string, unknown>>('bil', 'approve_voice', { clientId }),
  resume: (campaignId: string) => call<{ resumed: boolean }>('bil', 'resume', { campaignId }),
  lookup: (handle: string) =>
    call<{ handle: string; name: string; followers: number; posts: number; verified: boolean; bio?: string; premiumGuess: boolean }>('bil', 'lookup', { handle }),
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
