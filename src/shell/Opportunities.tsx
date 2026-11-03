import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { bil, DoorError, team, type Me, type MeetingRegion } from '../lib/team';
import type { Workspace } from './data';
import { Radar } from './icons';

// Opportunities: Rein's Opportunity Meeting, inside Rein in the Playground. For everyone
// except the team (decided Nov 2, 2026): clients get 1 free a month, the executive runs any,
// casual users once payments open. The meeting runs on the server in stages; this screen
// reads its row (Rein's steps while she works, then the finished meeting) and shows it one
// slide at a time, with a PDF export. Rein does not follow up.

type Basis = 'measured' | 'estimated' | 'unknown';
type Figure = { label: string; value: string; low?: number; high?: number; unit?: string; basis: Basis; math?: string; sourceIds: string[] };
type Profile = { name: string; job: string; paysFor: string[]; products: string[]; ignores: string[]; spend?: string; stays?: string; sourceIds: string[] };
type CostLine = { line: string; name: string; perHundred: number | null; basis: Basis; math?: string; sourceIds: string[] };
type CostStack = { lines: CostLine[]; knownTotal: number; complete: boolean; kept: number | null };
type Slide = { key: string; title: string; headline: string; body: string; figures: Figure[]; points: string[]; profiles: Profile[]; moves: Array<{ move: string; why: string; forBil: boolean }>; costStack?: CostStack };
type SourceRef = { id: string; kind: 'web' | 'x'; title: string; publisher: string; published: string; rung: number; url: string | null };
type MeetingDoc = {
  version: number; market: string; marketName: string; region: MeetingRegion; kind: string; title: string; headline: string;
  adult: boolean; reusedMarket: boolean; score?: { passed: number; of: number; missing: string[] }; slides: Slide[]; sources: SourceRef[]; skipped: Array<{ section: string; why: string }>; note: string; createdAt: string;
};
type Row = {
  id: string; status: 'queued' | 'working' | 'ready' | 'failed'; market_input: string; market_name: string | null; region: MeetingRegion;
  steps: Array<{ label: string; done: boolean }>; error: string | null; created_at: string; ready_at: string | null; kind: string; meeting: MeetingDoc | null;
};

const REGION_LABEL: Record<MeetingRegion, string> = { us: 'US', uk: 'UK', canada: 'Canada' };
const RUNG_LABEL = ['', 'Primary source', 'Research or press', 'Survey', 'Lead'];
const SECTION_NAME: Record<string, string> = {
  opportunity: 'The opportunity', size: 'The size', money: 'The money', cost_to_100: 'The cost to make $100', buyers: 'Who pays',
  prices: 'The price ladder', crowding: 'How crowded it is', timing: 'Timing', first_dollar: 'Time to first dollar', startup_kit: 'Startup kit',
  platforms: 'Where the money lives', converts: 'What converts', way_in: 'How to get in', exit: 'The exit', launch_pads: 'Launch pads',
  risks: 'Risks', fit: 'Your fit', custom: 'Worth knowing',
};
const BASIS_LABEL: Record<Basis, string> = { measured: 'Measured', estimated: 'Estimated', unknown: 'Unknown' };

