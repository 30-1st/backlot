import { PaperPlayground, PlaygroundHologram } from './PlaygroundHologram';
import type { ScreenProps } from './Shell';

// The Playground: narrate an Instagram or X profile post by post, or search what is rising
// with Rein. Open to the team, clients and casual members alike. The paper playground sets
// the scene; the hologram is the way in.

export function PlaygroundScreen({ go }: ScreenProps) {
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
      <PaperPlayground />
      <PlaygroundHologram go={go} />
    </main>
  );
}
