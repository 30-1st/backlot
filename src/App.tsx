import { useCallback, useEffect, useState } from 'react';
import { isReadyPlatform, type Platform } from './platforms';
import { Home } from './components/Home';
import { Accounts } from './components/Accounts';
import { SignIn } from './components/SignIn';
import { People } from './components/People';
import { BilLab } from './components/BilLab';
import { Studio } from './Studio';
import { signOut, useLogin } from './lib/auth';

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
// In the hosted build all of them sit behind the sign-in screen.

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

export default function App() {
  const login = useLogin();
  const [path, setPath] = useState(readPath);
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
  if (login.status === 'out') return <SignIn />;

  // In the hosted build, show who is signed in and let them leave.
  // Keying each screen by the login makes sure nothing carries over between people.
  const who = login.status === 'in' ? login.userId : 'offline';
  const onSignOut = () => {
    go('');
    void signOut();
  };
  // People, chats and sharing need a login, so they only exist in the hosted build.
  const account = login.status === 'in' ? { username: login.username, onSignOut, onPeople: () => go('people') } : {};
  const bil = login.status === 'in' ? { onBil: () => go('bil') } : {};

  if (login.status === 'in' && path === 'bil') return <BilLab key={who} onHome={() => go('')} />;

  if (login.status === 'in' && (path === 'people' || path.startsWith('people.'))) {
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

  const route = parse(path);
  if (!route) return <Home key={who} onChoose={(platform) => go(platform)} {...account} {...bil} />;

  const { platform, narrationId } = route;
  const open = (id: string, message?: string) => go(`${platform}.${id}`, message);
  const note = flash?.path === path ? flash.text : undefined;

  if (!narrationId) {
    return (
      <Accounts
        key={`${who}:${platform}`}
        platform={platform}
        flash={note}
        onHome={() => go('')}
        onOpen={open}
        {...account}
      />
    );
  }

  return (
    <Studio
      key={`${who}:${narrationId}`}
      platform={platform}
      narrationId={narrationId}
      flash={note}
      onHome={() => go('')}
      onAccounts={(message) => go(platform, message)}
      onOpen={open}
      onPeople={login.status === 'in' ? () => go('people') : undefined}
    />
  );
}
