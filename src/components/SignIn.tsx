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
import { Backdrop } from './Home';
import { Logo, Segmented } from './ui';

type Mode = 'in' | 'new';

/** The door to the hosted build: sign in, or make a login with a username and a password. */
export function SignIn() {
  const [mode, setMode] = useState<Mode>('in');
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const name = cleanUsername(username);
    let problem: LoginProblem | null = null;

    if (mode === 'new' && !code.trim()) return setError('Type the invite code your team sent you.');
    if (!name || !password) return setError('Type your username and password.');
    if (!USERNAME_RULE.test(name)) problem = mode === 'new' ? 'username_format' : 'wrong';
    else if (mode === 'new' && password.length < MIN_PASSWORD) problem = 'password_length';
    if (problem) return setError(PROBLEM_TEXT[problem]);
    if (mode === 'new' && password !== repeat) return setError('The two passwords do not match.');

    setBusy(true);
    setError('');
    problem = mode === 'new' ? await createLogin(code.trim(), name, password) : await signIn(name, password);
    // On success the app swaps this screen out by itself.
    if (problem) {
      setBusy(false);
      setError(PROBLEM_TEXT[problem]);
    }
  }

  return (
    <main className="home">
      <Backdrop />
      <div className="home-in">
        <div className="home-logo">
          <Logo size={96} />
        </div>
        <h1>Backlot</h1>

        <form className="login" onSubmit={submit} noValidate>
          <Segmented
            block
            label="Sign in or create a login"
            value={mode}
            options={[
              { value: 'in', label: 'Sign in' },
              { value: 'new', label: 'Join with a code' },
            ]}
            onChange={(next) => {
              setMode(next);
              setError('');
            }}
          />

          {mode === 'new' && (
            <label className="field">
              <span className="field-label">Invite code</span>
              <input
                id="login-code"
                value={code}
                maxLength={20}
                placeholder="BKLT-XXXX-XXXX"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellCheck={false}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
          )}

          <label className="field">
            <span className="field-label">Username</span>
            <input
              id="login-username"
              value={username}
              maxLength={25}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>

          <label className="field">
            <span className="field-label">Password</span>
            <input
              id="login-password"
              type="password"
              value={password}
              maxLength={72}
              autoComplete={mode === 'new' ? 'new-password' : 'current-password'}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {mode === 'new' && (
            <>
              <label className="field">
                <span className="field-label">Repeat password</span>
                <input
                  id="login-repeat"
                  type="password"
                  value={repeat}
                  maxLength={72}
                  autoComplete="new-password"
                  onChange={(e) => setRepeat(e.target.value)}
                />
              </label>
              <p className="login-note">
                Backlot is private and invite only. If you forget your password, ask your team to set a new one for you.
              </p>
            </>
          )}

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn primary login-go" disabled={busy}>
            {mode === 'new' ? (busy ? 'Creating your login' : 'Create my login') : busy ? 'Signing in' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
