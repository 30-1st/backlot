import { useState, type ReactNode } from 'react';
import type { Me } from '../lib/team';
import { Logo } from '../components/ui';
import { Clapper, Reel, StarDoor } from './icons';
import { ModeSwitch } from './ModeSwitch';

// Home: three rooms (two for a client) on a lit stage. A warm key light falls from the
// top onto the Backlot mark, and a small beam inside the glass panel follows whichever
// room you point at. Teal only marks what you can tap.

export type Room = { key: string; name: string; path: string; icon: ReactNode };

const RAYS: Array<[number, number, number, number, number]> = [
  [-34, 70, 14, 11, 0],
  [-19, 46, 10, 9, -3],
  [-6, 90, 18, 13, -6],
  [8, 54, 12, 10, -2],
  [21, 80, 16, 12, -5],
  [35, 44, 10, 8, -1],
];
const MOTES: Array<[number, number, number, number]> = [
  [46, 52, 9, 0],
  [55, 74, 12, -4],
  [43, 92, 10, -7],
  [58, 40, 14, -2],
  [50, 100, 11, -9],
];

function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 5) return 'Good evening.';
  if (h < 12) return 'Good morning.';
  if (h < 18) return 'Good afternoon.';
  return 'Good evening.';
}

/** The lit stage behind Home: key light, cone, rays, a little dust, and the floor. */
export function Stage() {
  return (
    <div className="bl-stage" aria-hidden="true">
      <div className="bl-sun" />
      <div className="bl-cone-wrap">
        <div className="bl-cone" />
      </div>
      <div className="bl-rays">
        {RAYS.map(([a, w, b, d, o], i) => (
          <span
            key={i}
            className="bl-ray"
            style={{ ['--a' as string]: `${a}deg`, ['--w' as string]: `${w}px`, ['--b' as string]: `${b}px`, ['--d' as string]: `${d}s`, ['--o' as string]: `${o}s` }}
          />
        ))}
      </div>
      <div className="bl-motes">
        {MOTES.map(([x, y, d, o], i) => (
          <i key={i} style={{ left: `${x}%`, top: `${y}px`, ['--d' as string]: `${d}s`, ['--o' as string]: `${o}s` }} />
        ))}
      </div>
      <div className="bl-floor" />
      <div className="bl-vignette" />
    </div>
  );
}

/** A glass panel of rooms or tools. The small beam rests on the first and follows the pointer. */
export function Deck({ rooms, go, label }: { rooms: Room[]; go: (p: string) => void; label: string }) {
  const [at, setAt] = useState(0);
  return (
    <nav className={`bl-deck${rooms.length === 2 ? ' two' : ''} bl-in`} aria-label={label} style={{ animationDelay: '140ms' }}>
      <span className="bl-deck-glow" aria-hidden="true" style={{ width: `${100 / rooms.length}%`, transform: `translateX(${at * 100}%)` }}>
        <span className="bl-deck-beam">
          <i />
        </span>
      </span>
      {rooms.map((r, i) => (
        <a
          key={r.key}
          href={`#${r.path}`}
          className={`bl-room${i === at ? ' lit' : ''}`}
          onMouseEnter={() => setAt(i)}
          onFocus={() => setAt(i)}
          onClick={(e) => {
            e.preventDefault();
            go(r.path);
          }}
        >
          {r.icon}
          <span className="bl-room-name">{r.name}</span>
        </a>
      ))}
    </nav>
  );
}

export function HomeRooms({ me, go, needs }: { me: Me; go: (p: string) => void; needs: number }) {
  const isTeam = me.role !== 'client';
  const now = new Date();
  const rooms: Room[] = isTeam
    ? [
        { key: 'team', name: 'Team', path: 'today', icon: <Clapper /> },
        { key: 'client', name: 'Client', path: 'client', icon: <StarDoor /> },
        { key: 'play', name: 'Playground', path: 'playground', icon: <Reel /> },
      ]
    : [
        { key: 'posts', name: 'Your posts', path: 'today', icon: <StarDoor /> },
        { key: 'play', name: 'Playground', path: 'playground', icon: <Reel /> },
      ];
  const foot = needs > 0 ? `${needs} ${needs === 1 ? 'thing needs' : 'things need'} you` : 'All caught up';

  return (
    <div className="bl-home">
      <Stage />
      <header className="bl-bar bl-home-bar">
        <span className="bl-word">Backlot</span>
        <div className="bl-bar-end">
          <ModeSwitch />
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
      </header>
      <main className="bl-home-main">
        <section className="bl-home-hero">
          <span className="bl-home-logo bl-in">
            <Logo size={60} />
          </span>
          <span className="bl-home-pool bl-in" aria-hidden="true" style={{ animationDelay: '40ms' }} />
          <p className="bl-home-date bl-in" style={{ animationDelay: '60ms' }}>
            {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <h1 className="bl-greet">{greeting(now)}</h1>
        </section>
        <section className="bl-home-pick">
          <p className="bl-home-ask bl-in" style={{ animationDelay: '120ms' }}>
            Where are you working?
          </p>
          <Deck rooms={rooms} go={go} label="Rooms" />
        </section>
      </main>
      <p className="bl-home-foot bl-in" style={{ animationDelay: '380ms' }}>
        <span className="bl-live-dot" aria-hidden="true" />
        {foot}
      </p>
    </div>
  );
}
