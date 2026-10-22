import { useEffect, useState } from 'react';
import { PLATFORMS, type Platform } from '../platforms';
import { listAccounts } from '../lib/library';
import { plural } from '../lib/format';
import { PlatformMark } from '../components/ui';
import { Back } from './icons';
import type { ScreenProps } from './Shell';

// Narrate: pick the platform whose profile you are telling the story of. Free, and no
// campaign needed. Opens the narration studio for that platform's accounts.

export function NarrateScreen({ go }: ScreenProps) {
  const [counts, setCounts] = useState<Partial<Record<Platform, number>>>({});

  useEffect(() => {
    let alive = true;
    for (const p of PLATFORMS) {
      if (!p.ready) continue;
      void listAccounts(p.id).then(
        (a) => alive && setCounts((prev) => ({ ...prev, [p.id]: a.length })),
        () => undefined,
      );
    }
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="bl-bar bl-rise" style={{ justifyContent: 'flex-start', gap: 12 }}>
        <button type="button" className="bl-ghost bl-round" aria-label="Back to Create" onClick={() => go('create')}>
          <Back />
        </button>
        <h1 className="bl-h1">
          <i>Narrate</i>
        </h1>
      </div>
      <p className="bl-p bl-muted bl-rise bl-d1">
        Tell the story of a profile, post by post. Free, and no campaign needed. Pick the platform you are narrating.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }} className="bl-rise bl-d2">
        {PLATFORMS.map((p) => {
          const n = counts[p.id] ?? 0;
          const body = (
            <>
              <span
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: p.ready ? 'var(--accent-wash)' : 'var(--mist)',
                  color: p.ready ? 'var(--accent-text)' : 'var(--ink-3)',
                }}
              >
                <PlatformMark platform={p.id} size={26} />
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <b style={{ fontSize: 17 }}>{p.name}</b>
                <span className={p.ready ? 'bl-label accent' : 'bl-label'}>
                  {!p.ready ? 'Coming soon' : n > 0 ? `${n} ${plural(n, 'account')}` : 'Start'}
                </span>
              </span>
            </>
          );
          return p.ready ? (
            <a
              key={p.id}
              href={`#${p.id}`}
              className="bl-card"
              style={{ minHeight: 160, justifyContent: 'space-between' }}
              onClick={(e) => {
                e.preventDefault();
                go(p.id);
              }}
            >
              {body}
            </a>
          ) : (
            <div key={p.id} className="bl-card" style={{ minHeight: 160, justifyContent: 'space-between', opacity: 0.7 }} aria-disabled="true">
              {body}
            </div>
          );
        })}
      </div>
    </main>
  );
}
