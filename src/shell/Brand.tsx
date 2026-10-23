import { useEffect, useMemo, useState } from 'react';
import { bil } from '../lib/team';
import type { ScreenProps } from './Shell';

// The brand kit: everything Bil reads about a client before he plans or writes, on one
// page. The team's edits go straight in. A client's edits wait for the team's OK, so
// nothing Bil plans from changes without someone on the team seeing it first.

type Goal = { goal: string; detail: string; target?: string };
type Kit = {
  displayName: string;
  niche: string;
  offer: string;
  audience: string;
  positioning: string;
  goals: Goal[];
  timezone: string;
  language: string;
  xPremium: boolean;
  postsPerWeek: number;
  allowedHashtags: string[];
  nicheKeywords: string[];
  competitors: string[];
  adultContent: boolean;
  adultsOnlyConfirmed: boolean;
};

const GOALS: Array<[string, string]> = [
  ['sales', 'Sales'],
  ['leads', 'Leads'],
  ['bookings', 'Bookings'],
  ['followers', 'Followers'],
  ['community', 'Community'],
  ['awareness', 'Awareness'],
];

export const LABELS: Record<keyof Kit, string> = {
  displayName: 'Name',
  niche: 'Niche',
  offer: 'What they sell',
  audience: 'Who it is for',
  positioning: 'What sets them apart',
  goals: 'Goals',
  timezone: 'Time zone',
  language: 'Language',
  xPremium: 'X Premium',
  postsPerWeek: 'Posts a week',
  allowedHashtags: 'Hashtags',
  nicheKeywords: 'Niche keywords',
  competitors: 'Competitor accounts',
  adultContent: 'Adult content',
  adultsOnlyConfirmed: 'Adults only',
};

function kitOf(p: Record<string, unknown>): Kit {
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  return {
    displayName: String(p.displayName ?? ''),
    niche: String(p.niche ?? ''),
    offer: String(p.offer ?? ''),
    audience: String(p.audience ?? ''),
    positioning: String(p.positioning ?? ''),
    goals: Array.isArray(p.goals) ? (p.goals as Goal[]).map((g) => ({ goal: g.goal, detail: g.detail ?? '', target: g.target ?? '' })) : [],
    timezone: String(p.timezone ?? ''),
    language: String(p.language ?? 'en'),
    xPremium: Boolean(p.xPremium),
    postsPerWeek: Number(p.postsPerWeek ?? 5),
    allowedHashtags: arr(p.allowedHashtags),
    nicheKeywords: arr(p.nicheKeywords),
    competitors: arr(p.competitors),
    adultContent: Boolean(p.adultContent),
    adultsOnlyConfirmed: Boolean(p.adultsOnlyConfirmed),
  };
}

/** "a, b  c" -> ["a","b","c"], with a cleaner for each kind of word list. */
const words = (s: string, clean: (w: string) => string) =>
  [...new Set(s.split(/[,\n]+/).map((w) => clean(w.trim())).filter(Boolean))];
