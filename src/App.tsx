import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { isReadyPlatform, type Platform } from './platforms';
import { Home } from './components/Home';
import { Accounts } from './components/Accounts';
import { People } from './components/People';
import { BilLab } from './components/BilLab';
import { Studio } from './Studio';
import { signOut, useLogin } from './lib/auth';
import { hosted } from './lib/supabase';
import { rememberGuest, setGuest, wasGuest } from './lib/mode';
import { isTeamRole, team, type Role } from './lib/team';
import { GuestStrip } from './components/GuestStrip';
import { MoveGuestWork } from './components/MoveGuestWork';
import { Gate } from './shell/Gate';
import { Shell, isShellPath } from './shell/Shell';
import './shell/shell.css';

// Three screens, one inside the next:
//   the homescreen            #home
//   a platform's accounts     #instagram
//   one narration's studio    #instagram.<narration id>
// and, in the hosted build, the people a creator works with:
//   contacts and chats        #people
//   one chat                  #people.<chat id>
//   Bil's test page           #bil
// The address keeps track, so Back and reload land where you expect.
//
// In the hosted build they sit behind the sign-in screen, except the Playground, which
// anyone may try without a login. That work stays in this browser (lib/mode.ts) until
// they make a login, and then it moves into the login (lib/adopt.ts).

interface Route {
  platform: Platform;
  narrationId?: string;
}

function readPath(): string {
  try {
    return window.location.hash.slice(1);
  } catch {
    return '';
  }
}

function parse(path: string): Route | null {
  const dot = path.indexOf('.');
  const platform = dot < 0 ? path : path.slice(0, dot);
  if (!isReadyPlatform(platform)) return null;
  const narrationId = dot < 0 ? '' : path.slice(dot + 1);
  return { platform, narrationId: narrationId || undefined };
}

/** The signed-in person's role, read once per login. Null until known. */
function useRole(userId: string | null): Role | null {
  const [role, setRole] = useState<Role | null>(null);
  useEffect(() => {
    setRole(null);
    if (!userId) return;
    let live = true;
    team.me().then(
      (m) => live && setRole(m.role),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [userId]);
  return role;
}

export default function App() {
  const login = useLogin();
  const [path, setPath] = useState(readPath);
  const [guest, setGuestChoice] = useState(() => hosted && wasGuest());
  const role = useRole(login.status === 'in' ? login.userId : null);
  // Where narrations are kept is decided before any screen reads them.
  setGuest(login.status === 'out' && guest);
  // A one-time message for the screen being opened, such as "this is a copy".
  const [flash, setFlash] = useState<{ path: string; text: string } | null>(null);

  useEffect(() => {
    const onHash = () => setPath(readPath());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((next: string, message?: string) => {
    setFlash(message ? { path: next, text: message } : null);
    setPath(next);
    try {
      const hash = `#${next || 'home'}`;
      if (window.location.hash !== hash) window.location.hash = hash;
      window.scrollTo(0, 0);
    } catch {
      // Some embedded views lock the address. The screen still changes.
    }
  }, []);

  if (login.status === 'loading') return <div className="app" aria-busy="true" />;
  // Just made a login or signed in from the Playground: straight back to the Playground.
  if (login.status === 'in' && (path === 'join' || path === 'in')) {
    queueMicrotask(() => go('playground'));
    return <div className="app" aria-busy="true" />;
  }
  const tryIt = () => {
    rememberGuest(true);
    setGuestChoice(true);
    go('');
  };
  const leaveTrial = () => {
    rememberGuest(false);
    setGuestChoice(false);
    go('');
  };
  // Signed out: the welcome page and sign-in, unless they chose to try the Playground.
  if (login.status === 'out' && !guest) return <Gate onTry={tryIt} />;
  if (login.status === 'out' && (path === 'join' || path === 'in')) {
    return <Gate key={path} start={path} onLeave={() => go('')} />;
  }

  // In the hosted build, show who is signed in and let them leave.
  // Keying each screen by the login makes sure nothing carries over between people.
  const who = login.status === 'in' ? login.userId : login.status === 'out' ? 'guest' : 'offline';
  const onSignOut = () => {
    go('');
    void signOut();
  };
  // People, chats and sharing need a login and are for the team and clients; Bil's test
  // page is the team's. Playground logins (visitors) get neither.
  const inTeamSpace = login.status === 'in' && role !== null && role !== 'visitor';
  const account =
    login.status === 'in' ? { username: login.username, onSignOut, ...(inTeamSpace ? { onPeople: () => go('people') } : {}) } : {};
  const bil = login.status === 'in' && isTeamRole(role) ? { onBil: () => go('bil'), onBack: () => go('home') } : {};
  const moving = login.status === 'in' ? <MoveGuestWork key={who} onMoved={() => go(path)} /> : null;
  const withMove = (screen: ReactNode) => (
    <>
      {screen}
      {moving}
    </>
  );
  // Trying without a login: a strip above every screen offers to save the work.
  const withStrip = (screen: ReactNode) =>
    login.status === 'out' ? (
      <>
        <GuestStrip onSave={() => go('join')} onLeave={leaveTrial} />
        {screen}
      </>
    ) : (
      withMove(screen)
    );

  // The app shell: notifications, create, library, campaigns, insights, team.
  if (login.status === 'in' && isShellPath(path)) return withMove(<Shell key={who} path={path} go={go} onSignOut={onSignOut} />);

  if (login.status === 'in' && path === 'bil' && isTeamRole(role)) return <BilLab key={who} onHome={() => go('')} />;

  if (inTeamSpace && (path === 'people' || path.startsWith('people.'))) {
    return (
      <People
        key={who}
        me={{ id: login.userId, username: login.username }}
        chatId={path.slice('people.'.length) || undefined}
        onHome={() => go('')}
        onChat={(id) => go(id ? `people.${id}` : 'people')}
        onOpenNarration={(platform, id) => go(`${platform}.${id}`)}
        onSignOut={onSignOut}
      />
    );
  }

  // In the hosted build the narration tools live in the Playground (#playground);
  // the offline build keeps it as its homescreen.
  const home = login.status === 'in' ? 'playground' : '';
  const route = parse(path);
  if (!route) return withStrip(<Home key={who} onChoose={(platform) => go(platform)} {...account} {...bil} />);

  const { platform, narrationId } = route;
  const open = (id: string, message?: string) => go(`${platform}.${id}`, message);
  const note = flash?.path === path ? flash.text : undefined;

  if (!narrationId) {
    return withStrip(
      <Accounts
        key={`${who}:${platform}`}
        platform={platform}
        flash={note}
        onHome={() => go(home)}
        onOpen={open}
        {...account}
      />,
    );
  }

  return withStrip(
    <Studio
      key={`${who}:${narrationId}`}
      platform={platform}
      narrationId={narrationId}
      flash={note}
      onHome={() => go(home)}
      onAccounts={(message) => go(platform, message)}
      onOpen={open}
      onPeople={inTeamSpace ? () => go('people') : undefined}
    />,
  );
}
