import { useEffect, useMemo, useRef, useState } from 'react';
import { DoorError, openRoom, type RoomView, verifyVisit } from './api';
import { TURNSTILE_SITE_KEY } from './config';
import { runCheck } from './turnstile';

// A client's room. The page shows what the room door returns and nothing else: the AI
// badge first, the name, the greeting, a hero file if there is one, and buttons to the
// client's approved links. Adult rooms ask for 18+ before showing anything. Chat with
// Kris arrives in K2. Every word from the server is shown as plain text.

const SLUG = /^[a-z0-9_]{3,30}$/;

function safeSession<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** The room name from /k/<name>, and the preview ticket from #preview=..., which is then
 *  taken out of the address bar so screenshots and shares never carry it. */
function readAddress(): { slug: string | null; preview?: string } {
  const m = location.pathname.match(/^\/k\/([A-Za-z0-9_]{3,30})\/?$/);
  const slug = m ? m[1].toLowerCase() : null;
  const hash = new URLSearchParams(location.hash.slice(1));
  let preview = hash.get('preview') ?? undefined;
  if (slug) {
    const key = `room.preview.${slug}`;
    if (preview) {
      safeSession(() => sessionStorage.setItem(key, preview!), undefined);
      history.replaceState(null, '', location.pathname);
    } else {
      preview = safeSession(() => sessionStorage.getItem(key) ?? undefined, undefined);
    }
  }
  return { slug: slug && SLUG.test(slug) ? slug : null, preview };
}

/** Black or white text for an accent, whichever reads better (WCAG relative luminance). */
function inkOn(hex: string): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#121218' : '#ffffff';
}

type Load = { kind: 'loading' } | { kind: 'room'; room: RoomView } | { kind: 'private' } | { kind: 'error'; message: string };

