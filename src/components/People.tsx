import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { PLATFORM, type Platform } from '../platforms';
import type { Person, ShareRole } from '../lib/library';
import { MediaOwner } from '../lib/media';
import {
  acceptContact,
  addContact,
  addToGroup,
  blockPerson,
  chatName,
  createGroup,
  deleteMessage,
  leaveChat,
  listBlocked,
  listChats,
  listContacts,
  listMessages,
  listMyNarrations,
  listShares,
  markRead,
  narrationCards,
  openDirect,
  removeContact,
  renameGroup,
  sendMessage,
  setShare,
  unblock,
  watchMessages,
  type AddResult,
  type Chat,
  type Contact,
  type Message,
  type NarrationCard,
} from '../lib/people';
import { plural } from '../lib/format';
import { ConfirmButton, Icon, Logo, MediaView, Modal, PlatformMark, Segmented, cx } from './ui';

type Tab = 'chats' | 'contacts';

const ADD_TEXT: Record<AddResult, (name: string) => string> = {
  sent: (n) => `Request sent to @${n}. They show up in your contacts once they accept.`,
  accepted: (n) => `@${n} had already asked you, so you are now contacts.`,
  already: (n) => `@${n} is already in your contacts.`,
  not_found: () => 'Nobody has that username. Check the spelling with them.',
  self: () => 'That is your own username.',
  blocked_by_you: (n) => `You blocked @${n}. Unblock them first.`,
  too_many: () => 'You have a lot of requests waiting. Take some back before sending more.',
};

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

const dayKey = (ms: number) => new Date(ms).toDateString();

