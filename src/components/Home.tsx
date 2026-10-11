import { useEffect, useState } from 'react';
import { PLATFORMS, type Platform } from '../platforms';
import { listAccounts } from '../lib/library';
import { plural } from '../lib/format';
import { Logo, PlatformMark } from './ui';

/** A stage flat in outline, the same shape as the logo, drawn large and faint in the wings. */
function Flat({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.1" vectorEffect="non-scaling-stroke">
        <path d="M17 8.5 25 23.5H17" vectorEffect="non-scaling-stroke" />
        <rect x="3.5" y="4.5" width="13.5" height="19" vectorEffect="non-scaling-stroke" />
        <rect x="7.6" y="9" width="5.3" height="6.2" vectorEffect="non-scaling-stroke" />
        <path d="M3.5 19.2H17" vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  );
}

/** The quiet stage behind the homescreen and the sign-in screen. */
export function Backdrop() {
  return (
    <div className="home-backdrop" aria-hidden="true">
      <Flat className="wing wing-l1" />
      <Flat className="wing wing-l2" />
      <Flat className="wing wing-r1" />
      <Flat className="wing wing-r2" />
      <i className="home-pool" />
    </div>
  );
}

export function Home({
  onChoose,
  username,
  onSignOut,
}: {
  onChoose: (platform: Platform) => void;
  /** Set in the hosted build, where a creator is signed in. */
  username?: string;
  onSignOut?: () => void;
}) {
  const [counts, setCounts] = useState<Partial<Record<Platform, number>>>({});

  useEffect(() => {
    let alive = true;
    for (const p of PLATFORMS) {
      if (!p.ready) continue;
      void listAccounts(p.id).then(
        (accounts) => {
          if (alive) setCounts((prev) => ({ ...prev, [p.id]: accounts.length }));
        },
        () => undefined,
      );
    }
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className="home">
      <Backdrop />

      {onSignOut && (
        <div className="who">
          <span>@{username}</span>
          <button type="button" className="btn quiet sm" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      )}

      <div className="home-in">
        <div className="home-logo">
          <Logo size={112} />
        </div>
        <h1>Backlot</h1>
        <p className="home-line">Choose the profile you are narrating.</p>

        <div className="home-marks">
          <i className="mark tl" />
          <i className="mark tr" />
          <i className="mark bl" />
          <i className="mark br" />
          <ul className="platforms">
          {PLATFORMS.map((p) => {
            const count = counts[p.id] ?? 0;
            const body = (
              <>
                <span className="platform-mark">
                  <PlatformMark platform={p.id} size={34} />
                </span>
                <b>{p.name}</b>
                <span className="platform-state">
                  {!p.ready ? 'Coming soon' : count > 0 ? `${count} ${plural(count, 'account')}` : 'Start'}
                </span>
              </>
            );
            return (
              <li key={p.id}>
                {p.ready ? (
                  <button type="button" className="platform" onClick={() => onChoose(p.id)}>
                    {body}
                  </button>
                ) : (
                  <div className="platform is-soon" aria-disabled="true">
                    {body}
                  </div>
                )}
              </li>
            );
          })}
          </ul>
        </div>
      </div>
    </main>
  );
}
