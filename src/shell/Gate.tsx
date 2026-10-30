import { useState, type FormEvent } from 'react';
import {
  MIN_PASSWORD,
  PROBLEM_TEXT,
  USERNAME_RULE,
  cleanUsername,
  createLogin,
  signIn,
  type LoginProblem,
} from '../lib/auth';
import { Arrow, Back } from './icons';
import { useTheme } from './theme';
import { Install } from './Install';
import { ModeSwitch } from './ModeSwitch';

// The door for signed-out people: the welcome page, sign in, create a login, and the
// add-to-phone guide. A login made with an invite code from the team joins as team or
// client. Without a code it is a Playground login (a visitor): it saves their own
// narrations and searches with Rein, and never sees client work. Anyone can also try the
// Playground first without a login; that work stays in the browser until they save it.

// Where "Request an invite" sends email. Set VITE_INVITE_EMAIL when the inbox exists;
// until then the button is hidden so nobody writes to an address that is not there.
const INVITE_EMAIL = (import.meta.env.VITE_INVITE_EMAIL as string | undefined)?.trim() || '';

export type View = 'welcome' | 'in' | 'join' | 'install' | 'privacy';

export function Gate({ start = 'welcome', onTry, onLeave }: { start?: View; onTry?: () => void; onLeave?: () => void }) {
  const { theme } = useTheme();
  const [view, setViewState] = useState<View>(start);
  // Someone who came from the Playground goes back there instead of to the welcome page.
  const setView = (v: View) => (v === 'welcome' && onLeave ? onLeave() : setViewState(v));

  return (
    <div className="bl-root" data-theme={theme}>
      {view === 'welcome' && <Welcome go={setView} onTry={onTry} />}
      {(view === 'in' || view === 'join') && <Door mode={view} go={setView} saving={Boolean(onLeave)} />}
      {view === 'install' && <Install onBack={() => setView('welcome')} />}
      {view === 'privacy' && <Privacy onBack={() => setView('welcome')} />}
    </div>
  );
}

