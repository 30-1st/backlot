import { useEffect, useRef, useState } from 'react';
import { guestNarrationCount, moveGuestWork } from '../lib/adopt';
import { rememberGuest } from '../lib/mode';
import { plural } from '../lib/format';

// After signing in, offers to move what was made in the Playground without a login into
// this login. Nothing moves without a yes, and "Not now" keeps it in the browser.

export function MoveGuestWork({ onMoved }: { onMoved: () => void }) {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDialogElement>(null);

  // A plain dialog: the screen behind may change its address while this is open (a
  // Playground login is sent to the Playground), and that must not close the question.
  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) d.showModal();
  }, [open]);

  useEffect(() => {
    let live = true;
    void guestNarrationCount().then((n) => {
      if (!live) return;
      setCount(n);
      setOpen(n > 0);
      if (n === 0) rememberGuest(false);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!open) return null;

  async function move() {
    setBusy(true);
    setError('');
    try {
      const r = await moveGuestWork((d) => setDone(d));
      if (r.failed > 0) {
        setError(`${r.moved} moved. ${r.failed} ${plural(r.failed, 'narration')} could not be moved and ${r.failed === 1 ? 'stays' : 'stay'} in this browser. Try again in a moment.`);
        setBusy(false);
        return;
      }
      rememberGuest(false);
      setOpen(false);
      onMoved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your work could not be moved. It is still in this browser.');
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="move-guest"
      aria-labelledby="move-guest-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) setOpen(false);
      }}
    >
      <div className="move-guest-in">
        <h2 id="move-guest-title">Move your Playground work?</h2>
        <p>
          This browser has {count} {plural(count, 'narration')} you made before signing in. Move {count === 1 ? 'it' : 'them'} into this
          login, photos and videos included, so {count === 1 ? 'it is' : 'they are'} saved and open on any device.
        </p>
        {busy && (
          <p className="field-hint" aria-live="polite">
            Moving {done} of {count}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="move-guest-actions">
          <button type="button" className="btn quiet" disabled={busy} onClick={() => setOpen(false)}>
            Not now
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void move()}>
            {busy ? 'Moving' : `Move ${count === 1 ? 'it' : 'them'}`}
          </button>
        </div>
      </div>
    </dialog>
  );
}
