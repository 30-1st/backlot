import { createPortal } from 'react-dom';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { DoorError, team, type ClientBrief, type ReinBrief, type ReinRegion } from '../lib/team';
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

/**
 * One client's trends, on their Insights page. Everyone sees the latest saved brief; the
 * team can ask Rein to check again, and sees what that costs before it runs.
 */
export function ClientTrends({ clientId, isTeam }: { clientId: string; isTeam: boolean }) {
  const [region, setRegion] = useState<ReinRegion>('worldwide');
  const [latest, setLatest] = useState<ClientBrief | null>(null);
  const [preview, setPreview] = useState<{ free: boolean; costUsd: number; checkedAt: string | null } | null>(null);
  const [niche, setNiche] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    let live = true;
    setLoaded(false);
    team.reinClient(clientId, region).then(
      (r) => {
        if (!live) return;
        setLatest((cur) => cur ?? r.latest);
        setPreview(r.preview ?? null);
        setNiche(r.niche ?? null);
        setLoaded(true);
      },
      (e: Error) => live && (setError(e.message), setLoaded(true)),
    );
    return () => {
      live = false;
    };
  }, [clientId, region]);

  async function update() {
    setBusy(true);
    setError('');
    setNote('');
    try {
      const r = await team.reinClientUpdate(clientId, region);
      setLatest(r.latest);
      setPreview({ free: true, costUsd: 0, checkedAt: r.latest.createdAt });
      setNote(r.reused ? 'Rein had checked this niche in the last 6 hours, so this cost nothing.' : 'Rein checked the niche just now.');
      setConfirming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rein could not check the niche right now.');
    } finally {
      setBusy(false);
    }
  }

  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <section className="bl-card bl-trends-card" aria-labelledby="rising-t" style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 id="rising-t" className="bl-h2">
          What&rsquo;s rising
        </h2>
        {latest && <span className="bl-small">Saved {when(latest.savedAt)}</span>}
      </div>
      <p className="bl-small" style={{ margin: 0 }}>
        {niche ? `Rein's read on ${niche}. ` : ''}Topics only, never people. Bil asks Rein again when he plans a campaign, free if her last check is under 6 hours old.
      </p>
      {latest ? <Results brief={latest} /> : loaded && <p className="bl-small">{isTeam ? 'No trends saved for this client yet.' : 'Your team has not checked your niche yet.'}</p>}

      {isTeam && (
        <div className="bl-trends-update">
          <div className="bl-seg" role="radiogroup" aria-label="Where">
            {REGIONS.map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={region === v} aria-pressed={region === v} onClick={() => (setRegion(v), setConfirming(false))}>
                {l}
              </button>
            ))}
          </div>
          {!niche && loaded ? (
            <p className="bl-small">Add the client&rsquo;s niche in their brand kit first.</p>
          ) : confirming && preview ? (
            <div className="bl-wash" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span>
                {preview.free
                  ? `Free: Rein checked this niche ${preview.checkedAt ? `at ${when(preview.checkedAt)}` : 'in the last 6 hours'}, so the update reuses it.`
                  : `Up to $${preview.costUsd.toFixed(2)} from this month's AI budget. It takes about a minute.`}
              </span>
              <div className="bl-row-actions">
                <button type="button" className="bl-ghost" disabled={busy} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button type="button" className="bl-btn" disabled={busy} onClick={() => void update()}>
                  {busy ? 'Rein is checking' : preview.free ? 'Update, free' : 'Update'}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="bl-ghost bl-start" disabled={!preview} onClick={() => setConfirming(true)}>
              {preview ? (preview.free ? 'Update (free right now)' : `Update (up to $${preview.costUsd.toFixed(2)})`) : 'Update'}
            </button>
          )}
        </div>
      )}
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
      <TikTokNotes clientId={clientId} niche={niche} />
    </section>
  );
}

const CREATIVE_CENTER = 'https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/';
type TikTokKind = 'hashtag' | 'song' | 'format';
type TikTokNote = { id: string; kind: TikTokKind; name: string; note: string | null; region: string; createdAt: string };
const KIND_WORDS: Record<TikTokKind, string> = { hashtag: 'Hashtag', song: 'Song', format: 'Format' };

/**
 * TikTok, by hand. TikTok has no trend data API for businesses and Backlot never scrapes,
 * so a person looks at TikTok Creative Center and notes what fits. Bil reads the last two
 * weeks of notes as ideas for X. Never creators or other people.
 */
