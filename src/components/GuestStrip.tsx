// Shown above the Playground while someone tries it without a login: their work stays
// in this browser, and one tap saves it to a login of their own.

export function GuestStrip({ onSave, onLeave }: { onSave: () => void; onLeave: () => void }) {
  return (
    <div className="guest-strip" role="status">
      <span>
        <strong>Trying Backlot.</strong> Your work stays in this browser only.
      </span>
      <span className="guest-strip-actions">
        <button type="button" className="btn primary sm" onClick={onSave}>
          Save it to a login
        </button>
        <button type="button" className="btn quiet sm" onClick={onLeave}>
          Leave
        </button>
      </span>
    </div>
  );
}
