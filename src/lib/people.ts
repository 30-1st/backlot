import type { MediaItem } from '../types';
import type { Platform } from '../platforms';
import { currentUserId, supabase } from './supabase';
import type { NarrationMeta, Person, ShareRole } from './library.types';

// People: contacts, chats, and sharing narrations. Hosted build only.
//
// The rules live in the database, not here:
//   * someone is added by exact username and has to accept
//   * chats and shares only reach contacts
//   * the author of a narration decides who gets in and what they may do

function db() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

async function myId(): Promise<string> {
  const id = await currentUserId();
  if (!id) throw new Error('Signed out');
  return id;
}

const ms = (iso: string) => new Date(iso).getTime();
const byName = (a: Person, b: Person) => a.username.localeCompare(b.username);

/* ---------- Contacts ---------- */

export interface Contact {
  person: Person;
  /** contact: you both agreed. incoming: they asked you. outgoing: you asked them. */
  state: 'contact' | 'incoming' | 'outgoing';
}

export async function listContacts(): Promise<Contact[]> {
  const me = await myId();
  const { data, error } = await db()
    .from('contacts')
    .select(
      'status, requester, addressee, asked:members!contacts_requester_fkey(id, username), got:members!contacts_addressee_fkey(id, username)',
    );
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{
    status: 'pending' | 'accepted';
    requester: string;
    addressee: string;
    asked: Person | null;
    got: Person | null;
  }>;
  const contacts: Contact[] = [];
  for (const row of rows) {
    const mine = row.requester === me;
    const person = mine ? row.got : row.asked;
    if (!person) continue;
    contacts.push({ person, state: row.status === 'accepted' ? 'contact' : mine ? 'outgoing' : 'incoming' });
  }
  return contacts.sort((a, b) => byName(a.person, b.person));
}

export type AddResult = 'sent' | 'accepted' | 'already' | 'not_found' | 'self' | 'blocked_by_you' | 'too_many';

/** Ask someone to be a contact, by their exact username. */
export async function addContact(username: string): Promise<AddResult> {
  const { data, error } = await db().rpc('add_contact', { username });
  if (error) throw error;
  return data as AddResult;
}

export async function acceptContact(personId: string): Promise<void> {
  const me = await myId();
  const { error } = await db()
    .from('contacts')
    .update({ status: 'accepted' })
    .eq('requester', personId)
    .eq('addressee', me);
  if (error) throw error;
}

/** Remove a contact, turn down a request, or take back one you sent. Shares between the two of you end with it. */
export async function removeContact(personId: string): Promise<void> {
  const me = await myId();
  const { error } = await db()
    .from('contacts')
    .delete()
    .or(`and(requester.eq.${me},addressee.eq.${personId}),and(requester.eq.${personId},addressee.eq.${me})`);
  if (error) throw error;
}

/** Block someone: no messages, no shares, and their requests never reach you. */
export async function blockPerson(personId: string): Promise<void> {
  const me = await myId();
  const { error } = await db()
    .from('blocks')
    .upsert({ blocker: me, blocked: personId }, { onConflict: 'blocker,blocked', ignoreDuplicates: true });
  if (error) throw error;
  await removeContact(personId);
}

export async function listBlocked(): Promise<Person[]> {
  const { data, error } = await db().from('blocks').select('person:members!blocks_blocked_fkey(id, username)');
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{ person: Person | null }>;
  return rows.flatMap((r) => (r.person ? [r.person] : [])).sort(byName);
}

export async function unblock(personId: string): Promise<void> {
  const me = await myId();
  const { error } = await db().from('blocks').delete().eq('blocker', me).eq('blocked', personId);
  if (error) throw error;
}

/* ---------- Chats ---------- */

export interface Chat {
  id: string;
  title: string | null;
  isGroup: boolean;
  /** Everyone in the chat, the signed-in creator included. */
  members: Person[];
  lastAt: number;
  preview: string;
  lastSenderId: string | null;
  /** Someone else wrote since the signed-in creator last looked. */
  unread: boolean;
}

export async function listChats(): Promise<Chat[]> {
  const me = await myId();
  const { data, error } = await db()
    .from('conversations')
    .select(
      'id, title, is_group, last_message_at, last_preview, last_sender_id, conversation_members(user_id, last_read_at, person:members(id, username))',
    )
    .order('last_message_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    title: string | null;
    is_group: boolean;
    last_message_at: string;
    last_preview: string;
    last_sender_id: string | null;
    conversation_members: Array<{ user_id: string; last_read_at: string; person: Person | null }> | null;
  }>;
  return rows.map((row) => {
    const seats = row.conversation_members ?? [];
    const mine = seats.find((s) => s.user_id === me);
    const lastAt = ms(row.last_message_at);
    return {
      id: row.id,
      title: row.title,
      isGroup: row.is_group,
      members: seats.flatMap((s) => (s.person ? [s.person] : [])).sort(byName),
      lastAt,
      preview: row.last_preview,
      lastSenderId: row.last_sender_id,
      unread: row.last_preview !== '' && row.last_sender_id !== me && !!mine && lastAt > ms(mine.last_read_at),
    };
  });
}

