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
      throw new Error(body?.error ?? `The server answered ${error.context.status}.`);
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
  setPassword: (password: string, currentPassword?: string) =>
    call<{ ok: true }>('team', 'password_set', { password, currentPassword }),
};

export type Decision = 'approved' | 'changes' | 'posted' | 'pending';

export const bil = {
  review: (campaignId: string, slot: number, decision: Decision, note?: string) =>
    call<{ review: Decision }>('bil', 'review_post', { campaignId, slot, decision, note }),
  learn: (clientId: string) =>
    call<Record<string, unknown>>('bil', 'learn', { requestId: crypto.randomUUID(), clientId }),
  approveVoice: (clientId: string) => call<Record<string, unknown>>('bil', 'approve_voice', { clientId }),
  resume: (campaignId: string) => call<{ resumed: boolean }>('bil', 'resume', { campaignId }),
};
