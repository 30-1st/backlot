// Creates a Backlot login from a username and a password.
//
// Backlot has no email. Supabase Auth still needs an address for every user,
// so each username gets an internal one on a domain that can never receive
// mail. Nobody ever sees it, and nothing is ever sent to it.
//
// This function is public by nature (it is the sign-up door), so the platform's
// JWT check is off and the function guards itself: strict input rules and a cap
// on sign-ups per network address.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const LOGIN_DOMAIN = 'login.backlot.invalid';
const USERNAME = /^[a-z0-9._]{3,24}$/;
const RESERVED = new Set(['admin', 'administrator', 'backlot', 'support', 'help', 'root', 'system', 'staff', 'moderator']);
const MAX_SIGNUPS_PER_HOUR = 5;

const cors = {
  'Access-Control-Allow-Origin': '*',
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'method' });

  let body: { username?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'bad_request' });
  }

  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

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
  await db.from('signup_log').insert({ ip });

  const { data: created, error: createError } = await db.auth.admin.createUser({
    email: `${username}@${LOGIN_DOMAIN}`,
    password,
    email_confirm: true,
    app_metadata: { username },
  });
  if (createError || !created.user) {
    const code = (createError as { code?: string } | null)?.code ?? '';
    if (code === 'email_exists' || code === 'user_already_exists') return reply(409, { error: 'username_taken' });
    if (code === 'weak_password') return reply(400, { error: 'password_weak' });
    console.error('createUser failed', code, createError?.message);
    return reply(500, { error: 'server' });
  }

  const { error: memberError } = await db.from('members').insert({ id: created.user.id, username });
  if (memberError) {
    // Do not leave a login behind without its member row.
    await db.auth.admin.deleteUser(created.user.id);
    if (memberError.code === '23505') return reply(409, { error: 'username_taken' });
    console.error('member insert failed', memberError.code, memberError.message);
    return reply(500, { error: 'server' });
  }

  return reply(200, { ok: true, username });
});
