import { useState } from 'react';
import { bil } from '../lib/team';
import type { ScreenProps } from './Shell';

// Add a client, one step at a time. Bil reads up to 48 of their public posts once to learn
// their voice, then drafts a voice card for the client to approve. Nothing is posted.

const KINDS = [
  ['creator', 'Creator'],
  ['influencer', 'Influencer'],
  ['small_business', 'Small business'],
  ['professional', 'Licensed professional'],
] as const;
const STYLES = [
  ['personal', 'Shows their face'],
  ['faceless', 'Faceless'],
  ['product', 'Product led'],
  ['brand', 'Brand voice'],
] as const;
const GOALS = [
  ['followers', 'More followers'],
  ['community', 'Community'],
  ['awareness', 'Awareness'],
  ['sales', 'Sales'],
  ['leads', 'Leads'],
  ['bookings', 'Bookings'],
] as const;
const PROFESSIONS = [
  ['lawyer', 'Lawyer'],
  ['investment_adviser', 'Investment adviser'],
  ['broker', 'Broker'],
  ['financial_planner', 'Financial planner'],
  ['insurance', 'Insurance'],
  ['accountant', 'Accountant'],
  ['real_estate', 'Real estate'],
  ['other_licensed', 'Other licensed'],
] as const;
const TONE = {
  humor: ['funny', 'neutral', 'serious'],
  formality: ['formal', 'neutral', 'casual'],
  respect: ['respectful', 'neutral', 'irreverent'],
  energy: ['enthusiastic', 'neutral', 'matter_of_fact'],
} as const;

type Step = 'handle' | 'who' | 'want' | 'post' | 'voice' | 'confirm';
const STEPS: Step[] = ['handle', 'who', 'want', 'post', 'voice', 'confirm'];
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