/** What to call a chat: its title, or the other people in it. */
export function chatName(chat: Chat, me: string): string {
  if (chat.title) return chat.title;
  const others = chat.members.filter((m) => m.id !== me);
  if (others.length === 0) return chat.isGroup ? 'Empty group' : 'Left the chat';
  return others.map((m) => `@${m.username}`).join(', ');
}

/** The one-to-one chat with a contact. It is made the first time it is asked for. */
export async function openDirect(personId: string): Promise<string> {
  const { data, error } = await db().rpc('open_direct', { member: personId });
  if (error) throw error;
  return data as string;
}

export async function createGroup(title: string, memberIds: string[]): Promise<string> {
  const { data, error } = await db().rpc('create_group', { title, members: memberIds });
  if (error) throw error;
  return data as string;
}

export async function addToGroup(chatId: string, memberIds: string[]): Promise<void> {
  const { error } = await db().rpc('add_to_group', { conversation: chatId, members: memberIds });
  if (error) throw error;
}

export async function renameGroup(chatId: string, title: string): Promise<void> {
  const { error } = await db()
    .from('conversations')
    .update({ title: title.trim() || null })
    .eq('id', chatId);
  if (error) throw error;
}

export async function leaveChat(chatId: string): Promise<void> {
  const me = await myId();
  const { error } = await db().from('conversation_members').delete().eq('conversation_id', chatId).eq('user_id', me);
  if (error) throw error;
}

export async function markRead(chatId: string): Promise<void> {
  const me = await myId();
  // The server stamps the time itself; the value sent here is only a placeholder.
  const { error } = await db()
    .from('conversation_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', chatId)
    .eq('user_id', me);
  if (error) throw error;
}

/* ---------- Messages ---------- */

export interface Message {
  id: string;
  chatId: string;
  senderId: string | null;
  senderName: string;
  body: string;
  /** A narration this message points at, if any. */
  narrationId: string | null;
  at: number;
}

const MESSAGE = 'id, conversation_id, sender_id, sender_name, body, narration_id, created_at';

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  sender_name: string;
  body: string;
  narration_id: string | null;
  created_at: string;
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    chatId: row.conversation_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    body: row.body,
    narrationId: row.narration_id,
    at: ms(row.created_at),
  };
}

/** The latest messages in a chat, oldest first. */
export async function listMessages(chatId: string, limit = 200): Promise<Message[]> {
  const { data, error } = await db()
    .from('messages')
    .select(MESSAGE)
    .eq('conversation_id', chatId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as unknown as MessageRow[]).map(toMessage).reverse();
}

export async function sendMessage(chatId: string, body: string, narrationId?: string): Promise<Message> {
  const me = await myId();
  const { data, error } = await db()
    .from('messages')
    .insert({ conversation_id: chatId, sender_id: me, body: body.trim(), narration_id: narrationId ?? null })
    .select(MESSAGE)
    .single();
  if (error) throw error;
  return toMessage(data as unknown as MessageRow);
}

