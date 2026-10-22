import type { Me } from '../lib/team';
import { railTime, type Workspace } from './data';
import type { ScreenProps } from './Shell';

// Home: notifications on a signal rail, newest first, with the ones that need you on top.
// Everything is worked out from the workspace data, so nothing here can drift out of step
// with the campaigns themselves.

type Item = {
  key: string;
  at: string;
  needs: boolean;
  label: string;
  title: string;
  body?: string;
  action?: { label: string; path: string; primary: boolean };
};

export function campaignTitle(c: { plan: Record<string, unknown> | null; request: Record<string, unknown> | null }): string {
  const t = (c.plan as { title?: string } | null)?.title ?? (c.request as { goal?: string } | null)?.goal;
  return typeof t === 'string' && t.trim() ? t.trim() : 'Campaign';
}

function build(me: Me, ws: Workspace, focus: string | null): Item[] {
  const isTeam = me.role !== 'client';
  const handle = (id: string) => ws.clients.find((c) => c.id === id)?.handle ?? '';
  const inScope = (clientId: string) => !focus || clientId === focus;
  const items: Item[] = [];

  for (const c of ws.campaigns) {
    if (!inScope(c.clientId)) continue;
    const label = `@${handle(c.clientId)} · Campaign`;
    const posts = ws.posts.filter((p) => p.campaignId === c.id);
    const blocked = posts.filter((p) => p.status === 'blocked');
    const pending = posts.filter((p) => p.status === 'ok' && p.review === 'pending');
    const changes = posts.filter((p) => p.review === 'changes');
    const open = `campaigns.${c.id}`;

    if (blocked.length) {
      const reasons = [...new Set(blocked.flatMap((p) => (Array.isArray(p.post.blockedReasons) ? p.post.blockedReasons : [])))]
        .slice(0, 2)
        .join(' ');
      items.push({
        key: `${c.id}:blocked`,
        at: c.updatedAt,
        needs: true,
        label,
        title: `Bil needs ${blocked.length === 1 ? 'a detail' : `${blocked.length} details`} to finish ${blocked.length === 1 ? 'a post' : 'posts'}`,
        body: reasons ? `${reasons} He never makes these up.` : 'He never makes up links, prices or times.',
        action: { label: 'See what is missing', path: open, primary: true },
      });
    }
    if (pending.length) {
      items.push({
        key: `${c.id}:pending`,
        at: c.updatedAt,
        needs: true,
        label,
        title: isTeam
          ? `${pending.length} ${pending.length === 1 ? 'post is' : 'posts are'} ready to approve`
          : `${pending.length} ${pending.length === 1 ? 'post is' : 'posts are'} ready for your OK`,
        body: `${campaignTitle(c)}. About ${Math.max(1, Math.round(pending.length / 8))} min to review.`,
        action: { label: 'Review posts', path: open, primary: !isTeam },
      });
    }
    if (isTeam && changes.length) {
      items.push({
        key: `${c.id}:changes`,
        at: c.updatedAt,
        needs: true,
        label,
        title: `Changes asked for on ${changes.length} ${changes.length === 1 ? 'post' : 'posts'}`,
        action: { label: 'Read the notes', path: open, primary: false },
      });
    }
    if (isTeam && c.hold === 'month_budget') {
      items.push({
        key: `${c.id}:hold`,
        at: c.updatedAt,
        needs: true,
        label,
        title: 'Paused at this month\'s AI budget',
        body: 'It picks up where it stopped once you resume it or the month resets.',
        action: { label: 'Open campaign', path: open, primary: true },
      });
    } else if (c.status === 'planning' || c.status === 'drafting') {
      items.push({
        key: `${c.id}:working`,
        at: c.updatedAt,
        needs: false,
        label,
        title: `Bil is ${c.status === 'planning' ? 'planning' : 'drafting'} ${campaignTitle(c)}`,
        body: c.postsTotal ? `${c.postsDone} of ${c.postsTotal} posts written.` : undefined,
        action: { label: 'Watch it fill in', path: open, primary: false },
      });
    } else if (isTeam && c.status === 'failed') {
      items.push({
        key: `${c.id}:failed`,
        at: c.updatedAt,
        needs: true,
        label,
        title: 'A campaign stopped before it finished',
        action: { label: 'Open campaign', path: open, primary: false },
      });
    }
  }

  for (const v of ws.voices) {
    if (!inScope(v.clientId)) continue;
    const label = `@${handle(v.clientId)} · Voice`;
    if (!v.approved) {
      items.push({
        key: `${v.clientId}:voice`,
        at: v.updatedAt,
        needs: !isTeam,
        label,
        title: isTeam ? `Waiting for @${handle(v.clientId)} to approve their voice` : 'Approve your voice',
        body: isTeam ? undefined : 'Bil writes every post in this voice. Check it sounds like you.',
        action: { label: isTeam ? 'See the voice' : 'Check my voice', path: 'insights', primary: !isTeam },
      });
    }
    const measured = v.card?.whatWorks?.measuredAt as string | undefined;
    if (measured) {
      const summary = String(v.card.whatWorks.summary ?? '');
      const first = summary.split(/(?<=\.)\s/)[0];
      items.push({
        key: `${v.clientId}:learned`,
        at: measured,
        needs: false,
        label: `@${handle(v.clientId)} · Insights`,
        title: 'Bil measured what performs.',
        body: first || undefined,
        action: { label: 'See insights', path: 'insights', primary: false },
      });
    }
  }

  return items.sort((a, b) => Number(b.needs) - Number(a.needs) || b.at.localeCompare(a.at));
}

