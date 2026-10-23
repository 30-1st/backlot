import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { isTeamRole, team, type Me } from '../lib/team';
import { useWorkspace } from './data';
import { BrandScreen } from './Brand';
import { BoardScreen } from './Board';
import { ApprovalsScreen } from './Approvals';
import { ReportsScreen } from './Reports';
import { DeskScreen } from './Desk';
import { Back, Chevron, House, People, Rise, Sequence, Signal, Reel, Vault } from './icons';
import { useTheme } from './theme';
import { Notifications, needsYouCount } from './Notifications';
import { CreateScreen } from './Create';
import { LibraryScreen } from './Library';
import { CampaignsScreen } from './Campaigns';
import { InsightsScreen } from './Insights';
import { TeamScreen } from './Team';
import { ChangePassword } from './ChangePassword';
import { HomeRooms } from './Rooms';
import { ClientsScreen } from './Clients';
import { PlaygroundScreen } from './Playground';
import { MeasureFlow, PlanFlow } from './PlanFlow';
import { AddClientFlow } from './AddClientFlow';
import { ReinScreen } from './Rein';

// The signed-in app is three rooms behind one Home:
//   Home                      #home
//   Team (team only)          #today  #campaigns[.id]  #clients  #insights  #library  #brand  #board  #approvals  #create
//   Client                    #today, #campaigns and #library (Media) for a client; the team previews
//                             a client's view under #client, #client.campaigns[.id]
//   Playground (everyone)     #playground  #instagram and #x (narration studios)  #rein
//   Account (from the avatar) #account
// The house button always goes Home; inside a tool, the back arrow goes up one level.

const SHELL_HEADS = ['', 'home', 'today', 'campaigns', 'clients', 'insights', 'library', 'brand', 'board', 'approvals', 'reports', 'desk', 'create', 'account', 'team', 'client', 'playground', 'narrate', 'rein'];

export function isShellPath(path: string): boolean {
  return SHELL_HEADS.includes(path.split('.')[0]);
}

type RoomKey = 'home' | 'team' | 'client' | 'preview' | 'play' | 'account';

