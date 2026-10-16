// The shared toolbox: what Rein and Bil call to get real data and save their work.
//
// Rules every tool follows:
//   * No tool can post, reply, like, follow or send messages. Only GET calls reach X.
//   * Paid tools run inside the caller's Budget (reserve, call, settle).
//   * Inputs and outputs are checked against the shapes in ./schemas/tools.ts.
//   * Client data is read and written with the signed-in user's own login (userDb), so
//     the database's access rules decide what is visible. The service key is used only
//     for shared niche briefs (public topics) and the spend meter.
//
// The same implementations can later be offered through an MCP endpoint (phase 5).

import { tool, type ToolSet } from 'npm:ai@7.0.142';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import { MAX_EXCERPT, z } from './schemas/common.ts';
import { ClientProfile, PostTypeLibrary, VoiceCard } from './schemas/client.ts';
import { nicheKey, ReinBrief, type StoredEvidence } from './schemas/rein.ts';
import { Campaign } from './schemas/bil.ts';
import { TOOLS, type ToolName } from './schemas/tools.ts';
import { X_PRICES } from './models.ts';
import { algorithmParams, algorithmSearch } from './algorithm.ts';
import { secret } from './secrets.ts';
import { type Budget, serviceClient } from './spend.ts';

// ---------- context ----------

export type ToolContext = {
  /** Meter for paid tools; the calling agent's budget. */
  budget: Budget;
  /** Database client acting as the signed-in user. Required for client data. */
  userDb?: SupabaseClient;
  /** That user's ID, taken from their verified login, never from model output. */
  ownerId?: string;
};

/**
 * Builds a database client that acts as the person who sent the request, from their
 * Authorization header. Returns null when there is no valid login.
 */
export async function userContextFromRequest(req: Request): Promise<{ userDb: SupabaseClient; ownerId: string } | null> {
  const auth = req.headers.get('Authorization') ?? '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!jwt) return null;
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const userDb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userDb.auth.getClaims(jwt);
  const sub = data?.claims?.sub;
  if (error || typeof sub !== 'string' || data?.claims?.role !== 'authenticated') return null;
  return { userDb, ownerId: sub };
}

function needUser(ctx: ToolContext): { userDb: SupabaseClient; ownerId: string } {
  if (!ctx.userDb || !ctx.ownerId) throw new Error('This tool needs a signed-in Backlot account');
  return { userDb: ctx.userDb, ownerId: ctx.ownerId };
}

// ---------- X API (read only) ----------

const X_API = 'https://api.x.com/2';

/** One GET to X inside a reservation. Refused requests (4xx/5xx) are released, not charged. */
async function xGet(
  budget: Budget,
  kind: string,
  url: URL,
  estimate: number,
  costOf: (body: any) => number,
  resource?: string,
): Promise<any> {
  const token = secret('xBearerToken');
  if (!token) throw new Error('The X bearer token secret is not set');
  const body = await budget.charge(
    kind,
    estimate,
    async () => {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const why = json?.title ?? json?.detail ?? json?.errors?.[0]?.message ?? `HTTP ${res.status}`;
        throw new Error(`X API: ${why} (HTTP ${res.status})`, { cause: res });
      }
      return json;
    },
    costOf,
    resource ? { resource } : {},
  );
  return body;
}

/** Search operators that would point a search at people instead of topics. */
const PERSON_OPERATORS = /(^|\s)-?(from|to|retweets_of|list):|(^|\s)-?@\w/i;

function excerptOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= MAX_EXCERPT ? flat : flat.slice(0, MAX_EXCERPT - 1).trimEnd() + '…';
}

// ---------- implementations ----------

type In<N extends ToolName> = z.infer<(typeof TOOLS)[N]['input']>;
type Out<N extends ToolName> = z.infer<(typeof TOOLS)[N]['output']>;

