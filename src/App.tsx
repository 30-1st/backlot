import { useCallback, useEffect, useState } from 'react';
import { isReadyPlatform, type Platform } from './platforms';
import { Home } from './components/Home';
import { Studio } from './Studio';

// Two screens: the homescreen, and the studio for whichever platform was chosen.
// The address keeps track (#instagram), so Back and reload land where you expect.

function readRoute(): Platform | null {
  try {
    const id = window.location.hash.slice(1);
    return isReadyPlatform(id) ? id : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [route, setRoute] = useState<Platform | null>(readRoute);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((next: Platform | null) => {
    setRoute(next);
    try {
      const hash = next ? `#${next}` : '#home';
      if (window.location.hash !== hash) window.location.hash = hash;
      window.scrollTo(0, 0);
    } catch {
      // Some embedded views lock the address. The screen still changes.
    }
  }, []);

  return route ? <Studio key={route} platform={route} onHome={() => go(null)} /> : <Home onChoose={go} />;
}
