import { useEffect, useMemo, useState } from 'react';
import { bil } from '../lib/team';
import type { ScreenProps } from './Shell';

// Plan a campaign, one question at a time: the goal, the shape, anything extra, then the
// price before anything is spent. Bil writes in the background and Today says when the
// posts are ready to approve.

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
  const [days, setDays] = useState<3 | 7 | 14>(7);
  const [perDay, setPerDay] = useState<1 | 2 | 3>(2);
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
  const posts = Math.min(60, days * perDay);
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
      `${posts} posts over ${days} days, starting ${new Date(`${start}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}.${trends ? ' Checks what is trending first.' : ''}${reward !== 'none' ? ` With a ${reward === 'draw' ? 'giveaway' : 'guaranteed reward'}.` : ''}`,
    [posts, days, start, trends, reward],
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
        goal: goal.trim(),
        startDate: start,
        lengthDays: days,
        posts,
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
            What should this campaign get them?
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
          <span className="bl-small">One clear goal works best. Bil builds every post toward it.</span>
        </section>
      )}

      {step === 'shape' && (
        <section className="bl-flow-step bl-in" key="shape">
          <h2 className="bl-flow-q">How big?</h2>
          <Choice label="How long" value={days} options={[3, 7, 14] as const} onChange={setDays} show={(d) => `${d} days`} />
          <Choice label="Posts a day" value={perDay} options={[1, 2, 3] as const} onChange={setPerDay} show={(n) => String(n)} />
          <label className="bl-choice-label" htmlFor="start">
            Starts
          </label>
          <input id="start" type="date" className="bl-input" value={start} min={tomorrow()} onChange={(e) => setStart(e.target.value)} />
          <label className="bl-switch">
            <input type="checkbox" checked={trends} onChange={(e) => setTrends(e.target.checked)} />
            <span>Check what is trending first</span>
          </label>
          <span className="bl-small num">{posts} posts in all.</span>
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
          <label className="bl-choice-label" htmlFor="notes">
            Notes for Bil
          </label>
          <textarea id="notes" className="bl-input" rows={2} maxLength={1000} value={notes} placeholder="For example: no posts on Sunday" onChange={(e) => setNotes(e.target.value)} />
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
          <p className="bl-p" style={{ margin: 0 }}>
            {goal.trim()}
          </p>
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
            {busy ? 'Starting' : 'Start the campaign'}
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
