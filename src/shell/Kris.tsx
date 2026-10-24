import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { bil, type KrisMessage } from '../lib/team';
import type { Post } from './data';
import type { ScreenProps } from './Shell';

// Kris, the client's publicist (K0). One chat per client, shared by the client and the
// team. She brings updates, pitches and drafts; the Approve and Change buttons on a draft
// call the same review action as the Schedule, so every yes lands in the approvals log.
// Her words are shown as plain text, never as HTML.

const PAGE = 60;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourName = (h: number) => new Date(2026, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });

type Prefs = { plain: boolean; quietFrom: number; quietTo: number };

export function KrisScreen({ ws, single, isTeam, go }: ScreenProps) {
  const client = ws.data?.clients.find((c) => c.id === single) ?? null;
  const [msgs, setMsgs] = useState<KrisMessage[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [prefs, setPrefs] = useState<Prefs>({ plain: false, quietFrom: 21, quietTo: 9 });
  const [showPrefs, setShowPrefs] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  async function load() {
    if (!supabase || !client) return;
    const [m, p] = await Promise.all([
      supabase.from('kris_messages').select('id, role, kind, body, cards, link, created_at').eq('client_id', client.id).order('id', { ascending: false }).limit(PAGE),
      supabase.from('kris_prefs').select('plain, quiet_from, quiet_to').eq('client_id', client.id).maybeSingle(),
    ]);
    if (m.error) return setError(m.error.message);
    setMsgs(
      (m.data ?? [])
        .map((r) => ({ id: Number(r.id), role: r.role, kind: r.kind, body: String(r.body), cards: Array.isArray(r.cards) ? r.cards : null, link: r.link ?? null, createdAt: String(r.created_at) }) as KrisMessage)
        .reverse(),
    );
    if (p.data) setPrefs({ plain: Boolean(p.data.plain), quietFrom: Number(p.data.quiet_from), quietTo: Number(p.data.quiet_to) });
  }

  useEffect(() => {
    setMsgs(null);
    setError('');
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [msgs?.length]);

  if (!client) {
    return (
      <main className="bl-flow">
        <h1 className="bl-h1 bl-rise">Kris</h1>
        <p className="bl-p bl-muted">Pick a client first.</p>
      </main>
    );
  }

  async function send() {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setError('');
    try {
      const r = await bil.kris(client!.id, t);
      setText('');
      setMsgs((prev) => [...(prev ?? []), ...r.messages.filter((x) => !(prev ?? []).some((p) => p.id === x.id))]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kris could not answer just now.');
    } finally {
      setSending(false);
    }
  }

  async function savePrefs(next: Prefs) {
    setPrefs(next);
    if (!supabase) return;
    const { error: e } = await supabase.rpc('kris_set_prefs', { p_client: client!.id, p_plain: next.plain, p_quiet_from: next.quietFrom, p_quiet_to: next.quietTo });
    if (e) setError(e.message);
  }

  const you = isTeam ? 'team' : 'client';
  const label = (m: KrisMessage) => (m.role === 'kris' ? 'Kris' : m.role === you ? 'You' : m.role === 'client' ? `@${client.handle}` : 'Your team');

  return (
    <main className="bl-flow bl-kris">
      <div className="bl-kris-head">
        <div>
          <h1 className="bl-h1 bl-rise">Kris</h1>
          <p className="bl-small" style={{ margin: '6px 0 0' }}>
            <span className="bl-chip">AI</span> {isTeam ? `@${client.handle}'s publicist. The client sees this chat too.` : 'Your publicist. Your team sees this chat too.'}
          </p>
        </div>
        <button type="button" className="bl-ghost" aria-expanded={showPrefs} onClick={() => setShowPrefs((s) => !s)}>
          Settings
        </button>
      </div>

      {showPrefs && (
        <section className="bl-glass-card bl-brand-group" aria-label="Kris settings">
          <label className="bl-brand-check">
            <input type="checkbox" checked={prefs.plain} onChange={(e) => void savePrefs({ ...prefs, plain: e.target.checked })} />
            <span>Plain notices only. Kris still tells you what happened, but stops pitching ideas.</span>
          </label>
          <div className="bl-brand-row">
            <label className="bl-field">
              <span className="bl-label">Quiet from</span>
              <select className="bl-input" value={prefs.quietFrom} onChange={(e) => void savePrefs({ ...prefs, quietFrom: Number(e.target.value) })}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hourName(h)}
                  </option>
                ))}
              </select>
            </label>
            <label className="bl-field">
              <span className="bl-label">Until</span>
              <select className="bl-input" value={prefs.quietTo} onChange={(e) => void savePrefs({ ...prefs, quietTo: Number(e.target.value) })}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hourName(h)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <span className="bl-small">No pitches in quiet hours, in the client&rsquo;s time zone, and never more than one a day. Chats are kept for 30 days.</span>
        </section>
      )}

      {msgs === null && !error && (
        <p className="bl-small" aria-busy="true">
          Loading the chat.
        </p>
      )}

      <ol className="bl-kris-log" aria-label="Chat with Kris" aria-live="polite">
        {msgs?.length === 0 && (
          <li className="bl-kris-msg kris">
            <span className="bl-label">Kris</span>
            <p className="bl-kris-body">
              Hi, I&rsquo;m Kris, {isTeam ? `@${client.handle}'s` : 'your'} publicist. I&rsquo;ll bring you updates, ideas worth trying, and posts waiting for a yes. Ask me how things are going, or say &ldquo;show me what&rsquo;s waiting&rdquo;.
            </p>
          </li>
        )}
        {msgs?.map((m) => (
          <li key={m.id} className={`bl-kris-msg ${m.role === 'kris' ? 'kris' : 'me'}`}>
            <span className="bl-label">
              {label(m)}
              {m.kind === 'note' ? ' · update' : ''}
              <span className="num"> {new Date(m.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            </span>
            <p className="bl-kris-body">{m.body}</p>
            {m.link && (
              <button type="button" className="bl-linkish" style={{ alignSelf: 'flex-start' }} onClick={() => go(m.link!)}>
                Open it
              </button>
            )}
            {m.cards?.map((c) => (
              <DraftCard key={`${c.campaignId}.${c.slot}`} ws={ws} campaignId={c.campaignId} slot={c.slot} />
            ))}
          </li>
        ))}
        {sending && (
          <li className="bl-kris-msg kris" aria-busy="true">
            <span className="bl-label">Kris</span>
            <p className="bl-kris-body bl-muted">Thinking</p>
          </li>
        )}
      </ol>
      <div ref={end} />

      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}

      <form
        className="bl-kris-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="bl-sr" htmlFor="kris-text">
          Message Kris
        </label>
        <textarea
          id="kris-text"
          className="bl-input"
          rows={2}
          maxLength={1000}
          value={text}
          placeholder="Ask Kris anything about your posts"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className="bl-btn" disabled={sending || !text.trim()}>
          Send
        </button>
      </form>
    </main>
  );
}

