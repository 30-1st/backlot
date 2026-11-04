import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, type ReactNode } from 'react';

// The shared ways Backlot keeps long pages short (approved Nov 2, 2026; same words, better
// presentation): a header with one line and "How this works" for the rest, folding sections
// that show a one-line summary until opened, and a step-through deck that shows one section
// or question per screen, like Rein's intake.

/** Title, one short line, an optional chip, and the longer explanation behind "How this works". */
export function PageHead({ title, line, chip, how, actions }: { title: string; line?: ReactNode; chip?: string; how?: ReactNode; actions?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bl-head">
      <div className="bl-head-row">
        <h1 className="bl-h1 bl-rise">{title}</h1>
        {actions && <div className="bl-head-actions">{actions}</div>}
      </div>
      {(line || chip || how) && (
        <div className="bl-head-line">
          {chip && <span className="bl-chip">{chip}</span>}
          {line && <span className="bl-small">{line}</span>}
          {how && (
            <button type="button" className="bl-how" aria-haspopup="dialog" onClick={() => setOpen(true)}>
              <Info /> How this works
            </button>
          )}
        </div>
      )}
      {open && how && (
        <InfoSheet title={title} onClose={() => setOpen(false)}>
          {how}
        </InfoSheet>
      )}
    </div>
  );
}

/** A bottom sheet with the longer explanation. */
export function InfoSheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const box = useRef<HTMLElement>(null);
  useEffect(() => box.current?.focus(), []);
  const host = document.querySelector('.bl-root') ?? document.body;
  return createPortal(
    <div className="bl-sheet-back" onClick={onClose}>
      <section
        ref={box}
        tabIndex={-1}
        className="bl-sheet bl-how-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`How ${title} works`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2 className="bl-sheet-title">How {title} works</h2>
        <div className="bl-how-body">{children}</div>
        <button type="button" className="bl-btn bl-wide" onClick={onClose}>
          Got it
        </button>
      </section>
    </div>,
    host,
  );
}

/** One section as a row with its summary; tap to open. */
export function Fold({ title, summary, done, open, onToggle, children, id }: { title: string; summary: string; done?: boolean; open: boolean; onToggle: () => void; children: ReactNode; id: string }) {
  return (
    <section className={`bl-fold${open ? ' open' : ''}`} aria-labelledby={`${id}-t`}>
      <button type="button" className="bl-fold-row" aria-expanded={open} aria-controls={`${id}-b`} onClick={onToggle}>
        <span className={`bl-fold-dot${done ? ' done' : ''}`} aria-hidden="true" />
        <span className="bl-fold-text">
          <b id={`${id}-t`}>{title}</b>
          <small>{summary}</small>
        </span>
        <span className="bl-fold-chev" aria-hidden="true">
          <Chev />
        </span>
      </button>
      {open && (
        <div id={`${id}-b`} className="bl-fold-body">
          {children}
        </div>
      )}
    </section>
  );
}

/** One step per screen, full screen, with a progress bar, Back and Next; the last step saves. */
export function StepDeck({
  label, steps, start = 0, onClose, finish,
}: {
  label: string;
  steps: Array<{ key: string; title: string; hint?: string; body: ReactNode }>;
  start?: number;
  onClose: () => void;
  finish?: { label: string; busy?: boolean; disabled?: boolean; run: () => void };
}) {
  const [i, setI] = useState(Math.min(start, steps.length - 1));
  const s = steps[i];
  const host = document.querySelector('.bl-root') ?? document.body;
  return createPortal(
    <div className="bl-deck-view" role="dialog" aria-modal="true" aria-label={label} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="bl-deck-top">
        <button type="button" className="bl-ghost bl-round" aria-label="Close" onClick={onClose}>
          <X />
        </button>
        <span className="bl-small num" aria-live="polite">
          {i + 1} of {steps.length}
        </span>
        <span style={{ width: 44 }} />
      </div>
      <div className="bl-intake-bar" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={i + 1} aria-label={label}>
        <i style={{ width: `${((i + 1) / steps.length) * 100}%` }} />
      </div>
      <div className="bl-deck-stage">
        <div key={s.key} className="bl-deck-slide in-next bl-intake">
          <span className="bl-slide-kick">{label}</span>
          <h2 className="bl-slide-head">{s.title}</h2>
          {s.hint && <span className="bl-small">{s.hint}</span>}
          <div className="bl-step-body">{s.body}</div>
        </div>
      </div>
      <div className="bl-dv-nav">
        <button type="button" className="bl-ghost" style={{ visibility: i === 0 ? 'hidden' : 'visible' }} onClick={() => setI(i - 1)}>
          Back
        </button>
        {i < steps.length - 1 ? (
          <button type="button" className="bl-btn" onClick={() => setI(i + 1)}>
            Next
          </button>
        ) : finish ? (
          <button type="button" className="bl-btn" disabled={finish.busy || finish.disabled} onClick={finish.run}>
            {finish.busy ? 'Saving' : finish.label}
          </button>
        ) : (
          <button type="button" className="bl-btn" onClick={onClose}>
            Done
          </button>
        )}
      </div>
    </div>,
    host,
  );
}

/** A short rule as a small badge; tap it for the full sentence. */
export function RuleBadge({ label, full }: { label: string; full: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="bl-rule">
      <button type="button" className="bl-rule-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Lock /> {label}
      </button>
      {open && <span className="bl-small bl-rule-full">{full}</span>}
    </span>
  );
}

function Info() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.1" />
    </svg>
  );
}
function Chev() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
function X() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
function Lock() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
