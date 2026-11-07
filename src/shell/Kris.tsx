import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { bil, type KrisMessage } from '../lib/team';
import { coverBoxes, exportShot, loadShot, type Box } from '../lib/blur';
import type { Post } from './data';
import type { ScreenProps } from './Shell';
import { BlurEditor, STAGES, type Shot } from './Xev';
import { Working } from './Working';

// The team chat (approved Nov 3, 2026): one group chat per client, shared by the client,
// their human team and all four agents. It grew out of Kris's chat and keeps its table, so
// Kris's notes, pitches and draft cards land here too. A message gets one answer from the
// agent best placed to give it; then up to two teammates may chime in, or nobody does.
// Screenshots go to Xev from the paperclip, blurred on this phone and never saved. Every
// agent's words are shown as plain text, never as HTML.

const PAGE = 60;
const REFRESH_MS = 30_000;
const CHIME_GAP_MS = 450;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourName = (h: number) => new Date(2026, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });
const AGENT: Record<string, string> = { rein: 'Rein', bil: 'Bil', kris: 'Kris', xev: 'Xev' };
const isAgent = (r: string) => r in AGENT;

type Prefs = { plain: boolean; quietFrom: number; quietTo: number };
type Move = { reply: string; why: string; earns?: string };

const shape = (r: any): KrisMessage => ({
  id: Number(r.id),
  role: r.role,
  kind: r.kind,
  body: String(r.body),
  cards: Array.isArray(r.cards) ? r.cards : null,
  link: r.link ?? null,
  turn: r.turn == null ? null : Number(r.turn),
  data: r.data && typeof r.data === 'object' ? r.data : null,
  createdAt: String(r.created_at),
});

