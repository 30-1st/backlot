import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { bil, type DeskMessage } from '../lib/team';
import type { ScreenProps } from './Shell';

// The HQ chat (approved Nov 5, 2026): the executive's and each team member's own chat with
// Rein, Bil, Kris and Xev. The executive's covers every client and the whole team; a team
// member's covers only the clients the executive granted them. The server reads the role
// and grants on every turn; this screen only shows what it is sent, as plain text. Tag a
// client's @handle to bring their full picture into the answer, or @Rein, @Bil, @Kris or
// @Xev to ask one agent directly.

const PAGE = 60;
const CHIME_GAP_MS = 900;
const AGENT: Record<string, string> = { rein: 'Rein', bil: 'Bil', kris: 'Kris', xev: 'Xev' };

export function HqScreen({ me, ws }: ScreenProps) {
  const owner = me.role === 'owner';
  const [msgs, setMsgs] = useState<DeskMessage[] | null>(null);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const clients = ws.data?.clients ?? [];

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error: e } = await supabase.from('desk_messages').select('id, role, body, turn, created_at').order('id', { ascending: false }).limit(PAGE);
    if (e) return setError(e.message);
    setMsgs(((data ?? []) as DeskMessage[]).map((r) => ({ ...r, id: Number(r.id) })).reverse());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const b = box.current;
    if (b) b.scrollTop = b.scrollHeight;
  }, [msgs?.length, typing]);

  const merge = (add: DeskMessage[]) =>
    setMsgs((prev) => {
      const seen = new Set((prev ?? []).map((x) => x.id));
      return [...(prev ?? []), ...add.filter((x) => !seen.has(x.id))].sort((a, b) => a.id - b.id);
    });

  async function chime(turn: number) {
    setTyping(true);
    try {
      const r = await bil.deskChime(turn);
      for (const m of r.messages) {
        await new Promise((ok) => window.setTimeout(ok, CHIME_GAP_MS));
        merge([m]);
      }
    } catch {
      // A missed chime-in is fine; the answer is already there.
    } finally {
      setTyping(false);
    }
  }

  async function send() {
    const t = text.trim();
    if (!t || typing) return;
    setTyping(true);
    setError('');
    setText('');
    try {
      const r = await bil.deskSend(t);
      merge(r.messages);
      if (r.chime) void chime(r.turn);
      else setTyping(false);
    } catch (e) {
      setText(t);
      setTyping(false);
      setError(e instanceof Error ? e.message : 'The team could not answer just now.');
    }
  }

  const covers = owner ? `Every client and your whole team` : clients.length ? clients.map((c) => `@${c.handle}`).join(', ') : 'No clients granted yet';

  return (
    <main className="bl-flow bl-kris bl-gc bl-fit">
      <header className="bl-gc-head">
        <span className="bl-gc-faces" aria-hidden="true">
          {Object.keys(AGENT).map((a) => (
            <span key={a} className={`bl-gc-av ${a}`}>
              {AGENT[a][0]}
            </span>
          ))}
        </span>
        <div className="bl-gc-title">
          <h1 className="bl-h1 bl-rise">{owner ? 'HQ' : 'Your clients'}</h1>
          <span className="bl-small">{covers}</span>
        </div>
      </header>

      {msgs === null && !error && (
        <p className="bl-small" aria-busy="true">
          Loading the chat.
        </p>
      )}

      <div className="bl-kris-box" ref={box}>
        <ol className="bl-gc-log" aria-label={owner ? 'HQ chat' : 'Your clients chat'} aria-live="polite">
          {msgs?.length === 0 && (
            <li className="bl-gc-row">
              <span className="bl-gc-av bil" aria-hidden="true">
                B
              </span>
              <div className="bl-gc-msg">
                <span className="bl-gc-who">Bil</span>
                <p className="bl-gc-bub">
                  {owner
                    ? 'This is HQ. We see every client and the whole team from here. Ask who needs you first, who is behind, or tag a client like @handle to go deep.'
                    : 'This is your desk. We see the clients you manage. Ask who needs you first, or tag a client like @handle to go deep.'}
                </p>
              </div>
            </li>
          )}
          {msgs?.map((m) =>
            m.role === 'me' ? (
              <li key={m.id} className="bl-gc-me">
                <p className="bl-gc-mebub">{m.body}</p>
              </li>
            ) : (
              <li key={m.id} className="bl-gc-row">
                <span className={`bl-gc-av ${m.role}`} aria-hidden="true">
                  {(AGENT[m.role] ?? '?')[0]}
                </span>
                <div className="bl-gc-msg">
                  <span className="bl-gc-who">
                    {AGENT[m.role] ?? m.role}
                    <span className="num"> {new Date(m.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                  </span>
                  <p className="bl-gc-bub">{m.body}</p>
                </div>
              </li>
            ),
          )}
          {typing && (
            <li className="bl-gc-row" aria-busy="true">
              <span className="bl-gc-faces small" aria-hidden="true">
                <span className="bl-gc-av rein">R</span>
                <span className="bl-gc-av bil">B</span>
              </span>
              <p className="bl-gc-bub bl-gc-dots">
                <span className="bl-sr">The team is typing</span>
                <i aria-hidden="true" />
                <i aria-hidden="true" />
                <i aria-hidden="true" />
              </p>
            </li>
          )}
        </ol>
      </div>

      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}

      <form
        className="bl-gc-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="bl-sr" htmlFor="hq-text">
          Message the team
        </label>
        <textarea
          id="hq-text"
          className="bl-input"
          rows={1}
          maxLength={1000}
          value={text}
          placeholder={owner ? 'Ask HQ anything' : 'Ask about your clients'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className="bl-gc-round send" aria-label="Send" disabled={typing || !text.trim()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>
    </main>
  );
}
