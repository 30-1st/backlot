// Creates a Backlot login from a one-time invite code, a username and a password.
//
// Backlot is private: nobody can sign up without a code a teammate made (team function,
// invite_create). The code decides whether the new login joins as team or as a client,
// and which client. It is claimed in one step, so it can never be used twice; if making
// the login fails afterwards, the code is handed back.
//
// Backlot has no email. Supabase Auth still needs an address for every user,
// so each username gets an internal one on a domain that can never receive
// mail. Nobody ever sees it, and nothing is ever sent to it.
//
// This function is public by nature (it is the sign-up door), so the platform's
// JWT check is off and the function guards itself: strict input rules and a cap
// on sign-ups per network address.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { hashCode, looksLikeCode } from '../_shared/invite-code.ts';
import { withCors } from '../_shared/cors.ts';

const LOGIN_DOMAIN = 'login.backlot.invalid';
const USERNAME = /^[a-z0-9._]{3,24}$/;
const RESERVED = new Set(['admin', 'administrator', 'backlot', 'support', 'help', 'root', 'system', 'staff', 'moderator']);
const MAX_SIGNUPS_PER_HOUR = 5;
// Across every address together. The forwarded address can be spoofed, so this cap is
// what really bounds guessing; a small team never comes near it.
const MAX_SIGNUPS_PER_HOUR_ALL = 30;

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function admin() {
  const url = Deno.env.get('SUPABASE_URL')!;
  let key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  try {
    const named = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (typeof named.default === 'string') key = named.default;
  } catch {
    // Fall back to the legacy key above.
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'method' });

  let body: { username?: unknown; password?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'bad_request' });
  }

  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const code = typeof body.code === 'string' ? body.code : '';

  if (!looksLikeCode(code)) return reply(400, { error: 'invite_invalid' });
  if (!USERNAME.test(username)) return reply(400, { error: 'username_format' });
  if (RESERVED.has(username)) return reply(409, { error: 'username_taken' });
  if (password.length < 8 || password.length > 72) return reply(400, { error: 'password_length' });

  const db = admin();

  // Slow down bulk sign-ups from one address.
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count, error: countError } = await db
    .from('signup_log')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('created_at', since);
  if (countError) return reply(500, { error: 'server' });
  if ((count ?? 0) >= MAX_SIGNUPS_PER_HOUR) return reply(429, { error: 'too_many' });
  const { count: all, error: allError } = await db
    .from('signup_log')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since);
  if (allError) return reply(500, { error: 'server' });
  if ((all ?? 0) >= MAX_SIGNUPS_PER_HOUR_ALL) return reply(429, { error: 'too_many' });
  await db.from('signup_log').insert({ ip });

  // Claim the code before making anything. Wrong, used and expired codes look the same.
  const { data: claimed, error: claimError } = await db.rpc('invite_claim', { p_code_hash: await hashCode(code) });
  if (claimError) {
    console.error('invite claim failed', claimError.code, claimError.message);
    return reply(500, { error: 'server' });
  }
  const invite = Array.isArray(claimed) ? claimed[0] : null;
  if (!invite) return reply(403, { error: 'invite_invalid' });
  const giveBack = async () => {
    const { error } = await db.rpc('invite_finish', { p_invite: invite.invite_id, p_user: null });
    if (error) console.error('could not hand the invite back', error.message);
  };

  const { data: created, error: createError } = await db.auth.admin.createUser({
    email: `${username}@${LOGIN_DOMAIN}`,
    password,
    email_confirm: true,
    app_metadata: { username },
  });
  if (createError || !created.user) {
    await giveBack();
    const errCode = (createError as { code?: string } | null)?.code ?? '';
    if (errCode === 'email_exists' || errCode === 'user_already_exists') return reply(409, { error: 'username_taken' });
    if (errCode === 'weak_password') return reply(400, { error: 'password_weak' });
    console.error('createUser failed', errCode, createError?.message);
    return reply(500, { error: 'server' });
  }
  const newId = created.user.id;

  // Do not leave a login behind without its member row and membership.
  const undo = async () => {
    await db.auth.admin.deleteUser(newId);
    await giveBack();
  };

  const { error: memberError } = await db.from('members').insert({ id: newId, username });
  if (memberError) {
    await undo();
    if (memberError.code === '23505') return reply(409, { error: 'username_taken' });
    console.error('member insert failed', memberError.code, memberError.message);
    return reply(500, { error: 'server' });
  }

  const { error: joinError } = await db.from('workspace_members').insert({
    user_id: newId,
    workspace_id: invite.workspace_id,
    role: invite.role,
    client_id: invite.client_id,
  });
  if (joinError) {
    await undo();
    // 23505 on client_id would mean the client already has a login.
    console.error('workspace join failed', joinError.code, joinError.message);
    return reply(500, { error: 'server' });
  }

  const { error: finishError } = await db.rpc('invite_finish', { p_invite: invite.invite_id, p_user: newId });
  if (finishError) console.error('could not record who used the invite', finishError.message);

  return reply(200, { ok: true, username, role: invite.role });
}

Deno.serve(withCors(handle));