function TikTokNotes({ clientId, niche }: { clientId: string; niche: string | null }) {
  const [notes, setNotes] = useState<TikTokNote[] | null>(null);
  const [kind, setKind] = useState<TikTokKind>('hashtag');
  const [name, setName] = useState('');
  const [why, setWhy] = useState('');
  const [region, setRegion] = useState('us');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const { data, error: e } = await supabase
      .from('tiktok_notes')
      .select('id, kind, name, note, region, created_at')
      .eq('client_id', clientId)
      .is('removed_at', null)
      .gt('created_at', since)
      .order('created_at', { ascending: false })
      .limit(40);
    if (e) return setError(e.message);
    setNotes((data ?? []).map((r) => ({ id: r.id, kind: r.kind, name: r.name, note: r.note ?? null, region: r.region, createdAt: r.created_at })));
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!supabase) return;
    const clean = kind === 'hashtag' ? `#${name.trim().replace(/^#+/, '').replace(/\s+/g, '')}` : name.trim();
    if (clean.replace('#', '').length < 2) return setError(kind === 'hashtag' ? 'Type the hashtag.' : kind === 'song' ? 'Type the song name.' : 'Name the format, like "day in the life".');
    setBusy(true);
    setError('');
    const { error: e } = await supabase.rpc('tiktok_note_add', { p_client: clientId, p_kind: kind, p_name: clean.slice(0, 80), p_note: why.trim().slice(0, 280) || null, p_region: region });
    setBusy(false);
    if (e) return setError(e.message);
    setName('');
    setWhy('');
    await load();
  }

  async function remove(id: string) {
    if (!supabase) return;
    const { error: e } = await supabase.rpc('tiktok_note_remove', { p_id: id });
    if (e) return setError(e.message);
    setNotes((list) => (list ?? []).filter((n) => n.id !== id));
  }

  return (
    <details className="bl-read bl-tiktok">
      <summary>
        <span>TikTok, by hand</span>
        <span className="bl-read-scores num">{notes?.length ? `${notes.length} noted` : ''}</span>
      </summary>
      <p className="bl-small" style={{ margin: 0 }}>
        TikTok has no trend data for businesses to plug into, and Backlot never scrapes, so you look and note what fits. Bil reads the last two weeks as ideas for X.
      </p>
      <ol className="bl-tiktok-steps">
        <li>
          Open{' '}
          <a className="bl-linkish" href={CREATIVE_CENTER} target="_blank" rel="noopener noreferrer">
            TikTok Creative Center, Trends
          </a>
          . Sign in if it asks.
        </li>
        <li>Pick Hashtags or Songs, the country, the industry closest to {niche ? `\u201c${niche}\u201d` : 'the client\u2019s niche'}, and the last 7 days.</li>
        <li>Note up to five that fit the client, with a few words on why. Formats you keep seeing count too. Never note creators.</li>
      </ol>
      <div className="bl-seg" role="group" aria-label="What to note">
        {(Object.keys(KIND_WORDS) as TikTokKind[]).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {KIND_WORDS[k]}
          </button>
        ))}
      </div>
      <div className="bl-brand-row">
        <label className="bl-field">
          <span className="bl-label">{KIND_WORDS[kind]}</span>
          <input className="bl-input" value={name} maxLength={80} placeholder={kind === 'hashtag' ? '#fallbaking' : kind === 'song' ? 'Song and artist' : 'Day in the life'} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="bl-field">
          <span className="bl-label">Where</span>
          <select className="bl-input" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="us">US</option>
            <option value="uk">UK</option>
            <option value="canada">Canada</option>
            <option value="worldwide">Worldwide</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      <label className="bl-field">
        <span className="bl-label">Why it fits (optional)</span>
        <input className="bl-input" value={why} maxLength={280} placeholder="Gift buyers, fall recipes" onChange={(e) => setWhy(e.target.value)} />
      </label>
      <button type="button" className="bl-ghost" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => void add()}>
        {busy ? 'Adding' : 'Add the note'}
      </button>
      {error && (
        <p className="bl-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      {notes && notes.length > 0 && (
        <ul className="bl-tiktok-list">
          {notes.map((n) => (
            <li key={n.id}>
              <span className="bl-chip-ink">{KIND_WORDS[n.kind]}</span>
              <span className="bl-tiktok-name">
                <b>{n.name}</b>
                {n.note ? <span className="bl-small"> {n.note}</span> : null}
              </span>
              <button type="button" className="bl-linkish" aria-label={`Remove ${n.name}`} onClick={() => void remove(n.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
