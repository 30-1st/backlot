import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { bil } from '../lib/team';
import type { ScreenProps } from './Shell';
import { DEFAULT_DIALS, DIALS, type Dials } from '../lib/dials';

// Monthly reports: how each month went on X, from X's own public numbers. Code works out
// every number; Bil writes the plain-words part. The team makes them; clients read them.

type Numbers = {
  month: string;
  timezone: string;
  complete: boolean;
  posts: number;
  truncated: boolean;
  withMedia: number;
  impressions: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  bookmarks: number;
  engagementRate: number | null;
  medianImpressions: number | null;
  bestWindow: string | null;
  top: Array<{ postId: string; score: number; impressions: number; replies: number; quotes: number; reposts: number; likes: number }>;
  backlotPosted: number;
  previous: { posts: number; impressions: number; engagementRate: number | null } | null;
  /** Dial upgrade 4: levels that beat the setting in tests, from this month and the two before. */
  dialSuggestions?: Array<{ dial: keyof Dials; from: number; to: number; testPosts: number; basePosts: number; liftPct: number }>;
};
type Summary = { headline: string; worked: string[]; tryNext: string[] };
type Report = { id: string; month: string; numbers: Numbers; summary: Summary | null; costUsd: number; createdAt: string };

const fmt = (n: number) => new Intl.NumberFormat(undefined, { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
const monthName = (ym: string) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** This month and the five before it, newest first, as YYYY-MM. */
function recentMonths(): string[] {
  const d = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    return x.toISOString().slice(0, 7);
  });
}

function Change({ now, before, unit = '' }: { now: number | null; before: number | null | undefined; unit?: string }) {
  if (now === null || before === null || before === undefined) return null;
  const d = Math.round((now - before) * 100) / 100;
  if (d === 0) return <span className="bl-small">same as last month</span>;
  return (
    <span className={`bl-small${d < 0 ? ' bl-down' : ' bl-up'}`}>
      {d > 0 ? '+' : ''}
      {unit === '%' ? `${d} pts` : fmt(d)} vs last month
    </span>
  );
}

export function ReportsScreen({ ws, single, isTeam }: ScreenProps) {
  const client = ws.data?.clients.find((c) => c.id === single) ?? null;
  const [reports, setReports] = useState<Report[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [month, setMonth] = useState(recentMonths()[1]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!supabase || !client) return;
    const { data, error: e } = await supabase
      .from('client_reports')
      .select('id, month, numbers, summary, cost_usd, created_at')
      .eq('client_id', client.id)
      .order('month', { ascending: false })
      .limit(24);
    if (e) return setError(e.message);
    const list: Report[] = (data ?? []).map((r) => ({ id: r.id, month: String(r.month).slice(0, 7), numbers: r.numbers as Numbers, summary: (r.summary as Summary | null) ?? null, costUsd: Number(r.cost_usd), createdAt: r.created_at }));
    setReports(list);
    setOpen((o) => o ?? list[0]?.month ?? null);
  }, [client]);

  useEffect(() => {
    setReports(null);
    setOpen(null);
    void load();
  }, [load]);

  if (!client) {
    return (
      <main className="bl-flow">
        <h1 className="bl-h1 bl-rise">Reports</h1>
        <p className="bl-p bl-muted">Pick a client first.</p>
      </main>
    );
  }

  const postsPerWeek = Number((client.profile as { postsPerWeek?: unknown }).postsPerWeek ?? 5) || 5;
  const guessPosts = Math.min(100, Math.round(postsPerWeek * 4.3));
  const estimate = Math.round((guessPosts * 0.005 + 0.03) * 100) / 100;
  const exists = reports?.some((r) => r.month === month);

  async function make() {
    setBusy(true);
    setError('');
    try {
      await bil.report(client!.id, month);
      setOpen(month);
      setConfirming(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bil could not make the report right now.');
    } finally {
      setBusy(false);
    }
  }

  const shown = reports?.find((r) => r.month === open) ?? null;

  return (
    <main className="bl-flow">
      <div>
        <h1 className="bl-h1 bl-rise">Reports</h1>
        <p className="bl-small" style={{ margin: '6px 0 0' }}>
          {isTeam ? `@${client.handle}. ` : ''}How each month went on X, from X&rsquo;s own public numbers for original posts. Bil writes the summary; the numbers are worked out in code.
        </p>
      </div>

      {isTeam && (
        <section className="bl-glass-card bl-brand-group" aria-labelledby="make-t">
          <h2 id="make-t" className="bl-section-title">
            Make a report
          </h2>
          <label className="bl-field">
            <span className="bl-label">Month</span>
            <select className="bl-input" value={month} onChange={(e) => (setMonth(e.target.value), setConfirming(false))}>
              {recentMonths().map((m, i) => (
                <option key={m} value={m}>
                  {monthName(m)}
                  {i === 0 ? ' (so far)' : ''}
                </option>
              ))}
            </select>
          </label>
          {confirming ? (
            <div className="bl-wash" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span>
                About ${estimate.toFixed(2)} from this month&rsquo;s AI budget: $0.005 for each post X returns (around {guessPosts} at {postsPerWeek} a week, 100 at most) and one Bil call. {exists ? 'It replaces the report already saved for that month.' : ''}
              </span>
              <div className="bl-row-actions">
                <button type="button" className="bl-ghost" disabled={busy} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button type="button" className="bl-btn" disabled={busy} onClick={() => void make()}>
                  {busy ? 'Bil is reading the month' : 'Make it'}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="bl-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setConfirming(true)}>
              {exists ? 'Make it again' : 'Make the report'} (about ${estimate.toFixed(2)})
            </button>
          )}
        </section>
      )}

      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}

      {reports === null && !error && <p className="bl-small" aria-busy="true">Loading reports.</p>}
      {reports?.length === 0 && (
        <div className="bl-glass-card">
          <b>No reports yet</b>
          <p className="bl-p bl-muted" style={{ margin: 0 }}>
            {isTeam ? 'Make the first one above. Last month is picked already.' : 'Your team sends a report each month. It shows up here.'}
          </p>
        </div>
      )}

      {reports && reports.length > 1 && (
        <div className="bl-filters" role="group" aria-label="Month">
          {reports.map((r) => (
            <button key={r.month} type="button" className="bl-tagchip" aria-pressed={open === r.month} onClick={() => setOpen(r.month)}>
              {monthName(r.month)}
            </button>
          ))}
        </div>
      )}

      {shown && <ReportView r={shown} isTeam={isTeam} clientId={client.id} dials={{ ...DEFAULT_DIALS, ...((client.profile.dials as Partial<Dials> | undefined) ?? {}) }} refresh={ws.refresh} />}
    </main>
  );
}