export function Shell({ path, go, onSignOut }: { path: string; go: (p: string) => void; onSignOut: () => void }) {
  const { theme, choice, setChoice } = useTheme();
  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState('');
  const ws = useWorkspace();
  const [picked, setPicked] = useState<string>('all');
  const [still, setStill] = useState(false);

  // Ambient motion pauses whenever Backlot is not on screen, to save the phone's battery.
  useEffect(() => {
    const on = () => setStill(document.visibilityState !== 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

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

  const parts = path.split('.');
  const preview = parts[0] === 'client';
  const inner = preview ? parts.slice(1) : parts;
  const head = inner[0] || (preview ? 'today' : 'home');
  const sub = inner.slice(1).join('.');

  const isTeam = me ? isTeamRole(me.role) : false;
  const clients = ws.data?.clients ?? [];
  const focus = !isTeam ? me?.clientId ?? null : picked === 'all' ? null : picked;
  const single = focus ?? clients[0]?.id ?? null;
  const badge = useMemo(() => (me && ws.data ? needsYouCount(me, ws.data, isTeam ? null : focus) : 0), [me, ws.data, focus, isTeam]);

  const wrap = (children: ReactNode) => (
    <div className="bl-root" data-theme={theme} data-still={still ? '' : undefined}>
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

  // A Playground login has one room: the Playground, plus their own account page.
  if (me.role === 'visitor' && (preview || !['playground', 'narrate', 'rein', 'account'].includes(head))) {
    queueMicrotask(() => go('playground'));
    return wrap(<div className="bl-app" aria-busy="true" />);
  }

  // Home has its own stage and no dock.
  if (!preview && (head === 'home' || head === '')) return wrap(<HomeRooms me={me} go={go} needs={badge} />);

  // Which room this screen belongs to.
  const room: RoomKey = preview
    ? 'preview'
    : ['playground', 'narrate', 'rein'].includes(head)
      ? 'play'
      : head === 'account' || head === 'team'
        ? 'account'
        : isTeam
          ? 'team'
          : 'client';

  // The team previews a client's view: the screens think they are the client.
  const asMe: Me = preview ? { ...me, role: 'client', clientId: single, clientHandle: clients.find((c) => c.id === single)?.handle ?? null } : me;
  const goIn = preview ? (p: string) => go(p === 'today' || p.startsWith('campaigns') ? `client.${p}` : p) : go;
  const props = { me: asMe, ws, go: goIn, focus: preview ? single : focus, single, isTeam: preview ? false : isTeam };

  let screen: ReactNode;
  switch (head) {
    case 'campaigns':
      screen = <CampaignsScreen {...props} campaignId={sub || null} />;
      break;
    case 'clients':
      screen = isTeam ? <ClientsScreen {...props} pick={setPicked} /> : <Notifications {...props} />;
      break;
    case 'insights':
      screen = <InsightsScreen {...props} />;
      break;
    case 'library':
      screen = <LibraryScreen {...props} />;
      break;
    case 'brand':
      screen = <BrandScreen {...props} />;
      break;
    case 'board':
      screen = <BoardScreen {...props} />;
      break;
    case 'approvals':
      screen = <ApprovalsScreen {...props} />;
      break;
    case 'reports':
      screen = <ReportsScreen {...props} />;
      break;
    case 'desk':
      screen = <DeskScreen {...props} />;
      break;
    case 'create':
      screen = !isTeam ? (
        <Notifications {...props} />
      ) : sub === 'plan' ? (
        <PlanFlow {...props} />
      ) : sub === 'measure' ? (
        <MeasureFlow {...props} />
      ) : sub === 'client' ? (
        <AddClientFlow {...props} />
      ) : (
        <CreateScreen {...props} pick={setPicked} />
      );
      break;
    case 'account':
    case 'team':
      screen = <TeamScreen {...props} theme={{ choice, setChoice }} onSignOut={onSignOut} onChanged={() => void loadMe()} />;
      break;
    case 'playground':
    case 'narrate':
      screen = <PlaygroundScreen {...props} />;
      break;
    case 'rein':
      screen = <ReinScreen {...props} />;
      break;
    default:
      screen = <Notifications {...props} />;
  }

  const title =
    room === 'team' ? 'Team' : room === 'client' ? 'Your posts' : room === 'preview' ? 'Client' : room === 'play' ? 'Playground' : 'Account';
  const nested = head === 'rein';

  const budget = me.budget;
  const used = budget && budget.cap > 0 ? Math.min(100, Math.round((budget.used / budget.cap) * 100)) : 0;

  const tab = (to: string, label: string, icon: ReactNode, current: boolean, count = 0) => (
    <a
      href={`#${to}`}
      className="bl-tab"
      aria-label={count ? `${label}, ${count} need you` : label}
      aria-current={current ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault();
        go(to);
      }}
    >
      <span className="bl-tab-ic">
        {icon}
        {count > 0 && !current && <span className="bl-badge">{count}</span>}
      </span>
      {current && <span className="bl-tab-label">{label}</span>}
    </a>
  );

  let dock: ReactNode = null;
  if (room === 'team') {
    dock = (
      <nav aria-label="Team" className="bl-dock">
        {tab('today', 'Today', <Signal size={22} />, head === 'today', badge)}
        {tab('campaigns', 'Schedule', <Sequence size={22} />, head === 'campaigns' || head === 'approvals')}
        {tab('clients', 'Clients', <People size={22} />, ['clients', 'insights', 'library', 'brand', 'board', 'reports', 'desk'].includes(head))}
        {tab('create', 'Ask Bil', <Rise size={22} />, head === 'create')}
      </nav>
    );
  } else if (room === 'client') {
    dock = (
      <nav aria-label="Your posts" className="bl-dock">
        {tab('today', 'Today', <Signal size={22} />, head === 'today', badge)}
        {tab('campaigns', 'Schedule', <Sequence size={22} />, head === 'campaigns' || head === 'approvals' || head === 'reports' || head === 'desk')}
        {tab('library', 'Media', <Vault size={22} />, head === 'library' || head === 'board')}
        {tab('playground', 'Playground', <Reel size={22} />, false)}
      </nav>
    );
  } else if (room === 'preview') {
    dock = (
      <nav aria-label="Client view" className="bl-dock">
        {tab('client', 'Today', <Signal size={22} />, head === 'today')}
        {tab('client.campaigns', 'Schedule', <Sequence size={22} />, head === 'campaigns')}
      </nav>
    );
  }

  const showPicker = isTeam && clients.length > 0 && (room === 'team' || room === 'preview');
  // Screens about exactly one client pick one; there is no "All clients" there.
  const one = room === 'preview' || ['library', 'insights', 'brand', 'board', 'approvals', 'reports', 'desk'].includes(head) || (head === 'create' && sub !== '' && sub !== 'client');

  return wrap(
    <>
      <div className="bl-set" aria-hidden="true" />
      <div className={`bl-app${dock ? '' : ' no-dock'}`}>
        <header className="bl-top">
          <div className="bl-bar">
            <div className="bl-bar-start">
              {nested ? (
                <a
                  href="#playground"
                  className="bl-ghost bl-round"
                  aria-label="Back to the Playground"
                  onClick={(e) => {
                    e.preventDefault();
                    go('playground');
                  }}
                >
                  <Back />
                </a>
              ) : (
                <a
                  href="#home"
                  className="bl-ghost bl-round"
                  aria-label="Home"
                  onClick={(e) => {
                    e.preventDefault();
                    go('home');
                  }}
                >
                  <House />
                </a>
              )}
              <span className="bl-room-title">{nested ? (head === 'rein' ? 'Rein' : 'X') : title}</span>
            </div>
            <div className="bl-bar-end">
              {showPicker && (
                <label className="bl-ghost" style={{ position: 'relative', paddingRight: 14 }}>
                  <span className="bl-sr">Which client</span>
                  <span>{one ? `@${clients.find((c) => c.id === single)?.handle ?? ''}` : focus ? `@${clients.find((c) => c.id === focus)?.handle ?? ''}` : 'All clients'}</span>
                  <Chevron />
                  <select
                    value={one ? single ?? '' : picked}
                    onChange={(e) => setPicked(e.target.value)}
                    style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                  >
                    {!one && <option value="all">All clients</option>}
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        @{c.handle}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <a
                href="#account"
                className={`bl-avatar${isTeam ? '' : ' soft'}`}
                aria-label="Your account"
                onClick={(e) => {
                  e.preventDefault();
                  go('account');
                }}
              >
                {(me.username ?? '?').slice(0, 1)}
              </a>
            </div>
          </div>
          {head === 'create' && budget && (
            <div className="bl-spend">
              <span>Spent this month</span>
              <span className="num">
                ${budget.used.toFixed(2)} of ${budget.cap.toFixed(0)}
              </span>
              <span className="bl-meter-ink" role="img" aria-label={`${used} percent of this month's AI budget used`}>
                <span style={{ width: `${used}%` }} />
              </span>
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
      {dock}
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
