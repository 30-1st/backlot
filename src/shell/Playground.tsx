import { Bubble, Page, Radar } from './icons';
import { Deck, type Room } from './Rooms';
import type { ScreenProps } from './Shell';

// The Playground: narrate an Instagram or X profile post by post, or search what is rising
// with Rein. Open to the team, clients and casual members alike.

export function PlaygroundScreen({ go }: ScreenProps) {
  const tools: Room[] = [
    { key: 'ig', name: 'Instagram', path: 'instagram', icon: <Page /> },
    { key: 'x', name: 'X', path: 'narrate-x', icon: <Bubble /> },
    { key: 'rein', name: 'Rein', path: 'rein', icon: <Radar /> },
  ];
  return (
    <main className="bl-play">
      <div className="bl-play-head">
        <h2 className="bl-greet" style={{ fontSize: 32 }}>
          What are we making?
        </h2>
        <p className="bl-home-ask bl-in" style={{ animationDelay: '60ms' }}>
          Narrate a profile post by post, or find what is rising.
        </p>
      </div>
      <Deck rooms={tools} go={go} label="Playground tools" />
    </main>
  );
}

/** Honest holding screens for the two tools whose builds come in the Playground step. */
export function PlaygroundSoon({ go, tool }: ScreenProps & { tool: 'x' | 'rein' }) {
  const copy =
    tool === 'x'
      ? {
          icon: <Bubble size={52} />,
          title: 'X narration',
          body: 'The X profile page is being built next. It opens here as soon as it is ready, unlocked for everyone.',
        }
      : {
          icon: <Radar size={52} />,
          title: 'Rein',
          body: 'Rein searches what is rising in any niche. 3 searches are free, then $5 a search or $15 a month. Her search screen is being built next.',
        };
  return (
    <main className="bl-play">
      <div className="bl-play-head">
        <span className="bl-home-logo bl-in">{copy.icon}</span>
        <span className="bl-home-pool bl-in" aria-hidden="true" />
        <h2 className="bl-greet" style={{ fontSize: 32 }}>
          {copy.title}
        </h2>
        <p className="bl-home-ask bl-in" style={{ maxWidth: 320, margin: '12px auto 0' }}>
          {copy.body}
        </p>
        <button type="button" className="bl-ghost bl-in" style={{ marginTop: 24 }} onClick={() => go('playground')}>
          Back to the Playground
        </button>
      </div>
    </main>
  );
}