/** A draft Kris showed, with the same Approve and Change actions as the Schedule. */
function DraftCard({ ws, campaignId, slot }: { ws: ScreenProps['ws']; campaignId: string; slot: number }) {
  const post: Post | undefined = ws.data?.posts.find((p) => p.campaignId === campaignId && p.slot === slot);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!post) return <div className="bl-kris-card bl-small">That draft is no longer here.</div>;

  async function decide(decision: 'approved' | 'changes') {
    setBusy(true);
    setError('');
    try {
      await bil.review(campaignId, slot, decision, decision === 'changes' ? note.trim() : undefined);
      ws.patchPost(campaignId, slot, { review: decision, reviewNote: decision === 'changes' ? note.trim() : null });
      setAsking(false);
      setNote('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  const done = post.review === 'approved' || post.review === 'posted';
  return (
    <article className="bl-kris-card">
      <span className="bl-label">Post {slot}</span>
      <p className="bl-post-text" style={{ margin: 0 }}>
        {String(post.post.draft ?? '')}
      </p>
      {done ? (
        <span className="bl-chip">{post.review === 'posted' ? 'Posted' : 'Approved'}</span>
      ) : asking ? (
        <div className="bl-brand-group">
          <label className="bl-sr" htmlFor={`chg-${campaignId}-${slot}`}>
            What should change
          </label>
          <textarea id={`chg-${campaignId}-${slot}`} className="bl-input" rows={2} maxLength={500} value={note} placeholder="What should change" onChange={(e) => setNote(e.target.value)} />
          <div className="bl-row-actions">
            <button type="button" className="bl-ghost" disabled={busy} onClick={() => setAsking(false)}>
              Cancel
            </button>
            <button type="button" className="bl-btn" disabled={busy || !note.trim()} onClick={() => void decide('changes')}>
              Ask for changes
            </button>
          </div>
        </div>
      ) : (
        <div className="bl-row-actions">
          {post.review === 'changes' && <span className="bl-small">Changes asked</span>}
          <button type="button" className="bl-ghost" disabled={busy} onClick={() => setAsking(true)}>
            Change
          </button>
          <button type="button" className="bl-btn" disabled={busy} onClick={() => void decide('approved')}>
            Approve
          </button>
        </div>
      )}
      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