function dayLabel(ms: number): string {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (dayKey(ms) === today.toDateString()) return 'Today';
  if (dayKey(ms) === yesterday.toDateString()) return 'Yesterday';
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** When a chat last had a message, as the list shows it: a time today, otherwise a short date. */
function when(ms: number): string {
  if (dayKey(ms) === new Date().toDateString()) return clock(ms);
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** A person's mark: their first letter in a ring. Backlot logins have no photo. */
function Face({ name, group = false }: { name: string; group?: boolean }) {
  return (
    <span className={cx('face', group && 'is-group')} aria-hidden="true">
      {group ? <Icon name="people" size={17} /> : (name.replace(/^[^a-z0-9]+/i, '')[0] ?? '?').toUpperCase()}
    </span>
  );
}

/**
 * Contacts and chats: who the creator works with, and the conversations
 * around the narrations they share.
 */
export function People({
  me,
  chatId,
  onHome,
  onChat,
  onOpenNarration,
  onSignOut,
}: {
  me: Person;
  /** The chat that is open, taken from the address. */
  chatId?: string;
  onHome: () => void;
  onChat: (chatId?: string) => void;
  onOpenNarration: (platform: Platform, narrationId: string) => void;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>('chats');
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [blocked, setBlocked] = useState<Person[]>([]);
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [grouping, setGrouping] = useState(false);
  const [arrived, setArrived] = useState<Message | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);

  const say = useCallback((text: string) => setToast({ id: Date.now(), text }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  const refreshContacts = useCallback(async () => {
    try {
      const [list, blocks] = await Promise.all([listContacts(), listBlocked()]);
      setContacts(list);
      setBlocked(blocks);
      setFailed(false);
    } catch {
      setContacts((prev) => prev ?? []);
      setFailed(true);
    }
  }, []);

  const refreshChats = useCallback(async () => {
    try {
      setChats(await listChats());
      setFailed(false);
    } catch {
      setChats((prev) => prev ?? []);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void refreshContacts();
    void refreshChats();
  }, [refreshContacts, refreshChats]);

  // New messages arrive live. The slower check behind it catches anything the
  // live line missed, and picks up requests, which do not come over it.
  useEffect(
    () =>
      watchMessages((message) => {
        setArrived(message);
        void refreshChats();
      }),
    [refreshChats],
  );
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshChats();
      void refreshContacts();
    };
    const t = setInterval(check, 12_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', check);
    };
  }, [refreshChats, refreshContacts]);

  const open = chatId ? chats?.find((c) => c.id === chatId) : undefined;
  const friends = useMemo(() => (contacts ?? []).filter((c) => c.state === 'contact').map((c) => c.person), [contacts]);
  const incoming = (contacts ?? []).filter((c) => c.state === 'incoming');
  const outgoing = (contacts ?? []).filter((c) => c.state === 'outgoing');
  const unread = (chats ?? []).filter((c) => c.unread && c.id !== chatId).length;

  async function message(person: Person) {
    try {
      const id = await openDirect(person.id);
      await refreshChats();
      setTab('chats');
      onChat(id);
    } catch {
      say(`A chat with @${person.username} could not be opened. Try again.`);
    }
  }

  return (
    <div className="app people">
      <header className="bar">
        <a
          className="brand"
          href="#home"
          aria-label="Backlot home"
          onClick={(e) => {
            e.preventDefault();
            onHome();
          }}
        >
          <Logo />
          <b>Backlot</b>
        </a>
        <span className="on-platform">
          <Icon name="people" size={14} />
          People
        </span>
        <div className="bar-tools who-inline">
          <span>@{me.username}</span>
          <button type="button" className="btn quiet sm" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className={cx('people-main', chatId && 'has-open')}>
        <section className="people-list" aria-label="Chats and contacts">
          <Segmented
            block
            label="Show"
            value={tab}
            options={[
              { value: 'chats', label: unread > 0 ? `Chats (${unread})` : 'Chats' },
              { value: 'contacts', label: incoming.length > 0 ? `Contacts (${incoming.length})` : 'Contacts' },
            ]}
            onChange={setTab}
          />

          {failed && (
            <div className="notice warn" role="status">
              <div>
                <strong>Backlot cannot reach the server.</strong> Check your connection. It will keep trying.
              </div>
            </div>
          )}

          {tab === 'chats' ? (
            <>
              <button
                type="button"
                className="btn sm people-new"
                disabled={friends.length === 0}
                onClick={() => setGrouping(true)}
              >
                <Icon name="plus" /> New group
              </button>
              {chats && chats.length === 0 && (
                <p className="people-empty">
                  No chats yet.{' '}
                  {friends.length === 0
                    ? 'Add a contact first, then message them.'
                    : 'Open Contacts and message someone, or start a group.'}
                </p>
              )}
              <ul className="chat-list">
                {(chats ?? []).map((chat) => {
                  const name = chatName(chat, me.id);
                  return (
                    <li key={chat.id}>
                      <button
                        type="button"
                        className={cx('chat-row', chat.id === chatId && 'is-open')}
                        aria-current={chat.id === chatId ? 'true' : undefined}
                        onClick={() => onChat(chat.id)}
                      >
                        <Face name={name} group={chat.isGroup} />
                        <span className="chat-text">
                          <b>{name}</b>
                          <span>
                            {chat.preview
                              ? `${chat.lastSenderId === me.id ? 'You: ' : ''}${chat.preview}`
                              : 'No messages yet'}
                          </span>
                        </span>
                        <span className="chat-side">
                          <time>{when(chat.lastAt)}</time>
                          {chat.unread && chat.id !== chatId && <i className="unread" aria-label="New messages" />}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <ContactsPane
              incoming={incoming}
              outgoing={outgoing}
              friends={friends}
              blocked={blocked}
              loaded={contacts !== null}
              onChanged={refreshContacts}
              onMessage={message}
              say={say}
            />
          )}
        </section>

        <section className="people-thread" aria-label="Chat">
          {open ? (
            <Thread
              key={open.id}
              chat={open}
              me={me}
              friends={friends}
              arrived={arrived}
              onBack={() => onChat()}
              onChanged={refreshChats}
              onLeft={() => {
                onChat();
                void refreshChats();
              }}
              onOpenNarration={onOpenNarration}
              say={say}
            />
          ) : chatId && chats ? (
            <div className="thread-empty">
              <p>That chat is not open to you any more.</p>
              <button type="button" className="btn sm" onClick={() => onChat()}>
                Back to chats
              </button>
            </div>
          ) : (
            <div className="thread-empty">
              <Icon name="chat" size={28} />
              <p>Pick a chat, or message a contact, to talk a narration through.</p>
            </div>
          )}
        </section>
      </main>

      {grouping && (
        <PeoplePicker
          heading="New group"
          action="Create group"
          people={friends}
          withTitle
          onClose={() => setGrouping(false)}
          onSubmit={async (ids, title) => {
            const id = await createGroup(title, ids);
            await refreshChats();
            setGrouping(false);
            onChat(id);
          }}
        />
      )}

      <div className="toast-zone" aria-live="polite">
        {toast && (
          <div key={toast.id} className="toast">
            {toast.text}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Contacts ---------- */

function ContactsPane({
  incoming,
  outgoing,
  friends,
  blocked,
  loaded,
  onChanged,
  onMessage,
  say,
}: {
  incoming: Contact[];
  outgoing: Contact[];
  friends: Person[];
  blocked: Person[];
  loaded: boolean;
  onChanged: () => Promise<void>;
  onMessage: (person: Person) => void;
  say: (text: string) => void;
}) {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [more, setMore] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    const name = username.trim().toLowerCase().replace(/^@/, '');
    if (!name) return;
    setBusy(true);
    try {
      const result = await addContact(name);
      setNote(ADD_TEXT[result](name));
      if (result === 'sent' || result === 'accepted') setUsername('');
      await onChanged();
    } catch {
      setNote('That did not go through. Check your connection and try again.');
    }
    setBusy(false);
  }

  /** Run one change, then reload the lists. */
  async function change(work: () => Promise<void>, failure: string) {
    try {
      await work();
    } catch {
      say(failure);
    }
    setMore(null);
    await onChanged();
  }

  return (
    <div className="contacts">
      <form className="add-person" onSubmit={add}>
        <label className="field">
          <span className="field-label">Add someone by their exact username</span>
          <span className="add-row">
            <input
              id="add-username"
              value={username}
              maxLength={25}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="@username"
              onChange={(e) => setUsername(e.target.value)}
            />
            <button type="submit" className="btn primary" disabled={busy || !username.trim()}>
              Add
            </button>
          </span>
        </label>
        {note && (
          <p className="add-note" role="status">
            {note}
          </p>
        )}
      </form>

      {incoming.length > 0 && (
        <section className="people-group">
          <h2>Requests</h2>
          <ul>
            {incoming.map(({ person }) => (
              <li key={person.id} className="person">
                <Face name={person.username} />
                <b>@{person.username}</b>
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={() => void change(() => acceptContact(person.id), 'That request could not be accepted. Try again.')}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="btn quiet sm"
                  onClick={() => void change(() => removeContact(person.id), 'That request could not be turned down. Try again.')}
                >
                  Decline
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="people-group">
        <h2>Contacts</h2>
        {loaded && friends.length === 0 && (
          <p className="people-empty">
            Nobody yet. Add someone above. Once they accept, you can message them and share narrations with them.
          </p>
        )}
        <ul>
          {friends.map((person) => (
            <li key={person.id} className="person">
              <Face name={person.username} />
              <b>@{person.username}</b>
              <button type="button" className="btn sm" onClick={() => onMessage(person)}>
                <Icon name="chat" /> Message
              </button>
              <button
                type="button"
                className="btn quiet sm"
                aria-label={`More for ${person.username}`}
                aria-expanded={more === person.id}
                onClick={() => setMore(more === person.id ? null : person.id)}
              >
                <Icon name="more" size={18} />
              </button>
              {more === person.id && (
                <div className="person-more">
                  <span>Removing or blocking also ends every narration shared between you.</span>
                  <ConfirmButton
                    className="quiet sm danger"
                    label="Remove"
                    confirmLabel="Remove contact?"
                    onConfirm={() => void change(() => removeContact(person.id), 'That contact could not be removed. Try again.')}
                  />
                  <ConfirmButton
                    className="quiet sm danger"
                    label="Block"
                    confirmLabel="Block them?"
                    onConfirm={() => void change(() => blockPerson(person.id), 'That did not fully go through. Try Block again.')}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {outgoing.length > 0 && (
        <section className="people-group">
          <h2>Waiting for an answer</h2>
          <ul>
            {outgoing.map(({ person }) => (
              <li key={person.id} className="person">
                <Face name={person.username} />
                <b>@{person.username}</b>
                <button
                  type="button"
                  className="btn quiet sm"
                  onClick={() => void change(() => removeContact(person.id), 'That request could not be taken back. Try again.')}
                >
                  Take back
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {blocked.length > 0 && (
        <section className="people-group">
          <h2>Blocked</h2>
          <ul>
            {blocked.map((person) => (
              <li key={person.id} className="person">
                <Face name={person.username} />
                <b>@{person.username}</b>
                <button
                  type="button"
                  className="btn quiet sm"
                  onClick={() => void change(() => unblock(person.id), 'That block could not be lifted. Try again.')}
                >
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ---------- One chat ---------- */

function Thread({
  chat,
  me,
  friends,
  arrived,
  onBack,
  onChanged,
  onLeft,
  onOpenNarration,
  say,
}: {
  chat: Chat;
  me: Person;
  friends: Person[];
  /** The newest message heard over the live line, in any chat. */
  arrived: Message | null;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onLeft: () => void;
  onOpenNarration: (platform: Platform, narrationId: string) => void;
  say: (text: string) => void;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [cards, setCards] = useState<Map<string, NarrationCard> | null>(null);
  const [cardsAsked, setCardsAsked] = useState(0);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState('');
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<'share' | 'add' | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(chat.title ?? '');
  const end = useRef<HTMLDivElement>(null);

  const name = chatName(chat, me.id);
  const others = chat.members.filter((m) => m.id !== me.id);
  // One to one, messages only go through while the two are still contacts.
  const canPost = chat.isGroup || others.some((o) => friends.some((f) => f.id === o.id));

  const add = (list: Message[] | null, one: Message) =>
    list && !list.some((m) => m.id === one.id) ? [...list, one] : list;

  const seen = useCallback(() => {
    void markRead(chat.id).then(onChanged, () => undefined);
  }, [chat.id, onChanged]);

  const load = useCallback(async () => {
    try {
      setMessages(await listMessages(chat.id));
      setProblem('');
      seen();
    } catch {
      setMessages((prev) => prev ?? []);
      setProblem('These messages could not be loaded. Check your connection.');
    }
  }, [chat.id, seen]);

  useEffect(() => {
    void load();
  }, [load]);

  // A message heard live goes straight onto the screen.
  useEffect(() => {
    if (!arrived || arrived.chatId !== chat.id) return;
    setMessages((prev) => add(prev, arrived));
    if (arrived.senderId !== me.id) seen();
  }, [arrived, chat.id, me.id, seen]);

  // If the list of chats knows of something newer than what is on screen, the live line missed it.
  const newest = messages && messages.length > 0 ? messages[messages.length - 1].at : 0;
  useEffect(() => {
    if (messages && chat.preview !== '' && chat.lastAt > newest) void load();
    // Only the chat's own clock should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.lastAt]);

  const pointed = useMemo(
    () => Array.from(new Set((messages ?? []).flatMap((m) => (m.narrationId ? [m.narrationId] : [])))).sort().join(','),
    [messages],
  );
  useEffect(() => {
    if (!pointed) return;
    let alive = true;
    void narrationCards(pointed.split(',')).then(
      (found) => {
        if (alive) setCards(found);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [pointed, cardsAsked]);

  const count = messages?.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [count, cards]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const sent = await sendMessage(chat.id, body);
      setMessages((prev) => add(prev, sent));
      setDraft('');
      setProblem('');
      void onChanged();
    } catch {
      setProblem('That message could not be sent. Try again.');
    }
    setSending(false);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  async function takeBack(id: string) {
    try {
      await deleteMessage(id);
      setMessages((prev) => prev?.filter((m) => m.id !== id) ?? prev);
      void onChanged();
    } catch {
      say('That message could not be taken back. Try again.');
    }
  }

  async function rename(e: FormEvent) {
    e.preventDefault();
    try {
      await renameGroup(chat.id, title);
      await onChanged();
    } catch {
      say('The group could not be renamed. Try again.');
    }
    setRenaming(false);
    setMenu(false);
  }

  async function leave() {
    try {
      await leaveChat(chat.id);
      onLeft();
    } catch {
      say('You could not leave that chat. Try again.');
    }
  }

  return (
    <>
      <header className="thread-head">
        <button type="button" className="thread-back" aria-label="Back to chats" onClick={onBack}>
          <Icon name="left" size={22} />
        </button>
        <Face name={name} group={chat.isGroup} />
        <div className="thread-who">
          <b>{name}</b>
          {chat.isGroup && (
            <span>
              {chat.members.length} {plural(chat.members.length, 'person', 'people')}
              {chat.title ? `: ${chat.members.map((m) => `@${m.username}`).join(', ')}` : ''}
            </span>
          )}
        </div>
        <button
          type="button"
          className="btn quiet sm"
          aria-label="Chat options"
          aria-expanded={menu}
          onClick={() => {
            setMenu(!menu);
            setRenaming(false);
          }}
        >
          <Icon name="more" size={18} />
        </button>
      </header>

      {menu && (
        <div className="thread-menu">
          {renaming ? (
            <form className="narr-rename" onSubmit={rename}>
              <input
                id="group-name"
                aria-label="Group name"
                value={title}
                maxLength={60}
                autoFocus
                onChange={(e) => setTitle(e.target.value)}
              />
              <button type="submit" className="btn sm primary">
                Save
              </button>
              <button type="button" className="btn quiet sm" onClick={() => setRenaming(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <>
              {chat.isGroup && (
                <>
                  <button type="button" className="btn quiet sm" onClick={() => setDialog('add')}>
                    <Icon name="plus" /> Add people
                  </button>
                  <button
                    type="button"
                    className="btn quiet sm"
                    onClick={() => {
                      setTitle(chat.title ?? '');
                      setRenaming(true);
                    }}
                  >
                    <Icon name="pencil" /> Rename
                  </button>
                </>
              )}
              <ConfirmButton
                className="quiet sm danger"
                label={chat.isGroup ? 'Leave group' : 'Leave chat'}
                confirmLabel="Leave and lose the messages?"
                onConfirm={() => void leave()}
              />
            </>
          )}
        </div>
      )}

      <div className="thread-body">
        {messages && messages.length === 0 && !problem && (
          <p className="thread-start">Nothing here yet. Say hello, or share a narration to talk it through.</p>
        )}
        <ol className="msgs">
          {(messages ?? []).map((m, i) => {
            const mine = m.senderId === me.id;
            const prev = i > 0 ? messages![i - 1] : undefined;
            const newDay = !prev || dayKey(prev.at) !== dayKey(m.at);
            const named = chat.isGroup && !mine && (newDay || prev?.senderId !== m.senderId);
            return (
              <Fragment key={m.id}>
                {newDay && <li className="msg-day">{dayLabel(m.at)}</li>}
                <li className={cx('msg', mine && 'is-mine')}>
                  {named && <span className="msg-who">@{m.senderName || 'someone who left'}</span>}
                  {m.narrationId && (
                    <NarrationChip card={cards?.get(m.narrationId)} waiting={cards === null} onOpen={onOpenNarration} />
                  )}
                  {m.body && <p className="msg-body">{m.body}</p>}
                  <span className="msg-meta">
                    <time>{clock(m.at)}</time>
                    {mine && (
                      <ConfirmButton
                        className="quiet sm msg-undo"
                        label="Take back"
                        confirmLabel="Take back?"
                        onConfirm={() => void takeBack(m.id)}
                      />
                    )}
                  </span>
                </li>
              </Fragment>
            );
          })}
        </ol>
        <div ref={end} />
      </div>

      {problem && (
        <p className="form-error thread-problem" role="alert">
          {problem}
        </p>
      )}

      {canPost ? (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <button
            type="button"
            className="btn composer-share"
            aria-label="Share a narration in this chat"
            title="Share a narration"
            onClick={() => setDialog('share')}
          >
            <Icon name="layers" size={18} />
          </button>
          <textarea
            id="message"
            aria-label="Message"
            rows={1}
            maxLength={4000}
            placeholder="Message"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
          />
          <button type="submit" className="btn primary composer-send" aria-label="Send" disabled={sending || !draft.trim()}>
            <Icon name="send" size={18} />
          </button>
        </form>
      ) : (
        <p className="composer-closed">
          You can only message your contacts. Add {others[0] ? `@${others[0].username}` : 'them'} again to keep talking.
        </p>
      )}

      {dialog === 'share' && (
        <NarrationPicker
          chat={chat}
          me={me}
          friends={friends}
          onClose={() => setDialog(null)}
          onShared={(sent, notes) => {
            setMessages((prev) => add(prev, sent));
            setCardsAsked((n) => n + 1);
            setDialog(null);
            void onChanged();
            if (notes) say(notes);
          }}
        />
      )}
      {dialog === 'add' && (
        <PeoplePicker
          heading="Add people"
          action="Add to group"
          people={friends.filter((f) => !chat.members.some((m) => m.id === f.id))}
          onClose={() => setDialog(null)}
          onSubmit={async (ids) => {
            await addToGroup(chat.id, ids);
            await onChanged();
            setDialog(null);
            setMenu(false);
          }}
        />
      )}
    </>
  );
}

/** A narration inside a message. Tapping it opens the narration, if it is open to you. */
function NarrationChip({
  card,
  waiting,
  onOpen,
}: {
  card: NarrationCard | undefined;
  waiting: boolean;
  onOpen: (platform: Platform, narrationId: string) => void;
}) {
  if (!card) {
    return (
      <div className="ncard is-closed">
        <Icon name="lock" />
        <span>{waiting ? 'Loading the narration' : 'A narration that is not shared with you, or was deleted.'}</span>
      </div>
    );
  }
  const can = card.role === 'owner' ? 'Your narration' : card.role === 'edit' ? 'You can edit' : 'You can view';
  return (
    <MediaOwner.Provider value={card.role === 'owner' ? null : card.ownerId}>
      <button type="button" className="ncard" onClick={() => onOpen(card.platform, card.meta.id)}>
        <span className="ncard-avatar">
          <MediaView item={card.meta.avatar ?? undefined} />
        </span>
        <span className="ncard-text">
          <b>@{card.meta.username || 'username'}</b>
          <span>
            {card.meta.name}, {card.meta.posts} {plural(card.meta.posts, 'post')}
          </span>
          <span className="ncard-role">
            <PlatformMark platform={card.platform} size={12} /> {PLATFORM[card.platform].name}. {can}.
          </span>
        </span>
        <Icon name="right" />
      </button>
    </MediaOwner.Provider>
  );
}

/* ---------- Dialogs ---------- */

/** Tick contacts for a new group, or to add to one. */
function PeoplePicker({
  heading,
  action,
  people,
  withTitle = false,
  onClose,
  onSubmit,
}: {
  heading: string;
  action: string;
  people: Person[];
  withTitle?: boolean;
  onClose: () => void;
  onSubmit: (ids: string[], title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (picked.size === 0) return setError('Tick at least one person.');
    setBusy(true);
    try {
      await onSubmit(Array.from(picked), title.trim());
    } catch {
      setBusy(false);
      setError('That did not go through. Try again.');
    }
  }

  return (
    <Modal label={heading} className="sheet" onClose={onClose}>
      <form className="sheet-form" onSubmit={submit}>
        <header className="sheet-head">
          <button type="button" className="sheet-x" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
          <strong>{heading}</strong>
          <span />
        </header>
        <div className="sheet-body">
          {withTitle && (
            <label className="field">
              <span className="field-label">Group name</span>
              <input
                id="new-group-name"
                value={title}
                maxLength={60}
                placeholder="For example: Brand team"
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
          )}
          {people.length === 0 ? (
            <p className="people-empty">Everyone in your contacts is already here.</p>
          ) : (
            <ul className="pick-list">
              {people.map((p) => (
                <li key={p.id}>
                  <label className="pick">
                    <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                    <Face name={p.username} />
                    <b>@{p.username}</b>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="sheet-foot">
          <button type="button" className="btn quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || people.length === 0}>
            {action}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

/** Pick one of your narrations to put in a chat, and say what the people there may do with it. */
function NarrationPicker({
  chat,
  me,
  friends,
  onClose,
  onShared,
}: {
  chat: Chat;
  me: Person;
  friends: Person[];
  onClose: () => void;
  onShared: (sent: Message, note: string) => void;
}) {
  const [mine, setMine] = useState<NarrationCard[] | null>(null);
  const [picked, setPicked] = useState('');
  const [role, setRole] = useState<ShareRole>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void listMyNarrations().then(setMine, () => {
      setMine([]);
      setError('Your narrations could not be loaded. Check your connection.');
    });
  }, []);

  const others = chat.members.filter((m) => m.id !== me.id);
  const reachable = others.filter((o) => friends.some((f) => f.id === o.id));
  const left = others.filter((o) => !reachable.includes(o));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!picked) return setError('Pick a narration.');
    setBusy(true);
    try {
      // Never lower what someone already has. A person who may edit keeps that.
      const existing = new Map((await listShares(picked)).map((s) => [s.person.id, s.role]));
      for (const person of reachable) {
        if (existing.get(person.id) === 'edit' || existing.get(person.id) === role) continue;
        await setShare(picked, person.id, role);
      }
      const sent = await sendMessage(chat.id, '', picked);
      onShared(
        sent,
        left.length > 0
          ? `${left.map((p) => `@${p.username}`).join(', ')} cannot open it yet. You can only share with your own contacts.`
          : '',
      );
    } catch {
      setBusy(false);
      setError('That did not go through. Try again.');
    }
  }

  return (
    <Modal label="Share a narration" className="sheet" onClose={onClose}>
      <form className="sheet-form" onSubmit={submit}>
        <header className="sheet-head">
          <button type="button" className="sheet-x" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
          <strong>Share a narration</strong>
          <span />
        </header>
        <div className="sheet-body">
          {mine && mine.length === 0 && !error && (
            <p className="people-empty">You have no narrations yet. Make an account first, then share it here.</p>
          )}
          <ul className="pick-list">
            {(mine ?? []).map((card) => (
              <li key={card.meta.id}>
                <label className="pick">
                  <input
                    type="radio"
                    name="narration"
                    checked={picked === card.meta.id}
                    onChange={() => setPicked(card.meta.id)}
                  />
                  <span className="ncard-avatar">
                    <MediaView item={card.meta.avatar ?? undefined} />
                  </span>
                  <span className="pick-text">
                    <b>@{card.meta.username || 'username'}</b>
                    <span>
                      {card.meta.name}, {PLATFORM[card.platform].name}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <div className="field">
            <span className="field-label">
              {reachable.length === 0
                ? 'Nobody in this chat is in your contacts'
                : `${reachable.map((p) => `@${p.username}`).join(', ')} can`}
            </span>
            <Segmented
              block
              label="What they can do"
              value={role}
              options={[
                { value: 'view', label: 'View it' },
                { value: 'edit', label: 'Edit it' },
              ]}
              onChange={setRole}
            />
            <span className="field-hint">
              They see the whole narration, drafts included. Only you can rename it, delete it, set its save point or
              share it. You can change this later from the narration's Share button.
            </span>
          </div>
          {left.length > 0 && (
            <p className="people-empty">
              {left.map((p) => `@${p.username}`).join(', ')} {left.length === 1 ? 'is' : 'are'} not in your contacts, so
              the narration will stay closed to them.
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="sheet-foot">
          <button type="button" className="btn quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !picked}>
            Share in chat
          </button>
        </footer>
      </form>
    </Modal>
  );
}