export const impl = {
  async x_profile_lookup(ctx: ToolContext, { handle }: In<'x_profile_lookup'>): Promise<Out<'x_profile_lookup'>> {
    const url = new URL(`${X_API}/users/by/username/${encodeURIComponent(handle)}`);
    url.searchParams.set('user.fields', 'public_metrics,verified,description');
    const body = await xGet(ctx.budget, 'x_user_lookup', url, X_PRICES.userLookup, () => X_PRICES.userLookup, `x_user:${handle.toLowerCase()}`);
    const d = body.data;
    if (!d) throw new Error(`X API: no such account @${handle}`);
    return {
      handle: d.username,
      userId: d.id,
      name: d.name,
      bio: d.description || undefined,
      followers: d.public_metrics?.followers_count ?? 0,
      following: d.public_metrics?.following_count ?? 0,
      posts: d.public_metrics?.tweet_count ?? 0,
      verified: Boolean(d.verified),
    };
  },

  async x_post_search(ctx: ToolContext, { query, maxPosts }: In<'x_post_search'>): Promise<Out<'x_post_search'>> {
    if (PERSON_OPERATORS.test(query)) {
      throw new Error('Searches are about topics, never people: remove from:, to:, @handles and list:');
    }
    const url = new URL(`${X_API}/tweets/search/recent`);
    // Reposts would be billed again as duplicates of posts already in the results.
    url.searchParams.set('query', `${query} -is:retweet`);
    url.searchParams.set('max_results', String(maxPosts));
    url.searchParams.set('tweet.fields', 'created_at,public_metrics');
    const body = await xGet(
      ctx.budget,
      'x_post_search',
      url,
      maxPosts * X_PRICES.postRead,
      (b) => (Array.isArray(b?.data) ? b.data.length : 0) * X_PRICES.postRead,
    );
    const posts = (body.data ?? []).map((p: any) => ({
      postId: p.id,
      excerpt: excerptOf(p.text ?? ''),
      createdAt: p.created_at,
      likes: p.public_metrics?.like_count ?? 0,
    }));
    return { posts: posts.filter((p: { excerpt: string }) => p.excerpt.length > 0) };
  },

  async client_posts_read(ctx: ToolContext, { clientId, maxPosts }: In<'client_posts_read'>): Promise<Out<'client_posts_read'>> {
    const { userDb } = needUser(ctx);
    const { data: client, error } = await userDb.from('clients').select('id, x_handle, x_user_id').eq('id', clientId).maybeSingle();
    if (error) throw new Error(`Could not read the client: ${error.message}`);
    if (!client) throw new Error('No such client on this account');

    let userId: string | null = client.x_user_id;
    if (!userId) {
      // Paid once per client ever: X user IDs never change.
      const profile = await impl.x_profile_lookup(ctx, { handle: client.x_handle });
      userId = profile.userId;
      const { error: saveError } = await userDb.from('clients').update({ x_user_id: userId }).eq('id', clientId);
      if (saveError) console.error('Could not save the X user ID', saveError.message);
    }

    const url = new URL(`${X_API}/users/${userId}/tweets`);
    url.searchParams.set('max_results', String(maxPosts));
    // Original posts only: replies are written to someone else, reposts are someone else's words.
    url.searchParams.set('exclude', 'replies,retweets');
    url.searchParams.set('tweet.fields', 'created_at');
    const body = await xGet(
      ctx.budget,
      'x_client_posts',
      url,
      maxPosts * X_PRICES.postRead,
      (b) => (Array.isArray(b?.data) ? b.data.length : 0) * X_PRICES.postRead,
      `x_timeline:${userId}`,
    );
    const posts = (body.data ?? [])
      .filter((p: any) => typeof p.text === 'string' && p.text.trim())
      .slice(0, maxPosts)
      .map((p: any) => ({ postId: p.id, text: p.text.slice(0, 2048), createdAt: p.created_at }));
    return { clientId, postsRead: posts.length, posts };
  },

  async brand_kit(ctx: ToolContext, { clientId }: In<'brand_kit'>): Promise<Out<'brand_kit'>> {
    const { userDb } = needUser(ctx);
    const [client, voice, types] = await Promise.all([
      userDb.from('clients').select('id, profile').eq('id', clientId).maybeSingle(),
      userDb.from('voice_cards').select('card').eq('client_id', clientId).maybeSingle(),
      userDb.from('post_type_libraries').select('library').eq('client_id', clientId).maybeSingle(),
    ]);
    for (const r of [client, voice, types]) if (r.error) throw new Error(`Could not read the brand kit: ${r.error.message}`);
    if (!client.data) throw new Error('No such client on this account');
    return {
      clientId,
      profile: ClientProfile.parse(client.data.profile),
      voice: voice.data ? VoiceCard.parse(voice.data.card) : undefined,
      postTypes: types.data ? PostTypeLibrary.parse(types.data.library) : undefined,
    };
  },

  async save_brief(_ctx: ToolContext, brief: In<'save_brief'>): Promise<Out<'save_brief'>> {
    const db = serviceClient();
    // Excerpts live in brief_evidence, where they expire after 24 hours; the brief keeps post IDs only.
    const evidence: Array<StoredEvidence & { brief_id: string }> = [];
    const trends = brief.trends.map((t, i) => {
      for (const e of t.evidence) evidence.push({ brief_id: brief.briefId, trendIndex: i, postId: e.postId, excerpt: e.excerpt });
      return { ...t, evidence: t.evidence.map((e) => ({ postId: e.postId })) };
    });
    const { error } = await db.from('niche_briefs').insert({
      id: brief.briefId,
      niche_key: nicheKey(brief.niche),
      brief: { ...brief, trends },
      created_at: brief.createdAt,
    });
    if (error) throw new Error(`Could not save the brief: ${error.message}`);
    if (evidence.length) {
      const { error: evError } = await db.from('brief_evidence').upsert(
        evidence.map((e) => ({ brief_id: e.brief_id, trend_index: e.trendIndex, post_id: e.postId, excerpt: e.excerpt })),
        { onConflict: 'brief_id,trend_index,post_id', ignoreDuplicates: true },
      );
      if (evError) throw new Error(`Could not save the brief's evidence: ${evError.message}`);
    }
    return { briefId: brief.briefId, saved: true };
  },

  async write_campaign(ctx: ToolContext, campaign: In<'write_campaign'>): Promise<Out<'write_campaign'>> {
    const { userDb, ownerId } = needUser(ctx);
    // approved and blocked carry over; a draft or one waiting on the client is ready for review.
    const status = campaign.approval.status === 'approved' || campaign.approval.status === 'blocked' ? campaign.approval.status : 'ready';
    const { error } = await userDb.from('campaigns').upsert({
      id: campaign.campaignId,
      client_id: campaign.clientId,
      owner_id: ownerId,
      status,
      campaign,
      posts_total: campaign.posts.length,
      posts_done: campaign.posts.length,
    });
    if (error) throw new Error(`Could not save the campaign: ${error.message}`);
    return { campaignId: campaign.campaignId, saved: true };
  },

  async algorithm_search(_ctx: ToolContext, { question, limit }: In<'algorithm_search'>): Promise<Out<'algorithm_search'>> {
    return await algorithmSearch(question, limit) as Out<'algorithm_search'>;
  },

  async algorithm_params(_ctx: ToolContext, input: In<'algorithm_params'>): Promise<Out<'algorithm_params'>> {
    return await algorithmParams(input) as Out<'algorithm_params'>;
  },

  async cost_meter(ctx: ToolContext): Promise<Out<'cost_meter'>> {
    const s: any = await ctx.budget.summary();
    return {
      monthCapUsd: Number(s.month_cap ?? s.cap ?? 5),
      monthUsedUsd: Number(s.month_used ?? 0),
      byAgent: Object.fromEntries(Object.entries(s.by_agent ?? {}).map(([k, v]) => [k, Number(v)])),
    };
  },
} satisfies Partial<{ [N in ToolName]: (ctx: ToolContext, input: In<N>) => Promise<Out<N>> }>;

