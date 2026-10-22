import { useState, type FormEvent } from 'react';
import { team } from '../lib/team';
import { MIN_PASSWORD } from '../lib/auth';
import { Back } from './icons';

/**
 * Change your own password. Forced right after a team reset (no current password needed,
 * since the person just signed in with the temporary one); otherwise the current password
 * is required.
 */
export function ChangePassword({
  forced,
  onDone,
  onSignOut,
  onBack,
}: {
  forced?: boolean;
  onDone: () => void;
  onSignOut?: () => void;
  onBack?: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!forced && !current) return setError('Type your current password.');
    if (next.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (next !== repeat) return setError('The two new passwords do not match.');
    setBusy(true);
    setError('');
    try {
      await team.setPassword(next, forced ? undefined : current);
      setDone(true);
      window.setTimeout(onDone, forced ? 0 : 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="bl-app" onSubmit={submit} noValidate style={{ maxWidth: 480, gap: 16 }}>
      <div className="bl-bar">
        {onBack ? (
          <button type="button" className="bl-ghost bl-round" aria-label="Back" onClick={onBack}>
            <Back />
          </button>
        ) : (
          <span className="bl-word">Backlot</span>
        )}
        {onSignOut && (
          <button type="button" className="bl-ghost" onClick={onSignOut}>
            Sign out
          </button>
        )}
      </div>
      <h1 className="bl-h1">{forced ? 'Pick a new password' : 'Change password'}</h1>
      {forced && <p className="bl-p bl-muted">Your team set a temporary password for you. Choose your own to keep going.</p>}
      {!forced && (
        <label className="bl-field">
          <span className="bl-label">Current password</span>
          <input className="bl-input" type="password" autoComplete="current-password" maxLength={72} value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
      )}
      <label className="bl-field">
        <span className="bl-label">New password</span>
        <input
          className="bl-input"
          type="password"
          autoComplete="new-password"
          maxLength={72}
          placeholder={`At least ${MIN_PASSWORD} characters`}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
      <label className="bl-field">
        <span className="bl-label">New password again</span>
        <input className="bl-input" type="password" autoComplete="new-password" maxLength={72} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      </label>
      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}
      {done && <p className="bl-wash">Saved. Use the new password next time you sign in.</p>}
      <button type="submit" className="bl-btn big" disabled={busy || done}>
        {busy ? 'Saving' : 'Save new password'}
      </button>
    </form>
  );
}