const cleanTag = (w: string) => w.replace(/^#/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 50);
const cleanHandle = (w: string) => w.replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 15);
const cleanWord = (w: string) => w.replace(/\s+/g, ' ').slice(0, 40);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function BrandScreen({ ws, single, isTeam, go }: ScreenProps) {
  const client = ws.data?.clients.find((c) => c.id === single);
  const saved = useMemo(() => (client ? kitOf(client.profile) : null), [client]);
  const pending = client?.pending ?? null;
  // A client keeps editing on top of what they already suggested.
  const startFrom = useMemo(() => (client ? kitOf({ ...client.profile, ...(isTeam ? {} : pending ?? {}) }) : null), [client, pending, isTeam]);
  const [kit, setKit] = useState<Kit | null>(startFrom);
  const [lists, setLists] = useState({ tags: '', keys: '', rivals: '' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setKit(startFrom);
    if (startFrom) setLists({ tags: startFrom.allowedHashtags.join(', '), keys: startFrom.nicheKeywords.join(', '), rivals: startFrom.competitors.join(', ') });
  }, [startFrom]);

  if (!ws.data) return <main aria-busy="true" />;
  if (!client || !kit || !saved) {
    return (
      <main className="bl-flow">
        <h1 className="bl-h1">Brand kit</h1>
        <p className="bl-p bl-muted">Pick a client first.</p>
      </main>
    );
  }

  const set = (patch: Partial<Kit>) => setKit((k) => (k ? { ...k, ...patch } : k));
  const current: Kit = {
    ...kit,
    allowedHashtags: words(lists.tags, cleanTag).slice(0, 15),
    nicheKeywords: words(lists.keys, cleanWord).slice(0, 12),
    competitors: words(lists.rivals, cleanHandle).slice(0, 10),
  };
  const base = isTeam ? saved : startFrom!;
  const changed = (Object.keys(current) as Array<keyof Kit>).filter((k) => !same(current[k], base[k]));
  const pendingKeys = pending ? (Object.keys(pending) as Array<keyof Kit>).filter((k) => k in LABELS && !same(pending[k], saved[k])) : [];

  async function save() {
    setBusy(true);
    setError('');
    setNote('');
    try {
      const edits: Record<string, unknown> = {};
      for (const k of changed) edits[k] = k === 'goals' ? current.goals.map((g) => ({ goal: g.goal, detail: g.detail.trim(), ...(g.target?.trim() ? { target: g.target.trim() } : {}) })) : current[k];
      const r = await bil.brandSave(client!.id, edits);
      await ws.refresh();
      setNote(r.waiting ? 'Sent. Your team will look at it before Bil uses it.' : 'Saved. Bil uses it from the next plan.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the brand kit.');
    } finally {
      setBusy(false);
    }
  }

  async function review(approve: boolean) {
    setBusy(true);
    setError('');
    try {
      await bil.brandReview(client!.id, approve);
      await ws.refresh();
      setNote(approve ? 'Their changes are in. Bil uses them from the next plan.' : 'Their suggestion was dropped.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the review.');
    } finally {
      setBusy(false);
    }
  }

  const goals = kit.goals.length ? kit.goals : [{ goal: 'sales', detail: '', target: '' }];
  const setGoal = (i: number, patch: Partial<Goal>) => set({ goals: goals.map((g, j) => (j === i ? { ...g, ...patch } : g)) });

  return (
    <main className="bl-flow bl-brand">
      <div>
        <h1 className="bl-h1 bl-rise">Brand kit</h1>
        <p className="bl-small" style={{ margin: '6px 0 0' }}>
          @{client.handle}. Everything Bil reads before he plans or writes. {isTeam ? 'Your changes go straight in.' : 'Your changes go to your team for an OK first.'}
        </p>
      </div>

      {pending && pendingKeys.length > 0 && (
        <section className="bl-glass-card bl-in" aria-labelledby="pending-title">
          <b id="pending-title">{isTeam ? 'The client suggested changes' : 'Waiting for your team'}</b>
          <span className="bl-small">
            {pendingKeys.map((k) => LABELS[k]).join(', ')}
            {client.pendingAt ? `, ${new Date(client.pendingAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}.
          </span>
          {isTeam && (
            <div className="bl-row-actions">
              <button type="button" className="bl-ghost" disabled={busy} onClick={() => void review(false)}>
                Drop it
              </button>
              <button type="button" className="bl-btn" disabled={busy} onClick={() => void review(true)}>
                Take their changes
              </button>
            </div>
          )}
        </section>
      )}

      <section className="bl-glass-card bl-brand-group" aria-labelledby="who">
        <h2 id="who" className="bl-section-title">Who they are</h2>
        <label className="bl-field">
          <span className="bl-label">Name</span>
          <input className="bl-input" value={kit.displayName} maxLength={80} onChange={(e) => set({ displayName: e.target.value })} />
        </label>
        <label className="bl-field">
          <span className="bl-label">Niche</span>
          <input className="bl-input" value={kit.niche} maxLength={200} placeholder="For example: home fitness for new parents" onChange={(e) => set({ niche: e.target.value })} />
        </label>
        <label className="bl-field">
          <span className="bl-label">What they sell, or want people to do</span>
          <textarea className="bl-input" rows={3} maxLength={1000} value={kit.offer} onChange={(e) => set({ offer: e.target.value })} />
        </label>
        <label className="bl-field">
          <span className="bl-label">Who it is for</span>
          <textarea className="bl-input" rows={3} maxLength={1000} value={kit.audience} onChange={(e) => set({ audience: e.target.value })} />
        </label>
        <label className="bl-field">
          <span className="bl-label">What sets them apart</span>
          <textarea className="bl-input" rows={3} maxLength={1000} value={kit.positioning} onChange={(e) => set({ positioning: e.target.value })} />
        </label>
      </section>

      <section className="bl-glass-card bl-brand-group" aria-labelledby="goals">
        <h2 id="goals" className="bl-section-title">Goals</h2>
        {goals.map((g, i) => (
          <div key={i} className="bl-brand-goal">
            <select className="bl-input" aria-label={`Goal ${i + 1}`} value={g.goal} onChange={(e) => setGoal(i, { goal: e.target.value })}>
              {GOALS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <input className="bl-input" aria-label={`Goal ${i + 1}, in their words`} value={g.detail} maxLength={280} placeholder="In their words" onChange={(e) => setGoal(i, { detail: e.target.value })} />
            <input className="bl-input" aria-label={`Goal ${i + 1}, target`} value={g.target ?? ''} maxLength={120} placeholder="Target, if any" onChange={(e) => setGoal(i, { target: e.target.value })} />
            {goals.length > 1 && (
              <button type="button" className="bl-linkish" onClick={() => set({ goals: goals.filter((_, j) => j !== i) })}>
                Remove
              </button>
            )}
          </div>
        ))}
        {goals.length < 5 && (
          <button type="button" className="bl-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => set({ goals: [...goals, { goal: 'followers', detail: '', target: '' }] })}>
            Add a goal
          </button>
        )}
      </section>

      <section className="bl-glass-card bl-brand-group" aria-labelledby="words">
        <h2 id="words" className="bl-section-title">Words</h2>
        <label className="bl-field">
          <span className="bl-label">Hashtags they are happy to use</span>
          <input className="bl-input" value={lists.tags} placeholder="Separated by commas, up to 15" onChange={(e) => setLists({ ...lists, tags: e.target.value })} />
          <span className="bl-small">Bil only uses these, plus trend tags you approve and required tags like #ad.</span>
        </label>
        <label className="bl-field">
          <span className="bl-label">Niche keywords</span>
          <input className="bl-input" value={lists.keys} placeholder="Words people in the niche search for, up to 12" onChange={(e) => setLists({ ...lists, keys: e.target.value })} />
        </label>
        <label className="bl-field">
          <span className="bl-label">Competitor accounts</span>
          <input className="bl-input" value={lists.rivals} placeholder="@handles, up to 10" onChange={(e) => setLists({ ...lists, rivals: e.target.value })} />
          <span className="bl-small">For positioning only. Backlot never reads or engages with them on its own.</span>
        </label>
        <p className="bl-small" style={{ margin: 0 }}>
          How they sound, and words they never use, live in their voice on{' '}
          <button type="button" className="bl-linkish" onClick={() => go('insights')}>
            What works
          </button>
          .
        </p>
      </section>

      <section className="bl-glass-card bl-brand-group" aria-labelledby="posting">
        <h2 id="posting" className="bl-section-title">Posting</h2>
        <div className="bl-brand-row">
          <label className="bl-field">
            <span className="bl-label">Posts a week</span>
            <input className="bl-input num" type="number" min={1} max={35} value={kit.postsPerWeek} onChange={(e) => set({ postsPerWeek: Math.max(1, Math.min(35, Number(e.target.value) || 1)) })} />
          </label>
          <label className="bl-field">
            <span className="bl-label">Language</span>
            <input className="bl-input" value={kit.language} maxLength={6} placeholder="en" onChange={(e) => set({ language: e.target.value.trim() })} />
          </label>
        </div>
        <label className="bl-field">
          <span className="bl-label">Time zone</span>
          <input className="bl-input" value={kit.timezone} placeholder="America/New_York" onChange={(e) => set({ timezone: e.target.value.trim() })} />
        </label>
        <label className="bl-brand-check">
          <input type="checkbox" checked={kit.xPremium} onChange={(e) => set({ xPremium: e.target.checked })} />
          <span>On X Premium, so long posts are allowed</span>
        </label>
      </section>

      <section className="bl-glass-card bl-brand-group" aria-labelledby="adult">
        <h2 id="adult" className="bl-section-title">Adult content</h2>
        <label className="bl-brand-check">
          <input type="checkbox" checked={kit.adultContent} onChange={(e) => set({ adultContent: e.target.checked, ...(e.target.checked ? {} : { adultsOnlyConfirmed: false }) })} />
          <span>This is an adult niche</span>
        </label>
        {kit.adultContent && (
          <label className="bl-brand-check">
            <input type="checkbox" checked={kit.adultsOnlyConfirmed} onChange={(e) => set({ adultsOnlyConfirmed: e.target.checked })} />
            <span>Everyone involved is 18 or older and consenting</span>
          </label>
        )}
      </section>

      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}
      {note && (
        <p className="bl-small" role="status">
          {note}
        </p>
      )}
      <button type="button" className="bl-btn bl-wide" disabled={busy || changed.length === 0} onClick={() => void save()}>
        {busy ? 'Saving' : changed.length === 0 ? 'No changes' : isTeam ? `Save ${changed.length} ${changed.length === 1 ? 'change' : 'changes'}` : 'Send to your team'}
      </button>
    </main>
  );
}
