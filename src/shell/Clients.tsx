import { useEffect, useState } from 'react';
import { Checklist, setupLeft, stepsFor } from './Checklist';
import { TeamToday } from './Notifications';
import { timedPosts, when } from './timing';
import type { ScreenProps } from './Shell';

// Clients (reworked Nov 5, 2026): one row per client, the ones that need you first, with
// search once there are more than 10. A row opens the client's workspace: their overview
// (the same command center as Today, for that one client) with their setup checklist. The
// client menu under the top bar (ClientNav) moves between that client's pages.
// People and invite codes live in Account.

const SECTIONS: Array<{ path: string; label: string; more?: boolean }> = [
  { path: 'clients', label: 'Overview' },
  { path: 'campaigns', label: 'Schedule' },
  { path: 'library', label: 'Media' },
  { path: 'products', label: 'Products' },
  { path: 'chat', label: 'Chat' },
  { path: 'xev', label: 'Xev' },
  { path: 'reports', label: 'Reports' },
  { path: 'brand', label: 'Brand kit' },
  { path: 'insights', label: 'Game Plan', more: true },
  { path: 'board', label: 'Board', more: true },
  { path: 'approvals', label: 'Approvals', more: true },
  { path: 'desk', label: 'Desk', more: true },
  { path: 'room', label: 'Page', more: true },
];
export const CLIENT_HEADS = ['clients', 'campaigns', 'library', 'products', 'chat', 'kris', 'xev', 'reports', 'brand', 'insights', 'board', 'approvals', 'desk', 'room'];

/** The menu for one client's pages, shown under the top bar while a client is picked. */
export function ClientNav({ handle, clientId, head, go }: { handle: string; clientId: string; head: string; go: (p: string) => void }) {
  const [more, setMore] = useState(false);
  const here = head === 'kris' ? 'chat' : head;
  const main = SECTIONS.filter((s) => !s.more);
  const extra = SECTIONS.filter((s) => s.more);
  const extraOn = extra.some((s) => s.path === here);
  const link = (s: (typeof SECTIONS)[number]) => (
    <a
      key={s.path}
      href={`#${s.path === 'clients' ? `clients.${clientId}` : s.path}`}
      aria-current={here === s.path ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault();
        setMore(false);
        go(s.path === 'clients' ? `clients.${clientId}` : s.path);
      }}
    >
      {s.label}
    </a>
  );
  return (
    <nav className="bl-cnav" aria-label={`@${handle}`}>
      <b className="bl-cnav-who">@{handle}</b>
      <div className="bl-cnav-links">
        {main.map(link)}
        <span className="bl-cnav-more">
          <button type="button" aria-expanded={more} aria-current={extraOn ? 'page' : undefined} onClick={() => setMore(!more)}>
            {extraOn ? extra.find((s) => s.path === here)!.label : 'More'} ▾
          </button>
          {more && <span className="bl-cnav-pop">{extra.map(link)}</span>}
        </span>
      </div>
    </nav>
  );
}

export function ClientsScreen(props: ScreenProps & { pick: (clientId: string) => void; openId?: string | null }) {
  const { ws, pick, openId } = props;
  useEffect(() => {
    if (openId) pick(openId);
  }, [openId, pick]);
  if (openId && ws.data) return <ClientOverview {...props} clientId={openId} />;
  return <ClientList {...props} />;
}

function ClientOverview(props: ScreenProps & { clientId: string }) {
  const { ws, go, clientId } = props;
  const c = ws.data!.clients.find((x) => x.id === clientId);
  if (!c) return <main className="bl-flow"><p className="bl-error">That client is not in your workspace.</p></main>;
  const left = setupLeft(ws.data!, c);
  const total = stepsFor(ws.data!, c).length;
  const setup =
    left > 0 ? (
      <details className="bl-cmd-card bl-setup-fold">
        <summary>
          Setup: {total - left} of {total} done
        </summary>
        <Checklist ws={ws.data!} client={c} isTeam go={go} onChanged={() => void ws.refresh()} />
      </details>
    ) : null;
  return <TeamToday me={props.me} ws={ws} go={go} focus={clientId} firstSeen={null} top={setup} inClient />;
}

