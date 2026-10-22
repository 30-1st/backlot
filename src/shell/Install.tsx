import { Back, Check } from './icons';

/** The add-to-Home-Screen guide for iPhone, with the one-line Android version. */
export function Install({ onBack }: { onBack: () => void }) {
  const steps = [
    { title: 'Tap Share', hint: 'The square with an arrow at the bottom of Safari' },
    { title: 'Tap Add to Home Screen', hint: 'Scroll down the list to find it' },
  ];
  return (
    <main className="bl-welcome">
      <div className="bl-welcome-in">
        <div className="bl-bar">
          <button type="button" className="bl-ghost bl-round" aria-label="Back" onClick={onBack}>
            <Back />
          </button>
          <span className="bl-label">Install · iPhone</span>
          <span style={{ width: 44 }} />
        </div>
        <div className="bl-rise" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h1 className="bl-h1">
            Backlot on your Home Screen in <i>three taps</i>
          </h1>
          <p className="bl-p bl-muted">Opens full screen like any app. No App Store. Use Safari.</p>
        </div>
        <ol className="bl-rise bl-d1" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column' }}>
          {steps.map((s, i) => (
            <li key={s.title} style={{ display: 'flex', gap: 16, paddingBottom: 22 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span className={`bl-avatar soft${i === 0 ? ' bl-live' : ''}`} style={{ width: 36, height: 36, background: 'var(--accent)', color: 'var(--accent-ink)' }}>
                  {i + 1}
                </span>
                <span className="bl-line" style={{ background: 'var(--accent)', marginTop: 4 }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 6 }}>
                <b style={{ fontWeight: 500, fontSize: 17 }}>{s.title}</b>
                <span className="bl-small">{s.hint}</span>
              </div>
            </li>
          ))}
          <li style={{ display: 'flex', gap: 16 }}>
            <span className="bl-avatar" style={{ width: 36, height: 36, color: 'var(--accent)' }}>
              <Check size={16} />
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 6 }}>
              <b style={{ fontWeight: 500, fontSize: 17 }}>Tap Add</b>
              <span className="bl-small">Top right corner. Done.</span>
            </div>
          </li>
        </ol>
        <div className="bl-wash bl-rise bl-d3" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="bl-label accent">One thing to know</span>
          <span style={{ lineHeight: 1.5 }}>
            Open Backlot from the new icon and sign in there once. The app keeps its own login, separate from Safari.
          </span>
        </div>
        <p className="bl-small">
          Android: tap <b>Install</b> when Chrome offers it, or open Chrome's menu and tap <b>Install app</b>.
        </p>
      </div>
    </main>
  );
}
