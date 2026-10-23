import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

// Everything the shell shows comes from these reads. They run as the signed-in person,
// so the database's own rules decide what comes back: the team sees every client in the
// workspace, a client sees only themselves.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = Record<string, any>;

export type Client = {
  id: string;
  handle: string;
  profile: Json;
  /** Brand kit changes the client suggested, waiting for the team's OK. */
  pending: Json | null;
  pendingAt: string | null;
};
export type Voice = { clientId: string; card: Json; approved: boolean; updatedAt: string };
export type Campaign = {
  id: string;
  clientId: string;
  status: string;
  hold: string | null;
  request: Json | null;
  plan: Json | null;
  postsTotal: number;
  postsDone: number;
  createdAt: string;
  updatedAt: string;
};
export type Post = {
  campaignId: string;
  slot: number;
  status: 'ok' | 'blocked';
  post: Json;
  review: 'pending' | 'approved' | 'changes' | 'posted';
  reviewNote: string | null;
  reviewedAt: string | null;
};

export type OnboardingStep = 'delegate' | 'first_call' | 'contract';
export type StepDone = { clientId: string; step: OnboardingStep; doneAt: string };

export type Workspace = {
  clients: Client[];
  voices: Voice[];
  campaigns: Campaign[];
  posts: Post[];
  /** Onboarding steps a person ticked. The rest are worked out from the data. */
  steps: StepDone[];
  /** How many Media files each client has, not counting removed ones. */
  mediaCounts: Record<string, number>;
};

const EMPTY: Workspace = { clients: [], voices: [], campaigns: [], posts: [], steps: [], mediaCounts: {} };

async function load(): Promise<Workspace> {
  if (!supabase) return EMPTY;
  const [c, v, k, p, s, m] = await Promise.all([
    supabase.from('clients').select('id, x_handle, profile, profile_pending, profile_pending_at').order('created_at'),
    supabase.from('voice_cards').select('client_id, card, approved_by_client, updated_at'),
    supabase
      .from('campaigns')
      .select('id, client_id, status, hold, request, plan, posts_total, posts_done, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('campaign_posts').select('campaign_id, slot, status, post, review, review_note, reviewed_at').order('slot').limit(1000),
    supabase.from('onboarding_steps').select('client_id, step, done_at'),
    supabase.from('library_items').select('client_id').is('removed_at', null).limit(5000),
  ]);
  const error = c.error ?? v.error ?? k.error ?? p.error ?? s.error ?? m.error;
  if (error) throw new Error(error.message);
  return {
    clients: (c.data ?? []).map((r: Json) => ({ id: r.id, handle: r.x_handle, profile: r.profile ?? {}, pending: r.profile_pending ?? null, pendingAt: r.profile_pending_at ?? null })),
    voices: (v.data ?? []).map((r: Json) => ({ clientId: r.client_id, card: r.card ?? {}, approved: r.approved_by_client, updatedAt: r.updated_at })),
    campaigns: (k.data ?? []).map((r: Json) => ({
      id: r.id,
      clientId: r.client_id,
      status: r.status,
      hold: r.hold ?? null,
      request: r.request,
      plan: r.plan,
      postsTotal: r.posts_total,
      postsDone: r.posts_done,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    steps: (s.data ?? []).map((r: Json) => ({ clientId: r.client_id, step: r.step, doneAt: r.done_at })),
    mediaCounts: (m.data ?? []).reduce((acc: Record<string, number>, r: Json) => {
      acc[r.client_id] = (acc[r.client_id] ?? 0) + 1;
      return acc;
    }, {}),
    posts: (p.data ?? []).map((r: Json) => ({
      campaignId: r.campaign_id,
      slot: r.slot,
      status: r.status,
      post: r.post ?? {},
      review: r.review,
      reviewNote: r.review_note,
      reviewedAt: r.reviewed_at,
    })),
  };
}

const WORKING = new Set(['planning', 'drafting']);

/** Loads the workspace and refreshes it every 15 seconds while Bil is still drafting. */
export function useWorkspace(enabled = true) {
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = enabled ? await load() : EMPTY;
      if (alive.current) {
        setData(next);
        setError('');
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Could not load your workspace.');
    }
  }, [enabled]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  const working = data?.campaigns.some((c) => WORKING.has(c.status) && !c.hold) ?? false;
  useEffect(() => {
    if (!working) return;
    const t = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(t);
  }, [working, refresh]);

  /** Applies a change locally before the next refresh, so taps feel instant. */
  const patchPost = useCallback((campaignId: string, slot: number, fields: Partial<Post>) => {
    setData((d) =>
      d ? { ...d, posts: d.posts.map((p) => (p.campaignId === campaignId && p.slot === slot ? { ...p, ...fields } : p)) } : d,
    );
  }, []);

  return { data, error, refresh, patchPost };
}

/** "12M", "3H", "OCT 22": short rail times. */
export function railTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((now - t) / 60_000));
  if (mins < 5) return 'NOW';
  if (mins < 60) return `${mins}M`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}H`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();
}