function ClientList({ ws, go }: ScreenProps) {
  const [q, setQ] = useState('');
  const data = ws.data;
  const clients = data?.clients ?? [];
  if (!data) return <main className="bl-flow"><p className="bl-p bl-muted">Loading your clients.</p></main>;
  const now = Date.now();
  const timed = timedPosts(data, null);
  const rows = clients
    .filter((c) => !q || c.handle.toLowerCase().includes(q.toLowerCase().replace(/^@/, '')))
    .map((c) => {
      const camps = data.campaigns.filter((x) => x.clientId === c.id);
      const posts = data.posts.filter((p) => camps.some((x) => x.id === p.campaignId));
      const waiting = posts.filter((p) => p.status === 'ok' && (p.review === 'pending' || p.review === 'changes')).length;
      const held = posts.filter((p) => p.status === 'blocked').length;
      const next = timed.find((t) => t.client?.id === c.id && t.end.getTime() > now && t.post.review !== 'posted' && t.post.review !== 'not_posted');
      const left = setupLeft(data, c);
      const total = stepsFor(data, c).length;
      const voice = data.voices.find((v) => v.clientId === c.id);
      const last = data.activity.find((a) => a.clientId === c.id);
      const quiet = !last || now - Date.parse(last.at) > 5 * 86_400_000;
      const status: 'needs' | 'quiet' | 'ok' = waiting + held > 0 || c.pending || (voice && !voice.approved) ? 'needs' : !camps.length || quiet ? 'quiet' : 'ok';
      return { c, waiting, held, next, left, total, voice, status };
    })
    .sort((a, b) => ['needs', 'quiet', 'ok'].indexOf(a.status) - ['needs', 'quiet', 'ok'].indexOf(b.status) || a.c.handle.localeCompare(b.c.handle));
  const word = { needs: 'Needs you', quiet: 'Gone quiet', ok: 'On track' } as const;

  return (
    <main className="bl-flow bl-wide">
      <div className="bl-sched-top">
        <h1 className="bl-h1 bl-rise">Clients</h1>
        <span className="bl-row-actions">
          <button type="button" className="bl-ghost" onClick={() => go('create.client')}>
            Add a client
          </button>
        </span>
      </div>
      {clients.length > 10 && (
        <input className="bl-input" type="search" placeholder="Find a client" aria-label="Find a client" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      {clients.length === 0 ? (
        <div className="bl-glass-card bl-rise">
          <b>No clients yet</b>
          <p className="bl-p bl-muted" style={{ margin: 0 }}>
            Ask Bil to bring in your first client. He reads their page and drafts their voice.
          </p>
        </div>
      ) : (
        <ul className="bl-ctable" aria-label="Clients">
          <li className="bl-ctable-head" aria-hidden="true">
            <span>Client</span>
            <span>Next post</span>
            <span>Waiting</span>
            <span>Setup</span>
          </li>
          {rows.map((r) => {
            const pct = r.total ? Math.round(((r.total - r.left) / r.total) * 100) : 100;
            return (
              <li key={r.c.id}>
                <a
                  href={`#clients.${r.c.id}`}
                  className="bl-ctable-row"
                  onClick={(e) => {
                    e.preventDefault();
                    go(`clients.${r.c.id}`);
                  }}
                >
                  <span className="bl-ctable-who">
                    <span className={`bl-cmd-dot ${r.status}`} aria-hidden="true" />
                    <span>
                      <b>@{r.c.handle}</b>
                      <span className="bl-small">
                        {word[r.status]}
                        {r.c.pending ? ' · brand kit change to review' : r.voice ? (r.voice.approved ? '' : ' · voice waiting') : ' · no voice yet'}
                      </span>
                    </span>
                  </span>
                  <span className="bl-small" data-label="Next post">
                    {r.next ? when(r.next) : 'Nothing scheduled'}
                  </span>
                  <span data-label="Waiting">
                    {r.waiting + r.held > 0 ? (
                      <span className="bl-chip needs">
                        {r.waiting + r.held} {r.held ? 'need you' : 'waiting'}
                      </span>
                    ) : (
                      <span className="bl-small">None</span>
                    )}
                  </span>
                  <span className="bl-ctable-setup" data-label="Setup">
                    <span className="bl-ring" style={{ ['--p' as string]: `${pct}` }} role="img" aria-label={`Setup ${pct} percent done`} />
                    <span className="bl-small num">{r.left ? `${r.total - r.left}/${r.total}` : 'Done'}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="bl-linkish" style={{ alignSelf: 'flex-start' }} onClick={() => go('account')}>
        People and invite codes
      </button>
    </main>
  );
}
