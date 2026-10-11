import type { MediaItem, Sandbox, SavePoint } from '../types';
import type { Platform } from '../platforms';
import { referencedMedia } from '../state';
import { supabase } from './supabase';
import { describe, isSandbox, isSavePoint, type Account, type NarrationMeta, type OpenNarration } from './library.types';

// The library kept in Supabase. Each signed-in creator can reach only their
// own rows; the database enforces that, not this file.

const META = 'id, name, created_at, updated_at, username, avatar, posts, is_example';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MetaRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  username: string;
  avatar: MediaItem | null;
  posts: number;
  is_example: boolean;
}

interface AccountRow {
  id: string;
  platform: Platform;
  created_at: string;
  narrations: MetaRow[] | null;
}

function db() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

const ms = (iso: string) => new Date(iso).getTime();

function toMeta(row: MetaRow): NarrationMeta {
  return {
    id: row.id,
    name: row.name,
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at),
    username: row.username,
    avatar: row.avatar,
    posts: row.posts,
    isExample: row.is_example,
  };
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    platform: row.platform,
    createdAt: ms(row.created_at),
    narrations: (row.narrations ?? []).map(toMeta).sort((a, b) => a.createdAt - b.createdAt),
  };
}

/** The copied-out facts, in the column names the table uses. */
function metaColumns(sandbox: Sandbox) {
  const d = describe(sandbox);
  return { username: d.username, avatar: d.avatar, posts: d.posts, is_example: d.isExample };
}

export async function listAccounts(platform?: Platform): Promise<Account[]> {
  let query = db().from('accounts').select(`id, platform, created_at, narrations(${META})`).order('created_at');
  if (platform) query = query.eq('platform', platform);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as unknown as AccountRow[]).map(toAccount);
}

export async function openNarration(id: string): Promise<OpenNarration | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await db()
    .from('narrations')
    .select(`id, sandbox, save_point, account:accounts(id, platform, created_at, narrations(${META}))`)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as { sandbox: unknown; save_point: unknown; account: AccountRow | null };
  if (!row.account || !isSandbox(row.sandbox)) return null;
  const account = toAccount(row.account);
  const meta = account.narrations.find((n) => n.id === id);
  if (!meta) return null;
  return { account, meta, sandbox: row.sandbox, savePoint: isSavePoint(row.save_point) ? row.save_point : undefined };
}

export async function createAccount(platform: Platform, sandbox: Sandbox, name = 'Original'): Promise<NarrationMeta> {
  const accountId = crypto.randomUUID();
  const { error: accountError } = await db().from('accounts').insert({ id: accountId, platform });
  if (accountError) throw accountError;

  const savePoint: SavePoint = { sandbox, savedAt: Date.now() };
  const { data, error } = await db()
    .from('narrations')
    .insert({ id: crypto.randomUUID(), account_id: accountId, name, sandbox, save_point: savePoint, ...metaColumns(sandbox) })
    .select(META)
    .single();
  if (error) {
    // Do not leave an account behind with no narration in it.
    await db().from('accounts').delete().eq('id', accountId);
    throw error;
  }
  return toMeta(data as unknown as MetaRow);
}

export async function deleteAccount(accountId: string): Promise<void> {
  // The account's narrations go with it.
  const { error } = await db().from('accounts').delete().eq('id', accountId);
  if (error) throw error;
}

export async function duplicateNarration(sourceId: string, name: string): Promise<NarrationMeta | null> {
  const { data: source, error: readError } = await db()
    .from('narrations')
    .select('account_id, sandbox, save_point')
    .eq('id', sourceId)
    .maybeSingle();
  if (readError) throw readError;
  if (!source || !isSandbox(source.sandbox)) return null;

  const sandbox = source.sandbox as Sandbox;
  const savePoint: SavePoint = isSavePoint(source.save_point) ? source.save_point : { sandbox, savedAt: Date.now() };
  const { data, error } = await db()
    .from('narrations')
    .insert({
      id: crypto.randomUUID(),
      account_id: source.account_id,
      name,
      sandbox,
      save_point: savePoint,
      ...metaColumns(sandbox),
    })
    .select(META)
    .single();
  if (error) throw error;
  return toMeta(data as unknown as MetaRow);
}

export async function renameNarration(id: string, name: string): Promise<void> {
  const { error } = await db().from('narrations').update({ name }).eq('id', id);
  if (error) throw error;
}

export async function deleteNarration(id: string): Promise<void> {
  const { data: row, error: readError } = await db().from('narrations').select('account_id').eq('id', id).maybeSingle();
  if (readError) throw readError;
  if (!row) return;
  const { count, error: countError } = await db()
    .from('narrations')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', row.account_id);
  if (countError) throw countError;
  if ((count ?? 0) < 2) return;
  const { error } = await db().from('narrations').delete().eq('id', id);
  if (error) throw error;
}

export async function saveSandbox(id: string, sandbox: Sandbox): Promise<void> {
  const { error } = await db()
    .from('narrations')
    .update({ sandbox, ...metaColumns(sandbox) })
    .eq('id', id);
  if (error) throw error;
}

export async function saveSavePoint(id: string, point: SavePoint): Promise<void> {
  const { error } = await db().from('narrations').update({ save_point: point }).eq('id', id);
  if (error) throw error;
}

export async function mediaInUse(exceptNarrationId?: string): Promise<Set<string>> {
  const { data, error } = await db().from('narrations').select('id, sandbox, save_point');
  if (error) throw error;
  const keep = new Set<string>();
  for (const row of data ?? []) {
    if (row.id === exceptNarrationId) continue;
    if (isSandbox(row.sandbox)) for (const m of referencedMedia(row.sandbox)) keep.add(m);
    if (isSavePoint(row.save_point)) for (const m of referencedMedia(row.save_point.sandbox)) keep.add(m);
  }
  return keep;
}
