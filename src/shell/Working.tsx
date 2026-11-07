// A thin, quiet progress line for anything the app or an agent is working on: sits on top
// of the area that is loading, slides while it waits, and says what is happening to screen
// readers. One look everywhere (chat, Up next, Rein, campaigns, Media), so waiting never
// looks like nothing is happening.

export function Working({ label, className }: { label: string; className?: string }) {
  return (
    <div className={`bl-working${className ? ` ${className}` : ''}`} role="progressbar" aria-label={label} aria-busy="true">
      <i aria-hidden="true" />
    </div>
  );
}
