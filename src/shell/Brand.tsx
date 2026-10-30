import { useEffect, useMemo, useState } from 'react';
import { bil } from '../lib/team';
import { DEFAULT_DIALS, DIALS, HUMOR, anchorFor, dialClashes, riskyDials, type Dials, type HumorStyle } from '../lib/dials';
import type { ScreenProps } from './Shell';
import { VoiceSection } from './Insights';

// The brand kit: everything Bil reads about a client before he plans or writes, on one
// page. The team's edits go straight in. A client's edits wait for the team's OK, so
// nothing Bil plans from changes without someone on the team seeing it first.

type Goal = { goal: string; detail: string; target?: string };
type Faq = { q: string; a: string };
type Link = { label: string; url: string };
type Deal = { code: string; note: string; ends: string };
type Offer = { name: string; what: string; price: string; forWho: string; link: string; deal: Deal };
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
  dials: Dials | null;
  humorStyles: HumorStyle[];
  faq: Faq[];
  links: Link[];
  offers: Offer[];
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
  dials: 'Dials',
  humorStyles: 'Humor styles',
  faq: 'Questions people ask',
  links: 'Links',
  offers: 'Offers',
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
    dials: p.dials && typeof p.dials === 'object' ? { ...DEFAULT_DIALS, ...(p.dials as Partial<Dials>) } : null,
    humorStyles: Array.isArray(p.humorStyles) ? (p.humorStyles as HumorStyle[]) : [],
    faq: Array.isArray(p.faq) ? (p.faq as Faq[]).map((f) => ({ q: String(f.q ?? ''), a: String(f.a ?? '') })) : [],
    links: Array.isArray(p.links) ? (p.links as Link[]).map((l) => ({ label: String(l.label ?? ''), url: String(l.url ?? '') })) : [],
    offers: Array.isArray(p.offers)
      ? (p.offers as Array<Record<string, unknown>>).map((o) => {
          const d = (o.deal ?? {}) as Record<string, unknown>;
          return {
            name: String(o.name ?? ''),
            what: String(o.what ?? ''),
            price: String(o.price ?? ''),
            forWho: String(o.forWho ?? ''),
            link: String(o.link ?? ''),
            deal: { code: String(d.code ?? ''), note: String(d.note ?? ''), ends: String(d.ends ?? '') },
          };
        })
      : [],
  };
}

const EMPTY_OFFER: Offer = { name: '', what: '', price: '', forWho: '', link: '', deal: { code: '', note: '', ends: '' } };

/** The offer as the server stores it: blank optional fields left out. */
function cleanOffer(o: Offer): Record<string, unknown> {
  const t = (v: string) => v.trim();
  const deal = { code: t(o.deal.code), note: t(o.deal.note), ends: t(o.deal.ends) };
  const hasDeal = deal.code || deal.note;
  return {
    name: t(o.name),
    what: t(o.what),
    ...(t(o.price) ? { price: t(o.price) } : {}),
    ...(t(o.forWho) ? { forWho: t(o.forWho) } : {}),
    ...(t(o.link) ? { link: t(o.link) } : {}),
    ...(hasDeal ? { deal: { ...(deal.code ? { code: deal.code } : {}), ...(deal.note ? { note: deal.note } : {}), ...(deal.ends ? { ends: deal.ends } : {}) } } : {}),
  };
}

/** "a, b  c" -> ["a","b","c"], with a cleaner for each kind of word list. */
const words = (s: string, clean: (w: string) => string) =>
  [...new Set(s.split(/[,\n]+/).map((w) => clean(w.trim())).filter(Boolean))];
