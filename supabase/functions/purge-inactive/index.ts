// Removes logins that have not opened Backlot for 60 days, along with their
// accounts, narrations and media. Runs once a day from pg_cron.
//
// The caller must present the cleanup token kept in public.internal_config,
// which only server-side code can read. The platform's JWT check is off
// because the scheduler has no user session.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';

const IDLE_DAYS = 60;
const BATCH = 200;

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
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

/** Delete every file in one login's media folder. */
async function emptyFolder(db: SupabaseClient, userId: string): Promise<number> {
  let removed = 0;
  for (;;) {
    const { data, error } = await db.storage.from('media').list(userId, { limit: 1000 });
    if (error) throw error;
    if (!data || data.length === 0) return removed;
    const { error: removeError } = await db.storage.from('media').remove(data.map((f) => `${userId}/${f.name}`));
    if (removeError) throw removeError;
    removed += data.length;
    if (data.length < 1000) return removed;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return reply(405, { error: 'method' });

  const db = admin();

  const { data: config, error: configError } = await db
    .from('internal_config')
    .select('value')
    .eq('key', 'purge_token')
    .maybeSingle();
  if (configError || !config) return reply(500, { error: 'server' });
  const presented = req.headers.get('x-purge-token') ?? '';
  if (presented.length === 0 || presented !== config.value) return reply(401, { error: 'unauthorized' });

  const cutoff = new Date(Date.now() - IDLE_DAYS * 86_400_000).toISOString();
  const { data: idle, error: idleError } = await db
    .from('members')
    .select('id')
    .lt('last_active_at', cutoff)
    .limit(BATCH);
  if (idleError) return reply(500, { error: 'server' });

  let logins = 0;
  let files = 0;
  const failed: string[] = [];
  for (const member of idle ?? []) {
    try {
      files += await emptyFolder(db, member.id);
      // Deleting the login removes its member row, accounts and narrations with it.
      const { error } = await db.auth.admin.deleteUser(member.id);
      if (error) throw error;
      logins += 1;
    } catch (err) {
      console.error('purge failed for', member.id, err instanceof Error ? err.message : err);
      failed.push(member.id);
    }
  }

  // The sign-up log only needs the last hour. Keep a day and drop the rest.
  await db.from('signup_log').delete().lt('created_at', new Date(Date.now() - 86_400_000).toISOString());

  return reply(200, { ok: true, logins, files, failed: failed.length });
});