/**
 * Dial upgrade 4. A tested level that beat the setting is offered to the client, who says
 * yes here; like any client edit to the brand kit, it then waits for the team's OK.
 */
function DialTests({ r, isTeam, clientId, dials, refresh }: { r: Report; isTeam: boolean; clientId: string; dials: Dials; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const list = (r.numbers.dialSuggestions ?? []).filter((x) => DIALS.some((d) => d.key === x.dial));
  if (!list.length) return null;
  const name = (k: keyof Dials) => DIALS.find((d) => d.key === k)?.name ?? k;
  async function use(dial: keyof Dials, to: number) {
    setBusy(dial);
    setError('');
    try {
      const r2 = await bil.brandSave(clientId, { dials: { ...dials, [dial]: to } });
      await refresh();
      setNote(r2.waiting ? 'Sent. Your team will OK it, then Bil writes to the new level.' : 'Saved. Bil writes to the new level from the next plan.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the change.');
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="bl-glass-card" aria-labelledby={`d-${r.id}`}>
      <b id={`d-${r.id}`}>What the dial tests found</b>
      <span className="bl-small">About one post in five tries one dial a notch off the setting. These levels did better on your posts.</span>
      <ul className="bl-report-list">
        {list.map((x) => (
          <li key={x.dial} className="bl-dial-lift">
            <span>
              {name(x.dial)} at {x.to} beat {x.from} by {x.liftPct}% ({x.testPosts} test posts against {x.basePosts} at the setting).
            </span>
            {dials[x.dial] === x.to ? (
              <span className="bl-small">Already set to {x.to}.</span>
            ) : isTeam ? (
              <span className="bl-small">The client can switch to it from their Reports.</span>
            ) : (
              <button type="button" className="bl-ghost" disabled={!!busy} onClick={() => void use(x.dial, x.to)}>
                {busy === x.dial ? 'Sending' : `Use ${name(x.dial)} ${x.to}`}
              </button>
            )}
          </li>
        ))}
      </ul>
      {note && (
        <p className="bl-small" role="status" style={{ margin: 0 }}>
          {note}
        </p>
      )}
      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function ReportView({ r, isTeam, clientId, dials, refresh }: { r: Report; isTeam: boolean; clientId: string; dials: Dials; refresh: () => Promise<void> }) {
  const n = r.numbers;
  const tiles: Array<[string, string, React.ReactNode]> = [
    ['Posts', fmt(n.posts), <Change key="p" now={n.posts} before={n.previous?.posts} />],
    ['Views', fmt(n.impressions), <Change key="v" now={n.impressions} before={n.previous?.impressions} />],
    ['Engagement', n.engagementRate === null ? 'No views yet' : `${n.engagementRate}%`, <Change key="e" now={n.engagementRate} before={n.previous?.engagementRate} unit="%" />],
    ['Replies', fmt(n.replies), null],
    ['Quotes', fmt(n.quotes), null],
    ['Reposts', fmt(n.reposts), null],
    ['Likes', fmt(n.likes), null],
    ['Bookmarks', fmt(n.bookmarks), null],
  ];
  const [full, setFull] = useState(false);
  const best = n.top[0];
  const viewsChange = n.previous && n.previous.impressions > 0 ? Math.round(((n.impressions - n.previous.impressions) / n.previous.impressions) * 100) : null;
  const short: Array<[string, string]> = [];
  if (r.summary?.headline) short.push(['Top win', r.summary.headline]);
  if (best) short.push(['Best post', `${fmt(best.impressions)} views, ${fmt(best.replies)} replies, ${fmt(best.quotes)} quotes`]);
  if (r.summary?.worked[0]) short.push(['Do more of', r.summary.worked[0]]);
  if (viewsChange !== null) short.push(['Against last month', `Views ${viewsChange >= 0 ? 'up' : 'down'} ${Math.abs(viewsChange)}%`]);
  if (r.summary?.tryNext[0]) short.push(['Next step', r.summary.tryNext[0]]);
  return (
    <article className="bl-report">
      <div>
        <h2 className="bl-h2" style={{ margin: 0 }}>
          {monthName(n.month)}
          {!n.complete && ' so far'}
        </h2>
      </div>

      {short.length > 0 && (
        <dl className="bl-report-short">
          {short.slice(0, 5).map(([k, v]) => (
            <div key={k}>
              <dt className="bl-label">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <button type="button" className="bl-ghost bl-start" aria-expanded={full} onClick={() => setFull((f) => !f)}>
        {full ? 'Show the short version' : 'See the full report'}
      </button>
      {full && (
      <>

      <dl className="bl-report-tiles">
        {tiles.map(([label, value, change]) => (
          <div key={label} className="bl-report-tile">
            <dt className="bl-label">{label}</dt>
            <dd className="num">{value}</dd>
            {change && <dd>{change}</dd>}
          </div>
        ))}
      </dl>
      <p className="bl-small" style={{ margin: 0 }}>
        Engagement is replies, quotes, reposts and likes per 100 views. {n.bestWindow ? `Posts did best in the ${n.bestWindow}. ` : ''}
        {n.backlotPosted ? `${n.backlotPosted} ${n.backlotPosted === 1 ? 'post' : 'posts'} from Backlot campaigns were marked posted. ` : ''}
        {n.truncated ? 'Only the first 100 posts were read. ' : ''}Times in {n.timezone}.
      </p>

      {n.top.length > 0 && (
        <section className="bl-glass-card" aria-labelledby={`top-${r.id}`}>
          <b id={`top-${r.id}`}>Top posts</b>
          <ol className="bl-report-top">
            {n.top.map((t) => (
              <li key={t.postId}>
                <a className="bl-linkish" href={`https://x.com/i/status/${t.postId}`} target="_blank" rel="noopener noreferrer">
                  Open on X
                </a>
                <span className="bl-small num">
                  {fmt(t.impressions)} views · {fmt(t.replies)} replies · {fmt(t.quotes)} quotes · {fmt(t.reposts)} reposts · {fmt(t.likes)} likes
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {r.summary && r.summary.worked.length > 0 && (
        <section className="bl-glass-card" aria-labelledby={`w-${r.id}`}>
          <b id={`w-${r.id}`}>What worked</b>
          <ul className="bl-report-list">
            {r.summary.worked.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      )}
      {r.summary && r.summary.tryNext.length > 0 && (
        <section className="bl-glass-card" aria-labelledby={`t-${r.id}`}>
          <b id={`t-${r.id}`}>Try next month</b>
          <ul className="bl-report-list">
            {r.summary.tryNext.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      )}
      <DialTests r={r} isTeam={isTeam} clientId={clientId} dials={dials} refresh={refresh} />
      </>
      )}
      {n.posts === 0 && <p className="bl-small">No original posts that month, so there is nothing to report.</p>}
      <p className="bl-small" style={{ margin: 0 }}>
        Made {new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        {isTeam ? ` · cost $${r.costUsd.toFixed(2)}` : ''}
      </p>
    </article>
  );
}