export type ImplementedTool = keyof typeof impl;

/**
 * A brief for this niche that is still inside its 6-hour reuse window, rebuilt with
 * whatever excerpts have not expired yet. Free; saves a paid fetch when clients share a niche.
 */
export async function reusableBrief(niche: string): Promise<{ brief: z.infer<typeof ReinBrief>; reused: true } | null> {
  const db = serviceClient();
  const { data, error } = await db
    .from('niche_briefs')
    .select('id, brief')
    .eq('niche_key', nicheKey(niche))
    .gt('reuse_until', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const { data: ev } = await db.from('brief_evidence').select('trend_index, post_id, excerpt').eq('brief_id', data.id);
  const byTrend = new Map<number, Array<{ postId: string; excerpt: string }>>();
  for (const e of ev ?? []) {
    if (!e.excerpt) continue; // expired excerpts are dropped from the rebuilt brief
    const list = byTrend.get(e.trend_index) ?? [];
    list.push({ postId: e.post_id, excerpt: e.excerpt });
    byTrend.set(e.trend_index, list);
  }
  const stored = data.brief as any;
  const brief = ReinBrief.safeParse({
    ...stored,
    trends: (stored.trends ?? []).map((t: any, i: number) => ({ ...t, evidence: byTrend.get(i) ?? [] })),
  });
  return brief.success ? { brief: brief.data, reused: true } : null;
}

// ---------- AI SDK tools ----------

/**
 * The tools an agent may use, as AI SDK tools. Each agent gets only the names it needs,
 * so Rein never sees write_campaign. Every result is checked against its shape before
 * the model sees it.
 */
export function agentTools(ctx: ToolContext, names: readonly ImplementedTool[]): ToolSet {
  const set: ToolSet = {};
  for (const name of names) {
    const shape = TOOLS[name];
    const run = impl[name] as (c: ToolContext, i: unknown) => Promise<unknown>;
    set[name] = tool({
      description: shape.description,
      inputSchema: shape.input as z.ZodType<any>,
      execute: async (input: unknown) => shape.output.parse(await run(ctx, shape.input.parse(input))),
    });
  }
  return set;
}

/** Which tools each agent may call. */
export const AGENT_TOOLS = {
  rein: ['x_post_search', 'save_brief', 'cost_meter'],
  bil: ['brand_kit', 'x_profile_lookup', 'algorithm_search', 'algorithm_params', 'write_campaign', 'cost_meter'],
  onboard: ['client_posts_read', 'brand_kit'],
} as const satisfies Record<string, readonly ImplementedTool[]>;

/** Campaign shape, re-exported for callers that save campaigns. */
export { Campaign };
