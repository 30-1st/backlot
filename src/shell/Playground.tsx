import { Bubble, Page, Radar } from './icons';
import { Deck, type Room } from './Rooms';
import type { ScreenProps } from './Shell';

// The Playground: narrate an Instagram or X profile post by post, or search what is rising
// with Rein. Open to the team, clients and casual members alike.

export function PlaygroundScreen({ go }: ScreenProps) {
  const tools: Room[] = [
    { key: 'ig', name: 'Instagram', path: 'instagram', icon: <Page /> },
    { key: 'x', name: 'X', path: 'x', icon: <Bubble /> },
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