export function needsYouCount(me: Me, ws: Workspace, focus: string | null): number {
  return build(me, ws, focus).filter((i) => i.needs).length;
}

export function Notifications({ me, ws, go, focus, isTeam }: ScreenProps) {
  if (!ws.data) return <main aria-busy="true" />;
  const items = build(me, ws.data, focus);
  const needs = items.filter((i) => i.needs).length;
  const now = Date.now();

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="bl-head bl-rise">
        <h1 className="bl-h1">Notifications</h1>
        {needs > 0 && <span className="bl-count">{needs} need you</span>}
      </div>

      {items.length === 0 ? (
        <div className="bl-empty bl-rise bl-d1">
          <b style={{ fontSize: 17 }}>You are all caught up.</b>
          <span className="bl-small">
            {isTeam
              ? ws.data.clients.length
                ? 'Nothing is waiting on you. Start something new with Bil.'
                : 'No clients yet. Onboard your first client with Bil to begin.'
              : 'Nothing needs you right now. New posts from your team show up here.'}
          </span>
          {isTeam && (
            <button type="button" className="bl-btn" onClick={() => go('create')}>
              Create with Bil
            </button>
          )}
        </div>
      ) : (
        <ol className="bl-rail">
          {items.map((it, i) => {
            const time = railTime(it.at, now);
            const last = i === items.length - 1;
            return (
              <li key={it.key} className={`bl-rise bl-d${Math.min(4, i + 1)}`}>
                <div className="bl-rail-side">
                  <span className={`bl-rail-time${it.needs && time === 'NOW' ? ' now' : ''}`}>{time}</span>
                  <span className={`bl-node${it.needs ? (i === 0 ? ' bl-live' : '') : ' quiet'}`} />
                  {!last && <span className={`bl-line${it.needs && i === 0 ? ' flow' : ''}`} />}
                </div>
                <div className="bl-rail-body">
                  {it.needs ? (
                    <article className={`bl-card lift${i === 0 ? ' hero' : ''}`}>
                      <span className="bl-label">{it.label}</span>
                      <div className="bl-card-title">{it.title}</div>
                      {it.body && <div className="bl-small">{it.body}</div>}
                      {it.action && (
                        <button
                          type="button"
                          className={`${it.action.primary ? 'bl-btn' : 'bl-ghost accent'} bl-start`}
                          onClick={() => go(it.action!.path)}
                        >
                          {it.action.label}
                        </button>
                      )}
                    </article>
                  ) : (
                    <a
                      className="bl-rail-quiet"
                      href={`#${it.action?.path ?? 'home'}`}
                      onClick={(e) => {
                        e.preventDefault();
                        if (it.action) go(it.action.path);
                      }}
                    >
                      <span className="bl-label">{it.label}</span>
                      <span style={{ lineHeight: 1.4 }}>
                        {it.title} {it.body}
                      </span>
                      {it.action && <span className="bl-count">{it.action.label}</span>}
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
