// Removes logins that have not opened Backlot for 60 days, along with their
// accounts, narrations and media, clears out chats nobody is in any more, and deletes
// Library files that were removed more than 7 days ago.
// Runs once a day from pg_cron.
//
// The owner, the team and clients are never removed: deleting the owner's login would
// delete every client, voice card and campaign with it, and a client who goes quiet for
// two months is still a client. Visitors (open sign-ups for the Playground) and logins
// outside the workspace expire after 60 idle days, with their narrations and media.
//
// The caller must present the cleanup token kept in public.internal_config,
// which only server-side code can read. The platform's JWT check is off
// because the scheduler has no user session.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';

const IDLE_DAYS = 60;
const BATCH = 200;
const LIBRARY_KEEP_DAYS = 7;
const BOARD_KEEP_DAYS = 90;

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

  // Never purge the owner, the team or clients, whatever their activity.
  const idleIds = (idle ?? []).map((m) => m.id);
  const { data: kept, error: keptError } = idleIds.length
    ? await db.from('workspace_members').select('user_id').in('user_id', idleIds).in('role', ['owner', 'team', 'client'])
    : { data: [], error: null };
  if (keptError) return reply(500, { error: 'server' });
  const protectedIds = new Set((kept ?? []).map((k) => k.user_id));

  let logins = 0;
  let files = 0;
  const failed: string[] = [];
  for (const member of (idle ?? []).filter((m) => !protectedIds.has(m.id))) {
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

  // Library files someone removed more than 7 days ago: delete the file, then its row.
  // Until then they could still be restored from the app.
  let libraryFiles = 0;
  const { data: gone, error: goneError } = await db
    .from('library_items')
    .select('id, path')
    .lt('removed_at', new Date(Date.now() - LIBRARY_KEEP_DAYS * 86_400_000).toISOString())
    .limit(500);
  if (goneError) {
    console.error('finding removed library files failed', goneError.message);
  } else if (gone && gone.length > 0) {
    const { error: storageError } = await db.storage.from('library').remove(gone.map((g) => g.path));
    if (storageError) {
      console.error('deleting removed library files failed', storageError.message);
    } else {
      const { error } = await db.from('library_items').delete().in('id', gone.map((g) => g.id));
      if (error) console.error('deleting removed library rows failed', error.message);
      else libraryFiles = gone.length;
    }
  }

  // Inspiration board: items removed more than 7 days ago, and unpinned items 90 days old.
  // Screenshots go first, then the rows.
  let boardItems = 0;
  const boardBefore = new Date(Date.now() - LIBRARY_KEEP_DAYS * 86_400_000).toISOString();
  const boardOld = new Date(Date.now() - BOARD_KEEP_DAYS * 86_400_000).toISOString();
  const { data: stale, error: staleError } = await db
    .from('inspiration_items')
    .select('id, path')
    .or(`removed_at.lt.${boardBefore},and(pinned.eq.false,created_at.lt.${boardOld})`)
    .limit(500);
  if (staleError) {
    console.error('finding old board items failed', staleError.message);
  } else if (stale && stale.length > 0) {
    const shots = stale.map((s) => s.path).filter((p): p is string => Boolean(p));
    const { error: storageError } = shots.length ? await db.storage.from('board').remove(shots) : { error: null };
    if (storageError) {
      console.error('deleting old board screenshots failed', storageError.message);
    } else {
      const { error } = await db.from('inspiration_items').delete().in('id', stale.map((s) => s.id));
      if (error) console.error('deleting old board rows failed', error.message);
      else boardItems = stale.length;
    }
  }

  // The sign-up log only needs the last hour. Keep a day and drop the rest.
  await db.from('signup_log').delete().lt('created_at', new Date(Date.now() - 86_400_000).toISOString());

  // A chat everyone has left (or whose members were all removed above) is of
  // no use to anyone. Its messages go with it.
  let chats = 0;
  const { data: empty, error: emptyError } = await db
    .from('conversations')
    .select('id, conversation_members!left(user_id)')
    .is('conversation_members', null)
    .limit(500);
  if (emptyError) {
    console.error('finding empty chats failed', emptyError.message);
  } else if (empty && empty.length > 0) {
    const { error } = await db.from('conversations').delete().in('id', empty.map((c) => c.id));
    if (error) console.error('removing empty chats failed', error.message);
    else chats = empty.length;
  }

  return reply(200, { ok: true, logins, files, libraryFiles, boardItems, chats, failed: failed.length });
});