export function KrisScreen({ ws, single, isTeam, go }: ScreenProps) {
  const client = ws.data?.clients.find((c) => c.id === single) ?? null;
  const [msgs, setMsgs] = useState<KrisMessage[] | null>(null);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState('');
  const [prefs, setPrefs] = useState<Prefs>({ plain: false, quietFrom: 21, quietTo: 9 });
  const [showPrefs, setShowPrefs] = useState(false);
  const [xevOpen, setXevOpen] = useState(false);
  const [winOpen, setWinOpen] = useState(false);
  const [dmLead, setDmLead] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!supabase || !client) return;
    const [m, p] = await Promise.all([
      supabase.from('kris_messages').select('id, role, kind, body, cards, link, turn, data, created_at').eq('client_id', client.id).order('id', { ascending: false }).limit(PAGE),
      supabase.from('kris_prefs').select('plain, quiet_from, quiet_to').eq('client_id', client.id).maybeSingle(),
    ]);
    if (m.error) return setError(m.error.message);
    const fresh = (m.data ?? []).map(shape).reverse();
    setMsgs((prev) => {
      if (!prev) return fresh;
      const seen = new Set(prev.map((x) => x.id));
      const add = fresh.filter((x) => !seen.has(x.id));
      // Saved messages in order; one still sending stays at the bottom.
      return add.length ? [...[...prev, ...add].filter((x) => x.id >= 0).sort((a, b) => a.id - b.id), ...prev.filter((x) => x.id < 0)] : prev;
    });
    if (p.data) setPrefs({ plain: Boolean(p.data.plain), quietFrom: Number(p.data.quiet_from), quietTo: Number(p.data.quiet_to) });
  }, [client]);

  useEffect(() => {
    setMsgs(null);
    setError('');
    void load();
    // The other side of the chat (the client, or the team) shows up without a reload.
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [load]);

  // Newest at the bottom; older messages scroll up and fade under the top edge.
  useEffect(() => {
    const b = box.current;
    if (b) b.scrollTop = b.scrollHeight;
  }, [msgs?.length, typing]);

  if (!client) {
    return (
      <main className="bl-flow">
        <h1 className="bl-h1 bl-rise">Chat</h1>
        <p className="bl-p bl-muted">Pick a client first.</p>
      </main>
    );
  }

  // A sent message shows at once (as pending, id below zero) and is swapped for the saved one.
  const merge = (add: KrisMessage[], drop?: number) =>
    setMsgs((prev) => {
      const kept = (prev ?? []).filter((x) => x.id !== drop);
      const seen = new Set(kept.map((x) => x.id));
      const all = [...kept, ...add.filter((x) => !seen.has(x.id))];
      // Saved messages in order, then any still sending, at the bottom.
      return [...all.filter((x) => x.id >= 0).sort((a, b) => a.id - b.id), ...all.filter((x) => x.id < 0)];
    });

  /** Teammates chime in one at a time, a beat apart, like people typing. */
  async function chime(turn: number) {
    setTyping(true);
    try {
      const r = await bil.chatChime(client!.id, turn);
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
    const tempId = -Date.now();
    merge([{ id: tempId, role: isTeam ? 'team' : 'client', kind: 'chat', body: t, cards: null, link: null, turn: null, data: null, createdAt: new Date().toISOString() }]);
    try {
      const r = await bil.chatSend(client!.id, t);
      merge(r.messages, tempId);
      if (r.chime) void chime(r.turn);
      else setTyping(false);
    } catch (e) {
      merge([], tempId);
      setText(t);
      setTyping(false);
      setError(e instanceof Error ? e.message : 'The team could not answer just now.');
    }
  }

  async function savePrefs(next: Prefs) {
    setPrefs(next);
    if (!supabase) return;
    const { error: e } = await supabase.rpc('kris_set_prefs', { p_client: client!.id, p_plain: next.plain, p_quiet_from: next.quietFrom, p_quiet_to: next.quietTo });
    if (e) setError(e.message);
  }

  const you = isTeam ? 'team' : 'client';
  const who = (m: KrisMessage) => (isAgent(m.role) ? AGENT[m.role] : m.role === you ? 'You' : m.role === 'client' ? `@${client.handle}` : 'Your team');
  const mine = (m: KrisMessage) => m.role === you;

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
          <h1 className="bl-h1 bl-rise">{isTeam ? 'Team chat' : 'Your team'}</h1>
          <span className="bl-small">{isTeam ? `@${client.handle}, Rein, Bil, Kris, Xev and you` : 'Rein, Bil, Kris, Xev and you'}</span>
        </div>
        <div className="bl-gc-actions">
          <button type="button" className="bl-btn bl-gc-win" onClick={() => setWinOpen(true)}>
            Log a win
          </button>
          <button type="button" className="bl-ghost" aria-expanded={showPrefs} onClick={() => setShowPrefs((s) => !s)}>
            Settings
          </button>
        </div>
      </header>

      {showPrefs && (
        <section className="bl-glass-card bl-brand-group" aria-label="Chat settings">
          <label className="bl-brand-check">
            <input type="checkbox" checked={prefs.plain} onChange={(e) => void savePrefs({ ...prefs, plain: e.target.checked })} />
            <span>Plain notices only. The team still tells you what happened, but Kris stops pitching ideas.</span>
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
          <span className="bl-small">No pitches in quiet hours, in your time zone, and never more than one a day. Tip: start a message with @Rein, @Bil, @Kris or @Xev to ask one of them directly.{isTeam ? ` Tag @${client.handle} to talk to the client without the agents jumping in.` : ''}</span>
        </section>
      )}

      <div className="bl-kris-box" ref={box}>
        {(typing || msgs === null) && <Working className="top" label={msgs === null ? 'Loading the chat' : 'The team is answering'} />}
        <ol className="bl-gc-log" aria-label="Team chat" aria-live="polite">
          {msgs?.length === 0 && (
            <li className="bl-gc-row">
              <span className="bl-gc-av kris" aria-hidden="true">
                K
              </span>
              <div className="bl-gc-msg">
                <span className="bl-gc-who">Kris</span>
                <p className="bl-gc-bub">
                  Welcome to {isTeam ? `@${client.handle}'s` : 'your'} team chat. Rein knows what&rsquo;s trending, Bil runs the plan, Xev knows your buyers and I get your name out there. What are you working on right now?
                </p>
              </div>
            </li>
          )}
          {msgs?.map((m) =>
            mine(m) ? (
              <li key={m.id} className={`bl-gc-me${m.id < 0 ? ' pending' : ''}`}>
                <p className="bl-gc-mebub">{m.body}</p>
              </li>
            ) : (
              <li key={m.id} className="bl-gc-row">
                <span className={`bl-gc-av ${isAgent(m.role) ? m.role : 'human'}`} aria-hidden="true">
                  {isAgent(m.role) ? AGENT[m.role][0] : m.role === 'client' ? '@' : 'T'}
                </span>
                <div className="bl-gc-msg">
                  <span className="bl-gc-who">
                    {who(m)}
                    {m.kind === 'note' ? ' · update' : m.kind === 'pitch' ? ' · pitch' : m.kind === 'briefing' ? ' · briefing' : ''}
                    <span className="num"> {new Date(m.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                  </span>
                  {m.kind === 'read' && m.data ? <XevCard body={m.body} data={m.data} clientId={client.id} /> : <p className="bl-gc-bub">{m.body}</p>}
                  {m.role === 'xev' && typeof m.data?.leadId === 'string' && (
                    <button type="button" className="bl-ghost bl-dm-open" onClick={() => setDmLead(String(m.data!.leadId))}>
                      <XMark /> See the chat
                    </button>
                  )}
                  {m.link && (
                    <button type="button" className="bl-linkish" style={{ alignSelf: 'flex-start' }} onClick={() => go(m.link!)}>
                      {m.link === 'next' ? 'Open Up next' : 'Open it'}
                    </button>
                  )}
                  {m.cards?.map((c) => (
                    <DraftCard key={`${c.campaignId}.${c.slot}`} ws={ws} campaignId={c.campaignId} slot={c.slot} />
                  ))}
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
        <button type="button" className="bl-gc-round" aria-label="Show Xev a sales chat screenshot" onClick={() => setXevOpen(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="5" width="16" height="14" rx="2" />
            <path d="M4 16l5-5 4 4 3-3 4 4" />
          </svg>
        </button>
        <label className="bl-sr" htmlFor="gc-text">
          Message your team
        </label>
        <textarea
          id="gc-text"
          className="bl-input"
          rows={1}
          maxLength={1000}
          value={text}
          placeholder="Message your team"
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

      {winOpen && (
        <WinSheet
          clientId={client.id}
          onClose={() => setWinOpen(false)}
          onLogged={(messages) => {
            setWinOpen(false);
            merge(messages);
          }}
        />
      )}

      {dmLead && (
        <DmSheet
          clientId={client.id}
          leadId={dmLead}
          replies={[...(msgs ?? [])].reverse().map((x) => (x.role === 'xev' && x.data?.leadId === dmLead && Array.isArray(x.data?.replies) ? (x.data.replies as unknown[]).filter((r): r is string => typeof r === 'string') : [])).find((r) => r.length) ?? []}
          onClose={() => setDmLead(null)}
        />
      )}
      {xevOpen && (
        <XevSheet
          clientId={client.id}
          onClose={() => setXevOpen(false)}
          onRead={(messages, turn) => {
            setXevOpen(false);
            merge(messages);
            if (turn) void chime(turn);
          }}
        />
      )}
    </main>
  );
}

const WIN_KINDS = [
  { key: 'sale', name: 'A sale' },
  { key: 'call', name: 'A booked call' },
  { key: 'subscriber', name: 'A new subscriber' },
  { key: 'other', name: 'Something else' },
] as const;

/** One tap when the money moves: the only way Backlot sees results against the client's goals. */
function WinSheet({ clientId, onClose, onLogged }: { clientId: string; onClose: () => void; onLogged: (m: KrisMessage[]) => void }) {
  const [kind, setKind] = useState<(typeof WIN_KINDS)[number]['key']>('sale');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const host = document.querySelector('.bl-root') ?? document.body;
  const usd = amount.trim() ? Number(amount.replace(/[$,\s]/g, '')) : undefined;
  const bad = usd !== undefined && (!Number.isFinite(usd) || usd < 0 || usd > 1_000_000);

  async function save() {
    setBusy(true);
    setError('');
    try {
      const r = await bil.winLog(clientId, { kind, amountUsd: usd, note: note.trim() || undefined });
      onLogged(r.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the win.');
      setBusy(false);
    }
  }

  return createPortal(
    <div className="bl-sheet-back" onClick={busy ? undefined : onClose}>
      <section className="bl-sheet bl-gc-sheet" role="dialog" aria-modal="true" aria-labelledby="gc-win-t" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !busy && onClose()}>
        <h2 id="gc-win-t" className="bl-sheet-title">
          Log a win
        </h2>
        <span className="bl-small">The team measures every plan against these. Only you and your team see them.</span>
        <div className="bl-filters" role="group" aria-label="What happened">
          {WIN_KINDS.map((k) => (
            <button key={k.key} type="button" className="bl-tagchip" aria-pressed={kind === k.key} onClick={() => setKind(k.key)}>
              {k.name}
            </button>
          ))}
        </div>
        {(kind === 'sale' || kind === 'other') && (
          <label className="bl-field">
            <span className="bl-label">How much, in dollars (optional)</span>
            <input className="bl-input" inputMode="decimal" maxLength={12} value={amount} placeholder="For example: 250" onChange={(e) => setAmount(e.target.value)} />
          </label>
        )}
        <label className="bl-field">
          <span className="bl-label">A note (optional, no names)</span>
          <input className="bl-input" maxLength={200} value={note} placeholder="For example: came from Tuesday's post" onChange={(e) => setNote(e.target.value)} />
        </label>
        {bad && <p className="bl-error">That amount does not look right.</p>}
        {error && (
          <p className="bl-error" role="alert">
            {error}
          </p>
        )}
        <div className="bl-row-actions">
          <button type="button" className="bl-ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="bl-btn" disabled={busy || bad} onClick={() => void save()}>
            {busy ? 'Saving' : 'Log it'}
          </button>
        </div>
      </section>
    </div>,
    host,
  );
}

/** Xev's read in the chat: where the buyer stands, why, and the replies to send. */
function XevCard({ body, data, clientId }: { body: string; data: Record<string, unknown>; clientId: string }) {
  const [copied, setCopied] = useState<number | null>(null);
  const stage = STAGES.findIndex((s) => s.key === data.stage);
  const moves = (Array.isArray(data.moves) ? data.moves : []) as Move[];
  const readId = typeof data.readId === 'string' ? data.readId : undefined;
  async function copy(t: string, i: number) {
    try {
      await navigator.clipboard.writeText(t);
      setCopied(i);
      window.setTimeout(() => setCopied(null), 1500);
      if (readId) void bil.xevFeedback(clientId, { readId, used: true });
    } catch {
      // Clipboard blocked: the text is on screen to select by hand.
    }
  }
  return (
    <div className="bl-gc-bub bl-gc-read">
      {!data.stop && stage >= 0 && (
        <div className="bl-gc-stage">
          <span className="bl-label">Where they are · {STAGES[stage].name}</span>
          <span className="bl-gc-steps" aria-hidden="true">
            {STAGES.map((s, i) => (
              <i key={s.key} className={i <= stage ? 'on' : undefined} />
            ))}
          </span>
        </div>
      )}
      <p style={{ margin: 0 }}>{body}</p>
      {!data.stop &&
        moves.map((mv, i) => (
          <div key={i} className="bl-gc-move">
            <span className="bl-label">{i === 0 ? 'Send this' : 'Or this'}</span>
            <p style={{ margin: 0 }}>{mv.reply}</p>
            {mv.why && <span className="bl-small">{mv.why}</span>}
            <button type="button" className="bl-ghost bl-gc-copy" onClick={() => void copy(mv.reply, i)}>
              {copied === i ? 'Copied' : 'Copy'}
            </button>
          </div>
        ))}
    </div>
  );
}

/** Pick, blur and send screenshots to Xev without leaving the chat. */
function XevSheet({ clientId, onClose, onRead }: { clientId: string; onClose: () => void; onRead: (m: KrisMessage[], turn: number | null) => void }) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [note, setNote] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const host = document.querySelector('.bl-root') ?? document.body;

  async function add(files: FileList | null) {
    if (!files) return;
    setError('');
    try {
      const loaded = await Promise.all([...files].slice(0, 3 - shots.length).map(async (f, i) => ({ key: `${Date.now()}-${i}`, source: await loadShot(f), boxes: [] as Box[] })));
      setShots((s) => [...s, ...loaded]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that picture.');
    }
  }

  async function read() {
    setBusy(true);
    setError('');
    try {
      const images = shots.map((s) => exportShot(coverBoxes(s.source, s.boxes)));
      const r = await bil.xevRead(clientId, images, { label: 'From the chat', note: note.trim() || undefined, chat: true });
      onRead(r.chat?.messages ?? [], r.chat?.turn ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xev could not read that right now.');
      setBusy(false);
    }
  }

  return createPortal(
    <div className="bl-sheet-back" onClick={busy ? undefined : onClose}>
      <section className="bl-sheet bl-gc-sheet" role="dialog" aria-modal="true" aria-labelledby="gc-xev-t" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !busy && onClose()}>
        <h2 id="gc-xev-t" className="bl-sheet-title">
          Show Xev a sales chat
        </h2>
        <span className="bl-small">Up to 3 screenshots of one conversation. Drag over names, usernames and photos to blur them. Blurring happens on this phone, and Xev reads them once and never saves them.</span>
        <input ref={picker} type="file" accept="image/jpeg,image/png" multiple hidden onChange={(e) => void add(e.target.files).then(() => (e.target.value = ''))} />
        {shots.length < 3 && (
          <button type="button" className="bl-ghost bl-start" onClick={() => picker.current?.click()}>
            {shots.length ? 'Add another screenshot' : 'Pick screenshots'}
          </button>
        )}
        {shots.map((s, i) => (
          <BlurEditor
            key={s.key}
            shot={s}
            onChange={(boxes) => setShots((all) => all.map((x, k) => (k === i ? { ...x, boxes } : x)))}
            onRemove={() => setShots((all) => all.filter((_, k) => k !== i))}
          />
        ))}
        <label className="bl-field">
          <span className="bl-label">What do you want to know? (optional)</span>
          <input className="bl-input" maxLength={300} value={note} placeholder="For example: she keeps asking questions but won't buy" onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="bl-check-line">
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I may share this chat, and names and photos are blurred.
        </label>
        {error && (
          <p className="bl-error" role="alert">
            {error}
          </p>
        )}
        <div className="bl-row-actions">
          <button type="button" className="bl-ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="bl-btn" disabled={busy || !ok || !shots.length} onClick={() => void read()}>
            {busy ? 'Xev is reading' : 'Send to Xev'}
          </button>
        </div>
      </section>
    </div>,
    host,
  );
}

/** A draft an agent showed, with the same Approve and Change actions as the Schedule. */
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

function XMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.19L2 3h6.33l4.37 5.78L17.75 3Zm-1.08 16.18h1.7L7.4 4.73H5.58l11.09 14.45Z" />
    </svg>
  );
}

/**
 * The DM Xev is talking about, read live from X with the client's login when they open this,
 * shown once and never saved. Her replies sit under it: one tap copies a reply and opens the
 * conversation on X, where the client pastes and sends it. Backlot never sends anything.
 */
function DmSheet({ clientId, leadId, replies, onClose }: { clientId: string; leadId: string; replies: string[]; onClose: () => void }) {
  const [view, setView] = useState<{ openUrl: string; messages: Array<{ you: boolean; text: string; at: string | null }> } | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<number | null>(null);
  const host = document.querySelector('.bl-root') ?? document.body;
  const url = view?.openUrl ?? 'https://x.com/messages';

  useEffect(() => {
    let live = true;
    bil
      .xevLeadView(clientId, leadId)
      .then((v) => live && setView(v))
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not read it from X.'));
    return () => {
      live = false;
    };
  }, [clientId, leadId]);

  // Opened in the same tap as the copy, so phones do not block the new tab.
  function copyAndOpen(t: string, i: number) {
    void navigator.clipboard?.writeText(t).catch(() => undefined);
    setCopied(i);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return createPortal(
    <div className="bl-sheet-back" onClick={onClose}>
      <section className="bl-sheet bl-gc-sheet bl-dm" role="dialog" aria-modal="true" aria-labelledby="gc-dm-t" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2 id="gc-dm-t" className="bl-sheet-title">
          The chat on X
        </h2>
        {!view && !error && <Working label="Reading it from X" />}
        {error && (
          <p className="bl-error" role="alert">
            {error}
          </p>
        )}
        {view && (
          <ol className="bl-dm-list" aria-label="Messages, oldest first">
            {view.messages.map((x, i) => (
              <li key={i} className={x.you ? 'you' : 'them'}>
                <p>{x.text}</p>
                {x.at && <small className="num">{new Date(x.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small>}
              </li>
            ))}
          </ol>
        )}
        {replies.length > 0 && (
          <div className="bl-dm-replies">
            <span className="bl-label">Xev's replies. Pick one: it copies, and X opens to this chat to paste it.</span>
            {replies.map((r, i) => (
              <div key={i} className="bl-gc-move">
                <p style={{ margin: 0 }}>{r}</p>
                <button type="button" className="bl-btn" onClick={() => copyAndOpen(r, i)}>
                  {copied === i ? 'Copied. Paste it in X' : 'Copy and open X'}
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="bl-small" style={{ margin: 0 }}>
          Not in your inbox? X puts messages from people you don't follow under Message requests. Backlot never sends anything; you do.
        </p>
        <div className="bl-row-actions">
          <button type="button" className="bl-ghost" onClick={onClose}>
            Close
          </button>
          <a className="bl-btn" href={url} target="_blank" rel="noopener noreferrer">
            Open in X
          </a>
        </div>
      </section>
    </div>,
    host,
  );
}
