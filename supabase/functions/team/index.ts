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
//   password_reset   { userId }                      a temporary password, shown once    team
//   password_set     { password, currentPassword? }  change your own password            everyone
//
// Nothing here is paid. Codes and temporary passwords are never stored in plain text and
// never logged.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { userContextFromRequest } from '../_shared/toolbox.ts';
import { serviceClient } from '../_shared/spend.ts';
import { AccessError, memberOf, requireOwnPassword, requireTeam } from '../_shared/workspace.ts';
import { hashCode, newInviteCode, temporaryPassword } from '../_shared/invite-code.ts';
import { id, z } from '../_shared/schemas/common.ts';
import { withCors } from '../_shared/cors.ts';

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

const InviteRequest = z.object({ role: z.enum(['team', 'client']), clientId: id.optional() });
const ResetRequest = z.object({ userId: id });
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
        if (member.role !== 'client') {
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
          db.from('workspace_members').select('user_id, role, client_id, created_at').eq('workspace_id', member.workspaceId),
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
        return reply(200, {
          people,
          clients: (clients ?? []).map((c) => ({ clientId: c.id, handle: c.x_handle, hasLogin: joined.has(c.id) })),
        });
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
        requireTeam(member);
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

      default:
        return reply(400, { error: 'Unknown action. Use me, people, invite_create, password_reset or password_set.' });
    }
  } catch (err) {
    if (err instanceof AccessError) return reply(err.status, { error: err.message });
    if (err instanceof InputError) return reply(err.status, { error: err.message });
    console.error(`team: ${action} failed`, err instanceof Error ? err.message : err);
    return reply(500, { error: 'Something went wrong. Try again.' });
  }
}

Deno.serve(withCors(handle));