function Welcome({ go, onTry }: { go: (v: View) => void; onTry?: () => void }) {
  const mail = INVITE_EMAIL
    ? `mailto:${INVITE_EMAIL}?subject=${encodeURIComponent('Backlot invite request')}&body=${encodeURIComponent('My X handle: @\nWhat I do or sell:\nMy main goal (followers, sales, attention or a launch):\n')}`
    : '';
  return (
    <main className="bl-welcome">
      <svg className="bl-rings" width="460" height="460" viewBox="0 0 460 460" fill="none" aria-hidden="true" style={{ top: -170, right: -190 }}>
        <g className="bl-breathe">
          <circle cx="230" cy="230" r="78" stroke="var(--accent)" strokeWidth="1.5" opacity="0.7" />
          <circle cx="230" cy="230" r="120" stroke="var(--accent)" strokeWidth="1.2" opacity="0.5" />
          <circle cx="230" cy="230" r="216" stroke="var(--accent)" strokeWidth="1" opacity="0.18" />
        </g>
        <circle className="bl-spin" cx="230" cy="230" r="166" stroke="var(--accent)" strokeWidth="1" opacity="0.4" strokeDasharray="2 9" />
      </svg>
      <div className="bl-core" aria-hidden="true" />

      <div className="bl-welcome-in">
        <div className="bl-bar">
          <div className="bl-word">Backlot</div>
          <span style={{ marginRight: 72 }}>
            <ModeSwitch />
          </span>
        </div>

        <div style={{ paddingTop: 90, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="bl-label accent bl-rise">Private · by invite</div>
          <h1 className="bl-hero bl-rise bl-d1">
            Get seen.
            <br />
            Get followed.
            <br />
            <i>Get paid.</i>
          </h1>
          <p className="bl-p bl-muted bl-rise bl-d2" style={{ fontSize: 16 }}>
            The strategy team behind creators and small businesses on X. We learn what your audience already rewards,
            then plan every post to travel further, in your voice.
          </p>
        </div>

        <div className="bl-points bl-rise bl-d3">
          <div>
            <span className="bl-label accent">01</span>
            <span>
              <b>Your numbers, not guesses.</b> <span className="bl-muted">We measure what earns replies and reposts.</span>
            </span>
          </div>
          <div>
            <span className="bl-label accent">02</span>
            <span>
              <b>Trends before they peak.</b> <span className="bl-muted">Post while it is rising.</span>
            </span>
          </div>
          <div>
            <span className="bl-label accent">03</span>
            <span>
              <b>You stay in control.</b> <span className="bl-muted">We never post or ask for your password.</span>
            </span>
          </div>
        </div>

        <div className="bl-rise bl-d4" style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mail && (
            <a className="bl-btn big" href={mail} style={{ justifyContent: 'space-between', paddingRight: 8 }}>
              Request an invite
              <span className="bl-avatar" style={{ width: 42, height: 42, background: 'var(--accent-ink)', color: 'var(--accent)' }}>
                <Arrow />
              </span>
            </a>
          )}
          <button type="button" className={mail ? 'bl-ghost big' : 'bl-btn big'} onClick={() => go('in')}>
            I have an account
          </button>
          <button type="button" className="bl-ghost big" onClick={() => go('join')}>
            Create a login
          </button>
          {onTry && (
            <button type="button" className="bl-linkish accent" style={{ alignSelf: 'center', fontSize: 15 }} onClick={onTry}>
              Try the Playground without a login
            </button>
          )}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, fontSize: 13 }}>
            <button type="button" className="bl-linkish" onClick={() => go('privacy')}>
              Privacy note
            </button>
            <button type="button" className="bl-linkish" onClick={() => go('install')}>
              Add to your phone
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function Door({ mode, go, saving }: { mode: 'in' | 'join'; go: (v: View) => void; saving: boolean }) {
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const join = mode === 'join';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const name = cleanUsername(username);
    let problem: LoginProblem | null = null;
    if (!name || !password) return setError('Type your username and password.');
    if (!USERNAME_RULE.test(name)) problem = join ? 'username_format' : 'wrong';
    else if (join && password.length < MIN_PASSWORD) problem = 'password_length';
    if (problem) return setError(PROBLEM_TEXT[problem]);
    if (join && !adult) return setError('Tick the box to confirm you are 18 or older and have read the privacy note.');

    setBusy(true);
    setError('');
    problem = join ? await createLogin(code.trim(), name, password, adult) : await signIn(name, password);
    // On success the app swaps this screen out by itself.
    if (problem) {
      setBusy(false);
      setError(PROBLEM_TEXT[problem]);
    }
  }

  return (
    <main className="bl-welcome">
      <svg className="bl-rings" width="300" height="300" viewBox="0 0 300 300" fill="none" aria-hidden="true" style={{ bottom: -150, left: -150 }}>
        <g className="bl-breathe">
          <circle cx="150" cy="150" r="50" stroke="var(--accent)" strokeWidth="1.2" opacity="0.6" />
          <circle cx="150" cy="150" r="90" stroke="var(--accent)" strokeWidth="1" opacity="0.36" />
          <circle cx="150" cy="150" r="135" stroke="var(--accent)" strokeWidth="1" opacity="0.2" />
        </g>
      </svg>
      <form className="bl-welcome-in" onSubmit={submit} noValidate>
        <div className="bl-bar">
          <button type="button" className="bl-ghost bl-round" aria-label="Back to welcome" onClick={() => go('welcome')}>
            <Back />
          </button>
          <div className="bl-word">Backlot</div>
          <ModeSwitch />
        </div>

        <div className="bl-seg" style={{ marginTop: 16 }}>
          <button type="button" aria-pressed={!join} onClick={() => { setError(''); go('in'); }}>
            Sign in
          </button>
          <button type="button" aria-pressed={join} onClick={() => { setError(''); go('join'); }}>
            Create a login
          </button>
        </div>

        <h1 className="bl-h1 bl-rise" style={{ marginTop: 16 }}>
          {join ? (saving ? 'Save your work' : 'Create a login') : 'Welcome back'}
        </h1>
        {saving && (
          <p className="bl-small" style={{ margin: 0 }}>
            {join ? 'Make a login and what you made in the Playground moves into it.' : 'Sign in and what you made in the Playground moves into your login.'}
          </p>
        )}

        {join && (
          <label className="bl-field">
            <span className="bl-label">Invite code (only if your Backlot team sent one)</span>
            <input
              className="bl-input bl-code"
              value={code}
              maxLength={20}
              placeholder="BKLT-XXXX-XXXX"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              onChange={(e) => setCode(e.target.value)}
            />
            <span className="bl-small">Without a code you get the Playground: narrate Instagram and X profiles and search trends with Rein.</span>
          </label>
        )}
        <label className="bl-field">
          <span className="bl-label">{join ? 'Pick a username' : 'Username'}</span>
          <input
            className="bl-input"
            value={username}
            maxLength={25}
            placeholder={join ? 'Letters, numbers, . or _' : 'yourname'}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="bl-field">
          <span className="bl-label">{join ? 'Pick a password' : 'Password'}</span>
          <input
            className="bl-input"
            type="password"
            value={password}
            maxLength={72}
            placeholder={join ? `At least ${MIN_PASSWORD} characters` : undefined}
            autoComplete={join ? 'new-password' : 'current-password'}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {join && (
          <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.45 }} className="bl-muted">
            <input
              type="checkbox"
              checked={adult}
              onChange={(e) => setAdult(e.target.checked)}
              style={{ width: 22, height: 22, margin: 0, accentColor: 'var(--accent-text)', flexShrink: 0 }}
            />
            <span>
              I am 18 or older and I have read the{' '}
              <button type="button" className="bl-linkish accent" onClick={() => go('privacy')}>
                privacy note
              </button>
              .
            </span>
          </label>
        )}

        {error && (
          <p className="bl-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="bl-btn big" disabled={busy}>
          {join ? (busy ? 'Creating your login' : 'Create my login') : busy ? 'Signing in' : 'Sign in'}
        </button>
        <p className="bl-small" style={{ textAlign: 'center' }}>
          {join
            ? 'Backlot has no email, so keep your password somewhere safe. Your Backlot team, if you have one, can set a new one.'
            : 'Forgot your password? If you work with a Backlot team, message them. They can set a new one in a minute.'}
        </p>
      </form>
    </main>
  );
}