const cleanTag = (w: string) => w.replace(/^#/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 50);
const cleanHandle = (w: string) => w.replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 15);
const cleanWord = (w: string) => w.replace(/\s+/g, ' ').slice(0, 40);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function BrandScreen({ ws, single, isTeam }: ScreenProps) {
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
    faq: kit.faq.map((f) => ({ q: f.q.trim(), a: f.a.trim() })).filter((f) => f.q && f.a),
    links: kit.links.map((l) => ({ label: l.label.trim(), url: l.url.trim() })).filter((l) => l.label && l.url),
    offers: kit.offers.filter((o) => o.name.trim() && o.what.trim()),
  };
  const badCode = current.offers.find((o) => o.deal.code.trim() && !/^[A-Za-z0-9_-]{3,24}$/.test(o.deal.code.trim()));
  const halfOffer = kit.offers.find((o) => (o.name.trim() || o.what.trim()) && !(o.name.trim() && o.what.trim()));
  const badLink = current.links.find((l) => !/^https:\/\/[^\s/]+\.[^\s]+$/.test(l.url));
  const base = isTeam ? saved : startFrom!;
  const changed = (Object.keys(current) as Array<keyof Kit>).filter((k) => !same(current[k], base[k]));
  const pendingKeys = pending ? (Object.keys(pending) as Array<keyof Kit>).filter((k) => k in LABELS && !same(pending[k], saved[k])) : [];

  async function save() {
    setBusy(true);
    setError('');
    setNote('');
    try {
      const edits: Record<string, unknown> = {};
      for (const k of changed)
        edits[k] =
          k === 'goals'
            ? current.goals.map((g) => ({ goal: g.goal, detail: g.detail.trim(), ...(g.target?.trim() ? { target: g.target.trim() } : {}) }))
            : k === 'offers'
              ? current.offers.map(cleanOffer)
              : current[k];
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

  const dials = kit.dials ?? DEFAULT_DIALS;
  // Dial upgrade 1: where their best posts sit, from Bil's last "measure what works".
  const start = (() => {
    const card = ws.data?.voices.find((v) => v.clientId === client.id)?.card as { whatWorks?: { dialStart?: { top: Dials; matters: Array<keyof Dials>; posts: { top: number } } } } | undefined;
    const d = card?.whatWorks?.dialStart;
    return d && d.top && DIALS.every((x) => typeof d.top[x.key] === 'number') ? d : null;
  })();
  const setDial = (k: keyof Dials, v: number) => set({ dials: { ...dials, [k]: v } });
  const toggleHumor = (h: HumorStyle) =>
    set({ humorStyles: kit.humorStyles.includes(h) ? kit.humorStyles.filter((x) => x !== h) : [...kit.humorStyles, h].slice(-2) });
  const setFaq = (i: number, patch: Partial<Faq>) => set({ faq: kit.faq.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  // An offer points at a link by its address, so editing or removing a link carries over.
  const setLink = (i: number, patch: Partial<Link>) => {
    const old = kit.links[i]?.url ?? '';
    const links = kit.links.map((l, j) => (j === i ? { ...l, ...patch } : l));
    const offers = patch.url !== undefined && old ? kit.offers.map((o) => (o.link === old ? { ...o, link: patch.url ?? '' } : o)) : kit.offers;
    set({ links, offers });
  };
  const removeLink = (i: number) => {
    const old = kit.links[i]?.url ?? '';
    set({ links: kit.links.filter((_, j) => j !== i), offers: kit.offers.map((o) => (o.link === old ? { ...o, link: '' } : o)) });
  };
  const setOffer = (i: number, patch: Partial<Offer>) => set({ offers: kit.offers.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const setDeal = (i: number, patch: Partial<Deal>) => setOffer(i, { deal: { ...kit.offers[i].deal, ...patch } });
  const linkChoices = current.links.filter((l) => /^https:\/\/[^\s/]+\.[^\s]+$/.test(l.url));

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
          How they sound, and words they never use, live in their voice below.
        </p>
      </section>

      {single && <VoiceSection ws={ws} clientId={single} isTeam={isTeam} />}

      <section className="bl-glass-card bl-brand-group" aria-labelledby="dials">
        <h2 id="dials" className="bl-section-title">Dials</h2>
        <p className="bl-small" style={{ margin: 0 }}>
          How every post should feel, from 1 to 7. Bil and Kris write at these levels, give or take one notch, and never go above controversy or spice.
          {!kit.dials && ' These are the starting levels until someone sets them.'}
        </p>
        {start && (
          <div className="bl-wash bl-dial-start">
            <span className="bl-small">
              <b>From their best posts.</b> When Bil measured what works, their top {start.posts.top} posts sat at{' '}
              {DIALS.map((d) => `${d.name} ${start.top[d.key]}`).join(', ')}.
              {start.matters.length > 0 && ` The dials that set their best posts apart: ${start.matters.map((k) => DIALS.find((d) => d.key === k)?.name ?? k).join(', ')}.`}
            </span>
            {DIALS.some((d) => dials[d.key] !== start.top[d.key]) ? (
              <button type="button" className="bl-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => set({ dials: { ...start.top } })}>
                Start from these
              </button>
            ) : (
              <span className="bl-small">The dials match them now.</span>
            )}
          </div>
        )}
        {DIALS.map((d) => (
          <label key={d.key} className="bl-knob">
            <span className="bl-knob-top">
              <span className="bl-label">{d.name}</span>
              <b className="num">{dials[d.key]}</b>
            </span>
            <input type="range" min={1} max={7} step={1} value={dials[d.key]} aria-valuetext={`${dials[d.key]}, ${anchorFor(d.at, dials[d.key])}`} onChange={(e) => setDial(d.key, Number(e.target.value))} />
            <span className="bl-small">{anchorFor(d.at, dials[d.key])}</span>
          </label>
        ))}
        {riskyDials(dials) && (
          <p className="bl-small bl-knob-warn" role="note">
            At this controversy and spice, {isTeam ? 'the client approves each post themselves' : 'you approve each post yourself'}. Jokes aimed at real people are never written, at any level.
          </p>
        )}
        {dialClashes(dials).map((w) => (
          <p key={w} className="bl-small bl-knob-warn" role="note">
            {w}
          </p>
        ))}
        <fieldset className="bl-knob-humor">
          <legend className="bl-label">Humor style, pick up to 2</legend>
          {HUMOR.map(([h, label]) => (
            <label key={h} className="bl-brand-check">
              <input type="checkbox" checked={kit.humorStyles.includes(h)} onChange={() => toggleHumor(h)} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
      </section>

      <section className="bl-glass-card bl-brand-group" aria-labelledby="faq">
        <h2 id="faq" className="bl-section-title">Questions people ask</h2>
        <p className="bl-small" style={{ margin: 0 }}>
          Kris answers from these and never makes up the rest.
        </p>
        {kit.faq.map((f, i) => (
          <div key={i} className="bl-brand-goal">
            <input className="bl-input" aria-label={`Question ${i + 1}`} value={f.q} maxLength={200} placeholder="The question" onChange={(e) => setFaq(i, { q: e.target.value })} />
            <textarea className="bl-input" aria-label={`Answer ${i + 1}`} rows={2} value={f.a} maxLength={500} placeholder="The answer" onChange={(e) => setFaq(i, { a: e.target.value })} />
            <button type="button" className="bl-linkish" onClick={() => set({ faq: kit.faq.filter((_, j) => j !== i) })}>
              Remove
            </button>
          </div>
        ))}
        {kit.faq.length < 20 && (
          <button type="button" className="bl-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => set({ faq: [...kit.faq, { q: '', a: '' }] })}>
            Add a question
          </button>
        )}
      </section>

      <section className="bl-glass-card bl-brand-group" aria-labelledby="links">
        <h2 id="links" className="bl-section-title">Links</h2>
        <p className="bl-small" style={{ margin: 0 }}>
          The only links Bil and Kris may put in a post. Anything else gets rewritten.
        </p>
        {kit.links.map((l, i) => (
          <div key={i} className="bl-brand-goal">
            <input className="bl-input" aria-label={`Link ${i + 1} name`} value={l.label} maxLength={60} placeholder="Name, like Shop or Booking" onChange={(e) => setLink(i, { label: e.target.value })} />
            <input className="bl-input" aria-label={`Link ${i + 1} address`} type="url" inputMode="url" value={l.url} maxLength={500} placeholder="https://" onChange={(e) => setLink(i, { url: e.target.value })} />
            <button type="button" className="bl-linkish" onClick={() => removeLink(i)}>
              Remove
            </button>
          </div>
        ))}
        {kit.links.length < 12 && (
          <button type="button" className="bl-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => set({ links: [...kit.links, { label: '', url: '' }] })}>
            Add a link
          </button>
        )}
        {badLink && (
          <p className="bl-error" role="alert">
            {badLink.label}: use a full address that starts with https://
          </p>
        )}
      </section>

      <section className="bl-glass-card bl-brand-group" aria-labelledby="offers">
        <h2 id="offers" className="bl-section-title">Offers</h2>
        <p className="bl-small" style={{ margin: 0 }}>
          What they sell. Kris points visitors to the one that fits, and Bil names them in posts. Neither makes up an offer, a price or a deal.
        </p>
        {kit.offers.map((o, i) => (
          <div key={i} className="bl-brand-goal bl-offer">
            <input className="bl-input" aria-label={`Offer ${i + 1} name`} value={o.name} maxLength={60} placeholder="Name, like Monthly subscription" onChange={(e) => setOffer(i, { name: e.target.value })} />
            <textarea className="bl-input" aria-label={`Offer ${i + 1}, what is included`} rows={2} value={o.what} maxLength={300} placeholder="What is included" onChange={(e) => setOffer(i, { what: e.target.value })} />
            <div className="bl-brand-row">
              <input className="bl-input" aria-label={`Offer ${i + 1} price`} value={o.price} maxLength={40} placeholder="Price, like $15 a month (optional)" onChange={(e) => setOffer(i, { price: e.target.value })} />
              <input className="bl-input" aria-label={`Offer ${i + 1}, who it suits`} value={o.forWho} maxLength={120} placeholder="Who it suits (optional)" onChange={(e) => setOffer(i, { forWho: e.target.value })} />
            </div>
            <label className="bl-field">
              <span className="bl-label">Where to get it</span>
              <select className="bl-input" value={linkChoices.some((l) => l.url === o.link) ? o.link : ''} onChange={(e) => setOffer(i, { link: e.target.value })}>
                <option value="">{linkChoices.length ? 'Pick one of their links' : 'Add a link above first'}</option>
                {linkChoices.map((l) => (
                  <option key={l.url} value={l.url}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <details className="bl-offer-deal" open={Boolean(o.deal.code || o.deal.note)}>
              <summary>Deal or code (optional)</summary>
              <div className="bl-brand-row">
                <input className="bl-input" aria-label={`Offer ${i + 1} deal code`} value={o.deal.code} maxLength={24} placeholder="Code, like WELCOME20" onChange={(e) => setDeal(i, { code: e.target.value.replace(/\s/g, '') })} />
                <input className="bl-input" aria-label={`Offer ${i + 1} deal ends`} type="date" value={o.deal.ends} onChange={(e) => setDeal(i, { ends: e.target.value })} />
              </div>
              <input className="bl-input" aria-label={`Offer ${i + 1} deal note`} value={o.deal.note} maxLength={80} placeholder="What it is, like 20% off the first month" onChange={(e) => setDeal(i, { note: e.target.value })} />
              <span className="bl-small">Kris shares a code only until its end date. No end date means until you remove it.</span>
            </details>
            <button type="button" className="bl-linkish" onClick={() => set({ offers: kit.offers.filter((_, j) => j !== i) })}>
              Remove
            </button>
          </div>
        ))}
        {kit.offers.length < 8 && (
          <button type="button" className="bl-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => set({ offers: [...kit.offers, { ...EMPTY_OFFER, deal: { ...EMPTY_OFFER.deal } }] })}>
            Add an offer
          </button>
        )}
        {halfOffer && (
          <p className="bl-small" role="status">
            An offer needs both a name and what is included before it saves.
          </p>
        )}
        {badCode && (
          <p className="bl-error" role="alert">
            {badCode.name}: codes use letters, numbers, - or _, 3 to 24 long.
          </p>
        )}
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
      <button type="button" className="bl-btn bl-wide" disabled={busy || changed.length === 0 || !!badLink || !!badCode} onClick={() => void save()}>
        {busy ? 'Saving' : changed.length === 0 ? 'No changes' : isTeam ? `Save ${changed.length} ${changed.length === 1 ? 'change' : 'changes'}` : 'Send to your team'}
      </button>
    </main>
  );
}
