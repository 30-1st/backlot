import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { team, type Me } from '../lib/team';
import { useWorkspace } from './data';
import { Chevron, Dial, Rise, Sequence, Signal, Vault } from './icons';
import { useTheme } from './theme';
import { Notifications, needsYouCount } from './Notifications';
import { CreateScreen } from './Create';
import { LibraryScreen } from './Library';
import { CampaignsScreen } from './Campaigns';
import { InsightsScreen } from './Insights';
import { TeamScreen } from './Team';
import { ChangePassword } from './ChangePassword';

// The signed-in app: a status line, the screen, and the floating dock.
// Routes (in the address after #): home, create, library, campaigns, campaigns.<id>,
// insights, team. The older tools (narration studio, people, Bil's test page) keep their
// own routes and are reached from Create and Team.

export type ShellRoute = 'home' | 'create' | 'library' | 'campaigns' | 'insights' | 'team';

export function isShellPath(path: string): boolean {
  const head = path.split('.')[0];
  return path === '' || ['home', 'create', 'library', 'campaigns', 'insights', 'team'].includes(head);
}

export function Shell({ path, go, onSignOut }: { path: string; go: (p: string) => void; onSignOut: () => void }) {
  const { theme, choice, setChoice } = useTheme();
  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState('');
  const ws = useWorkspace();
  const [picked, setPicked] = useState<string>('all');

  const loadMe = () =>
    team.me().then(
      (m) => {
        setMe(m);
        setMeError('');
      },
      (e: Error) => setMeError(e.message),
    );
  useEffect(() => {
    void loadMe();
  }, []);

  const [head, sub] = [path.split('.')[0] || 'home', path.split('.').slice(1).join('.')];
  const route = (head === '' ? 'home' : head) as ShellRoute;

  const isTeam = me ? me.role !== 'client' : false;
  const clients = ws.data?.clients ?? [];
  // A client is always looking at themselves. The team picks one, or all.
  const focus = !isTeam ? me?.clientId ?? null : picked === 'all' ? null : picked;
  const single = focus ?? clients[0]?.id ?? null;
  const badge = useMemo(() => (me && ws.data ? needsYouCount(me, ws.data, focus) : 0), [me, ws.data, focus]);

  const wrap = (children: ReactNode) => (
    <div className="bl" data-theme={theme}>
      {children}
    </div>
  );

  if (meError) {
    return wrap(
      <div className="bl-app">
        <div className="bl-word">Backlot</div>
        <p className="bl-error" role="alert">
          {meError}
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="bl-btn" onClick={() => void loadMe()}>
            Try again
          </button>
          <button type="button" className="bl-ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>,
    );
  }
  if (!me) return wrap(<div className="bl-app" aria-busy="true" />);
  if (me.mustChangePassword) {
    return wrap(<ChangePassword forced onDone={() => void loadMe()} onSignOut={onSignOut} />);
  }

  const budget = me.budget;
  const used = budget && budget.cap > 0 ? Math.min(100, Math.round((budget.used / budget.cap) * 100)) : 0;
  const resets = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1))
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .toUpperCase();

  const props = { me, ws, go, focus, single, isTeam };

  let screen: ReactNode;
  switch (route) {
    case 'create':
      screen = <CreateScreen {...props} />;
      break;
    case 'library':
      screen = <LibraryScreen {...props} />;
      break;
    case 'campaigns':
      screen = <CampaignsScreen {...props} campaignId={sub || null} />;
      break;
    case 'insights':
      screen = <InsightsScreen {...props} />;
      break;
    case 'team':
      screen = <TeamScreen {...props} theme={{ choice, setChoice }} onSignOut={onSignOut} onChanged={() => void loadMe()} />;
      break;
    default:
      screen = <Notifications {...props} />;
  }

  const tab = (r: ShellRoute, label: string, icon: ReactNode, extra?: ReactNode) => (
    <a
      href={`#${r}`}
      className="bl-tab"
      aria-label={label}
      aria-current={route === r ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault();
        go(r);
      }}
    >
      {icon}
      {extra}
    </a>
  );

  return wrap(
    <>
      <div className="bl-app">
        <header className="bl-top">
          <div className="bl-bar">
            <a
              href="#home"
              className="bl-word"
              onClick={(e) => {
                e.preventDefault();
                go('home');
              }}
            >
              Backlot
            </a>
            <div className="bl-bar-end">
              {isTeam && clients.length > 0 && (
                <label className="bl-ghost" style={{ position: 'relative', paddingRight: 14 }}>
                  <span className="bl-sr">Which client</span>
                  <span>{focus ? `@${clients.find((c) => c.id === focus)?.handle ?? ''}` : 'All clients'}</span>
                  <Chevron />
                  <select
                    value={picked}
                    onChange={(e) => setPicked(e.target.value)}
                    style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                  >
                    <option value="all">All clients</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        @{c.handle}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <a
                href="#team"
                className={`bl-avatar${isTeam ? '' : ' soft'}`}
                aria-label={isTeam ? 'Team and your account' : 'Your account'}
                onClick={(e) => {
                  e.preventDefault();
                  go('team');
                }}
              >
                {(me.username ?? '?').slice(0, 1)}
              </a>
            </div>
          </div>
          {budget && (
            <div className="bl-status">
              <span className="bl-dot bl-live" />
              <span>
                Budget ${budget.used.toFixed(2)} / ${budget.cap.toFixed(0)}
              </span>
              <span className={`bl-meter${used >= 90 ? ' warn' : ''}`} role="img" aria-label={`${used} percent of this month's AI budget used`}>
                <span style={{ width: `${used}%` }} />
              </span>
              <span>Resets {resets}</span>
            </div>
          )}
          {ws.error && (
            <p className="bl-error" role="alert">
              {ws.error}
            </p>
          )}
        </header>
        {screen}
      </div>

      <nav aria-label="Main" className="bl-dock">
        {tab('home', badge ? `Home, ${badge} need you` : 'Home', <Signal />, badge ? <span className="bl-badge">{badge}</span> : null)}
        {tab('library', 'Library', <Vault />)}
        <a
          href="#create"
          className="bl-orb"
          aria-label="Create with Bil"
          aria-current={route === 'create' ? 'page' : undefined}
          onClick={(e) => {
            e.preventDefault();
            go('create');
          }}
        >
          <Rise />
        </a>
        {tab('campaigns', 'Campaigns', <Sequence />)}
        {tab('insights', 'Insights', <Dial />)}
      </nav>
    </>,
  );
}

export type ScreenProps = {
  me: Me;
  ws: ReturnType<typeof useWorkspace>;
  go: (p: string) => void;
  /** The client in focus, or null for all (team only). */
  focus: string | null;
  /** A single client to show when a screen needs exactly one. */
  single: string | null;
  isTeam: boolean;
};
