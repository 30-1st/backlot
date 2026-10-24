import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { chat, deleteChat, DoorError, history, type Msg, openRoom, type RoomView, tap, verifyVisit } from './api';
import { lookFor, paletteFor, type Look } from './archetypes';
import { TURNSTILE_SITE_KEY } from './config';
import { runCheck } from './turnstile';
import type { Mood } from './Stage';
import { Safety } from './Safety';

// A client's room: Kris's landing page. Everything from the server is shown as plain
// text. Adult rooms ask for 18+ before anything else. FAQ answers come with the room,
// so tapping one costs nothing; typed messages go to Kris once a bot check has passed.

const SLUG = /^[a-z0-9_]{3,30}$/;

// The 3D code is large, so it loads after the words: the room reads at once and the
// object fades in a moment later.
const StageLazy = lazy(() => import('./Stage').then((m) => ({ default: m.Stage })));
function Stage(props: { look: Look; accent: string; mood: Mood }) {
  return (
    <Suspense fallback={<div className="r-stage" aria-hidden="true" />}>
      <StageLazy {...props} />
    </Suspense>
  );
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** /k/<name>, and a preview ticket from #preview=..., taken out of the address bar at once. */
function readAddress(): { slug: string | null; preview?: string } {
  const m = location.pathname.match(/^\/k\/([A-Za-z0-9_]{3,30})\/?$/);
  const slug = m ? m[1].toLowerCase() : null;
  let preview = new URLSearchParams(location.hash.slice(1)).get('preview') ?? undefined;
  if (slug) {
    const key = `room.preview.${slug}`;
    if (preview) {
      safe(() => sessionStorage.setItem(key, preview!), undefined);
      history_replace();
    } else {
      preview = safe(() => sessionStorage.getItem(key) ?? undefined, undefined);
    }
  }
  return { slug: slug && SLUG.test(slug) ? slug : null, preview };
}
function history_replace() {
  window.history.replaceState(null, '', location.pathname);
}

type Load = { kind: 'loading' } | { kind: 'room'; room: RoomView } | { kind: 'private' } | { kind: 'error'; message: string };

export function App() {
  if (location.pathname.replace(/\/$/, '') === '/safety') return <Safety />;
  return <RoomPage />;
}

function RoomPage() {
  const address = useMemo(readAddress, []);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [adultOk, setAdultOk] = useState(() => (address.slug ? safe(() => sessionStorage.getItem(`room.18.${address.slug}`) === 'yes', false) : false));
  const [left, setLeft] = useState(false);

  useEffect(() => {
    if (!address.slug) return setLoad({ kind: 'private' });
    openRoom(address.slug, address.preview).then(
      (room) => setLoad({ kind: 'room', room }),
      (e: unknown) => setLoad(e instanceof DoorError && e.status === 404 ? { kind: 'private' } : { kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' }),
    );
  }, [address]);

  if (load.kind === 'loading') return <div className="r-shell r-blank" aria-busy="true" />;
  if (load.kind === 'private' || load.kind === 'error') {
    return (
      <div className="r-shell r-blank">
        <main className="r-note" role={load.kind === 'error' ? 'alert' : undefined}>
          <h1 className="r-note-title">{load.kind === 'private' ? 'This room is not open.' : 'This room did not load.'}</h1>
          <p>{load.kind === 'private' ? 'Check the link you were given, or ask the person who shared it.' : load.message}</p>
          {load.kind === 'error' && (
            <button type="button" className="r-btn" onClick={() => location.reload()}>
              Try again
            </button>
          )}
        </main>
      </div>
    );
  }

  const room = load.room;
  const look = lookFor(room.preset);
  if (room.ageGate && left) {
    return (
      <Shell look={look} room={room}>
        <main className="r-note">
          <h1 className="r-note-title">You left the room.</h1>
          <p>Nothing was saved. You can close this page.</p>
        </main>
      </Shell>
    );
  }
  if (room.ageGate && !adultOk) {
    return (
      <Shell look={look} room={room}>
        <main className="r-gate" aria-labelledby="gate-title">
          <div className="r-gate-stage">
            <Stage look={look} accent={room.accent} mood="idle" />
          </div>
          <p className="r-gate-handle">@{room.handle}</p>
          <h1 id="gate-title" className="r-gate-title">For adults only.</h1>
          <p className="r-gate-copy">This room links to adult products. Enter only if you are 18 or older and adult content is legal where you are.</p>
          <div className="r-gate-actions">
            <button
              type="button"
              className="r-btn r-btn-solid"
              onClick={() => {
                safe(() => sessionStorage.setItem(`room.18.${room.slug}`, 'yes'), undefined);
                setAdultOk(true);
              }}
            >
              I am 18 or older
            </button>
            <button type="button" className="r-btn" onClick={() => setLeft(true)}>
              Leave
            </button>
          </div>
        </main>
      </Shell>
    );
  }
  return <Room room={room} look={look} preview={address.preview} />;
}

/** Colors, type and the twinkling marks for a look. */
function Shell({ look, room, children }: { look: Look; room: RoomView; children: React.ReactNode }) {
  const p = paletteFor(look, room.accent);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Set through the style object, which the strict security policy allows.
    for (const [k, v] of Object.entries({ '--bg': p.bg, '--ink': p.ink, '--muted': p.muted, '--accent': p.accent, '--on-accent': p.onAccent, '--accent-text': p.accentText, '--surface': p.surface, '--line': p.line })) el.style.setProperty(k, v);
    document.title = `${room.name}, with Kris`;
    document.documentElement.style.background = p.bg;
  }, [p.bg, p.ink, p.muted, p.accent, p.onAccent, p.accentText, p.surface, p.line, room.name]);
  return (
    <div ref={ref} className={`r-shell r-${look.id}${look.dark ? ' r-dark' : ''}`}>
      <Glyphs look={look} seed={room.slug} />
      {children}
    </div>
  );
}

function Glyphs({ look, seed }: { look: Look; seed: string }) {
  const marks = useMemo(() => {
    let h = 0;
    for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const rand = () => ((h = (h * 1664525 + 1013904223) >>> 0) / 4294967296);
    return Array.from({ length: 18 }, (_, i) => ({ g: look.glyphs[i % look.glyphs.length], x: rand() * 100, y: rand() * 70, d: 2.4 + rand() * 3.6, delay: -rand() * 6, s: 0.7 + rand() * 0.9 }));
  }, [look, seed]);
  return (
    <div className="r-glyphs" aria-hidden="true">
      {marks.map((m, i) => (
        <span key={i} style={{ left: `${m.x}%`, top: `${m.y}%`, animationDuration: `${m.d}s`, animationDelay: `${m.delay}s`, fontSize: `${m.s}em` } as CSSProperties}>
          {m.g}
        </span>
      ))}
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return <time className="num">{now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</time>;
}

type Line = { key: string; role: 'visitor' | 'kris'; body: string; links: number[]; source: string };

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function Room({ room, look, preview }: { room: RoomView; look: Look; preview?: string }) {
  const ticketKey = `room.visit.${room.slug}`;
  const [lines, setLines] = useState<Line[]>([]);
  const [lastSeq, setLastSeq] = useState(0);
  const [text, setText] = useState('');
  const [mood, setMood] = useState<Mood>('idle');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [closed, setClosed] = useState(false);
  const checkBox = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const live = room.chat !== 'off';
  const started = lines.length > 0;

  const getTicket = () => safe(() => {
    const raw = sessionStorage.getItem(ticketKey);
    if (!raw) return null;
    const t = JSON.parse(raw) as { ticket: string; exp: string };
    return Date.parse(t.exp) > Date.now() + 60_000 ? t.ticket : null;
  }, null);
  const dropTicket = () => safe(() => sessionStorage.removeItem(ticketKey), undefined);

  const fromServer = (m: Msg): Line => ({ key: `s${m.seq}`, role: m.role, body: m.body, links: m.links ?? [], source: m.source });

  // A reload picks the chat back up.
  useEffect(() => {
    const t = getTicket();
    if (!t || !live) return;
    history(room.slug, t, preview).then(
      (r) => {
        setLines(r.messages.map(fromServer));
        setLastSeq(r.messages.length ? r.messages[r.messages.length - 1].seq : 0);
      },
      () => dropTicket(),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [lines.length, busy]);

  useEffect(() => {
    if (mood !== 'answered') return;
    const t = window.setTimeout(() => setMood('idle'), 900);
    return () => window.clearTimeout(t);
  }, [mood]);

  async function ticket(): Promise<string> {
    const have = getTicket();
    if (have) return have;
    if (!TURNSTILE_SITE_KEY) throw new DoorError('Chat is not set up on this site yet.', 503);
    let token: string;
    try {
      token = await runCheck(checkBox.current!, TURNSTILE_SITE_KEY, look.dark ? 'dark' : 'light');
    } catch (e) {
      const why = e instanceof Error ? e.message : '';
      if (why === 'unsupported' || why === 'blocked') setBlocked(true);
      throw new DoorError('The quick check before chatting did not finish.', 0);
    }
    const v = await verifyVisit(room.slug, token, preview);
    safe(() => sessionStorage.setItem(ticketKey, JSON.stringify({ ticket: v.ticket, exp: v.expiresAt })), undefined);
    return v.ticket;
  }

  function askFaq(f: { q: string; a: string }) {
    tap(room.slug, 'faq', preview);
    const k = `f${Date.now()}`;
    setLines((l) => [...l, { key: `${k}q`, role: 'visitor', body: f.q, links: [], source: 'visitor' }, { key: `${k}a`, role: 'kris', body: f.a, links: [], source: 'faq' }]);
    setMood('answered');
  }

  async function send(msg: string, retry = 0): Promise<void> {
    const said = msg.trim();
    if (!said || busy || closed) return;
    if (!live) {
      setNote('Kris starts chatting here soon. Tap a question above or one of the links.');
      return;
    }
    setBusy(true);
    setNote('');
    setMood('thinking');
    const pendingKey = `p${Date.now()}`;
    if (!retry) {
      setLines((l) => [...l, { key: pendingKey, role: 'visitor', body: said, links: [], source: 'pending' }]);
      setText('');
    }
    try {
      const t = await ticket();
      const r = await chat(room.slug, t, said, lastSeq, preview);
      if (r.deleted) {
        dropTicket();
        setLines([]);
        setLastSeq(0);
        setNote('Your chat was deleted. Nothing from it is kept.');
        setMood('idle');
        return;
      }
      setLines((l) => [...l.filter((x) => x.source !== 'pending'), ...r.messages.map(fromServer)]);
      setLastSeq(r.messages[r.messages.length - 1]?.seq ?? lastSeq);
      if (r.closed) setClosed(true);
      setMood('answered');
    } catch (e) {
      setMood('idle');
      if (e instanceof DoorError && e.data.reverify && retry < 1) {
        dropTicket();
        setBusy(false);
        return send(said, retry + 1);
      }
      if (e instanceof DoorError && e.data.resync && Array.isArray(e.data.messages)) {
        const msgs = e.data.messages as Msg[];
        setLines(msgs.map(fromServer));
        setLastSeq(msgs.length ? msgs[msgs.length - 1].seq : 0);
        setNote('This chat changed in another tab, so it was refreshed. Send your message again.');
      } else {
        setLines((l) => l.filter((x) => x.source !== 'pending'));
        setText(said);
        setNote(e instanceof Error ? e.message : 'Kris could not answer just now.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function wipe() {
    const t = getTicket();
    if (t) await deleteChat(room.slug, t, preview).catch(() => undefined);
    dropTicket();
    setLines([]);
    setLastSeq(0);
    setNote('Your chat was deleted. Nothing from it is kept.');
  }

  return (
    <Shell look={look} room={room}>
      {room.state !== 'open' && (
        <p className="r-preview" role="status">
          {room.chat === 'test' ? 'Preview. Chats here are tests, paid from the test budget.' : room.state === 'closed' ? 'Closed room. Only people with a preview link can see it.' : 'Preview. Only people with this link can see it.'}
        </p>
      )}

      <header className="r-top">
        <span className="r-live">
          <span className="r-dot" aria-hidden="true" />
          Kris is {live ? 'online' : 'getting ready'}
        </span>
        <Clock />
      </header>

      <section className={`r-hero${started ? ' r-hero-small' : ''}`}>
        <Stage look={look} accent={room.accent} mood={mood} />
        <h1 className="r-name">{room.name}</h1>
        <p className="r-who">
          <span className="r-ai">AI</span> Kris, @{room.handle}&rsquo;s host
        </p>
      </section>

      <main className="r-main">
        {!started && room.greeting && <p className="r-greeting">{room.greeting}</p>}

        {!started && room.hero && (
          <figure className="r-hero-media">
            {room.hero.kind === 'video' ? <video src={room.hero.url} muted playsInline loop autoPlay aria-label={`From @${room.handle}`} /> : <img src={room.hero.url} alt={`From @${room.handle}`} />}
          </figure>
        )}

        {(room.faq.length > 0 || live) && (
          <div className="r-suggest" role="group" aria-label="Ask Kris">
            {room.faq.slice(0, started ? 2 : 4).map((f) => (
              <button key={f.q} type="button" className="r-card" onClick={() => askFaq(f)}>
                {f.q}
              </button>
            ))}
            {live && !started && (
              <button type="button" className="r-card" onClick={() => void send(`What's new with ${room.name}?`)}>
                What&rsquo;s new with {room.name}?
              </button>
            )}
          </div>
        )}

        {!started && room.buttons.length > 0 && (
          <nav className="r-links" aria-label={`@${room.handle}'s links`}>
            {room.buttons.map((b, i) => (
              <a key={i} className="r-link" href={b.url} target="_blank" rel="noopener noreferrer" onClick={() => tap(room.slug, 'link', preview)}>
                <span>{b.label}</span>
                <span className="r-link-host">{hostOf(b.url)}</span>
              </a>
            ))}
          </nav>
        )}

        {started && (
          <ol className="r-chat" aria-label="Chat with Kris" aria-live="polite">
            {lines.map((l) => (
              <li key={l.key} className={`r-msg r-${l.role}${l.source === 'pending' ? ' r-pending' : ''}`}>
                {l.role === 'kris' && (
                  <span className="r-avatar" aria-hidden="true">
                    K
                  </span>
                )}
                <div className="r-bubble">
                  <p>{l.body}</p>
                  {l.links.length > 0 && (
                    <div className="r-msg-links">
                      {l.links.map((i) => {
                        const link = room.links[i];
                        return link ? (
                          <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="r-chip" onClick={() => tap(room.slug, 'link', preview)}>
                            {link.label}
                          </a>
                        ) : null;
                      })}
                    </div>
                  )}
                </div>
              </li>
            ))}
            {busy && (
              <li className="r-msg r-kris" aria-busy="true">
                <span className="r-avatar" aria-hidden="true">
                  K
                </span>
                <div className="r-bubble r-typing" aria-label="Kris is typing">
                  {look.glyphs.slice(0, 3).map((g, i) => (
                    <span key={i}>{g}</span>
                  ))}
                </div>
              </li>
            )}
          </ol>
        )}
        <div ref={checkBox} className="r-check" />
        {blocked && (
          <div className="r-small">
            <p>The quick check cannot run in this app&rsquo;s browser. Open this page in Safari or Chrome: tap the menu (often three dots) and choose Open in browser.</p>
            <button
              type="button"
              className="r-btn"
              onClick={() =>
                void navigator.clipboard?.writeText(location.href + (preview ? `#preview=${preview}` : '')).then(
                  () => setNote('Link copied.'),
                  () => setNote('Copying is blocked here. Press and hold the address to copy it.'),
                )
              }
            >
              Copy the link
            </button>
          </div>
        )}
        {note && (
          <p className="r-small" role="status">
            {note}
          </p>
        )}
        <div ref={end} />
      </main>

      <form
        className="r-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <label className="r-sr" htmlFor="r-ask">
          Ask Kris
        </label>
        <input
          id="r-ask"
          className="r-input"
          value={text}
          maxLength={500}
          autoComplete="off"
          enterKeyHint="send"
          disabled={closed}
          placeholder={closed ? 'This chat has ended' : live ? look.placeholder(room.name) : 'Kris starts chatting here soon'}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="r-send" disabled={busy || closed || !text.trim()}>
          Send
        </button>
      </form>

      <footer className="r-foot">
        <p>Kris is an AI host. She works for @{room.handle}, recommends their own links, and is not @{room.handle} or a person.</p>
        <p>
          <a href="/safety">Safety and privacy</a>
          {started && (
            <>
              {'  '}
              <button type="button" className="r-linkish" onClick={() => void wipe()}>
                Delete this chat
              </button>
            </>
          )}
        </p>
      </footer>
    </Shell>
  );
}