function Chips<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <fieldset className="bl-choice">
      <legend>{label}</legend>
      <div className="bl-filters">
        {options.map(([v, l]) => (
          <button key={v} type="button" className="bl-tagchip" aria-pressed={value === v} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Text({ id, label, value, onChange, rows, placeholder, hint, max = 1000 }: { id: string; label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; hint?: string; max?: number }) {
  return (
    <>
      <label className="bl-choice-label" htmlFor={id}>
        {label}
      </label>
      {rows ? (
        <textarea id={id} className="bl-input" rows={rows} maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} className="bl-input" maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint && <span className="bl-small">{hint}</span>}
    </>
  );
}

export function AddClientFlow({ go, ws }: ScreenProps) {
  const [step, setStep] = useState<Step>('handle');
  const [handle, setHandle] = useState('');
  const [found, setFound] = useState<Awaited<ReturnType<typeof bil.lookup>> | null>(null);
  const [f, setF] = useState({
    displayName: '',
    kind: 'creator' as (typeof KINDS)[number][0],
    accountStyle: 'personal' as (typeof STYLES)[number][0],
    niche: '',
    goal: 'followers' as (typeof GOALS)[number][0],
    goalDetail: '',
    offer: '',
    audience: '',
    positioning: '',
    profession: 'lawyer' as (typeof PROFESSIONS)[number][0],
    regulator: '',
    complianceReviewRequired: true,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: 'en',
    postsPerWeek: 7,
    xPremium: false,
    hashtags: '',
    adultContent: false,
    adultsOnlyConfirmed: false,
  });
  const [tone, setTone] = useState<Record<keyof typeof TONE, string>>({ humor: '', formality: '', respect: '', energy: '' });
  const [voice, setVoice] = useState({ use: '', avoid: '', offLimits: '', samples: '', notes: '' });
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const set = (p: Partial<typeof f>) => setF((o) => ({ ...o, ...p }));
  const at = STEPS.indexOf(step);
  const clean = handle.trim().replace(/^@/, '');

  const okToGo: Record<Step, boolean> = {
    handle: /^[A-Za-z0-9_]{1,15}$/.test(clean),
    who: f.displayName.trim().length > 0 && f.niche.trim().length > 0 && (f.kind !== 'professional' || f.regulator.trim().length > 0),
    want: f.goalDetail.trim().length > 0 && f.offer.trim().length > 0 && f.audience.trim().length > 0 && f.positioning.trim().length > 0,
    post: /^(UTC|[A-Za-z]+(\/[A-Za-z0-9_+-]+){1,2})$/.test(f.timezone) && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(f.language) && (!f.adultContent || f.adultsOnlyConfirmed),
    voice: true,
    confirm: attest,
  };

  async function lookup() {
    setBusy('Looking them up');
    setError('');
    try {
      const p = await bil.lookup(clean);
      setFound(p);
      setHandle(p.handle);
      set({ displayName: f.displayName || p.name, xPremium: Boolean(p.premiumGuess) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not find that account.');
    } finally {
      setBusy('');
    }
  }

  async function onboard() {
    setBusy('Bil is reading their posts and writing their voice card. This takes 30 to 60 seconds.');
    setError('');
    const toneDone = Object.values(tone).every(Boolean);
    try {
      await bil.onboard({
        requestId: crypto.randomUUID(),
        attestOwnsAccount: attest,
        profile: {
          displayName: f.displayName.trim(),
          xHandle: clean,
          kind: f.kind,
          accountStyle: f.accountStyle,
          niche: f.niche.trim(),
          offer: f.offer.trim(),
          audience: f.audience.trim(),
          positioning: f.positioning.trim(),
          goals: [{ goal: f.goal, detail: f.goalDetail.trim() }],
          licensing: f.kind === 'professional' ? { profession: f.profession, regulator: f.regulator.trim(), complianceReviewRequired: f.complianceReviewRequired } : undefined,
          timezone: f.timezone,
          language: f.language,
          xPremium: f.xPremium,
          postsPerWeek: f.postsPerWeek,
          allowedHashtags: list(f.hashtags).map((t) => t.replace(/^#/, '')).filter((t) => /^[A-Za-z0-9_]{1,50}$/.test(t)).slice(0, 15),
          adultContent: f.adultContent,
          adultsOnlyConfirmed: f.adultsOnlyConfirmed,
        },
        voice: {
          tone: toneDone ? tone : undefined,
          wordsTheyUse: list(voice.use).slice(0, 30),
          wordsTheyAvoid: list(voice.avoid).slice(0, 30),
          offLimits: list(voice.offLimits).slice(0, 20),
          samples: voice.samples.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean).slice(0, 10),
          notes: voice.notes.trim() || undefined,
        },
      });
      await ws.refresh();
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the client.');
    } finally {
      setBusy('');
    }
  }

  if (done) {
    return (
      <main className="bl-flow">
        <h1 className="bl-h1">@{clean} is in</h1>
        <div className="bl-glass-card bl-in">
          <p className="bl-p" style={{ margin: 0 }}>
            Bil wrote their voice card. Next, they approve it so every post sounds like them. Make them an invite code in Account, then they can check it on their Today.
          </p>
          <div className="bl-row-actions">
            <button type="button" className="bl-btn" onClick={() => go('account')}>
              Make an invite code
            </button>
            <button type="button" className="bl-ghost" onClick={() => go('clients')}>
              See clients
            </button>
          </div>
        </div>
      </main>
    );
  }

  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, at + 1)]);
  const back = () => (at === 0 ? go('create') : setStep(STEPS[at - 1]));

  return (
    <main className="bl-flow">
      <div className="bl-flow-top">
        <span className="bl-small">
          Add a client, step {at + 1} of {STEPS.length}
        </span>
        <div className="bl-steps" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s} className={i <= at ? 'on' : undefined} />
          ))}
        </div>
      </div>

      {step === 'handle' && (
        <section className="bl-flow-step bl-in" key="handle">
          <h2 className="bl-flow-q">Who are we adding?</h2>
          <Text id="handle" label="Their X handle" value={handle} placeholder="@handle" max={16} onChange={(v) => { setHandle(v); setFound(null); }} />
          <button type="button" className="bl-ghost" style={{ alignSelf: 'flex-start' }} disabled={!okToGo.handle || Boolean(busy)} onClick={() => void lookup()}>
            {busy ? 'Looking' : 'Look them up ($0.01)'}
          </button>
          {found && (
            <div className="bl-glass-card">
              <b>{found.name}</b>
              <span className="bl-small num">
                @{found.handle}. {found.followers.toLocaleString()} followers, {found.posts.toLocaleString()} posts. {found.verified ? 'Verified, so probably on X Premium.' : 'Not verified.'}
              </span>
              {found.bio && <span className="bl-small">{found.bio}</span>}
            </div>
          )}
          <span className="bl-small">Looking them up is optional. It fills in their name and checks the handle exists.</span>
        </section>
      )}

      {step === 'who' && (
        <section className="bl-flow-step bl-in" key="who">
          <h2 className="bl-flow-q">Who are they?</h2>
          <Text id="name" label="Name to use" value={f.displayName} max={80} onChange={(v) => set({ displayName: v })} />
          <Chips label="What kind of account" value={f.kind} options={KINDS} onChange={(kind) => set({ kind })} />
          <Chips label="How they post" value={f.accountStyle} options={STYLES} onChange={(accountStyle) => set({ accountStyle })} />
          <Text id="niche" label="Their niche" value={f.niche} max={200} placeholder="For example: home fitness for busy parents" hint="Also used to check what is trending for them." onChange={(v) => set({ niche: v })} />
          {f.kind === 'professional' && (
            <>
              <Chips label="Profession" value={f.profession} options={PROFESSIONS} onChange={(profession) => set({ profession })} />
              <Text id="reg" label="Licensed by" value={f.regulator} max={200} placeholder="For example: the State Bar of New York" onChange={(v) => set({ regulator: v })} />
              <label className="bl-switch">
                <input type="checkbox" checked={f.complianceReviewRequired} onChange={(e) => set({ complianceReviewRequired: e.target.checked })} />
                <span>Compliance must approve posts</span>
              </label>
            </>
          )}
        </section>
      )}

      {step === 'want' && (
        <section className="bl-flow-step bl-in" key="want">
          <h2 className="bl-flow-q">What do they want?</h2>
          <Chips label="Main goal" value={f.goal} options={GOALS} onChange={(goal) => set({ goal })} />
          <Text id="gd" label="The goal in their words" value={f.goalDetail} max={280} onChange={(v) => set({ goalDetail: v })} />
          <Text id="offer" label="What they sell or want people to do" value={f.offer} rows={2} onChange={(v) => set({ offer: v })} />
          <Text id="aud" label="Who they serve" value={f.audience} rows={2} hint="Topics and needs, never names of people." onChange={(v) => set({ audience: v })} />
          <Text id="pos" label="What sets them apart" value={f.positioning} rows={2} onChange={(v) => set({ positioning: v })} />
        </section>
      )}

      {step === 'post' && (
        <section className="bl-flow-step bl-in" key="post">
          <h2 className="bl-flow-q">How do they post?</h2>
          <fieldset className="bl-choice">
            <legend>Posts they can really publish a week</legend>
            <div className="bl-filters">
              {[3, 5, 7, 10, 14, 21].map((n) => (
                <button key={n} type="button" className="bl-tagchip num" aria-pressed={f.postsPerWeek === n} onClick={() => set({ postsPerWeek: n })}>
                  {n}
                </button>
              ))}
            </div>
          </fieldset>
          <Text id="tz" label="Their time zone" value={f.timezone} max={60} hint="Like America/New_York. Posting times use it." onChange={(v) => set({ timezone: v.trim() })} />
          <Text id="lang" label="Language they post in" value={f.language} max={6} hint="Like en or es-MX." onChange={(v) => set({ language: v.trim() })} />
          <Text id="tags" label="Hashtags they are happy to use (optional)" value={f.hashtags} max={600} placeholder="fitness, homeworkout" hint="Separate with commas." onChange={(v) => set({ hashtags: v })} />
          <label className="bl-switch">
            <input type="checkbox" checked={f.xPremium} onChange={(e) => set({ xPremium: e.target.checked })} />
            <span>On X Premium (long posts allowed)</span>
          </label>
          <label className="bl-switch">
            <input type="checkbox" checked={f.adultContent} onChange={(e) => set({ adultContent: e.target.checked, adultsOnlyConfirmed: e.target.checked && f.adultsOnlyConfirmed })} />
            <span>Adult niche</span>
          </label>
          {f.adultContent && (
            <label className="bl-switch">
              <input type="checkbox" checked={f.adultsOnlyConfirmed} onChange={(e) => set({ adultsOnlyConfirmed: e.target.checked })} />
              <span>Everyone involved is 18 or older and consenting</span>
            </label>
          )}
        </section>
      )}

      {step === 'voice' && (
        <section className="bl-flow-step bl-in" key="voice">
          <h2 className="bl-flow-q">How do they sound? (optional)</h2>
          <span className="bl-small">Bil reads their posts too. Anything set here wins over what he reads. Tone only counts when all four are set.</span>
          {(Object.keys(TONE) as Array<keyof typeof TONE>).map((k) => (
            <Chips
              key={k}
              label={k[0].toUpperCase() + k.slice(1)}
              value={tone[k] as string}
              options={[['', 'Let Bil read it'] as const, ...TONE[k].map((o) => [o, o.replace(/_/g, ' ')] as const)] as readonly (readonly [string, string])[]}
              onChange={(v) => setTone((t) => ({ ...t, [k]: v }))}
            />
          ))}
          <Text id="use" label="Words they use" value={voice.use} max={1500} hint="Separate with commas." onChange={(v) => setVoice((x) => ({ ...x, use: v }))} />
          <Text id="avoid" label="Words they never use" value={voice.avoid} max={1500} onChange={(v) => setVoice((x) => ({ ...x, avoid: v }))} />
          <Text id="off" label="Off limits" value={voice.offLimits} max={2000} onChange={(v) => setVoice((x) => ({ ...x, offLimits: v }))} />
          <Text id="samples" label="Posts they wrote or love" value={voice.samples} rows={4} max={10000} hint="Up to 10, with a blank line between them." onChange={(v) => setVoice((x) => ({ ...x, samples: v }))} />
          <Text id="notes" label="Anything else about how they sound" value={voice.notes} rows={2} onChange={(v) => setVoice((x) => ({ ...x, notes: v }))} />
        </section>
      )}

      {step === 'confirm' && (
        <section className="bl-flow-step bl-in" key="confirm">
          <h2 className="bl-flow-q">Add @{clean}</h2>
          <div className="bl-price">
            <span className="bl-hero-time num" style={{ fontSize: 56 }}>
              $0.30
            </span>
            <span className="bl-small">about</span>
          </div>
          <p className="bl-p bl-muted" style={{ margin: 0 }}>
            Bil reads up to 48 of their public posts once, writes their voice card and the kinds of posts that fit them, then drops the posts. Only the card is kept, and they approve it before any campaign.
          </p>
          <label className="bl-switch" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} style={{ marginTop: 2 }} />
            <span>I own or manage @{clean}, and I allow Bil to read its public posts to learn its voice.</span>
          </label>
          {busy && <p className="bl-small">{busy}</p>}
        </section>
      )}

      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}

      <div className="bl-flow-nav">
        <button type="button" className="bl-ghost" onClick={back} disabled={Boolean(busy)}>
          {at === 0 ? 'Cancel' : 'Back'}
        </button>
        {step !== 'confirm' ? (
          <button type="button" className="bl-btn" onClick={next} disabled={!okToGo[step] || Boolean(busy)}>
            Next
          </button>
        ) : (
          <button type="button" className="bl-btn" onClick={() => void onboard()} disabled={!attest || Boolean(busy)}>
            {busy ? 'Adding' : 'Add the client'}
          </button>
        )}
      </div>
    </main>
  );
}
