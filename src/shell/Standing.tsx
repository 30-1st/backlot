import type { ScreenProps } from './Shell';
import { PastPost } from './Schedule';
import { missingLinks, overdueLinks } from './timing';

// When a client is paused, or owes posting links more than 3 days old, their portal locks
// to Home and this screen, which says why and holds the fix. Honest skips ("Not posted")
// always count, so the fix is always in the client's hands.

export function standingOf(ws: ScreenProps['ws'], clientId: string | null) {
  const client = ws.data?.clients.find((c) => c.id === clientId) ?? null;
  if (!ws.data || !client) return { client, paused: false, owed: [] as ReturnType<typeof overdueLinks>, missing: [] as ReturnType<typeof missingLinks> };
  return { client, paused: client.stage === 'paused', owed: overdueLinks(ws.data, client.id), missing: missingLinks(ws.data, client.id) };
}

export function StandingGate({ ws, go, single }: ScreenProps) {
  const { client, paused, owed } = standingOf(ws, single);
  if (!client) return null;
  return (
    <main className="bl-flow">
      <h1 className="bl-h1 bl-rise">{paused ? 'Your account is paused' : 'A few posting links are missing'}</h1>
      {paused ? (
        <p className="bl-p">
          {client.stageNote ? `${client.stageNote} ` : ''}Your posts and campaigns are kept safe. Message your Backlot team to pick back up, and they will reopen everything.
        </p>
      ) : (
        <p className="bl-p">
          Campaigns are hidden until you add the link to each post below, or mark it Not posted. Not posted is always fine. We keep links to keep posts compliant and to measure how Bil&rsquo;s work performs for your brand, so he can keep improving.
        </p>
      )}
      {!paused && (
        <ol className="bl-standing-list">
          {owed.map((t) => (
            <li key={`${t.campaign.id}:${t.post.slot}`} className="bl-glass-card bl-postcard is-past">
              <b className="num">{new Date(`${t.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}</b>
              <p className="bl-postcard-text">{String(t.post.post.hook ?? t.post.post.draft ?? '')}</p>
              <PastPost t={t} ws={ws} />
            </li>
          ))}
        </ol>
      )}
      <button type="button" className="bl-ghost bl-start" onClick={() => go('home')}>
        Back to Home
      </button>
    </main>
  );
}
