import { useState } from 'react';
import { bil } from '../lib/team';
import type { ScreenProps } from './Shell';

// Insights: what performs on the client's own page (the 24 hour dial, media against text,
// Bil's do and skip tips) and the voice Bil writes in. Measured by Bil from the client's
// public X posts; nothing here is learned from drafts.

type Group = { label: string; posts: number; medianScorePer1k: number | null };

const QUARTERS = [
  { key: 'night', name: 'Night', big: '12 to 6', small: 'AM' },
  { key: 'morning', name: 'Morning', big: '6 to 12', small: 'AM' },
  { key: 'afternoon', name: 'Afternoon', big: '12 to 6', small: 'PM' },
  { key: 'evening', name: 'Evening', big: '6 to 12', small: 'PM' },
] as const;
// Strongest to weakest.
const SHADES = ['var(--accent-text)', 'var(--accent)', 'rgba(var(--glow), 0.45)', 'rgba(var(--glow), 0.18)'];
const ARC = 107;
const GAP = 452.4 - ARC;

export function InsightsScreen({ ws, single, isTeam, go }: ScreenProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!ws.data) return <main aria-busy="true" />;
  const client = ws.data.clients.find((c) => c.id === single);
  const voice = ws.data.voices.find((v) => v.clientId === single);

  if (!client || !voice) {
    return (
      <main style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 className="bl-h1">Insights</h1>
        <div className="bl-empty">
          <b style={{ fontSize: 17 }}>Nothing measured yet.</b>
          <span className="bl-small">Insights appear once Bil has onboarded a client and read their page.</span>
          {isTeam && (
            <button type="button" className="bl-btn" onClick={() => go('bil')}>
              Onboard a client
            </button>
          )}
        </div>
      </main>
    );
  }

  const card = voice.card;
  const ww = card.whatWorks as
    | { summary?: string; doMore?: string[]; avoid?: string[]; measuredAt?: string; stats?: { postsMeasured?: number; groups?: Group[] } }
    | undefined;
  const groups: Group[] = ww?.stats?.groups ?? [];
  const find = (needle: string) => groups.find((g) => g.label.includes(needle));
  const quarters = QUARTERS.map((q) => ({ ...q, g: find(q.key) }));
  const ranked = [...quarters].filter((q) => q.g?.medianScorePer1k != null).sort((a, b) => b.g!.medianScorePer1k! - a.g!.medianScorePer1k!);
  const shade = (key: string) => {
    const r = ranked.findIndex((q) => q.key === key);
    return r < 0 ? 'var(--mist)' : SHADES[Math.min(3, r)];
  };
  const best = ranked[0];
  const thin = quarters.filter((q) => q.g && q.g.posts > 0 && q.g.posts < 3);
  const media = find('photo or video');
  const text = find('text only');
  const maxLevel = Math.max(media?.medianScorePer1k ?? 0, text?.medianScorePer1k ?? 0, 0.0001);
  const tz = String(client.profile?.timezone ?? '');

  async function refresh() {
    if (!window.confirm('Re-read the last posts and measure again? This costs about $0.25 from the monthly budget.')) return;
    setBusy(true);
    setError('');
    try {
      await bil.learn(client!.id);
      await ws.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not measure.');
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setBusy(true);
    setError('');
    try {
      await bil.approveVoice(client!.id);
      await ws.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="bl-rise" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1 className="bl-h1">
          What <i>works</i>
        </h1>
        <span className="bl-label">
          @{client.handle}
          {ww?.measuredAt
            ? ` · ${ww.stats?.postsMeasured ?? 0} posts · measured ${new Date(ww.measuredAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
            : ''}
          {tz ? ` · ${tz.replace(/_/g, ' ')}` : ''}
        </span>
      </div>

      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}

      {!ww ? (
        <div className="bl-empty">
          <b style={{ fontSize: 17 }}>Not measured yet.</b>
          <span className="bl-small">Bil reads the latest public posts and finds what this audience rewards.</span>
          {isTeam && (
            <button type="button" className="bl-btn" disabled={busy} onClick={() => void refresh()}>
              {busy ? 'Measuring' : 'Measure now (about $0.25)'}
            </button>
          )}
        </div>
      ) : (
        <>
          {ww.summary && <p className="bl-p bl-rise bl-d1" style={{ fontSize: 16 }}>{ww.summary}</p>}

          {ranked.length > 0 && (
            <section className="bl-card bl-rise bl-d1" aria-labelledby="dial-t">
              <h2 id="dial-t" className="bl-sr">
                Score by time of day
              </h2>
              <div className="bl-dial-row">
                <div className="bl-dial">
                  <svg
                    width="180"
                    height="180"
                    viewBox="0 0 180 180"
                    role="img"
                    aria-label={`24 hour dial. ${quarters.map((q) => `${q.name} ${q.g?.medianScorePer1k ?? 'no posts'}`).join(', ')}.`}
                  >
                    <circle cx="90" cy="90" r="72" fill="none" stroke="var(--mist)" strokeWidth="18" />
                    <g transform="rotate(-90 90 90)" fill="none" strokeWidth="18">
                      {quarters.map((q, i) => (
                        <circle
                          key={q.key}
                          className="arc"
                          cx="90"
                          cy="90"
                          r="72"
                          stroke={shade(q.key)}
                          strokeDasharray={`${ARC} ${GAP}`}
                          strokeDashoffset={-(3 + i * 113.1)}
                          style={{ animationDelay: `${i * 0.12}s` }}
                        />
                      ))}
                    </g>
                    {[
                      ['12A', 90, 12, 'middle'],
                      ['6A', 177, 93, 'end'],
                      ['12P', 90, 177, 'middle'],
                      ['6P', 3, 93, 'start'],
                    ].map(([t, x, y, a]) => (
                      <text key={t as string} x={x as number} y={y as number} textAnchor={a as 'middle'} fontSize="9" fontWeight="600" fill="var(--ink-2)">
                        {t}
                      </text>
                    ))}
                  </svg>
                  {best && (
                    <div className="bl-dial-center">
                      <span className="bl-label">Best</span>
                      <strong>{best.big}</strong>
                      <span className="bl-small">{best.small}</span>
                    </div>
                  )}
                </div>
                <div className="bl-legend">
                  {[...quarters]
                    .sort((a, b) => (b.g?.medianScorePer1k ?? -1) - (a.g?.medianScorePer1k ?? -1))
                    .map((q) => (
                      <div key={q.key}>
                        <span className="bl-swatch" style={{ background: shade(q.key), border: '1px solid var(--line)' }} />
                        <span style={{ flexGrow: 1, fontWeight: q === best ? 600 : 400 }}>{q.name}</span>
                        <span style={{ fontWeight: q === best ? 600 : 400 }}>{q.g?.medianScorePer1k ?? '·'}</span>
                      </div>
                    ))}
                  {thin.length > 0 && (
                    <span className="bl-small" style={{ fontSize: 11 }}>
                      {thin.map((q) => q.name).join(' and ')} {thin.length === 1 ? 'has' : 'have'} under 3 posts. Treat as a hint.
                    </span>
                  )}
                </div>
              </div>
            </section>
          )}

          {media && text && (
            <section className="bl-rise bl-d2" style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-labelledby="lv-t">
              <h2 id="lv-t" className="bl-h2" style={{ fontSize: 15 }}>
                Photo or video vs text only
              </h2>
              {[
                { name: 'With media', g: media, color: 'var(--accent)' },
                { name: 'Text only', g: text, color: 'var(--ink-3)' },
              ].map((l) => (
                <div key={l.name} className="bl-level">
                  <span>{l.name}</span>
                  <span className="bl-level-track">
                    <span style={{ width: `${Math.round(((l.g.medianScorePer1k ?? 0) / maxLevel) * 100)}%`, background: l.color }} />
                  </span>
                  <span style={{ textAlign: 'right', fontWeight: 600 }}>{l.g.medianScorePer1k ?? '·'}</span>
                </div>
              ))}
              <span className="bl-small">Score: likes, replies, reposts and quotes per 1,000 views, weighted the way X ranks posts.</span>
            </section>
          )}

          {Boolean(ww.doMore?.length || ww.avoid?.length) && (
            <ul className="bl-tips bl-rise bl-d3">
              {(ww.doMore ?? []).map((t) => (
                <li key={`d${t}`}>
                  <span className="bl-label accent tag">Do</span>
                  {t}
                </li>
              ))}
              {(ww.avoid ?? []).map((t) => (
                <li key={`a${t}`}>
                  <span className="bl-label tag" style={{ color: 'var(--danger)' }}>
                    Skip
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          )}

          {isTeam && (
            <button type="button" className="bl-ghost bl-start" disabled={busy} onClick={() => void refresh()}>
              {busy ? 'Measuring, about a minute' : 'Measure again (about $0.25)'}
            </button>
          )}
        </>
      )}

      <section className="bl-card" style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 className="bl-h2">The voice Bil writes in</h2>
          <span className={`bl-chip ${voice.approved ? 'approved' : 'needs'}`}>{voice.approved ? 'Approved' : 'Needs you'}</span>
        </div>
        {card.summary && <p className="bl-p">{String(card.summary)}</p>}
        {Array.isArray(card.wordsTheyUse) && card.wordsTheyUse.length > 0 && (
          <span className="bl-small">
            <b>Words used:</b> {card.wordsTheyUse.slice(0, 12).join(', ')}
          </span>
        )}
        {Array.isArray(card.offLimits) && card.offLimits.length > 0 && (
          <span className="bl-small">
            <b>Off limits:</b> {card.offLimits.slice(0, 8).join('; ')}
          </span>
        )}
        {!voice.approved && (
          <button type="button" className="bl-btn bl-start" disabled={busy} onClick={() => void approve()}>
            {isTeam ? 'Approve for the client' : 'This sounds like me'}
          </button>
        )}
      </section>
    </main>
  );
}
