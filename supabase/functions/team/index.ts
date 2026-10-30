// The team's front door: who you are, the people in the workspace, invites and passwords.
//
// Every request needs a signed-in Backlot login that belongs to the workspace. The
// platform's JWT check is off (config.toml) so the CORS preflight can be answered; this
// code verifies the login on every POST.
//
// Actions (POST JSON with "action"):
//   me               {}                              your role, client, and (team) budget everyone
//   people           {}                              everyone in the workspace + clients team
//   invite_create    { role, clientId? }             a one-time code, shown once         team
//   password_reset   { userId }                      a temporary password, shown once    owner
//   password_set     { password, currentPassword? }  change your own password            everyone
//   rein_search      { niche, region? }              what is rising in a niche           everyone
//   rein_history     {}                              your last searches and free left    everyone
//   rein_client      { clientId, region? }           a client's latest trends (+ update cost)  team, that client
//   rein_client_update { clientId, region? }         Rein checks the client's niche now  team
//   room_preview     { clientId }                    a signed preview link to their room, 24 hours  team, that client
//   access_set       { memberId, clientId, on }      give or take a team member's access to a client  owner
//   client_stage     { clientId, stage, note? }      onboarding, active or paused                 owner
//
// Rein: a search that reuses a brief from the last 6 hours is free and never counts.
// Clients get 3 free searches; after that it is $5 a search or $15 a month, and until
// payments are wired the server stops there. The team searches inside the AI budget.
//
// Nothing here is paid. Codes and temporary passwords are never stored in plain text and
// never logged.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { userContextFromRequest } from '../_shared/toolbox.ts';
import { Budget, serviceClient } from '../_shared/spend.ts';
import { AccessError, isTeam, memberOf, requireClientAccess, requireOwnPassword, requireTeam, seesClient } from '../_shared/workspace.ts';
import { hashCode, newInviteCode, temporaryPassword } from '../_shared/invite-code.ts';
import { id, z } from '../_shared/schemas/common.ts';
import { withCors } from '../_shared/cors.ts';
import { impl, reusableBrief } from '../_shared/toolbox.ts';
import { callRein, REIN_ESTIMATE_USD } from '../_shared/rein-client.ts';
import { Region } from '../_shared/schemas/rein.ts';
import { krisNote } from '../_shared/kris-notes.ts';
import { previewUrl } from '../_shared/rooms.ts';

const LOGIN_DOMAIN = 'login.backlot.invalid';

const CORS = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

class InputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const r = schema.safeParse(body);
  if (!r.success) throw new InputError(r.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'request'}: ${i.message}`).join('; '));
  return r.data;
}

const ReinSearch = z.object({ niche: z.string().trim().min(2, 'Type a niche or topic').max(200), region: Region.default('worldwide') });
const FREE_SEARCHES = 3;
const ReinClientGet = z.object({ clientId: id, region: Region.default('worldwide') });
const ReinClientUpdate = z.object({ clientId: id, region: Region.default('worldwide') });
const RoomPreview = z.object({ clientId: id });

/** A client's niche from their brand kit, or an error that says how to fix it. */
async function clientNiche(db: ReturnType<typeof serviceClient>, clientId: string, workspaceId: string): Promise<string> {
  const { data, error } = await db.from('clients').select('profile').eq('id', clientId).eq('owner_id', workspaceId).maybeSingle();
  if (error) throw new Error(`Could not read the client: ${error.message}`);
  if (!data) throw new InputError('No such client.', 404);
  const niche = String((data.profile as { niche?: unknown } | null)?.niche ?? '').trim();
  if (niche.length < 2) throw new InputError('Add the client\'s niche in their brand kit first.', 409);
  return niche.slice(0, 200);
}

/**
 * What the app shows of a brief's viral part: the posts with their numbers, the creators
 * behind them, what the top posts share, and post ideas. Handles, names and follower counts
 * come from brief_posts and are gone 24 hours after the brief was made; after that the posts
 * still show through X's own embed, and the creators list is left empty.
 */
async function viralForApp(db: ReturnType<typeof serviceClient>, b: any) {
  const v = b?.viral;
  if (!v || !Array.isArray(v.posts)) return null;
  const { data: rows } = await db.from('brief_posts').select('post_id, author_id, handle, name, followers, excerpt').eq('brief_id', String(b.briefId ?? ''));
  const byPost = new Map((rows ?? []).map((r: any) => [String(r.post_id), r]));
  const detail = (postId: string) => {
    const r: any = byPost.get(postId);
    return r?.handle ? { handle: String(r.handle), name: String(r.name ?? r.handle), followers: Number(r.followers ?? 0), excerpt: r.excerpt ? String(r.excerpt) : null } : null;
  };
  const posts = v.posts.slice(0, 20).map((p: any) => ({
    postId: String(p.postId),
    createdAt: String(p.createdAt),
    ageHours: Number(p.ageHours ?? 0),
    numbers: p.numbers,
    media: Array.isArray(p.media) ? p.media.map(String) : [],
    sensitive: Boolean(p.sensitive),
    perHour: Number(p.perHour ?? 0),
    vsUsual: p.vsUsual == null ? null : Number(p.vsUsual),
    bucket: p.bucket === 'rising' ? 'rising' : 'proven',
    account: detail(String(p.postId)),
  }));
  const creators = (Array.isArray(v.creators) ? v.creators : [])
    .map((c: any) => {
      const d = detail(String(c.bestPostId));
      return d ? { handle: d.handle, name: d.name, followers: d.followers, bestPostId: String(c.bestPostId), postsSeen: Number(c.postsSeen ?? 0), medianScore: Number(c.medianScore ?? 0), bestScore: Number(c.bestScore ?? 0) } : null;
    })
    .filter(Boolean);
  return {
    posts,
    creators,
    detailsExpired: posts.length > 0 && posts.every((p: any) => !p.account),
    patterns: (Array.isArray(v.patterns) ? v.patterns : []).slice(0, 5).map((p: any) => ({ pattern: String(p.pattern ?? ''), why: String(p.why ?? ''), postIds: (p.postIds ?? []).map(String) })),
    ideas: (Array.isArray(v.ideas) ? v.ideas : []).slice(0, 6).map((i: any) => ({ idea: String(i.idea ?? ''), pattern: String(i.pattern ?? '') })),
    queries: (v.queries ?? []).map(String),
    stats: v.stats ?? null,
  };
}

/** A brief as the app shows it: viral posts and creators, then topics. */
async function forApp(db: ReturnType<typeof serviceClient>, b: any) {
  return { ...briefForApp(b), viral: await viralForApp(db, b) };
}

/**
 * The client's own follower count, for "accounts like yours". Read from their public X
 * profile at most once a day ($0.01), and only when the team asks Rein for an update.
 */
async function clientFollowers(db: ReturnType<typeof serviceClient>, clientId: string, workspaceId: string, refresh: boolean): Promise<number | null> {
  const { data } = await db.from('clients').select('x_handle, x_followers, x_followers_at').eq('id', clientId).eq('owner_id', workspaceId).maybeSingle();
  if (!data) return null;
  const fresh = data.x_followers_at && Date.now() - Date.parse(data.x_followers_at) < 864e5;
  if (!refresh || fresh || !data.x_handle) return data.x_followers ?? null;
  try {
    const profile = await impl.x_profile_lookup({ budget: new Budget('rein', { perCallCap: 0.02 }) }, { handle: data.x_handle });
    await db.from('clients').update({ x_followers: profile.followers, x_followers_at: new Date().toISOString() }).eq('id', clientId);
    return profile.followers;
  } catch (err) {
    console.error('could not read the client follower count', err instanceof Error ? err.message : err);
    return data.x_followers ?? null;
  }
}

/** What the app shows of a brief's topics: why they move, and links. */
function briefForApp(b: any) {
  return {
    briefId: String(b?.briefId ?? ''),
    niche: String(b?.niche ?? ''),
    createdAt: String(b?.createdAt ?? ''),
    notFound: b?.notFound ? String(b.notFound) : null,
    trends: (Array.isArray(b?.trends) ? b.trends : []).slice(0, 10).map((t: any) => ({
      topic: String(t.topic ?? ''),
      summary: String(t.summary ?? ''),
      whyNow: String(t.whyNow ?? ''),
      momentum: String(t.momentum ?? ''),
      hashtags: Array.isArray(t.hashtags) ? t.hashtags.slice(0, 5).map(String) : [],
      touchesFinance: Boolean(t.touchesFinance),
      sources: (Array.isArray(t.sources) ? t.sources : []).slice(0, 3).map((c: any) => ({ url: String(c.url ?? ''), title: c.title ? String(c.title) : null })).filter((c: any) => /^https:\/\//.test(c.url)),
    })),
  };
}

const InviteRequest = z.object({ role: z.enum(['team', 'client']), clientId: id.optional() });
const ResetRequest = z.object({ userId: id });
const AccessRequest = z.object({ memberId: id, clientId: id, on: z.boolean() });
const StageRequest = z.object({ clientId: id, stage: z.enum(['onboarding', 'active', 'paused']), note: z.string().trim().max(300).optional() });
const SetRequest = z.object({
  password: z.string().min(8, 'Use at least 8 characters').max(72),
  currentPassword: z.string().max(72).optional(),
});

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  const user = await userContextFromRequest(req);
  if (!user) return reply(401, { error: 'Sign in first' });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return reply(400, { error: 'Send a JSON body with an action' });
  const { action, ...input } = body as { action?: string };
  const userId = user.ownerId; // the caller's own login here

  try {
    const member = await memberOf(userId);
    if (!member) return reply(403, { error: 'Your login is not part of a Backlot team yet.' });
    const db = serviceClient();
    // Right after a team reset, only "who am I" and choosing a password work.
    if (action !== 'me' && action !== 'password_set') requireOwnPassword(member);

    switch (action) {
      case 'me': {
        const [{ data: me }, client] = await Promise.all([
          db.from('members').select('username, must_change_password').eq('id', userId).maybeSingle(),
          member.clientId
            ? db.from('clients').select('x_handle').eq('id', member.clientId).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        // The shared monthly AI budget, for the team's status line. Clients never see spend.
        let budget: { used: number; cap: number } | null = null;
        if (isTeam(member)) {
          const { data: s, error: sError } = await db.rpc('agent_spend_summary');
          if (sError) console.error('team: spend summary failed', sError.message);
          else budget = { used: Number(s?.month_used ?? 0), cap: Number(s?.month_cap ?? 0) };
        }
        return reply(200, {
          userId,
          budget,
          username: me?.username ?? null,
          role: member.role,
          workspaceId: member.workspaceId,
          clientId: member.clientId,
          clientHandle: client.data?.x_handle ?? null,
          mustChangePassword: me?.must_change_password ?? false,
        });
      }

      case 'people': {
        requireTeam(member);
        const [{ data: rows, error }, { data: clients, error: cError }] = await Promise.all([
          // Visitors are not part of the team's people list.
          db.from('workspace_members').select('user_id, role, client_id, created_at').eq('workspace_id', member.workspaceId).neq('role', 'visitor'),
          db.from('clients').select('id, x_handle').eq('owner_id', member.workspaceId).order('created_at'),
        ]);
        if (error || cError) throw new Error(`Could not read the team: ${(error ?? cError)!.message}`);
        const ids = (rows ?? []).map((r) => r.user_id);
        const { data: names, error: nError } = ids.length
          ? await db.from('members').select('id, username').in('id', ids)
          : { data: [], error: null };
        if (nError) throw new Error(`Could not read usernames: ${nError.message}`);
        const nameOf = new Map((names ?? []).map((n) => [n.id, n.username]));
        const handleOf = new Map((clients ?? []).map((c) => [c.id, c.x_handle]));
        const order = { owner: 0, team: 1, client: 2 } as Record<string, number>;
        const people = (rows ?? [])
          .map((r) => ({
            userId: r.user_id,
            username: nameOf.get(r.user_id) ?? null,
            role: r.role,
            clientId: r.client_id,
            clientHandle: r.client_id ? handleOf.get(r.client_id) ?? null : null,
            isYou: r.user_id === userId,
            joinedAt: r.created_at,
          }))
          .sort((a, b) => order[a.role] - order[b.role] || String(a.username).localeCompare(String(b.username)));
        const joined = new Set(people.filter((p) => p.clientId).map((p) => p.clientId));
        // Team members see only the clients they were granted; the executive sees every grant.
        const visible = (clients ?? []).filter((c) => seesClient(member, c.id));
        let grants: Array<{ memberId: string; clientId: string }> = [];
        if (member.role === 'owner') {
          const { data: g, error: gError } = await db.from('client_access').select('member_id, client_id').eq('workspace_id', member.workspaceId);
          if (gError) throw new Error(`Could not read access: ${gError.message}`);
          grants = (g ?? []).map((x) => ({ memberId: x.member_id, clientId: x.client_id }));
        }
        return reply(200, {
          people: member.role === 'owner' ? people : people.filter((p) => !p.clientId || seesClient(member, p.clientId)),
          clients: visible.map((c) => ({ clientId: c.id, handle: c.x_handle, hasLogin: joined.has(c.id) })),
          grants,
        });
      }

      case 'access_set': {
        if (member.role !== 'owner') throw new AccessError('Only the executive gives access to clients.');
        const r = parse(AccessRequest, input);
        const [{ data: who }, { data: c }] = await Promise.all([
          db.from('workspace_members').select('role').eq('user_id', r.memberId).eq('workspace_id', member.workspaceId).maybeSingle(),
          db.from('clients').select('id').eq('id', r.clientId).eq('owner_id', member.workspaceId).maybeSingle(),
        ]);
        if (!who || who.role !== 'team') throw new InputError('Access is given to team members only.', 404);
        if (!c) throw new InputError('No such client in your workspace.', 404);
        const { error } = r.on
          ? await db.from('client_access').upsert({ member_id: r.memberId, client_id: r.clientId, workspace_id: member.workspaceId, granted_by: userId }, { onConflict: 'member_id,client_id' })
          : await db.from('client_access').delete().eq('member_id', r.memberId).eq('client_id', r.clientId);
        if (error) throw new Error(`Could not save access: ${error.message}`);
        return reply(200, { memberId: r.memberId, clientId: r.clientId, on: r.on });
      }

      case 'client_stage': {
        if (member.role !== 'owner') throw new AccessError('Only the executive changes a client\'s stage.');
        const r = parse(StageRequest, input);
        const { data, error } = await db
          .from('clients')
          .update({ stage: r.stage, stage_note: r.note || null, stage_at: new Date().toISOString() })
          .eq('id', r.clientId)
          .eq('owner_id', member.workspaceId)
          .select('id')
          .maybeSingle();
        if (error) throw new Error(`Could not save the stage: ${error.message}`);
        if (!data) throw new InputError('No such client in your workspace.', 404);
        return reply(200, { clientId: r.clientId, stage: r.stage });
      }

      case 'invite_create': {
        requireTeam(member);
        const r = parse(InviteRequest, input);
        if (r.role === 'client') {
          if (!r.clientId) throw new InputError('Pick which client this invite is for.');
          const { data: c } = await db.from('clients').select('id').eq('id', r.clientId).eq('owner_id', member.workspaceId).maybeSingle();
          if (!c) throw new InputError('No such client in your workspace.', 404);
          const { data: taken } = await db.from('workspace_members').select('user_id').eq('client_id', r.clientId).limit(1);
          if (taken && taken.length > 0) throw new InputError('This client already has a login.', 409);
        }
        const code = newInviteCode();
        const { data: expiresAt, error } = await db.rpc('invite_create', {
          p_code_hash: await hashCode(code),
          p_workspace: member.workspaceId,
          p_role: r.role,
          p_client: r.role === 'client' ? r.clientId : null,
          p_created_by: userId,
        });
        if (error) throw new Error(`Could not make the invite: ${error.message}`);
        return reply(200, { code, role: r.role, clientId: r.role === 'client' ? r.clientId : null, expiresAt });
      }

      case 'password_reset': {
        // Only the executive (the workspace owner) resets other people's passwords.
        if (member.role !== 'owner') throw new AccessError('Only the executive can reset passwords.');
        const r = parse(ResetRequest, input);
        if (r.userId === userId) throw new InputError('To change your own password, use Change password.');
        const target = await memberOf(r.userId);
        if (!target || target.workspaceId !== member.workspaceId) throw new InputError('No such person in your workspace.', 404);
        if (target.role === 'owner') throw new AccessError('The owner resets their own password.');
        const temp = temporaryPassword();
        const { error } = await db.auth.admin.updateUserById(r.userId, { password: temp });
        if (error) throw new Error(`Could not reset the password: ${error.message}`);
        const { error: flagError } = await db.from('members').update({ must_change_password: true }).eq('id', r.userId);
        if (flagError) throw new Error(`Could not mark the reset: ${flagError.message}`);
        // Sign that login out everywhere, so whoever had the old password loses access.
        const { error: revokeError } = await db.rpc('revoke_sessions', { p_user: r.userId });
        if (revokeError) console.error('team: could not sign the old sessions out', revokeError.message);
        return reply(200, { userId: r.userId, temporaryPassword: temp });
      }

      case 'password_set': {
        const r = parse(SetRequest, input);
        const { data: me } = await db.from('members').select('username, must_change_password').eq('id', userId).maybeSingle();
        if (!me) throw new InputError('Your login has no member record.', 404);
        // After a team reset the person just signed in with the temporary password. Any other
        // time, the current password is required, so a borrowed phone cannot lock someone out.
        if (!me.must_change_password) {
          if (!r.currentPassword) throw new InputError('Type your current password.');
          const check = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { error: wrong } = await check.auth.signInWithPassword({ email: `${me.username}@${LOGIN_DOMAIN}`, password: r.currentPassword });
          if (wrong) throw new InputError('Your current password is not right.', 403);
          await check.auth.signOut({ scope: 'local' });
        }
        const { error } = await db.auth.admin.updateUserById(userId, { password: r.password });
        if (error) {
          const code = (error as { code?: string }).code ?? '';
          if (code === 'weak_password' || code === 'same_password') throw new InputError('Pick a different, stronger password.');
          throw new Error(`Could not change the password: ${error.message}`);
        }
        await db.from('members').update({ must_change_password: false }).eq('id', userId);
        return reply(200, { ok: true });
      }

      case 'rein_search': {
        const r = parse(ReinSearch, input);
        // A brief from the last 6 hours costs nothing, for anyone.
        const reused = await reusableBrief(r.niche, r.region);
        if (reused) {
          await db.from('rein_searches').insert({ user_id: userId, workspace_id: member.workspaceId, niche: r.niche, region: r.region, brief_id: reused.brief.briefId, reused: true });
          return reply(200, { brief: await forApp(db, reused.brief), reused: true });
        }
        let rowId: string | null = null;
        // Everyone outside the team (clients and visitors) gets the 3 free searches.
        if (!isTeam(member)) {
          const { data, error } = await db.rpc('rein_claim_free', { p_user: userId, p_workspace: member.workspaceId, p_niche: r.niche, p_region: r.region });
          if (error) throw new Error(`Could not check free searches: ${error.message}`);
          if (!data) return reply(402, { error: 'You have used your 3 free searches. Paid searches open soon: $5 a search or $15 a month.', pay: true });
          rowId = String(data);
        } else {
          const { data, error } = await db.from('rein_searches').insert({ user_id: userId, workspace_id: member.workspaceId, niche: r.niche, region: r.region }).select('id').single();
          if (error) throw new Error(`Could not record the search: ${error.message}`);
          rowId = data.id;
        }
        const res = await callRein({ niche: r.niche, region: r.region });
        if (res.status !== 200 || !res.body?.brief) {
          // Nothing was found or Rein failed: give the free search back.
          await db.from('rein_searches').delete().eq('id', rowId);
          if (res.status === 409) throw new InputError('Someone is searching this niche right now. Try again in a minute.', 409);
          if (res.status === 402) throw new InputError('This month\'s AI budget is used up. It resets on the 1st.', 402);
          throw new Error(`Rein failed: ${String(res.body?.error ?? res.status).slice(0, 200)}`);
        }
        const brief = res.body.brief;
        await db.from('rein_searches').update({ brief_id: brief.briefId, reused: Boolean(res.body?.diagnostics?.reused) }).eq('id', rowId);
        return reply(200, { brief: await forApp(db, brief), reused: Boolean(res.body?.diagnostics?.reused) });
      }

      // A client's trends: their latest saved brief, and for the team, what an update costs.
      // A signed link to a client's private room preview. Nothing is stored; it ends in 24 hours.
      case 'room_preview': {
        const r = parse(RoomPreview, input);
        requireClientAccess(member, r.clientId);
        const { data: room, error } = await db.from('rooms').select('slug').eq('client_id', r.clientId).eq('workspace_id', member.workspaceId).maybeSingle();
        if (error) throw new Error(`Could not read the room: ${error.message}`);
        if (!room) throw new InputError('Set up the room first.', 404);
        return reply(200, await previewUrl(room.slug));
      }

      case 'rein_client': {
        const r = parse(ReinClientGet, input);
        requireClientAccess(member, r.clientId);
        const { data: line, error } = await db
          .from('client_briefs')
          .select('brief_id, region, source, created_at')
          .eq('client_id', r.clientId)
          .eq('workspace_id', member.workspaceId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw new Error(`Could not read the client's trends: ${error.message}`);
        let latest = null;
        if (line) {
          const { data: nb } = await db.from('niche_briefs').select('brief').eq('id', line.brief_id).maybeSingle();
          if (nb) latest = { ...(await forApp(db, nb.brief)), savedAt: line.created_at, region: line.region, source: line.source };
        }
        const followers = await clientFollowers(db, r.clientId, member.workspaceId, false);
        if (!isTeam(member)) return reply(200, { latest, clientFollowers: followers });
        const niche = await clientNiche(db, r.clientId, member.workspaceId).catch(() => null);
        const reusable = niche ? await reusableBrief(niche, r.region) : null;
        return reply(200, {
          latest,
          clientFollowers: followers,
          niche,
          preview: niche ? { free: Boolean(reusable), costUsd: reusable ? 0 : REIN_ESTIMATE_USD, checkedAt: reusable?.brief.createdAt ?? null } : null,
        });
      }

      // The team asks Rein what is rising in a client's niche now, and saves it as theirs.
      case 'rein_client_update': {
        requireTeam(member);
        const r = parse(ReinClientUpdate, input);
        requireClientAccess(member, r.clientId);
        const niche = await clientNiche(db, r.clientId, member.workspaceId);
        const reused = await reusableBrief(niche, r.region);
        let brief: any;
        let wasReused = Boolean(reused);
        if (reused) {
          brief = reused.brief;
        } else {
          const res = await callRein({ niche, region: r.region });
          if (res.status === 409) throw new InputError('Rein is already checking this niche. Try again in a minute.', 409);
          if (res.status === 402) throw new InputError('This month\'s AI budget is used up. It resets on the 1st.', 402);
          if (res.status !== 200 || !res.body?.brief) throw new Error(`Rein failed: ${String(res.body?.error ?? res.status).slice(0, 200)}`);
          brief = res.body.brief;
          wasReused = Boolean(res.body?.diagnostics?.reused);
        }
        const { data: saved, error } = await db
          .from('client_briefs')
          .insert({ workspace_id: member.workspaceId, client_id: r.clientId, brief_id: brief.briefId, region: r.region, source: 'update', reused: wasReused, added_by: userId })
          .select('created_at')
          .single();
        if (error) throw new Error(`Could not save the client's trends: ${error.message}`);
        const top = Array.isArray(brief?.trends) ? brief.trends.slice(0, 2).map((t: any) => String(t?.topic ?? '').slice(0, 60)).filter(Boolean) : [];
        const pattern = String(brief?.viral?.patterns?.[0]?.pattern ?? '').slice(0, 80);
        const viralCount = Array.isArray(brief?.viral?.posts) ? brief.viral.posts.length : 0;
        await krisNote(db, {
          workspaceId: member.workspaceId,
          clientId: r.clientId,
          ref: `trends:${brief.briefId}`,
          body: viralCount
            ? `Rein pulled the ${viralCount} posts doing best in your niche this week${pattern ? `. What keeps working: ${pattern.charAt(0).toLowerCase()}${pattern.slice(1)}` : ''}. Ask me how we could play it.`
            : top.length
            ? `Rein found what is rising in your niche: ${top.join(' and ')}. Ask me how we could play it.`
            : 'Rein checked what is rising in your niche. The full list is on your Game Plan.',
          link: 'insights',
        });
        const followers = await clientFollowers(db, r.clientId, member.workspaceId, true);
        return reply(200, { latest: { ...(await forApp(db, brief)), savedAt: saved.created_at, region: r.region, source: 'update' }, clientFollowers: followers, reused: wasReused });
      }

      case 'rein_history': {
        const { data: rows, error } = await db
          .from('rein_searches')
          .select('id, niche, region, brief_id, reused, free, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(20);
        if (error) throw new Error(`Could not read your searches: ${error.message}`);
        const usedFree = (rows ?? []).filter((x) => x.free && !x.reused).length;
        const last = (rows ?? []).find((x) => x.brief_id);
        let lastBrief = null;
        if (last) {
          const { data: nb } = await db.from('niche_briefs').select('brief').eq('id', last.brief_id).maybeSingle();
          if (nb) lastBrief = await forApp(db, nb.brief);
        }
        return reply(200, {
          freeLeft: isTeam(member) ? null : Math.max(0, FREE_SEARCHES - usedFree),
          searches: (rows ?? []).slice(0, 8).map((x) => ({ niche: x.niche, region: x.region, at: x.created_at })),
          last: lastBrief,
        });
      }

      default:
        return reply(400, { error: 'Unknown action. Use me, people, invite_create, password_reset, password_set, rein_search, rein_history, rein_client, rein_client_update or room_preview.' });
    }
  } catch (err) {
    if (err instanceof AccessError) return reply(err.status, { error: err.message });
    if (err instanceof InputError) return reply(err.status, { error: err.message });
    console.error(`team: ${action} failed`, err instanceof Error ? err.message : err);
    return reply(500, { error: 'Something went wrong. Try again.' });
  }
}

Deno.serve(withCors(handle));