export function OpportunitiesPanel({ me, ws, single, openId, go }: { me: Me; ws: Workspace | null; single: string | null; openId: string | null; go: (p: string) => void }) {
  const clientId = me.role === 'client' ? me.clientId : null;
  const niche = useMemo(() => {
    const c = ws?.clients.find((x) => x.id === (clientId ?? single));
    return clientId ? String((c?.profile as { niche?: unknown } | undefined)?.niche ?? '') : '';
  }, [ws, clientId, single]);
  const [market, setMarket] = useState('');
  const [region, setRegion] = useState<MeetingRegion>('us');
  const [allow, setAllow] = useState<{ freeLeft: boolean | null; canRun: boolean; available: boolean } | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(openId);
  const [editing, setEditing] = useState(false);

  useEffect(() => setMarket((m) => m || niche), [niche]);
  useEffect(() => setOpen(openId), [openId]);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('opportunity_meetings')
      .select('id, status, market_input, market_name, region, steps, error, created_at, ready_at, kind, meeting')
      .order('created_at', { ascending: false })
      .limit(20);
    setRows((data as Row[] | null) ?? []);
  }, []);

  useEffect(() => {
    void load();
    team.opportunityAllowance().then(setAllow, () => setAllow({ freeLeft: null, canRun: false, available: me.role !== 'team' }));
  }, [load, me.role]);

  // While a meeting is running, check on it every few seconds.
  const running = (rows ?? []).filter((r) => r.status === 'queued' || r.status === 'working');
  useEffect(() => {
    if (!running.length) return;
    const t = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(t);
  }, [running.length, load]);

  async function start() {
    const m = market.trim();
    if (m.length < 2 || busy) return;
    setBusy(true);
    setError('');
    try {
      await team.opportunityStart({ market: m, region });
      await load();
      team.opportunityAllowance().then(setAllow, () => undefined);
    } catch (e) {
      setError(e instanceof DoorError || e instanceof Error ? e.message : 'Rein could not start the meeting.');
    } finally {
      setBusy(false);
    }
  }

  if (me.role === 'team') {
    return (
      <div className="bl-glass-card">
        <b>Opportunities is not part of the team's tools</b>
        <span className="bl-small">The team gets its own tool here later.</span>
      </div>
    );
  }

  const ready = (rows ?? []).filter((r) => r.status === 'ready' && r.meeting);
  const failed = (rows ?? []).filter((r) => r.status === 'failed').slice(0, 1);
  const shown = rows?.find((r) => r.id === open && r.meeting);
  const visitor = me.role === 'visitor';
  const usedThisMonth = me.role === 'client' && allow?.freeLeft === false;
  const chip = visitor ? 'Opens with payments' : me.role === 'owner' ? 'Executive: any time' : usedThisMonth ? 'Used this month' : '1 free this month';

  return (
    <div className="bl-opp">
      <section className="bl-glass-card bl-opp-card" aria-labelledby="opp-title">
        <div className="bl-opp-head">
          <h2 id="opp-title" className="bl-opp-title">Opportunity meeting</h2>
          <span className="bl-chip">{chip}</span>
        </div>
        <span className="bl-small">Rein sizes a market, follows its money and maps the way in, the exit and what comes next. Every number has a source.</span>
        <form
          className="bl-opp-form"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <label className="bl-field">
            <span className="bl-label">Which market?</span>
            <input className="bl-input" maxLength={200} value={market} placeholder="A niche, a product or an idea" onChange={(e) => setMarket(e.target.value)} />
          </label>
          <div className="bl-filters" role="group" aria-label="Region">
            {(Object.keys(REGION_LABEL) as MeetingRegion[]).map((r) => (
              <button key={r} type="button" className="bl-tagchip" aria-pressed={region === r} onClick={() => setRegion(r)}>
                {REGION_LABEL[r]}
              </button>
            ))}
          </div>
          <button type="submit" className="bl-btn bl-wide" disabled={busy || market.trim().length < 2 || running.length > 0 || allow?.canRun === false}>
            {busy ? 'Starting' : visitor ? 'Opens with payments' : running.length ? 'Rein is in a meeting' : usedThisMonth ? 'Next free meeting on the 1st' : 'Start the meeting'}
          </button>
        </form>
        {error && (
          <p className="bl-error" role="alert">
            {error}
          </p>
        )}
      </section>

      {running.map((r) => (
        <Working key={r.id} row={r} />
      ))}

      {failed.map((r) =>
        Date.now() - Date.parse(r.created_at) < 86_400_000 ? (
          <div key={r.id} className="bl-glass-card" role="status">
            <b>Rein could not finish {r.market_name ?? r.market_input}</b>
            <span className="bl-small">
              {r.error ?? 'Something went wrong.'} {r.kind === 'free' ? 'Your free meeting is back.' : ''}
            </span>
          </div>
        ) : null,
      )}

      {ready.length > 0 && (
        <section className="bl-opp-list" aria-labelledby="opp-past">
          <h3 id="opp-past" className="bl-section-title">
            Your meetings <span>{ready.length}</span>
          </h3>
          <ul>
            {ready.map((r) => (
              <li key={r.id}>
                <button type="button" className="bl-opp-row" onClick={() => setOpen(r.id)}>
                  <span>
                    <b>{r.meeting!.title}</b>
                    <small>
                      {REGION_LABEL[r.region]} · {new Date(r.ready_at ?? r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {r.meeting!.slides.length + 2} slides
                    </small>
                  </span>
                  <Chevron />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {me.role === 'client' && clientId && <WhatReinKnows clientId={clientId} editing={editing} setEditing={setEditing} />}

      {shown && (
        <MeetingViewer
          doc={shown.meeting!}
          showScore={me.role === 'owner'}
          onClose={() => {
            setOpen(null);
            if (openId) go('opportunities');
          }}
        />
      )}
    </div>
  );
}

/** Rein at work: her own steps, checked off as the stages finish. */
function Working({ row }: { row: Row }) {
  const done = row.steps.filter((s) => s.done).length;
  return (
    <section className="bl-glass-card bl-opp-working" aria-live="polite" aria-label="Rein is working">
      <div className="bl-opp-head">
        <span className="bl-opp-radar" aria-hidden="true">
          <Radar size={30} />
        </span>
        <span style={{ minWidth: 0 }}>
          <b>Rein is on it</b>
          <span className="bl-small" style={{ display: 'block' }}>
            {row.market_name ?? row.market_input} · {REGION_LABEL[row.region]}
          </span>
        </span>
      </div>
      {row.steps.length > 0 ? (
        <ol className="bl-opp-steps">
          {row.steps.map((s, i) => (
            <li key={i} className={s.done ? 'done' : i === done ? 'now' : ''}>
              <span className="bl-opp-step-ic" aria-hidden="true">
                {s.done && <Tick />}
              </span>
              <span>{s.label}</span>
            </li>
          ))}
        </ol>
      ) : (
        <span className="bl-small">Pinning the market down.</span>
      )}
      <span className="bl-small">A meeting takes about 10 minutes. You can leave this screen.</span>
    </section>
  );
}

// ---------- the meeting, one slide at a time ----------

type Page = { key: string; render: () => ReactNode };

function MeetingViewer({ doc, onClose, showScore = false }: { doc: MeetingDoc; onClose: () => void; showScore?: boolean }) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<'next' | 'prev'>('next');
  const [printing, setPrinting] = useState(false);
  const startX = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const src = useMemo(() => new Map(doc.sources.map((s) => [s.id, s])), [doc]);
  const pages = useMemo<Page[]>(() => buildPages(doc, src, false, showScore), [doc, src, showScore]);
  const n = pages.length;
  const at = Math.min(i, n - 1);
  const move = (d: 1 | -1) => {
    const t = Math.max(0, Math.min(n - 1, at + d));
    if (t === at) return;
    setDir(d === 1 ? 'next' : 'prev');
    setI(t);
  };
  useEffect(() => box.current?.focus(), []);
  useEffect(() => {
    if (!printing) return;
    const title = document.title;
    document.title = `${doc.title} (Rein, Backlot)`;
    const t = window.setTimeout(() => {
      window.print();
      document.title = title;
      setPrinting(false);
    }, 60);
    return () => window.clearTimeout(t);
  }, [printing, doc.title]);

  const host = document.querySelector('.bl-root') ?? document.body;
  return createPortal(
    <>
      <div
        className="bl-deck-view"
        role="dialog"
        aria-modal="true"
        aria-label={`Opportunity meeting: ${doc.title}`}
        tabIndex={-1}
        ref={box}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') move(1);
          if (e.key === 'ArrowLeft') move(-1);
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="bl-deck-top">
          <button type="button" className="bl-ghost bl-round" aria-label="Close the meeting" onClick={onClose}>
            <Cross />
          </button>
          <span className="bl-deck-name">
            <b>Opportunity meeting</b>
            <small>
              Rein · {doc.marketName} · {REGION_LABEL[doc.region]}
            </small>
          </span>
          <button type="button" className="bl-ghost bl-round" aria-label="Export as PDF" onClick={() => setPrinting(true)}>
            <Download />
          </button>
        </div>
        <div className="bl-deck-segs" role="group" aria-label="Slides">
          {pages.map((p, k) => (
            <button
              key={p.key + k}
              type="button"
              className={k <= at ? 'on' : ''}
              aria-label={`Slide ${k + 1}`}
              aria-current={k === at ? 'step' : undefined}
              onClick={() => {
                setDir(k > at ? 'next' : 'prev');
                setI(k);
              }}
            />
          ))}
        </div>
        <div
          className="bl-deck-stage"
          onPointerDown={(e) => (startX.current = e.clientX)}
          onPointerUp={(e) => {
            if (startX.current === null) return;
            const dx = e.clientX - startX.current;
            startX.current = null;
            if (Math.abs(dx) > 60) move(dx < 0 ? 1 : -1);
          }}
        >
          <article key={at} className={`bl-deck-slide in-${dir}`}>
            {pages[at].render()}
          </article>
        </div>
        <div className="bl-dv-nav">
          <button type="button" className="bl-ghost bl-round" aria-label="Previous slide" disabled={at === 0} onClick={() => move(-1)}>
            <span className="bl-flip">
              <Chevron />
            </span>
          </button>
          <span className="bl-small num" aria-live="polite">
            {at + 1} of {n}
          </span>
          {at < n - 1 ? (
            <button type="button" className="bl-btn" onClick={() => move(1)}>
              Next
            </button>
          ) : (
            <button type="button" className="bl-btn" onClick={() => setPrinting(true)}>
              Export as PDF
            </button>
          )}
        </div>
      </div>
      {/* Always present while a meeting is open, so Export (and the browser's own Print) gets every slide. */}
      {createPortal(<PrintMeeting doc={doc} />, document.body)}
    </>,
    host,
  );
}

function buildPages(doc: MeetingDoc, src: Map<string, SourceRef>, print = false, showScore = false): Page[] {
  const pages: Page[] = [
    {
      key: 'cover',
      render: () => (
        <div className="bl-slide bl-slide-cover">
          <span className="bl-slide-kick">Opportunity meeting · {REGION_LABEL[doc.region]}</span>
          <h2 className="bl-slide-big">{doc.title}</h2>
          <p className="bl-slide-lead">{doc.headline}</p>
          <span className="bl-small">
            Rein · {new Date(doc.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} · {doc.slides.length} slides, {doc.sources.length} sources
          </span>
          {showScore && doc.score && (
            <span className="bl-score">
              Scorecard {doc.score.passed} of {doc.score.of}
              {doc.score.missing.length ? ` · missing: ${doc.score.missing.map((k) => SECTION_NAME[k] ?? k).join(', ')}` : ''}
            </span>
          )}
        </div>
      ),
    },
    ...doc.slides.map((s, k) => ({ key: `${s.key}-${k}`, render: () => <SlideView s={s} src={src} print={print} /> })),
    { key: 'sources', render: () => <SourcesView doc={doc} /> },
  ];
  return pages;
}

function SlideView({ s, src, print = false }: { s: Slide; src: Map<string, SourceRef>; print?: boolean }) {
  const [p, setP] = useState(0);
  const prof = s.profiles[Math.min(p, Math.max(0, s.profiles.length - 1))];
  // On paper every profile is shown; on screen, one at a time.
  const shownProfiles = print ? s.profiles : prof ? [prof] : [];
  return (
    <div className="bl-slide">
      <span className="bl-slide-kick">{SECTION_NAME[s.key] ?? s.title}</span>
      <h2 className="bl-slide-head">{s.headline}</h2>
      {s.body && <p className="bl-slide-body">{s.body}</p>}
      {s.costStack && <CostView c={s.costStack} src={src} />}
      {s.figures.length > 0 && !(s.profiles.length > 0 && !print) && !(s.costStack && s.costStack.lines.some((l) => l.perHundred !== null)) && (
        <div className={`bl-figs n${Math.min(s.figures.length, 4)}`}>
          {s.figures.map((f, k) => (
            <FigureView key={k} f={f} src={src} />
          ))}
        </div>
      )}
      {shownProfiles.length > 0 && (
        <div className="bl-profiles">
          {!print && (
          <div className="bl-filters" role="group" aria-label="Buyer profiles">
            {s.profiles.map((x, k) => (
              <button key={k} type="button" className="bl-tagchip" aria-pressed={k === p} onClick={() => setP(k)}>
                {x.name}
              </button>
            ))}
          </div>
          )}
          {shownProfiles.map((prof) => (
          <div key={prof.name} className="bl-profile">
            {print && <b>{prof.name}</b>}
            <p className="bl-slide-body">{prof.job}</p>
            {(prof.spend || prof.stays) && (
              <div className="bl-profile-nums">
                {prof.spend && (
                  <span>
                    <small>Spends</small>
                    <b>{prof.spend}</b>
                  </span>
                )}
                {prof.stays && (
                  <span>
                    <small>Stays</small>
                    <b>{prof.stays}</b>
                  </span>
                )}
              </div>
            )}
            <Chips label="Pays for" items={prof.paysFor} />
            <Chips label="Buys" items={prof.products} />
            <Chips label="Ignores" items={prof.ignores} muted />
            <Cite ids={prof.sourceIds} src={src} />
          </div>
          ))}
        </div>
      )}
      {s.moves.length > 0 && (
        <ol className="bl-moves">
          {s.moves.map((m, k) => (
            <li key={k}>
              <span className="bl-move-n">{k + 1}</span>
              <span>
                <b>{m.move}</b>
                <small>{m.why}</small>
              </span>
            </li>
          ))}
        </ol>
      )}
      {s.points.length > 0 && (
        <ul className="bl-slide-points">
          {s.points.map((x, k) => (
            <li key={k}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const COST_SHADES = ['var(--ink)', 'var(--ink-2)', 'var(--ink-3)', 'var(--line-2)', 'var(--line)', 'var(--mist)', '#b9b8b1', '#a3a29b'];

/** The cost to make $100: the known lines, totaled by code; "at least" while any line is unknown. */
function CostView({ c, src }: { c: CostStack; src: Map<string, SourceRef> }) {
  const known = c.lines.filter((l) => l.perHundred !== null);
  const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
  return (
    <div className="bl-cost">
      <div className="bl-cost-total">
        <span className="bl-fig-value num">{c.complete ? money(c.knownTotal) : `At least ${money(c.knownTotal)}`}</span>
        <span className="bl-fig-label">{c.complete ? `spent to bring in $100. The seller keeps ${money(c.kept ?? 0)}.` : 'of every $100 goes to the costs Rein could back. The lines marked unknown come on top.'}</span>
      </div>
      {known.length > 0 && (
        <div className="bl-cost-bar" role="img" aria-label={`Of every $100: ${known.map((l) => `${l.name} ${money(l.perHundred!)}`).join(', ')}`}>
          {known.map((l, k) => (
            <i key={l.line} style={{ flexGrow: l.perHundred!, background: COST_SHADES[k % COST_SHADES.length] }} />
          ))}
          {c.complete && <i className="kept" style={{ flexGrow: c.kept ?? 0 }} />}
          {!c.complete && <i className="rest" style={{ flexGrow: Math.max(0, 100 - c.knownTotal) }} />}
        </div>
      )}
      <ul className="bl-cost-lines">
        {c.lines.map((l) => (
          <li key={l.line}>
            <span className="bl-cost-name">
              {l.perHundred !== null && <i style={{ background: COST_SHADES[known.indexOf(l) % COST_SHADES.length] }} aria-hidden="true" />}
              {l.name}
            </span>
            <b className="num">{l.perHundred !== null ? money(l.perHundred) : 'Unknown'}</b>
            {l.math && <small>{l.math}</small>}
            {l.perHundred !== null && <Cite ids={l.sourceIds} src={src} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FigureView({ f, src }: { f: Figure; src: Map<string, SourceRef> }) {
  return (
    <div className="bl-fig">
      <span className="bl-fig-value num">{f.value}</span>
      <span className="bl-fig-label">{f.label}</span>
      <span className={`bl-basis ${f.basis}`}>{BASIS_LABEL[f.basis]}</span>
      {f.math && <small className="bl-fig-math">{f.math}</small>}
      {!(f.math && f.sourceIds.every((i) => f.math!.includes(src.get(i)?.publisher ?? '\u0000'))) && <Cite ids={f.sourceIds} src={src} />}
    </div>
  );
}

function Cite({ ids, src }: { ids: string[]; src: Map<string, SourceRef> }) {
  const names = [...new Set(ids.map((i) => src.get(i)?.publisher).filter(Boolean))];
  if (!names.length) return null;
  return <small className="bl-cite">{names.join(', ')}</small>;
}

function Chips({ label, items, muted = false }: { label: string; items: string[]; muted?: boolean }) {
  if (!items.length) return null;
  return (
    <div className="bl-profile-row">
      <small>{label}</small>
      <div>
        {items.map((x, k) => (
          <span key={k} className={`bl-chip${muted ? ' muted' : ''}`}>
            {x}
          </span>
        ))}
      </div>
    </div>
  );
}

function SourcesView({ doc }: { doc: MeetingDoc }) {
  return (
    <div className="bl-slide">
      <span className="bl-slide-kick">Sources</span>
      <h2 className="bl-slide-head">Where every number came from</h2>
      <div className="bl-basis-key">
        <span className="bl-basis measured">Measured</span>
        <span className="bl-basis estimated">Estimated</span>
        <span className="bl-basis unknown">Unknown</span>
      </div>
      <ol className="bl-sources">
        {doc.sources.map((s) => (
          <li key={s.id}>
            <span>
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.title}
                </a>
              ) : (
                <b>{s.title}</b>
              )}
              <small>
                {s.publisher} · {s.published} · {RUNG_LABEL[s.rung] ?? 'Source'}
              </small>
            </span>
          </li>
        ))}
      </ol>
      {doc.skipped.length > 0 && (
        <div className="bl-skipped">
          <b>What Rein skipped</b>
          <ul>
            {doc.skipped.map((x, k) => (
              <li key={k}>
                <span>{SECTION_NAME[x.section] ?? x.section}:</span> {x.why}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="bl-small">{doc.note}</p>
    </div>
  );
}

/** Every slide on its own page, for the browser's Save as PDF. Shown only while printing. */
function PrintMeeting({ doc }: { doc: MeetingDoc }) {
  const pages = buildPages(doc, new Map(doc.sources.map((s) => [s.id, s])), true);
  return (
    <div className="bl-root bl-print-root" data-theme="day">
      {pages.map((p, k) => (
        <section key={p.key + k} className="bl-print-page">
          {p.render()}
          <footer className="bl-print-foot">
            {doc.title} · Rein, Backlot · {k + 1} of {pages.length}
          </footer>
        </section>
      ))}
    </div>
  );
}

// ---------- what Rein knows: one question at a time ----------

type Plan = { sellsTo: string; appealsTo: string; products: Array<{ name: string; note: string }>; goals: string };
const EMPTY_PLAN: Plan = { sellsTo: '', appealsTo: '', products: [], goals: '' };

function WhatReinKnows({ clientId, editing, setEditing }: { clientId: string; editing: boolean; setEditing: (v: boolean) => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [startAt, setStartAt] = useState(0);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from('game_plans').select('sells_to, appeals_to, products, goals').eq('client_id', clientId).maybeSingle();
    setPlan(data ? { sellsTo: data.sells_to ?? '', appealsTo: data.appeals_to ?? '', products: (data.products as Plan['products']) ?? [], goals: data.goals ?? '' } : EMPTY_PLAN);
  }, [clientId]);
  useEffect(() => void load(), [load]);
  if (!plan) return null;
  const cards: Array<[string, string, boolean]> = [
    ['Who buys from you', plan.sellsTo, Boolean(plan.sellsTo.trim())],
    ['Who follows you', plan.appealsTo, Boolean(plan.appealsTo.trim())],
    ['What you sell', plan.products.length ? `${plan.products.length} product${plan.products.length === 1 ? '' : 's'}` : '', plan.products.length > 0],
    ['Your goals', plan.goals, Boolean(plan.goals.trim())],
  ];
  const filled = cards.filter((c) => c[2]).length;
  return (
    <section className="bl-opp-know" aria-labelledby="opp-know">
      <h3 id="opp-know" className="bl-section-title">
        What Rein knows about you <span>{filled} of 4</span>
      </h3>
      <div className="bl-know-grid">
        {cards.map(([label, value, ok], k) => (
          <button
            key={label}
            type="button"
            className="bl-know"
            onClick={() => {
              setStartAt(k);
              setEditing(true);
            }}
          >
            <small>{label}</small>
            <b className={ok ? '' : 'add'}>{ok ? value : 'Add'}</b>
          </button>
        ))}
      </div>
      {editing && (
        <PlanIntake
          clientId={clientId}
          plan={plan}
          startAt={startAt}
          onDone={() => {
            setEditing(false);
            void load();
          }}
        />
      )}
    </section>
  );
}

function PlanIntake({ clientId, plan, startAt, onDone }: { clientId: string; plan: Plan; startAt: number; onDone: () => void }) {
  const [draft, setDraft] = useState<Plan>(plan);
  const [i, setI] = useState(startAt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const steps = [
    { q: 'Who buys from you?', hint: 'Rein matches buyer profiles to them.', field: 'sellsTo' as const, ph: 'The people who pay you, in your words' },
    { q: 'Who follows and engages?', hint: 'Often not the same people who buy. Both matter.', field: 'appealsTo' as const, ph: 'The people your posts reach' },
    { q: 'What do you sell?', hint: 'Rein fits the way in to what you already offer.', field: 'products' as const, ph: '' },
    { q: 'What do you want in the next 1 to 3 months?', hint: '', field: 'goals' as const, ph: 'Your goal' },
  ];
  const s = steps[i];
  async function save() {
    setSaving(true);
    setError('');
    try {
      await bil.gamePlanSave(clientId, { ...draft, products: draft.products.filter((p) => p.name.trim()) });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      setSaving(false);
    }
  }
  const host = document.querySelector('.bl-root') ?? document.body;
  return createPortal(
    <div className="bl-deck-view" role="dialog" aria-modal="true" aria-label="What Rein knows about you">
      <div className="bl-deck-top">
        <button type="button" className="bl-ghost bl-round" aria-label="Close" onClick={onDone}>
          <Cross />
        </button>
        <span className="bl-small num" aria-live="polite">
          {i + 1} of {steps.length}
        </span>
        <span style={{ width: 44 }} />
      </div>
      <div className="bl-intake-bar" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={i + 1} aria-label="Questions">
        <i style={{ width: `${((i + 1) / steps.length) * 100}%` }} />
      </div>
      <div className="bl-deck-stage">
        <div key={i} className="bl-deck-slide in-next bl-intake">
          <span className="bl-slide-kick">What Rein knows about you</span>
          {s.field === 'products' ? (
            <>
              <h2 className="bl-slide-head">{s.q}</h2>
              {draft.products.map((p, k) => (
                <div key={k} className="bl-intake-product">
                  <input className="bl-input" aria-label={`Product ${k + 1}`} maxLength={80} value={p.name} placeholder="Product" onChange={(e) => setDraft({ ...draft, products: draft.products.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)) })} />
                  <input className="bl-input" aria-label={`Price and who it is for, product ${k + 1}`} maxLength={200} value={p.note} placeholder="Price, who it is for" onChange={(e) => setDraft({ ...draft, products: draft.products.map((x, j) => (j === k ? { ...x, note: e.target.value } : x)) })} />
                </div>
              ))}
              {draft.products.length < 20 && (
                <button type="button" className="bl-ghost bl-start" onClick={() => setDraft({ ...draft, products: [...draft.products, { name: '', note: '' }] })}>
                  Add a product
                </button>
              )}
            </>
          ) : (
            <>
              <label className="bl-slide-head" htmlFor="intake-a">
                {s.q}
              </label>
              <textarea id="intake-a" className="bl-input bl-intake-field" maxLength={1000} value={draft[s.field]} placeholder={s.ph} onChange={(e) => setDraft({ ...draft, [s.field]: e.target.value })} />
            </>
          )}
          {s.hint && <span className="bl-small">{s.hint}</span>}
          {error && (
            <p className="bl-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
      <div className="bl-dv-nav">
        <button type="button" className="bl-ghost" style={{ visibility: i === 0 ? 'hidden' : 'visible' }} onClick={() => setI(i - 1)}>
          Back
        </button>
        {i < steps.length - 1 ? (
          <button type="button" className="bl-btn" onClick={() => setI(i + 1)}>
            Next
          </button>
        ) : (
          <button type="button" className="bl-btn" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving' : 'Save'}
          </button>
        )}
      </div>
    </div>,
    host,
  );
}

// ---------- icons ----------

function Chevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}
function Cross() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
function Download() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  );
}
function Tick() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
