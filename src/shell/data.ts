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
  discardedAt: string | null;
};
export type Post = {
  campaignId: string;
  slot: number;
  status: 'ok' | 'blocked';
  post: Json;
  review: 'pending' | 'approved' | 'changes' | 'posted';
  reviewNote: string | null;
  reviewedAt: string | null;
  /** The X post the client says this draft became (dial upgrade 5). */
  xPostId?: string | null;
};

export type OnboardingStep = 'delegate' | 'first_call' | 'contract';
export type StepDone = { clientId: string; step: OnboardingStep; doneAt: string };

/** Something a person did that the other side may want to know about. */
export type Activity =
  | { kind: 'log'; clientId: string; at: string; actorId: string | null; actorRole: 'team' | 'client'; what: 'post' | 'voice' | 'brand' | 'campaign'; decision: string; campaignId: string | null; slot: number | null }
  | { kind: 'media' | 'board'; clientId: string; at: string; actorId: string | null };

export type Workspace = {
  clients: Client[];
  voices: Voice[];
  campaigns: Campaign[];
  /** Discarded campaigns, newest first. They stay out of everything else until restored. */
  discarded: Campaign[];
  posts: Post[];
  /** Onboarding steps a person ticked. The rest are worked out from the data. */
  steps: StepDone[];
  /** How many Media files each client has, not counting removed ones. */
  mediaCounts: Record<string, number>;
  /** The last 14 days of decisions, uploads and board items, newest first. */
  activity: Activity[];
  /** When this person last looked at what is new, or null if never. */
  seenAt: string | null;
};

const EMPTY: Workspace = { clients: [], voices: [], campaigns: [], discarded: [], posts: [], steps: [], mediaCounts: {}, activity: [], seenAt: null };
const ACTIVITY_DAYS = 14;

async function load(): Promise<Workspace> {
  if (!supabase) return EMPTY;
  const since = new Date(Date.now() - ACTIVITY_DAYS * 86_400_000).toISOString();
  const [c, v, k, p, s, m, lg, md, bd, sn] = await Promise.all([
    supabase.from('clients').select('id, x_handle, profile, profile_pending, profile_pending_at').order('created_at'),
    supabase.from('voice_cards').select('client_id, card, approved_by_client, updated_at'),
    supabase
      .from('campaigns')
      .select('id, client_id, status, hold, request, plan, posts_total, posts_done, created_at, updated_at, discarded_at')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('campaign_posts').select('campaign_id, slot, status, post, review, review_note, reviewed_at, x_post_id').order('slot').limit(1000),
    supabase.from('onboarding_steps').select('client_id, step, done_at'),
    supabase.from('library_items').select('client_id').is('removed_at', null).limit(5000),
    supabase
      .from('approval_log')
      .select('client_id, kind, decision, campaign_id, slot, actor_id, actor_role, created_at')
      .gt('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('library_items').select('client_id, added_by, created_at').gt('created_at', since).is('removed_at', null).order('created_at', { ascending: false }).limit(300),
    supabase.from('inspiration_items').select('client_id, added_by, created_at').gt('created_at', since).is('removed_at', null).order('created_at', { ascending: false }).limit(200),
    supabase.from('notice_seen').select('seen_at').maybeSingle(),
  ]);
  const error = c.error ?? v.error ?? k.error ?? p.error ?? s.error ?? m.error ?? lg.error ?? md.error ?? bd.error ?? sn.error;
  if (error) throw new Error(error.message);
  const campaigns: Campaign[] = (k.data ?? []).map((r: Json) => ({
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
    discardedAt: r.discarded_at ?? null,
  }));
  const gone = new Set(campaigns.filter((x) => x.discardedAt).map((x) => x.id));
  return {
    clients: (c.data ?? []).map((r: Json) => ({ id: r.id, handle: r.x_handle, profile: r.profile ?? {}, pending: r.profile_pending ?? null, pendingAt: r.profile_pending_at ?? null })),
    voices: (v.data ?? []).map((r: Json) => ({ clientId: r.client_id, card: r.card ?? {}, approved: r.approved_by_client, updatedAt: r.updated_at })),
    campaigns: campaigns.filter((x) => !x.discardedAt),
    discarded: campaigns.filter((x) => x.discardedAt),
    steps: (s.data ?? []).map((r: Json) => ({ clientId: r.client_id, step: r.step, doneAt: r.done_at })),
    activity: [
      ...(lg.data ?? []).map(
        (r: Json): Activity => ({
          kind: 'log',
          clientId: r.client_id,
          at: r.created_at,
          actorId: r.actor_id ?? null,
          actorRole: r.actor_role === 'client' ? 'client' : 'team',
          what: r.kind,
          decision: r.decision,
          campaignId: r.campaign_id ?? null,
          slot: r.slot ?? null,
        }),
      ),
      ...(md.data ?? []).map((r: Json): Activity => ({ kind: 'media', clientId: r.client_id, at: r.created_at, actorId: r.added_by ?? null })),
      ...(bd.data ?? []).map((r: Json): Activity => ({ kind: 'board', clientId: r.client_id, at: r.created_at, actorId: r.added_by ?? null })),
    ].sort((a, b) => b.at.localeCompare(a.at)),
    seenAt: (sn.data as Json | null)?.seen_at ?? null,
    mediaCounts: (m.data ?? []).reduce((acc: Record<string, number>, r: Json) => {
      acc[r.client_id] = (acc[r.client_id] ?? 0) + 1;
      return acc;
    }, {}),
    posts: (p.data ?? []).filter((r: Json) => !gone.has(r.campaign_id)).map((r: Json) => ({
      campaignId: r.campaign_id,
      slot: r.slot,
      status: r.status,
      post: r.post ?? {},
      review: r.review,
      reviewNote: r.review_note,
      reviewedAt: r.reviewed_at,
      xPostId: r.x_post_id ?? null,
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

  /** Records that everything up to this moment has been seen, so the badge clears. */
  const markSeen = useCallback((at: string) => {
    setData((d) => (d ? { ...d, seenAt: at } : d));
  }, []);

  return { data, error, refresh, patchPost, markSeen };
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
