import { useCallback, useEffect, useState } from 'react';
import { isReadyPlatform, type Platform } from './platforms';
import { Home } from './components/Home';
import { Accounts } from './components/Accounts';
import { Studio } from './Studio';

// Three screens, one inside the next:
//   the homescreen            #home
//   a platform's accounts     #instagram
//   one narration's studio    #instagram.<narration id>
// The address keeps track, so Back and reload land where you expect.

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

  const route = parse(path);
  if (!route) return <Home onChoose={(platform) => go(platform)} />;

  const { platform, narrationId } = route;
  const open = (id: string, message?: string) => go(`${platform}.${id}`, message);

  if (!narrationId) {
    return <Accounts key={platform} platform={platform} onHome={() => go('')} onOpen={open} />;
  }

  return (
    <Studio
      key={narrationId}
      platform={platform}
      narrationId={narrationId}
      flash={flash?.path === path ? flash.text : undefined}
      onHome={() => go('')}
      onAccounts={() => go(platform)}
      onOpen={open}
    />
  );
}
