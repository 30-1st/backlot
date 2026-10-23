import { useEffect, useState, type FormEvent } from 'react';
import { bil, team, type AskAction } from '../lib/team';

// The agent bar: one box where the team asks Bil anything. He answers, and may offer one
// next step. A step that costs money shows its price and runs only when you tap it.

const SCREEN_WORDS: Record<string, string> = {
  brand: 'the brand kit',
  board: 'the inspiration board',
  library: 'Media',
  approvals: 'the approvals log',
  reports: 'the reports',
  desk: 'the engagement desk',
  insights: 'What works',
  campaigns: 'the schedule',
};

const monthName = (ym: string) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

function offerText(a: AskAction, reinFree: boolean | null, postsPerWeek: number): { title: string; price: string | null; button: string } {
  const who = `@${a.handle}`;
  switch (a.type) {
    case 'trends':
      return { title: `Check what is rising for ${who}`, price: reinFree === null ? 'Checking the price' : reinFree ? 'Free: Rein checked this niche in the last 6 hours.' : 'Up to $0.10 from this month’s AI budget.', button: 'Check now' };
    case 'report': {
      const est = Math.round((Math.min(100, Math.round(postsPerWeek * 4.3)) * 0.005 + 0.03) * 100) / 100;
      return { title: `Make ${monthName(a.month)}’s report for ${who}`, price: `About $${est.toFixed(2)}: $0.005 for each post X returns, plus one Bil call.`, button: 'Make it' };
    }
    case 'desk':
      return { title: `Check replies and mentions for ${who}`, price: 'Up to $0.13: $0.005 for each post X returns, 25 at most.', button: 'Check' };
    case 'measure':
      return { title: `Measure what performs for ${who}`, price: 'About $0.25.', button: 'Measure' };
    case 'plan':
      return { title: `Plan a campaign for ${who}`, price: a.goal ? `Goal: ${a.goal}. The planner shows the price before Bil writes anything.` : 'The planner shows the price before Bil writes anything.', button: 'Open the planner' };
    case 'open':
      return { title: `Open ${SCREEN_WORDS[a.screen] ?? a.screen} for ${who}`, price: null, button: 'Open' };
  }
}

export function AgentBar({ clientId, clients, go, pick }: { clientId: string | null; clients: Array<{ id: string; profile: Record<string, unknown> }>; go: (p: string) => void; pick?: (id: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [answer, setAnswer] = useState<{ q: string; reply: string; action: AskAction | null; costUsd: number } | null>(null);
  const [reinFree, setReinFree] = useState<boolean | null>(null);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');

  const action = answer?.action ?? null;
  useEffect(() => {
    setReinFree(null);
    if (action?.type !== 'trends') return;
    let live = true;
    team.reinClient(action.clientId, action.region).then(
      (r) => live && setReinFree(Boolean(r.preview?.free)),
      () => live && setReinFree(false),
    );
    return () => {
      live = false;
    };
  }, [action]);

  async function ask(e: FormEvent) {
    e.preventDefault();
    const q = text.trim();
    if (q.length < 3 || busy) return;
    setBusy(true);
    setError('');
    setDone('');
    try {
      const r = await bil.ask(q, clientId);
      setAnswer({ q, ...r });
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bil could not answer right now.');
    } finally {
      setBusy(false);
    }
  }

  async function run(a: AskAction) {
    const open = (path: string) => {
      pick?.(a.clientId);
      go(path);
    };
    setRunning(true);
    setError('');
    try {
      switch (a.type) {
        case 'trends':
          await team.reinClientUpdate(a.clientId, a.region);
          return open('insights');
        case 'report':
          await bil.report(a.clientId, a.month);
          return open('reports');
        case 'desk':
          await bil.desk(a.clientId, true);
          return open('desk');
        case 'measure':
          await bil.learn(a.clientId);
          setDone(`Measured. What works for @${a.handle} is updated.`);
          return;
        case 'plan':
          try {
            if (a.goal) sessionStorage.setItem('backlot.plan.goal', a.goal);
          } catch {
            // The planner simply starts empty.
          }
          return open('create.plan');
        case 'open':
          return open(a.screen);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work. Try again.');
    } finally {
      setRunning(false);
    }
  }

  const ppw = (id: string) => Number(clients.find((c) => c.id === id)?.profile?.postsPerWeek ?? 5) || 5;
  const offer = action ? offerText(action, reinFree, ppw(action.clientId)) : null;

  return (
    <section className="bl-agentbar" aria-label="Ask Bil anything">
      <form onSubmit={ask} className="bl-agentbar-form">
        <label className="bl-sr" htmlFor="agentbar">
          Ask Bil anything
        </label>
        <textarea
          id="agentbar"
          className="bl-input"
          rows={2}
          maxLength={600}
          value={text}
          placeholder="Ask Bil anything. For example: what is rising for my pie shop client?"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="bl-agentbar-foot">
          <span className="bl-small">A few cents per question, from this month&rsquo;s AI budget.</span>
          <button type="submit" className="bl-btn" disabled={busy || text.trim().length < 3}>
            {busy ? 'Bil is thinking' : 'Ask'}
          </button>
        </div>
      </form>

      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}

      {answer && (
        <div className="bl-agentbar-answer" aria-live="polite">
          <p className="bl-small" style={{ margin: 0 }}>
            You asked: {answer.q}
          </p>
          <p className="bl-p" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {answer.reply}
          </p>
          {offer && action && (
            <div className="bl-wash bl-agentbar-offer">
              <b>{offer.title}</b>
              {offer.price && <span className="bl-small">{offer.price}</span>}
              <div className="bl-row-actions">
                <button type="button" className="bl-ghost" disabled={running} onClick={() => setAnswer({ ...answer, action: null })}>
                  Not now
                </button>
                <button type="button" className="bl-btn" disabled={running || (action.type === 'trends' && reinFree === null)} onClick={() => void run(action)}>
                  {running ? 'Working' : offer.button}
                </button>
              </div>
            </div>
          )}
          {done && (
            <p className="bl-small" role="status" style={{ margin: 0 }}>
              {done}
            </p>
          )}
          <span className="bl-small">This answer cost ${answer.costUsd.toFixed(2)}.</span>
        </div>
      )}
    </section>
  );
}
