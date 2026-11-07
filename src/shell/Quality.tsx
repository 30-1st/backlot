import { useCallback, useEffect, useState } from 'react';
import { team, type Quality, type QualityScore } from '../lib/team';
import type { ScreenProps } from './Shell';
import { PageHead } from './Present';
import { Working } from './Working';

// The executive's Quality screen (approved Nov 4, 2026), opened from the gear beside the
// executive's photo. Only the executive sees the gear, and the server refuses everyone
// else, so nothing here reaches the team or clients. It shows the eval pipeline at work:
// the last gate run, the daily scores by agent, the weakest replies with the reasons,
// real signals from clients, cost and errors. Every reply is shown as plain text.

const AGENT: Record<string, string> = { bil: 'Bil', rein: 'Rein', kris: 'Kris', xev: 'Xev', plan: "Bil's plans" };
const pct = (n: number | null | undefined) => (n == null ? 'Not enough yet' : `${Math.round(n * 100)}%`);
const when = (s: string) => new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function QualityScreen({ me }: ScreenProps) {
  const [q, setQ] = useState<Quality | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await team.quality();
      // An answer in the wrong shape shows as an error instead of breaking the screen.
      if (!r || !Array.isArray(r.runs) || !r.spend) throw new Error('Quality came back incomplete. Try again in a minute.');
      setQ(r);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load Quality.');
    }
  }, []);
  useEffect(() => {
    if (me.role === 'owner') void load();
  }, [load, me.role]);

  if (me.role !== 'owner') {
    return (
      <main className="bl-flow">
        <h1 className="bl-h1">Not available</h1>
      </main>
    );
  }

  async function runNow() {
    setBusy(true);
    setNote('');
    try {
      const r = await team.qualityRun();
      setNote(r.queued ? 'Queued. The checks start within 5 minutes and take a few more; come back to see them.' : r.reason ?? 'Not queued.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not queue the checks.');
    } finally {
      setBusy(false);
    }
  }

  const gate = q?.lastGate ?? null;
  const running = q?.runs?.find((r) => r.status === 'running') ?? null;
  const lastGateRun = gate ? q!.runs?.find((r) => r.id === gate.id) ?? null : null;

  return (
    <main className="bl-flow bl-quality">
      <PageHead
        title="Quality"
        chip="Executive only"
        line="How well the agents are doing, checked on real work."
        how={
          <>
            <p>Every day Backlot scores the last day&rsquo;s real replies: free rules in code (voice, em dashes, length, numbers repeated or not in the agent&rsquo;s data) and a judge that grades each reply 1 to 5 against the agent&rsquo;s rubric. The judge only reads clients who agreed to it.</p>
            <p>When an agent&rsquo;s knowledge or prompt changes, the gate replays every saved test case and compares the scores with the last gate. A drop shows here as a warning.</p>
          </>
        }
        actions={
          <button type="button" className="bl-btn" disabled={busy || Boolean(running)} onClick={() => void runNow()}>
            {running ? 'Checks running' : busy ? 'Queuing' : 'Run the checks'}
          </button>
        }
      />
      {note && (
        <p className="bl-small" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}
      {!q && !error && (
        <Working label="Loading" />
      )}

      {q && (
        <>
          <section className="bl-glass-card bl-q-gate" aria-labelledby="q-gate">
            <h2 id="q-gate" className="bl-section-title">
              Last gate run
            </h2>
            {lastGateRun ? (
              <>
                <p className="bl-p" style={{ margin: 0 }}>
                  <span className={`bl-chip ${lastGateRun.status === 'passed' ? '' : 'warn'}`}>{lastGateRun.status === 'passed' ? 'Passed' : lastGateRun.status === 'warned' ? 'Warning: scores dropped' : lastGateRun.status}</span>{' '}
                  {when(lastGateRun.startedAt)} · {lastGateRun.scored ?? 0} cases · average {lastGateRun.avg ?? 'n/a'} of 5 · {pct(lastGateRun.failRate)} broke a rule
                  {lastGateRun.previous ? ` (last time ${lastGateRun.previous.avg ?? 'n/a'} and ${pct(lastGateRun.previous.failRate)})` : ''}
                </p>
                <ScoreList scores={gate!.scores.slice(0, 8)} />
              </>
            ) : (
              <p className="bl-small" style={{ margin: 0 }}>
                No gate run yet. It runs by itself the first time an agent changes, once there are test cases ({q.cases} saved so far, from real chats each day).
              </p>
            )}
          </section>

          <section className="bl-glass-card" aria-labelledby="q-agents">
            <h2 id="q-agents" className="bl-section-title">
              Daily scores by agent
            </h2>
            {Object.keys(q.trend ?? {}).length === 0 ? (
              <p className="bl-small" style={{ margin: 0 }}>
                The first daily sample runs within the hour and scores the last day&rsquo;s replies.
              </p>
            ) : (
              <div className="bl-q-agents">
                {Object.entries(q.trend ?? {}).map(([agent, days]) => {
                  const last = days[days.length - 1];
                  return (
                    <div key={agent} className="bl-q-agent">
                      <b>{AGENT[agent] ?? agent}</b>
                      <Spark days={days} />
                      <span className="bl-small">
                        {last.avg != null ? `${last.avg} of 5` : 'Rules only'} · {pct(last.failRate)} broke a rule · {last.n} scored
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="bl-glass-card" aria-labelledby="q-signals">
            <h2 id="q-signals" className="bl-section-title">
              Real signals, last 30 days
            </h2>
            <dl className="bl-q-signals">
              <div>
                <dt>Posts approved as written</dt>
                <dd>{pct(q.signals.approvalRate)}</dd>
              </div>
              <div>
                <dt>Posts sent back for changes</dt>
                <dd>{pct(q.signals.changeRate)}</dd>
              </div>
              <div>
                <dt>Xev replies used</dt>
                <dd>{pct(q.signals.xevUsedRate)}</dd>
              </div>
              <div>
                <dt>Xev chats that closed</dt>
                <dd>{pct(q.signals.xevClosedRate)}</dd>
              </div>
              <div>
                <dt>Chat turns with a chime-in</dt>
                <dd>{pct(q.signals.chimeRate)}</dd>
              </div>
              <div>
                <dt>Wins logged</dt>
                <dd>
                  {q.signals.wins}
                  {q.signals.winsUsd ? `, $${q.signals.winsUsd.toLocaleString()}` : ''}
                </dd>
              </div>
            </dl>
          </section>

          <section className="bl-glass-card" aria-labelledby="q-weak">
            <h2 id="q-weak" className="bl-section-title">
              Weakest replies this fortnight
            </h2>
            {q.weakest.length ? <ScoreList scores={q.weakest} /> : <p className="bl-small" style={{ margin: 0 }}>None flagged.</p>}
          </section>

          <section className="bl-glass-card" aria-labelledby="q-cost">
            <h2 id="q-cost" className="bl-section-title">
              Cost and errors
            </h2>
            {q.spend && (
              <p className="bl-p" style={{ margin: 0 }}>
                ${q.spend.used.toFixed(2)} of ${q.spend.cap.toFixed(0)} this month.{' '}
                {Object.entries(q.spend?.byAgent ?? {})
                  .sort((a, b) => b[1] - a[1])
                  .map(([a, v]) => `${a} $${Number(v).toFixed(2)}`)
                  .join(' · ')}
              </p>
            )}
            <p className="bl-small" style={{ margin: 0 }}>
              Last 7 days: {q.errors.failedCampaigns} failed {q.errors.failedCampaigns === 1 ? 'campaign' : 'campaigns'}, {q.errors.failedMeetings} failed {q.errors.failedMeetings === 1 ? 'meeting' : 'meetings'}. Eval runs cost ${q.runs.reduce((a, r) => a + r.costUsd, 0).toFixed(2)} in all.
            </p>
          </section>

          <section className="bl-glass-card" aria-labelledby="q-runs">
            <h2 id="q-runs" className="bl-section-title">
              Recent runs
            </h2>
            <ol className="bl-q-runs">
              {q.runs.slice(0, 10).map((r) => (
                <li key={r.id}>
                  <span>{r.kind === 'gate' ? 'Gate' : 'Daily sample'}</span>
                  <span className="bl-small">
                    {when(r.startedAt)} · {r.kind === 'daily' && r.status === 'passed' ? (r.avg != null ? `average ${r.avg} of 5` : 'scored') : r.status} · {r.scored ?? 0} scored · ${r.costUsd.toFixed(3)}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </main>
  );
}

/** A tiny line of daily average scores (1 to 5) for one agent. */
function Spark({ days }: { days: Array<{ avg: number | null; failRate: number }> }) {
  const pts = days.map((d, i) => ({ x: days.length === 1 ? 50 : (i / (days.length - 1)) * 100, y: d.avg == null ? null : 28 - ((d.avg - 1) / 4) * 24 }));
  const line = pts.filter((p) => p.y != null).map((p) => `${p.x.toFixed(1)},${p.y!.toFixed(1)}`).join(' ');
  return (
    <svg className="bl-q-spark" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={`Daily scores: ${days.map((d) => (d.avg == null ? 'none' : d.avg)).join(', ')}`}>
      <line x1="0" y1="28" x2="100" y2="28" className="bl-q-axis" />
      {line && <polyline points={line} className="bl-q-line" />}
      {pts.map((p, i) => p.y != null && <circle key={i} cx={p.x} cy={p.y} r="1.8" className="bl-q-dot" />)}
    </svg>
  );
}

/** Scored replies, weakest first, each opening to the full reply. */
function ScoreList({ scores }: { scores: QualityScore[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <ul className="bl-q-list">
      {scores.map((s, i) => (
        <li key={i}>
          <button type="button" className="bl-q-row" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
            <span className={`bl-q-score s${s.judge_score ?? 0}`}>{s.judge_score ?? '·'}</span>
            <span className="bl-q-text">
              <b>{s.label}</b>
              <small>{s.rule_fails.length ? s.rule_fails.join('; ') : s.judge_why ?? 'Rules passed'}</small>
            </span>
          </button>
          {open === i && (
            <div className="bl-q-open">
              {s.judge_why && <p className="bl-small">Judge: {s.judge_why}</p>}
              <p className="bl-q-output">{s.output ?? '(no reply)'}</p>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
