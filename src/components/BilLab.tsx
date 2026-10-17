import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Logo } from './ui';

// A plain test page for Bil (#bil, signed in only). It drives the real agent end to end:
// look up the X account, onboard it (voice card + post types), approve the card, ask for
// a campaign, and watch the queued steps fill in post by post. No sample data: every
// field is the client's own answer. Backlot never posts; drafts are copied by hand.

type Json = Record<string, any>;

async function callBil(action: string, input: Json): Promise<Json> {
  if (!supabase) throw new Error('This build is offline.');
  const { data, error } = await supabase.functions.invoke('bil', { body: { action, ...input } });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => ({}));
      throw new Error(body?.error ?? `Bil answered ${error.context.status}`);
    }
    throw new Error(error.message);
  }
  return data as Json;
}

const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const tags = (s: string) => list(s).map((x) => x.replace(/^#/, ''));
const money = (n: unknown) => `$${Number(n ?? 0).toFixed(3)}`;
const today = () => new Date().toISOString().slice(0, 10);
const localZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="lab-card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function Pick<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o.replace(/_/g, ' ')}
        </option>
      ))}
    </select>
  );
}

// ---------- onboarding ----------

const KINDS = ['creator', 'influencer', 'small_business', 'professional'] as const;
const STYLES = ['personal', 'faceless', 'product', 'brand'] as const;
const GOALS = ['followers', 'community', 'awareness', 'sales', 'leads', 'bookings'] as const;
const PROFESSIONS = ['lawyer', 'investment_adviser', 'broker', 'financial_planner', 'insurance', 'accountant', 'real_estate', 'other_licensed'] as const;
const TONE = {
  humor: ['funny', 'neutral', 'serious'],
  formality: ['formal', 'neutral', 'casual'],
  respect: ['respectful', 'neutral', 'irreverent'],
  energy: ['enthusiastic', 'neutral', 'matter_of_fact'],
} as const;
const PERSONALITY = ['', 'sincerity', 'excitement', 'competence', 'sophistication', 'ruggedness'] as const;

