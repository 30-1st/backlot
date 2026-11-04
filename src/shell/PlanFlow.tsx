import { useEffect, useMemo, useState } from 'react';
import { bil } from '../lib/team';
import type { ScreenProps } from './Shell';

// Plan the week, one question at a time: up to three goals, what the client can really do,
// anything extra, then the price before anything is spent. Rolling 7-day plans (approved
// Nov 4, 2026): Bil, the consultant, sets how many posts and when, inside the client's
// capacity; keeps about one slot in four open for Rein's trends and new media; and writes
// each post about a day before it goes out. After the week, the client keeps the goals or
// changes them.

type Step = 'goal' | 'shape' | 'extras' | 'price';
const STEPS: Step[] = ['goal', 'shape', 'extras', 'price'];

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function Choice<T extends string | number>({ label, value, options, onChange, show }: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void; show: (v: T) => string }) {
  return (
    <fieldset className="bl-choice">
      <legend>{label}</legend>
      <div className="bl-filters">
        {options.map((o) => (
          <button key={String(o)} type="button" className="bl-tagchip" aria-pressed={value === o} onClick={() => onChange(o)}>
            {show(o)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function PlanFlow({ ws, go, single }: ScreenProps) {
  const client = ws.data?.clients.find((c) => c.id === single) ?? null;
  const voice = ws.data?.voices.find((v) => v.clientId === single);
  const [step, setStep] = useState<Step>('goal');
  // A goal handed over from the agent bar, used once.
  const [goal, setGoal] = useState(() => {
    try {
      return (sessionStorage.getItem('backlot.plan.goal') ?? '').slice(0, 280);
    } catch {
      return '';
    }
  });
  useEffect(() => {
    try {
      sessionStorage.removeItem('backlot.plan.goal');
    } catch {
      // Nothing to clear.
    }
  }, []);
  const [goals, setGoals] = useState<string[]>([]);
  const [capacity, setCapacity] = useState<1 | 2 | 3 | 4 | 5>(2);
  const days = 7;
  const [start, setStart] = useState(tomorrow());
  const [trends, setTrends] = useState(true);
  const [region, setRegion] = useState<'worldwide' | 'us' | 'uk' | 'canada'>('worldwide');
  const [reward, setReward] = useState<'none' | 'draw' | 'guaranteed'>('none');
  const [rewardDetails, setRewardDetails] = useState('');
  const [notes, setNotes] = useState('');
  const [price, setPrice] = useState<{ campaignUsd: number; reinUsd: number; totalUsd: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  // The most Bil may plan in the week; he decides the real number.
  const posts = Math.min(21, days * capacity);
  const allGoals = [goal.trim(), ...goals.map((g) => g.trim())].filter((g) => g.length >= 3).slice(0, 3);
  const at = STEPS.indexOf(step);

  // The price is free to work out, so it is fetched as soon as the last step opens.
  useEffect(() => {
    if (step !== 'price' || !client) return;
    let alive = true;
    setPrice(null);
    setError('');
    bil.estimate(client.id, posts, trends).then(
      (p) => alive && setPrice(p),
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [step, client, posts, trends]);

  const summary = useMemo(
    () =>
      `A 7-day plan starting ${new Date(`${start}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}. Bil decides how many posts (up to ${posts}) and when, keeps some open for what trends this week, and writes each one about a day before it goes out.${reward !== 'none' ? ` With a ${reward === 'draw' ? 'giveaway' : 'guaranteed reward'}.` : ''}`,
    [posts, start, reward],
  );

  if (!client) {
    return (
      <main className="bl-flow">
        <h1 className="bl-h1">Plan a campaign</h1>
        <div className="bl-glass-card">
          <b>No client yet</b>
          <p className="bl-p bl-muted" style={{ margin: 0 }}>
            Bring in a client first, then plan their campaign here.
          </p>
        </div>
      </main>
    );
  }

  if (!voice?.approved) {
    return (
      <main className="bl-flow">
        <h1 className="bl-h1">Plan a campaign</h1>
        <div className="bl-glass-card">
          <b>@{client.handle} needs to approve their voice first</b>
          <p className="bl-p bl-muted" style={{ margin: 0 }}>
            Bil writes every post in their voice, so they check it sounds like them before the first campaign. It is waiting for them on their Today.
          </p>
          <button type="button" className="bl-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => go('insights')}>
            See their voice
          </button>
        </div>
      </main>
    );
  }

  async function startIt() {
    if (!client) return;
    setBusy(true);
    setError('');
    try {
      await bil.campaign({
        requestId,
        clientId: client.id,
        goal: allGoals.join(' · ').slice(0, 280),
        goals: allGoals,
        rolling: true,
        capacityPerDay: capacity,
        startDate: start,
        lengthDays: days,
        useTrends: trends,
        region,
        reward,
        rewardDetails: reward !== 'none' && rewardDetails.trim() ? rewardDetails.trim() : undefined,
        notes: notes.trim() || undefined,
      });
      await ws.refresh();
      go('today');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the campaign.');
      setBusy(false);
    }
  }

  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, at + 1)]);
  const back = () => (at === 0 ? go('create') : setStep(STEPS[at - 1]));

  return (
    <main className="bl-flow">
      <div className="bl-flow-top">
        <span className="bl-small">
          Plan a campaign for @{client.handle}, step {at + 1} of {STEPS.length}
        </span>
        <div className="bl-steps" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s} className={i <= at ? 'on' : undefined} />
          ))}
        </div>
      </div>

      {step === 'goal' && (
        <section className="bl-flow-step bl-in" key="goal">
          <label className="bl-flow-q" htmlFor="goal">
            What should this week get them?
          </label>
          <textarea
            id="goal"
            className="bl-input"
            rows={3}
            maxLength={280}
            value={goal}
            placeholder="For example: 10 new paying fans by Friday"
            onChange={(e) => setGoal(e.target.value)}
          />
          {goals.map((g, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label className="bl-sr" htmlFor={`goal-${i}`}>
                Goal {i + 2}
              </label>
              <input id={`goal-${i}`} className="bl-input" style={{ flex: 1 }} maxLength={200} value={g} placeholder="Another goal, for example: grow to 5,000 followers" onChange={(e) => setGoals((all) => all.map((x, k) => (k === i ? e.target.value : x)))} />
              <button type="button" className="bl-ghost" aria-label={`Remove goal ${i + 2}`} onClick={() => setGoals((all) => all.filter((_, k) => k !== i))}>
                Remove
              </button>
            </div>
          ))}
          {goals.length < 2 && (
            <button type="button" className="bl-ghost bl-start" onClick={() => setGoals((all) => [...all, ''])}>
              Add another goal
            </button>
          )}
          <span className="bl-small">Up to three. Bil weighs them and splits the week between them, first one first.</span>
        </section>
      )}

      {step === 'shape' && (
        <section className="bl-flow-step bl-in" key="shape">
          <h2 className="bl-flow-q">What can {client.handle ? `@${client.handle}` : 'they'} really do?</h2>
          <Choice label="The most posts they can put up in a day, by hand" value={capacity} options={[1, 2, 3, 4, 5] as const} onChange={setCapacity} show={(n) => String(n)} />
          <span className="bl-small">Bil sets the rate and the times; this is the one limit he plans inside.</span>
          <label className="bl-choice-label" htmlFor="start">
            Starts
          </label>
          <input id="start" type="date" className="bl-input" value={start} min={tomorrow()} onChange={(e) => setStart(e.target.value)} />
          <label className="bl-switch">
            <input type="checkbox" checked={trends} onChange={(e) => setTrends(e.target.checked)} />
            <span>Check what is trending first</span>
          </label>
          <label className="bl-choice-label" htmlFor="notes">
            What they can&rsquo;t do this week (optional)
          </label>
          <textarea id="notes" className="bl-input" rows={2} maxLength={1000} value={notes} placeholder="For example: no posts Sunday, can't film until Wednesday" onChange={(e) => setNotes(e.target.value)} />
        </section>
      )}

      {step === 'extras' && (
        <section className="bl-flow-step bl-in" key="extras">
          <h2 className="bl-flow-q">Anything else? (optional)</h2>
          {trends && (
            <Choice
              label="Where to look for trends"
              value={region}
              options={['worldwide', 'us', 'uk', 'canada'] as const}
              onChange={setRegion}
              show={(r) => (r === 'worldwide' ? 'Worldwide' : r === 'us' ? 'US' : r === 'uk' ? 'UK' : 'Canada')}
            />
          )}
          <Choice
            label="A reward for fans"
            value={reward}
            options={['none', 'draw', 'guaranteed'] as const}
            onChange={setReward}
            show={(r) => (r === 'none' ? 'None' : r === 'draw' ? 'Giveaway' : 'Guaranteed reward')}
          />
          {reward !== 'none' && (
            <>
              <label className="bl-choice-label" htmlFor="reward">
                What they win
              </label>
              <input id="reward" className="bl-input" maxLength={400} value={rewardDetails} placeholder="For example: a signed photo for 3 winners" onChange={(e) => setRewardDetails(e.target.value)} />
            </>
          )}
        </section>
      )}

      {step === 'price' && (
        <section className="bl-flow-step bl-in" key="price">
          <h2 className="bl-flow-q">Ready to start</h2>
          <div className="bl-price">
            <span className="bl-hero-time num" style={{ fontSize: 56 }}>
              {price ? money(price.totalUsd) : '…'}
            </span>
            <span className="bl-small">at most</span>
          </div>
          <ol className="bl-p" style={{ margin: 0, paddingLeft: 20 }}>
            {allGoals.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ol>
          <p className="bl-p bl-muted" style={{ margin: 0 }}>
            {summary} The real cost is usually lower. Bil writes in the background, and Today tells you when the posts are ready to approve.
          </p>
        </section>
      )}

      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}

      <div className="bl-flow-nav">
        <button type="button" className="bl-ghost" onClick={back} disabled={busy}>
          {at === 0 ? 'Cancel' : 'Back'}
        </button>
        {step !== 'price' ? (
          <button type="button" className="bl-btn" onClick={next} disabled={step === 'goal' && goal.trim().length < 3}>
            Next
          </button>
        ) : (
          <button type="button" className="bl-btn" onClick={() => void startIt()} disabled={busy || !price}>
            {busy ? 'Starting' : 'Start the week'}
          </button>
        )}
      </div>
    </main>
  );
}

/** Measure what works: Bil reads the client's latest posts and updates what performs. */
export function MeasureFlow({ ws, go, single }: ScreenProps) {
  const client = ws.data?.clients.find((c) => c.id === single) ?? null;
  const [state, setState] = useState<'ready' | 'busy' | 'done'>('ready');
  const [error, setError] = useState('');

  async function run() {
    if (!client) return;
    setState('busy');
    setError('');
    try {
      await bil.learn(client.id);
      await ws.refresh();
      setState('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not measure right now.');
      setState('ready');
    }
  }

  return (
    <main className="bl-flow">
      <h1 className="bl-h1">Measure what works</h1>
      {!client ? (
        <div className="bl-glass-card">
          <b>No client yet</b>
        </div>
      ) : state === 'done' ? (
        <div className="bl-glass-card bl-in">
          <b>Done for @{client.handle}</b>
          <p className="bl-p bl-muted" style={{ margin: 0 }}>
            What works is up to date. Bil uses it for every campaign from now on.
          </p>
          <button type="button" className="bl-btn" style={{ alignSelf: 'flex-start' }} onClick={() => go('insights')}>
            See what works
          </button>
        </div>
      ) : (
        <div className="bl-glass-card bl-in">
          <p className="bl-p" style={{ margin: 0 }}>
            Bil reads @{client.handle}'s latest public posts on X and works out what earns replies, reposts and follows, and at what times.
          </p>
          <p className="bl-small" style={{ margin: 0 }}>
            It uses a little of this month's AI budget, shown in Spent this month on Ask Bil. It takes about a minute.
          </p>
          <button type="button" className="bl-btn" style={{ alignSelf: 'flex-start' }} disabled={state === 'busy'} onClick={() => void run()}>
            {state === 'busy' ? 'Measuring' : 'Measure now'}
          </button>
        </div>
      )}
      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