export function App() {
  const address = useMemo(readAddress, []);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [adultOk, setAdultOk] = useState(() => (address.slug ? safeSession(() => sessionStorage.getItem(`room.18.${address.slug}`) === 'yes', false) : false));
  const [left, setLeft] = useState(false);
  const shell = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!address.slug) {
      setLoad({ kind: 'private' });
      return;
    }
    openRoom(address.slug, address.preview).then(
      (room) => setLoad({ kind: 'room', room }),
      (e: unknown) => setLoad(e instanceof DoorError && e.status === 404 ? { kind: 'private' } : { kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' }),
    );
  }, [address]);

  const room = load.kind === 'room' ? load.room : null;
  useEffect(() => {
    if (!room || !shell.current) return;
    // CSS variables set through the style object, which the strict security policy allows.
    shell.current.style.setProperty('--accent', room.accent);
    shell.current.style.setProperty('--on-accent', inkOn(room.accent));
    document.title = `${room.name}, with Kris`;
  }, [room]);

  const preset = room?.preset ?? 'creator';

  if (load.kind === 'loading') return <div className="r-shell r-creator" aria-busy="true" />;
  if (load.kind === 'private') {
    return (
      <div className="r-shell r-creator">
        <main className="r-note">
          <h1 className="r-note-title">This room is not open.</h1>
          <p>Check the link you were given, or ask the person who shared it.</p>
        </main>
      </div>
    );
  }
  if (load.kind === 'error') {
    return (
      <div className="r-shell r-creator">
        <main className="r-note" role="alert">
          <h1 className="r-note-title">This room did not load.</h1>
          <p>{load.message}</p>
          <button type="button" className="r-btn" onClick={() => location.reload()}>
            Try again
          </button>
        </main>
      </div>
    );
  }

  const r = load.room;

  if (r.ageGate && left) {
    return (
      <div ref={shell} className={`r-shell r-${preset}`}>
        <main className="r-note">
          <h1 className="r-note-title">You left the room.</h1>
          <p>Nothing was saved. You can close this page.</p>
        </main>
      </div>
    );
  }

  if (r.ageGate && !adultOk) {
    return (
      <div ref={shell} className={`r-shell r-${preset}`}>
        <main className="r-gate" aria-labelledby="gate-title">
          <p className="r-gate-handle">@{r.handle}</p>
          <h1 id="gate-title" className="r-gate-title">For adults only.</h1>
          <p className="r-gate-copy">This room links to adult products. Enter only if you are 18 or older and adult content is legal where you are.</p>
          <div className="r-gate-actions">
            <button
              type="button"
              className="r-btn r-btn-solid"
              onClick={() => {
                safeSession(() => sessionStorage.setItem(`room.18.${r.slug}`, 'yes'), undefined);
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
      </div>
    );
  }

  return (
    <div ref={shell} className={`r-shell r-${preset}`}>
      {r.state !== 'open' && (
        <p className="r-preview" role="status">
          {r.state === 'closed' ? 'Closed room. Only people with a preview link can see it.' : 'Preview. Only people with this link can see it.'}
        </p>
      )}
      <header className="r-top">
        <span className="r-ai" aria-hidden="true">
          AI
        </span>
        <span className="r-who">
          Kris, <span className="r-handle">@{r.handle}</span>&rsquo;s AI
        </span>
      </header>

      <main className="r-main">
        <h1 className="r-name">
          <span>{r.name}</span>
        </h1>
        {r.greeting && <p className="r-greeting">{r.greeting}</p>}

        {r.hero && (
          <figure className="r-hero">
            {r.hero.kind === 'video' ? (
              <video src={r.hero.url} muted playsInline loop autoPlay controls={false} aria-label={`From @${r.handle}`} />
            ) : (
              <img src={r.hero.url} alt={`From @${r.handle}`} />
            )}
          </figure>
        )}

        {r.buttons.length > 0 && (
          <nav className="r-links" aria-label={`@${r.handle}'s links`}>
            {r.buttons.map((b, i) => (
              <a key={i} className="r-link" href={b.url} target="_blank" rel="noopener noreferrer">
                <span>{b.label}</span>
                <span className="r-link-host">{hostOf(b.url)}</span>
              </a>
            ))}
          </nav>
        )}

        <KrisSoon room={r} preview={address.preview} />
      </main>

      <footer className="r-foot">
        <p>Kris is an AI host for @{r.handle}. She is not @{r.handle} and will never say she is a person.</p>
        <p>This page asks for nothing about you and sets no cookies of its own.</p>
      </footer>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Where Kris's chat will sit. In a preview, the team can try the bot check here. */
function KrisSoon({ room, preview }: { room: RoomView; preview?: string }) {
  const [step, setStep] = useState<'idle' | 'checking' | 'passed' | 'blocked' | 'failed'>('idle');
  const [note, setNote] = useState('');
  const box = useRef<HTMLDivElement>(null);

  async function check() {
    if (!TURNSTILE_SITE_KEY) {
      setStep('failed');
      setNote('The bot check is not set up on this site yet.');
      return;
    }
    setStep('checking');
    setNote('');
    try {
      const token = await runCheck(box.current!, TURNSTILE_SITE_KEY, room.preset === 'creator_adult' ? 'dark' : 'light');
      const visit = await verifyVisit(room.slug, token, preview);
      setStep('passed');
      setNote(`Passed. This visit has a ticket until ${new Date(visit.expiresAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'unsupported' || msg === 'blocked') {
        setStep('blocked');
      } else {
        setStep('failed');
        setNote(e instanceof DoorError ? e.message : 'The bot check did not finish. Try again.');
      }
    }
  }

  return (
    <section className="r-kris" aria-labelledby="kris-title">
      <h2 id="kris-title" className="r-kris-title">
        Chat with Kris
      </h2>
      <p className="r-kris-copy">Kris starts chatting here soon. She can answer questions about @{room.handle} and point you to the right link.</p>
      {room.state !== 'open' && (
        <>
          <div ref={box} className="r-check" />
          {step === 'idle' && (
            <button type="button" className="r-btn" onClick={() => void check()}>
              Try the bot check
            </button>
          )}
          {step === 'checking' && <p className="r-small">Checking.</p>}
          {step === 'blocked' && (
            <div className="r-small">
              <p>The check cannot run in this app&rsquo;s browser. Open this page in Safari or Chrome: tap the menu (often three dots) and choose Open in browser.</p>
              <button
                type="button"
                className="r-btn"
                onClick={() => {
                  void navigator.clipboard?.writeText(location.href + (preview ? `#preview=${preview}` : '')).then(
                    () => setNote('Link copied.'),
                    () => setNote('Copying is blocked here. Press and hold the address to copy it.'),
                  );
                }}
              >
                Copy the link
              </button>
            </div>
          )}
          {note && (
            <p className="r-small" role={step === 'failed' ? 'alert' : 'status'}>
              {note}
            </p>
          )}
          {step === 'failed' && (
            <button type="button" className="r-btn" onClick={() => void check()}>
              Try again
            </button>
          )}
        </>
      )}
    </section>
  );
}