function Onboard({ onDone }: { onDone: () => void }) {
  const [handle, setHandle] = useState('');
  const [found, setFound] = useState<Json | null>(null);
  const [f, setF] = useState({
    displayName: '',
    kind: 'creator' as (typeof KINDS)[number],
    accountStyle: 'personal' as (typeof STYLES)[number],
    niche: '',
    offer: '',
    audience: '',
    positioning: '',
    goal: 'followers' as (typeof GOALS)[number],
    goalDetail: '',
    timezone: localZone(),
    language: 'en',
    xPremium: false,
    postsPerWeek: 5,
    allowedHashtags: '',
    adultContent: false,
    adultsOnlyConfirmed: false,
    profession: 'lawyer' as (typeof PROFESSIONS)[number],
    regulator: '',
    complianceReviewRequired: true,
  });
  const [tone, setTone] = useState<Record<keyof typeof TONE, string>>({ humor: '', formality: '', respect: '', energy: '' });
  const [personality, setPersonality] = useState<(typeof PERSONALITY)[number]>('');
  const [voice, setVoice] = useState({ wordsTheyUse: '', wordsTheyAvoid: '', offLimits: '', samples: '', notes: '' });
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const set = (patch: Partial<typeof f>) => setF((old) => ({ ...old, ...patch }));

  async function lookup() {
    setBusy('Looking up the account');
    setError('');
    try {
      const p = await callBil('lookup', { handle });
      setFound(p);
      set({ displayName: f.displayName || p.name, xPremium: Boolean(p.premiumGuess) });
      setHandle(p.handle);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  async function onboard() {
    setBusy('Bil is reading the posts and writing the voice card. This takes 30 to 60 seconds.');
    setError('');
    const toneDone = Object.values(tone).every(Boolean);
    try {
      await callBil('onboard', {
        requestId: crypto.randomUUID(),
        attestOwnsAccount: attest,
        profile: {
          displayName: f.displayName,
          xHandle: handle.replace(/^@/, ''),
          kind: f.kind,
          accountStyle: f.accountStyle,
          niche: f.niche,
          offer: f.offer,
          audience: f.audience,
          positioning: f.positioning,
          goals: [{ goal: f.goal, detail: f.goalDetail || f.goal }],
          licensing: f.kind === 'professional'
            ? { profession: f.profession, regulator: f.regulator, complianceReviewRequired: f.complianceReviewRequired }
            : undefined,
          timezone: f.timezone,
          language: f.language,
          xPremium: f.xPremium,
          postsPerWeek: Number(f.postsPerWeek),
          allowedHashtags: tags(f.allowedHashtags),
          adultContent: f.adultContent,
          adultsOnlyConfirmed: f.adultsOnlyConfirmed,
        },
        voice: {
          tone: toneDone ? tone : undefined,
          personality: personality || undefined,
          wordsTheyUse: list(voice.wordsTheyUse),
          wordsTheyAvoid: list(voice.wordsTheyAvoid),
          offLimits: list(voice.offLimits),
          samples: voice.samples.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean).slice(0, 10),
          notes: voice.notes.trim() || undefined,
        },
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  return (
    <Section title="1. Onboard a client">
      <div className="lab-row">
        <Field label="X handle">
          <input value={handle} placeholder="@handle" autoCapitalize="none" spellCheck={false} onChange={(e) => setHandle(e.target.value)} />
        </Field>
        <button className="btn" disabled={!handle || Boolean(busy)} onClick={lookup}>
          Look up ($0.01)
        </button>
      </div>
      {found && (
        <p className="lab-note">
          {found.name} · {found.followers} followers · {found.posts} posts · {found.verified ? 'verified (Premium likely)' : 'not verified'}
          {found.bio ? ` · “${found.bio}”` : ''}
        </p>
      )}

      <div className="lab-grid">
        <Field label="Display name"><input value={f.displayName} onChange={(e) => set({ displayName: e.target.value })} /></Field>
        <Field label="Kind"><Pick value={f.kind} options={KINDS} onChange={(kind) => set({ kind })} /></Field>
        <Field label="Account style"><Pick value={f.accountStyle} options={STYLES} onChange={(accountStyle) => set({ accountStyle })} /></Field>
        <Field label="Niche" hint="Rein searches trends for this."><input value={f.niche} onChange={(e) => set({ niche: e.target.value })} /></Field>
        <Field label="Main goal"><Pick value={f.goal} options={GOALS} onChange={(goal) => set({ goal })} /></Field>
        <Field label="Goal in their words"><input value={f.goalDetail} onChange={(e) => set({ goalDetail: e.target.value })} /></Field>
        <Field label="Time zone"><input value={f.timezone} onChange={(e) => set({ timezone: e.target.value })} /></Field>
        <Field label="Language" hint="e.g. en, es-MX"><input value={f.language} onChange={(e) => set({ language: e.target.value })} /></Field>
        <Field label="Posts they can publish a week"><input type="number" min={1} max={35} value={f.postsPerWeek} onChange={(e) => set({ postsPerWeek: Number(e.target.value) })} /></Field>
        <Field label="Hashtags they use" hint="Comma separated. Drafts use only these or approved trend tags."><input value={f.allowedHashtags} onChange={(e) => set({ allowedHashtags: e.target.value })} /></Field>
      </div>
      <Field label="What they sell or want people to do"><textarea rows={2} value={f.offer} onChange={(e) => set({ offer: e.target.value })} /></Field>
      <Field label="Who they serve"><textarea rows={2} value={f.audience} onChange={(e) => set({ audience: e.target.value })} /></Field>
      <Field label="What sets them apart"><textarea rows={2} value={f.positioning} onChange={(e) => set({ positioning: e.target.value })} /></Field>

      {f.kind === 'professional' && (
        <div className="lab-grid">
          <Field label="Profession"><Pick value={f.profession} options={PROFESSIONS} onChange={(profession) => set({ profession })} /></Field>
          <Field label="Licensed by"><input value={f.regulator} onChange={(e) => set({ regulator: e.target.value })} /></Field>
          <label className="lab-check"><input type="checkbox" checked={f.complianceReviewRequired} onChange={(e) => set({ complianceReviewRequired: e.target.checked })} /> Compliance must approve posts</label>
        </div>
      )}

      <div className="lab-checks">
        <label className="lab-check"><input type="checkbox" checked={f.xPremium} onChange={(e) => set({ xPremium: e.target.checked })} /> On X Premium (long posts allowed)</label>
        <label className="lab-check"><input type="checkbox" checked={f.adultContent} onChange={(e) => set({ adultContent: e.target.checked })} /> Adult niche</label>
        {f.adultContent && (
          <label className="lab-check"><input type="checkbox" checked={f.adultsOnlyConfirmed} onChange={(e) => set({ adultsOnlyConfirmed: e.target.checked })} /> Everyone involved is 18 or older and consenting</label>
        )}
      </div>

      <h3>Their voice (optional; Bil reads their posts too)</h3>
      <div className="lab-grid">
        {(Object.keys(TONE) as Array<keyof typeof TONE>).map((k) => (
          <Field key={k} label={k}>
            <select value={tone[k]} onChange={(e) => setTone((t) => ({ ...t, [k]: e.target.value }))}>
              <option value="">let Bil read it</option>
              {TONE[k].map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
            </select>
          </Field>
        ))}
        <Field label="Personality">
          <select value={personality} onChange={(e) => setPersonality(e.target.value as (typeof PERSONALITY)[number])}>
            {PERSONALITY.map((o) => <option key={o} value={o}>{o || 'let Bil read it'}</option>)}
          </select>
        </Field>
      </div>
      <p className="field-hint">Tone counts only when all four are set.</p>
      <div className="lab-grid">
        <Field label="Words they use" hint="Comma separated"><input value={voice.wordsTheyUse} onChange={(e) => setVoice((v) => ({ ...v, wordsTheyUse: e.target.value }))} /></Field>
        <Field label="Words they never use" hint="Comma separated"><input value={voice.wordsTheyAvoid} onChange={(e) => setVoice((v) => ({ ...v, wordsTheyAvoid: e.target.value }))} /></Field>
        <Field label="Off limits" hint="Comma separated"><input value={voice.offLimits} onChange={(e) => setVoice((v) => ({ ...v, offLimits: e.target.value }))} /></Field>
      </div>
      <Field label="Sample posts they wrote or love" hint="Up to 10, separated by a blank line."><textarea rows={4} value={voice.samples} onChange={(e) => setVoice((v) => ({ ...v, samples: e.target.value }))} /></Field>
      <Field label="Anything else about how they sound"><textarea rows={2} value={voice.notes} onChange={(e) => setVoice((v) => ({ ...v, notes: e.target.value }))} /></Field>

      <label className="lab-check">
        <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} /> I own or manage this X account and allow Bil to read up to 48 of its public posts to learn its voice. The posts are used, then dropped; only the voice card is kept.
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      {busy && <p className="lab-note">{busy}</p>}
      <button className="btn primary" disabled={!attest || !handle || Boolean(busy)} onClick={onboard}>
        Onboard (about $0.30)
      </button>
    </Section>
  );
}

// ---------- voice card ----------

/** What performs on their page, measured from X's public numbers, with a refresh button. */
function WhatWorksView({ client, onChange }: { client: Json; onChange: () => void }) {
  const w = client.voice?.card?.whatWorks;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    setBusy(true);
    setError('');
    try {
      await callBil('learn', { requestId: crypto.randomUUID(), clientId: client.id });
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h3>What performs on their page</h3>
      {w ? (
        <>
          <p className="lab-note">{w.summary}</p>
          <dl className="lab-dl">
            <dt>Posts measured</dt><dd>{w.stats.postsMeasured} (median views {w.stats.medianImpressions ?? 'n/a'}, median score {w.stats.medianScorePer1k ?? 'n/a'})</dd>
            {w.patterns.length > 0 && (<><dt>Top posts share</dt><dd>{w.patterns.join(' · ')}</dd></>)}
            {w.doMore.length > 0 && (<><dt>Do more</dt><dd>{w.doMore.join(' · ')}</dd></>)}
            {w.avoid.length > 0 && (<><dt>Avoid</dt><dd>{w.avoid.join(' · ')}</dd></>)}
            {w.stats.groups.map((g: Json) => (
              <span key={g.label} style={{ display: 'contents' }}>
                <dt>{g.label}</dt><dd>{g.posts} posts, median score {g.medianScorePer1k ?? 'n/a'}</dd>
              </span>
            ))}
          </dl>
          <p className="field-hint">
            Score = replies, quotes, reposts and likes weighted by X's published ranking weights, per 1,000 views. Measured {new Date(w.measuredAt).toLocaleString()}.
          </p>
        </>
      ) : (
        <p className="lab-note">Not measured yet. Refresh to read their latest posts and their numbers.</p>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="lab-row">
        <button className="btn" disabled={busy} onClick={refresh}>
          {busy ? 'Measuring their posts…' : 'Refresh what performs (about $0.25)'}
        </button>
      </div>
    </>
  );
}

function VoiceCardView({ client, onChange }: { client: Json; onChange: () => void }) {
  const card = client.voice?.card;
  const [summary, setSummary] = useState<string>(card?.summary ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setSummary(card?.summary ?? ''), [card?.summary]);
  if (!card) return null;

  async function approve() {
    setBusy(true);
    setError('');
    try {
      await callBil('approve_voice', { clientId: client.id, edits: summary.trim() !== card.summary ? { summary: summary.trim() } : undefined });
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={`2. Voice card for @${client.x_handle} (version ${card.version})`}>
      <Field label="Summary" hint="Edit it if it is off; an edit makes a new version.">
        <textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <dl className="lab-dl">
        <dt>Tone</dt><dd>{Object.values(card.tone).join(', ').replace(/_/g, ' ')}</dd>
        <dt>Personality</dt><dd>{card.personality.primary}{card.personality.secondary ? `, ${card.personality.secondary}` : ''}</dd>
        <dt>Words they use</dt><dd>{card.wordsTheyUse.join(', ') || '(none)'}</dd>
        <dt>Words they avoid</dt><dd>{card.wordsTheyAvoid.join(', ') || '(none)'}</dd>
        <dt>Habits</dt><dd>{card.habits.emoji} emoji, {card.habits.capitalization.replace(/_/g, ' ')}, {card.habits.postLength} posts, says “{card.habits.selfReference}”{card.habits.notes ? `. ${card.habits.notes}` : ''}</dd>
        <dt>Replies</dt><dd>{card.replyStyle.approach}{card.replyStyle.notes ? `. ${card.replyStyle.notes}` : ''}</dd>
        <dt>Off limits</dt><dd>{card.offLimits.join('; ') || '(none)'}</dd>
        <dt>Posts read</dt><dd>{card.learnedFrom.xPostsRead}</dd>
      </dl>
      <WhatWorksView client={client} onChange={onChange} />
      {client.library && (
        <>
          <h3>Post types</h3>
          <ul className="lab-list">
            {client.library.library.types.map((t: Json) => (
              <li key={t.slug}><b>{t.name}</b> ({t.stages.join(', ')}): {t.purpose}</li>
            ))}
          </ul>
        </>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      {client.voice.approved_by_client ? (
        <p className="lab-note">Approved. Edit the summary and approve again to make a new version.</p>
      ) : null}
      <button className="btn primary" disabled={busy} onClick={approve}>
        {client.voice.approved_by_client ? 'Save as new version' : 'Approve voice card'}
      </button>
    </Section>
  );
}

// ---------- campaigns ----------

function NewCampaign({ client, onStarted }: { client: Json; onStarted: () => void }) {
  const [c, setC] = useState({
    goal: '',
    startDate: today(),
    lengthDays: 7,
    posts: '',
    useTrends: true,
    region: 'worldwide',
    reward: 'none',
    rewardDetails: '',
    notes: '',
  });
  const [estimate, setEstimate] = useState<Json | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const set = (patch: Partial<typeof c>) => {
    setC((old) => ({ ...old, ...patch }));
    setEstimate(null);
  };
  const posts = c.posts ? Number(c.posts) : Math.max(1, Math.round((client.profile.postsPerWeek * c.lengthDays) / 7));

  async function run(action: 'estimate' | 'campaign') {
    setBusy(true);
    setError('');
    try {
      if (action === 'estimate') {
        setEstimate(await callBil('estimate', { clientId: client.id, posts, useTrends: c.useTrends }));
      } else {
        await callBil('campaign', {
          requestId,
          clientId: client.id,
          goal: c.goal,
          startDate: c.startDate,
          lengthDays: Number(c.lengthDays),
          posts,
          useTrends: c.useTrends,
          region: c.region,
          reward: c.reward,
          rewardDetails: c.reward !== 'none' && c.rewardDetails.trim() ? c.rewardDetails.trim() : undefined,
          notes: c.notes.trim() || undefined,
        });
        setRequestId(crypto.randomUUID());
        onStarted();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="3. Ask Bil for a campaign">
      <Field label="Goal for this campaign"><input value={c.goal} onChange={(e) => set({ goal: e.target.value })} /></Field>
      <div className="lab-grid">
        <Field label="Start date"><input type="date" value={c.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
        <Field label="Length in days"><input type="number" min={1} max={30} value={c.lengthDays} onChange={(e) => set({ lengthDays: Number(e.target.value) })} /></Field>
        <Field label="Posts" hint={`Blank = ${posts}, from their posts a week.`}><input type="number" min={1} max={60} value={c.posts} onChange={(e) => set({ posts: e.target.value })} /></Field>
        <Field label="Region for trends"><Pick value={c.region as 'worldwide'} options={['worldwide', 'us', 'uk', 'canada'] as const} onChange={(region) => set({ region })} /></Field>
        <Field label="Reward"><Pick value={c.reward as 'none'} options={['none', 'draw', 'guaranteed'] as const} onChange={(reward) => set({ reward })} /></Field>
      </div>
      {c.reward !== 'none' && <Field label="Reward details"><input value={c.rewardDetails} onChange={(e) => set({ rewardDetails: e.target.value })} /></Field>}
      <Field label="Notes for Bil"><textarea rows={2} value={c.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      <label className="lab-check"><input type="checkbox" checked={c.useTrends} onChange={(e) => set({ useTrends: e.target.checked })} /> Ask Rein for trends first</label>
      {estimate && (
        <p className="lab-note">
          Up to {money(estimate.campaignUsd)} for Bil{estimate.reinUsd ? ` plus about ${money(estimate.reinUsd)} for Rein` : ''}, at uncached prices. Real cost is usually lower.
        </p>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="lab-row">
        <button className="btn" disabled={busy} onClick={() => run('estimate')}>Estimate (free)</button>
        <button className="btn primary" disabled={busy || !c.goal.trim()} onClick={() => run('campaign')}>Start campaign</button>
      </div>
    </Section>
  );
}

function PostCard({ row }: { row: Json }) {
  const p = row.post;
  const [copied, setCopied] = useState(false);
  const blocked = row.status === 'blocked';
  return (
    <li className={blocked ? 'lab-post blocked' : 'lab-post'}>
      <div className="lab-post-head">
        <b>#{row.slot}</b> day {p.dayOffset + 1} · {p.postWindow} · {p.postType} · {p.pillar} · {p.stage}
        {!blocked && <> · algorithm {p.algorithm.score} · voice {p.voice.match}</>}
      </div>
      {p.draft ? <pre className="lab-draft">{p.draft}</pre> : <p className="lab-note">{p.idea}</p>}
      {p.mediaIdea && <p className="field-hint">Media: {p.mediaIdea}</p>}
      {p.engagementPlan && <p className="field-hint">After posting: {p.engagementPlan}</p>}
      {(p.compliance?.blockedReasons ?? p.blockedReasons ?? []).length > 0 && (
        <p className="form-error">Blocked: {(p.compliance?.blockedReasons ?? p.blockedReasons).join(' ')}</p>
      )}
      {p.compliance?.licensedApprovalNeeded && <p className="field-hint">Needs their compliance team's approval.</p>}
      {p.voice?.drift?.length > 0 && <p className="field-hint">Drift: {p.voice.drift.join('; ')}</p>}
      {p.draft && !blocked && (
        <button
          className="btn sm"
          onClick={() => {
            void navigator.clipboard?.writeText(p.draft).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </li>
  );
}

function CampaignView({ campaign, onChange }: { campaign: Json; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Json[]>([]);
  const running = campaign.status === 'planning' || campaign.status === 'drafting';

  useEffect(() => {
    if (!open || !supabase) return;
    let stop = false;
    const load = async () => {
      const { data } = await supabase!.from('campaign_posts').select('slot, status, post').eq('campaign_id', campaign.id).order('slot');
      if (!stop) setRows(data ?? []);
    };
    void load();
    if (!running) return () => void (stop = true);
    const t = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [open, running, campaign.id, campaign.posts_done]);

  const plan = campaign.plan;
  return (
    <li className="lab-campaign">
      <button className="btn quiet lab-campaign-head" onClick={() => setOpen((o) => !o)}>
        <b>{plan?.title ?? campaign.request?.goal ?? 'Campaign'}</b>
        <span>
          {campaign.status}
          {campaign.hold ? ' (paused)' : ''} · {campaign.posts_done} of {campaign.posts_total}
          {campaign.step ? ` · ${campaign.step}` : ''}
        </span>
      </button>
      {campaign.error && <p className={campaign.status === 'failed' ? 'form-error' : 'lab-note'}>{campaign.error}</p>}
      {campaign.hold && (
        <button className="btn sm" onClick={() => void callBil('resume', { campaignId: campaign.id }).then(onChange)}>Resume</button>
      )}
      {open && (
        <div className="lab-campaign-body">
          {plan && (
            <>
              <p>{plan.goal}</p>
              <p className="field-hint">KPIs: {plan.kpis.join('; ')}</p>
              <p className="field-hint">Pillars: {plan.pillars.map((p: Json) => p.name).join(', ')}</p>
              <p className="field-hint">{plan.notes}</p>
              {plan.reward && <p className="field-hint">Reward: {plan.reward.reward} ({plan.reward.kind}, {plan.reward.disclosureTag ?? 'no tag'})</p>}
              {plan.adjustments?.length > 0 && <p className="field-hint">Code adjusted: {plan.adjustments.join(' ')}</p>}
              <p className="field-hint">Ranking settings from xai-org/x-algorithm at {String(plan.algorithm.repoCommit).slice(0, 7)}. Scores are a guide, not a promise.</p>
            </>
          )}
          <ul className="lab-posts">{rows.map((r) => <PostCard key={r.slot} row={r} />)}</ul>
        </div>
      )}
    </li>
  );
}

// ---------- page ----------

export function BilLab({ onHome }: { onHome: () => void }) {
  const [clients, setClients] = useState<Json[]>([]);
  const [campaigns, setCampaigns] = useState<Json[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    if (!supabase) {
      setLoadError('This build is offline, so Bil is not available. Run the hosted build (npm run dev with .env).');
      return;
    }
    try {
      await loadAll();
      setLoadError('');
    } catch (e) {
      setLoadError(`Could not reach Backlot's database: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  async function loadAll() {
    if (!supabase) return;
    const [c, v, l, k] = await Promise.all([
      supabase.from('clients').select('id, x_handle, profile, created_at').order('created_at'),
      supabase.from('voice_cards').select('client_id, card, approved_by_client'),
      supabase.from('post_type_libraries').select('client_id, library'),
      supabase.from('campaigns').select('id, client_id, status, step, hold, plan, request, posts_total, posts_done, error, created_at').order('created_at', { ascending: false }).limit(20),
    ]);
    const failed = [c, v, l, k].find((r) => r.error);
    if (failed?.error) throw new Error(failed.error.message);
    const merged: Json[] = (c.data ?? []).map((row: Json) => ({
      ...row,
      voice: (v.data ?? []).find((x: Json) => x.client_id === row.id),
      library: (l.data ?? []).find((x: Json) => x.client_id === row.id),
    }));
    setClients(merged);
    setCampaigns(k.data ?? []);
    setSelected((s) => s || merged[0]?.id || '');
    setLoaded(true);
  }

  useEffect(() => {
    void load();
  }, [load]);

  const running = campaigns.some((c) => c.status === 'planning' || c.status === 'drafting');
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [running, load]);

  const client = useMemo(() => clients.find((c) => c.id === selected), [clients, selected]);
  const theirs = campaigns.filter((c) => c.client_id === selected);

  return (
    <div className="app">
      <header className="bar">
        <a className="brand" href="#home" onClick={(e) => { e.preventDefault(); onHome(); }}>
          <Logo /> <b>Backlot</b>
        </a>
        <span className="lab-title">Bil test page</span>
      </header>
      <main className="lab">
        <p className="lab-note">Bil drafts; nothing is posted. Every paid step is metered against your caps.</p>
        {loadError && (
          <p className="form-error" role="alert">
            {loadError}{' '}
            <button className="btn sm" onClick={() => void load()}>Try again</button>
          </p>
        )}
        {!loaded && !loadError && <p className="lab-note">Loading your clients…</p>}
        {loaded && clients.length > 0 && (
          <div className="lab-row">
            <Field label="Client">
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                {clients.map((c) => <option key={c.id} value={c.id}>@{c.x_handle}</option>)}
              </select>
            </Field>
            <button className="btn" onClick={() => setAdding((a) => !a)}>{adding ? 'Close' : 'Onboard another'}</button>
          </div>
        )}
        {loaded && (clients.length === 0 || adding) && (
          <Onboard
            onDone={() => {
              setAdding(false);
              setSelected('');
              void load();
            }}
          />
        )}
        {client && <VoiceCardView client={client} onChange={() => void load()} />}
        {client?.voice?.approved_by_client && <NewCampaign client={client} onStarted={() => void load()} />}
        {client && theirs.length > 0 && (
          <Section title="4. Campaigns">
            <ul className="lab-campaigns">{theirs.map((c) => <CampaignView key={c.id} campaign={c} onChange={() => void load()} />)}</ul>
          </Section>
        )}
      </main>
    </div>
  );
}
