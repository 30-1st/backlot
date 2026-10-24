import { useEffect, useState } from 'react';
import { AGENT_NAMES, banterMounted, pickLine, useBanterOn, type Moment, type Turn } from '../lib/banter';

// One short exchange between the agents, revealed a line at a time like a chat. It sits
// beside the real status text (which says plainly what is happening), so it is hidden from
// screen readers: they already hear the status, and do not need the jokes read aloud.

const GAP_MS = 1100;

export function Banter({ moment, after = 0, className, counts = true }: { moment: Moment; after?: number; className?: string; counts?: boolean }) {
  const [on] = useBanterOn();
  const [turns] = useState<Turn[]>(() => pickLine(moment));
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!on || !counts) return;
    banterMounted(1);
    return () => banterMounted(-1);
  }, [on, counts]);

  useEffect(() => {
    if (!on) return;
    const reduce = (() => {
      try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch {
        return false;
      }
    })();
    if (reduce) {
      const t = window.setTimeout(() => setShown(turns.length), after);
      return () => window.clearTimeout(t);
    }
    const timers = turns.map((_, i) => window.setTimeout(() => setShown(i + 1), after + i * GAP_MS));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [on, turns, after]);

  if (!on || shown === 0) return null;
  return (
    <div className={`bl-banter${className ? ` ${className}` : ''}`} aria-hidden="true">
      {turns.slice(0, shown).map(([who, text], i) => (
        <p key={i} className={`bl-banter-line ${who}`}>
          <b>{AGENT_NAMES[who]}</b> {text}
        </p>
      ))}
    </div>
  );
}
