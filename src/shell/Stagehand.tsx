import { useEffect, useRef, useState } from 'react';
import { useActive } from '../lib/activity';
import { useBanterMounted } from '../lib/banter';
import { Banter } from './Banter';
import { useTheme } from './theme';

// The stagehand works the edges of every screen:
//   * a thin progress bar when something the person asked for takes longer than 0.4 s
//     (under that, waiting feels instant, so a bar would only add noise);
//   * one line of agent banter if the wait passes 2.5 s and no other banter is showing;
//   * a short note when a link opens in a new tab, so the jump never feels like a glitch.

const SHOW_AFTER_MS = 400;
const TALK_AFTER_MS = 2500;
const OUT_MS = 3400;

export function Stagehand() {
  const { theme } = useTheme();
  const active = useActive();
  const others = useBanterMounted();
  const [phase, setPhase] = useState<'idle' | 'run' | 'done'>('idle');
  const [talk, setTalk] = useState(false);
  const [out, setOut] = useState<{ host: string; n: number } | null>(null);
  const running = useRef(false);

  useEffect(() => {
    if (active > 0) {
      if (running.current) return;
      running.current = true;
      const show = window.setTimeout(() => setPhase('run'), SHOW_AFTER_MS);
      const speak = window.setTimeout(() => setTalk(true), TALK_AFTER_MS);
      return () => {
        window.clearTimeout(show);
        window.clearTimeout(speak);
      };
    }
    running.current = false;
    setTalk(false);
    setPhase((p) => (p === 'run' ? 'done' : 'idle'));
    const t = window.setTimeout(() => setPhase('idle'), 450);
    return () => window.clearTimeout(t);
  }, [active > 0]);

  useEffect(() => {
    let n = 0;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target !== '_blank') return;
      try {
        const u = new URL(a.href, window.location.href);
        if (u.origin === window.location.origin || !/^https?:$/.test(u.protocol)) return;
        n += 1;
        setOut({ host: u.hostname.replace(/^www\./, ''), n });
      } catch {
        // Not a real address. Nothing to say.
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  useEffect(() => {
    if (!out) return;
    const t = window.setTimeout(() => setOut(null), OUT_MS);
    return () => window.clearTimeout(t);
  }, [out]);

  return (
    <div className="bl-stagehand" data-theme={theme}>
      {phase !== 'idle' && <div className={`bl-progress ${phase}`} role="progressbar" aria-label="Loading" aria-busy={phase === 'run'} />}
      {talk && phase === 'run' && others === 0 && (
        <div className="bl-wait-chip">
          <Banter moment="wait" counts={false} />
        </div>
      )}
      {out && (
        <div className="bl-out-note" key={out.n} role="status">
          <span>Opening {out.host} in a new tab</span>
          <Banter moment="out" after={350} counts={false} />
        </div>
      )}
    </div>
  );
}
