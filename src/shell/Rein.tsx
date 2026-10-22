import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { DoorError, team, type ReinBrief, type ReinRegion } from '../lib/team';
import { Radar } from './icons';
import type { ScreenProps } from './Shell';

// Rein: search what is rising in any niche. Topics only, never people. A search that
// reuses a check from the last 6 hours is free. Clients get 3 free searches; after that it
// is $5 a search or $15 a month (payments open soon). The team searches inside the budget.

const REGIONS: Array<[ReinRegion, string]> = [
  ['worldwide', 'Worldwide'],
  ['us', 'US'],
  ['uk', 'UK'],
  ['canada', 'Canada'],
];

function Momentum({ m }: { m: string }) {
  const word = m === 'rising' ? 'Rising' : m === 'peaking' ? 'Peaking' : m === 'fading' ? 'Fading' : m;
  return <span className={`bl-chip-ink${m === 'rising' ? ' next' : ''}`}>{word}</span>;
}

function Results({ brief }: { brief: ReinBrief }) {
  if (brief.trends.length === 0) {
    return (
      <div className="bl-glass-card">
        <b>Nothing real is rising right now</b>
        <span className="bl-small">{brief.notFound ?? 'Try a broader niche, or check again later today.'}</span>
      </div>
    );
  }
  return (
    <ol className="bl-trends">
      {brief.trends.map((t, i) => (
        <li key={`${t.topic}-${i}`} className="bl-glass-card bl-in" style={{ animationDelay: `${i * 80}ms` }}>
          <div className="bl-slot-row">
            <b className="bl-trend-topic">{t.topic}</b>
            <Momentum m={t.momentum} />
          </div>
          <p className="bl-p" style={{ margin: 0 }}>
            {t.summary}
          </p>
          {t.whyNow && <p className="bl-small" style={{ margin: 0 }}>Why now: {t.whyNow}</p>}
          {t.hashtags.length > 0 && (
            <div className="bl-filters">
              {t.hashtags.map((h) => (
                <span key={h} className="bl-chip-ink">
                  {h}
                </span>
              ))}
            </div>
          )}
          {t.touchesFinance && <p className="bl-small" style={{ margin: 0 }}>About money or an asset. Education only, never financial advice.</p>}
          {t.sources.length > 0 && (
            <div className="bl-row-actions">
              {t.sources.map((src) => (
                <a key={src.url} className="bl-linkish" href={src.url} target="_blank" rel="noopener noreferrer">
                  {src.title ?? new URL(src.url).hostname.replace(/^www\./, '')}
                </a>
              ))}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function Paywall({ niche, onClose }: { niche: string; onClose: () => void }) {
  const [plan, setPlan] = useState<'one' | 'month'>('one');
  const host = document.querySelector('.bl-root') ?? document.body;
  return createPortal(
    <div className="bl-sheet-back" onClick={onClose}>
      <section className="bl-sheet" role="dialog" aria-modal="true" aria-labelledby="pay-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="pay-title" className="bl-sheet-title">
          Keep searching
        </h2>
        <p className="bl-small" style={{ margin: 0 }}>
          You have used your 3 free searches. Nothing is charged until you confirm.
        </p>
        <div role="radiogroup" aria-label="How to pay" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(
            [
              ['one', 'This search', niche ? `Pay once for ${niche}` : 'Pay once', '$5'],
              ['month', 'Monthly', 'Search as often as you like. Cancel any time.', '$15/mo'],
            ] as const
          ).map(([k, title, body, price]) => (
            <button key={k} type="button" role="radio" aria-checked={plan === k} className={`bl-plan${plan === k ? ' pick' : ''}`} onClick={() => setPlan(k)}>
              <span className="bl-radio" />
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' }}>
                <b>{title}</b>
                <span className="bl-small">{body}</span>
              </span>
              <b className="num">{price}</b>
            </button>
          ))}
        </div>
        <button type="button" className="bl-btn bl-wide" disabled>
          Payments open soon
        </button>
        <button type="button" className="bl-ghost" onClick={onClose}>
          Not now
        </button>
      </section>
    </div>,
    host,
  );
}

export function ReinScreen({ isTeam }: ScreenProps) {
  const [niche, setNiche] = useState('');
  const [region, setRegion] = useState<ReinRegion>('worldwide');
  const [freeLeft, setFreeLeft] = useState<number | null>(null);
  const [brief, setBrief] = useState<ReinBrief | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [paywall, setPaywall] = useState(false);

  useEffect(() => {
    team.reinHistory().then(
      (h) => {
        setFreeLeft(h.freeLeft);
        if (h.last) setBrief(h.last);
      },
      () => undefined,
    );
  }, []);

  async function search() {
    const n = niche.trim();
    if (n.length < 2) return;
    if (!isTeam && freeLeft === 0) {
      setPaywall(true);
      return;
    }
    setSearching(true);
    setError('');
    try {
      const r = await team.reinSearch(n, region);
      setBrief(r.brief);
      const h = await team.reinHistory();
      setFreeLeft(h.freeLeft);
    } catch (e) {
      if (e instanceof DoorError && e.pay) {
        setFreeLeft(0);
        setPaywall(true);
      } else setError(e instanceof Error ? e.message : 'Rein could not search right now.');
    } finally {
      setSearching(false);
    }
  }

  return (
    <main className="bl-flow">
      <div className="bl-rein-hero bl-in">
        <span className="bl-home-logo">
          <Radar size={52} />
        </span>
        <span className="bl-home-pool" aria-hidden="true" />
      </div>
      <form
        className="bl-flow-step"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <label className="bl-flow-q" htmlFor="niche">
          What niche or topic?
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input id="niche" className="bl-input" type="search" maxLength={200} value={niche} placeholder="For example: home fitness" onChange={(e) => setNiche(e.target.value)} />
          <button type="submit" className="bl-btn" disabled={searching || niche.trim().length < 2}>
            {searching ? 'Looking' : 'Search'}
          </button>
        </div>
        <div className="bl-filters" role="group" aria-label="Where">
          {REGIONS.map(([v, l]) => (
            <button key={v} type="button" className="bl-tagchip" aria-pressed={region === v} onClick={() => setRegion(v)}>
              {l}
            </button>
          ))}
        </div>
        {isTeam ? (
          <span className="bl-small">Searches use the team's AI budget. A niche checked in the last 6 hours is free.</span>
        ) : (
          freeLeft !== null && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <span className="bl-pips" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <i key={i} className={i < freeLeft ? 'on' : undefined} />
                  ))}
                </span>
                <span className="bl-small num">{freeLeft} of 3 free left</span>
              </div>
              <span className="bl-small">After that, $5 a search or $15 a month. A niche checked in the last 6 hours is always free.</span>
            </>
          )
        )}
      </form>

      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}

      {searching ? (
        <section className="bl-rein-wait" aria-live="polite">
          <div className="bl-radar" aria-hidden="true">
            <i />
            <i />
            <b />
          </div>
          <b>Looking at {niche.trim()}</b>
          <span className="bl-small">Usually under a minute.</span>
        </section>
      ) : (
        brief && (
          <section aria-labelledby="found">
            <h2 id="found" className="bl-section-title">
              {brief.niche ? `Rising in ${brief.niche}` : 'Last search'}
              <span className="num">{brief.createdAt ? new Date(brief.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</span>
            </h2>
            <Results brief={brief} />
          </section>
        )
      )}

      {paywall && <Paywall niche={niche.trim()} onClose={() => setPaywall(false)} />}
    </main>
  );
}
