import { Vault } from './icons';
import type { ScreenProps } from './Shell';

// The Library (media vault and tagging) is the next roadmap item. Until then this screen
// says so plainly and points to what works today.

export function LibraryScreen({ go }: ScreenProps) {
  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 className="bl-h1 bl-rise">Library</h1>
      <div className="bl-empty bl-rise bl-d1">
        <span style={{ color: 'var(--accent-text)' }}>
          <Vault size={32} />
        </span>
        <b style={{ fontSize: 17 }}>Your media vault is coming next.</b>
        <span className="bl-small">
          You will upload photos and videos here and tag them, so Bil plans every campaign around what you really have.
          For now, narrations keep their own media.
        </span>
        <button type="button" className="bl-ghost accent" onClick={() => go('narrate')}>
          Open narrations
        </button>
      </div>
    </main>
  );
}