export function Privacy({ onBack }: { onBack: () => void }) {
  return (
    <main className="bl-welcome">
      <div className="bl-welcome-in">
        <div className="bl-bar">
          <button type="button" className="bl-ghost bl-round" aria-label="Back" onClick={onBack}>
            <Back />
          </button>
          <span className="bl-label">Privacy note</span>
          <span style={{ width: 44 }} />
        </div>
        <h1 className="bl-h1">What Backlot does with your data</h1>
        <div className="bl-wash" style={{ display: 'flex', flexDirection: 'column', gap: 8, lineHeight: 1.5 }}>
          <span className="bl-label accent">In short</span>
          <span>We read your public X posts and their public numbers to plan your content. We never post for you, never log in to your X account and never ask for its password.</span>
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 10, lineHeight: 1.5 }}>
          <li>Your login is a username and password. There is no email address on file.</li>
          <li>We read public posts and public counts (views, likes, replies, reposts, quotes, bookmarks) from X through X's official API.</li>
          <li>Drafts are written by AI (xAI's Grok) from your approved voice and your own results. A person on your team reviews them, and you approve every post before you post it yourself.</li>
          <li>Short quotes from other public posts used to spot trends are deleted after 24 hours.</li>
          <li>Backlot is for people 18 and older. Adult content is only for adults who agreed to it.</li>
          <li>When you post one of Backlot&rsquo;s drafts, add the link to the post on X (or mark it Not posted) within 3 days. We keep and review these links to keep posts compliant and to measure how Bil&rsquo;s work performs for your brand. If a link is more than 3 days late, campaigns pause until it is added. Not posted is always fine.</li>
          <li>Your team can pause an account (for example, for a missed payment). A paused account keeps everything and opens only Home until it is sorted out.</li>
          <li>To delete your login and everything in it, ask your team. It is removed for good.</li>
        </ul>
        <p className="bl-small">Backlot is a private tool in early use. This note will become a full privacy policy before it opens to the public.</p>
      </div>
    </main>
  );
}