export async function deleteMessage(id: string): Promise<void> {
  const { error } = await db().from('messages').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Hear about new messages as they arrive, in any chat the signed-in creator is
 * in. Returns a function that stops listening. If the live connection cannot
 * be made, nothing arrives here and the screens fall back to checking now and then.
 */
export function watchMessages(onMessage: (message: Message) => void): () => void {
  if (!supabase) return () => undefined;
  const client = supabase;
  const channel = client
    .channel(`messages-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
      onMessage(toMessage(payload.new as MessageRow));
    })
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

/* ---------- Sharing ---------- */

export interface Share {
  person: Person;
  role: ShareRole;
}

/** Who a narration is shared with. Only its author gets the full list. */
export async function listShares(narrationId: string): Promise<Share[]> {
  const { data, error } = await db()
    .from('narration_shares')
    .select('role, person:members!narration_shares_user_id_fkey(id, username)')
    .eq('narration_id', narrationId);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{ role: ShareRole; person: Person | null }>;
  return rows.flatMap((r) => (r.person ? [{ person: r.person, role: r.role }] : []));
}

/** Let a contact view or edit a narration, change what they may do, or stop sharing with them (null). */
export async function setShare(narrationId: string, personId: string, role: ShareRole | null): Promise<void> {
  const me = await myId();
  const table = () => db().from('narration_shares');
  if (role === null) {
    const { error } = await table().delete().eq('narration_id', narrationId).eq('user_id', personId);
    if (error) throw error;
    return;
  }
  const { data, error } = await table()
    .update({ role })
    .eq('narration_id', narrationId)
    .eq('user_id', personId)
    .select('role');
  if (error) throw error;
  if (data && data.length > 0) return;
  const { error: insertError } = await table().insert({
    narration_id: narrationId,
    user_id: personId,
    owner_id: me,
    role,
  });
  if (insertError) throw insertError;
}

/** How many people each of the signed-in creator's narrations is shared with. */
export async function shareCounts(): Promise<Map<string, number>> {
  const me = await myId();
  const { data, error } = await db().from('narration_shares').select('narration_id').eq('owner_id', me);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ narration_id: string }>) {
    counts.set(row.narration_id, (counts.get(row.narration_id) ?? 0) + 1);
  }
  return counts;
}

/** A narration as lists and chat cards show it, wherever it came from. */
export interface NarrationCard {
  meta: NarrationMeta;
  platform: Platform;
  /** The author's id, which is also the folder its photos and videos live in. */
  ownerId: string;
  /** Null when the signed-in creator is the author. */
  owner: Person | null;
  role: 'owner' | ShareRole;
}

const CARD = 'id, name, created_at, updated_at, username, avatar, posts, is_example, user_id, account:accounts(platform)';

interface CardRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  username: string;
  avatar: MediaItem | null;
  posts: number;
  is_example: boolean;
  user_id: string;
  account: { platform: Platform } | null;
}

function toCard(row: CardRow, owner: Person | null, role: NarrationCard['role']): NarrationCard | null {
  if (!row.account) return null;
  return {
    meta: {
      id: row.id,
      name: row.name,
      createdAt: ms(row.created_at),
      updatedAt: ms(row.updated_at),
      username: row.username,
      avatar: row.avatar,
      posts: row.posts,
      isExample: row.is_example,
    },
    platform: row.account.platform,
    ownerId: row.user_id,
    owner,
    role,
  };
}

/** Narrations other people shared with the signed-in creator, newest change first. */
export async function listSharedWithMe(platform?: Platform): Promise<NarrationCard[]> {
  const me = await myId();
  const { data, error } = await db()
    .from('narration_shares')
    .select(`role, narration:narrations(${CARD}), owner:members!narration_shares_owner_id_fkey(id, username)`)
    .eq('user_id', me);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{ role: ShareRole; narration: CardRow | null; owner: Person | null }>;
  const cards: NarrationCard[] = [];
  for (const row of rows) {
    if (!row.narration) continue;
    const card = toCard(row.narration, row.owner ?? { id: row.narration.user_id, username: '' }, row.role);
    if (card && (!platform || card.platform === platform)) cards.push(card);
  }
  return cards.sort((a, b) => b.meta.updatedAt - a.meta.updatedAt);
}

/** Take a narration someone shared out of your own list. */
export async function leaveShare(narrationId: string): Promise<void> {
  const me = await myId();
  const { error } = await db().from('narration_shares').delete().eq('narration_id', narrationId).eq('user_id', me);
  if (error) throw error;
}

/**
 * Look up the narrations a chat's messages point at. One that is missing from
 * the answer is not open to the signed-in creator, or was deleted.
 */
export async function narrationCards(ids: string[]): Promise<Map<string, NarrationCard>> {
  const cards = new Map<string, NarrationCard>();
  if (ids.length === 0) return cards;
  const me = await myId();
  const [found, shares] = await Promise.all([
    db().from('narrations').select(CARD).in('id', ids),
    db()
      .from('narration_shares')
      .select('narration_id, role, owner:members!narration_shares_owner_id_fkey(id, username)')
      .eq('user_id', me)
      .in('narration_id', ids),
  ]);
  if (found.error) throw found.error;
  if (shares.error) throw shares.error;
  const mine = new Map<string, { role: ShareRole; owner: Person | null }>();
  for (const s of (shares.data ?? []) as unknown as Array<{ narration_id: string; role: ShareRole; owner: Person | null }>) {
    mine.set(s.narration_id, { role: s.role, owner: s.owner });
  }
  for (const row of (found.data ?? []) as unknown as CardRow[]) {
    const share = mine.get(row.id);
    const card =
      row.user_id === me
        ? toCard(row, null, 'owner')
        : share
          ? toCard(row, share.owner ?? { id: row.user_id, username: '' }, share.role)
          : null;
    if (card) cards.set(row.id, card);
  }
  return cards;
}

/** Every narration the signed-in creator authored, for picking one to share. */
export async function listMyNarrations(): Promise<NarrationCard[]> {
  const me = await myId();
  const { data, error } = await db().from('narrations').select(CARD).eq('user_id', me).order('updated_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as CardRow[]).flatMap((row) => {
    const card = toCard(row, null, 'owner');
    return card ? [card] : [];
  });
}
