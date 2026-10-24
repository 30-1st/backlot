import { useEffect, useState } from 'react';

// Counts the server requests a person caused, so the app can show a thin progress bar when
// one takes a while. Background refreshes (the app checking for news on its own) are left
// out: a request counts only when it starts soon after a tap, a key press or a screen
// change. Otherwise the bar would flicker on its own and mean nothing.

const RECENT_MS = 1500;
let lastAct = 0;
let active = 0;
const listeners = new Set<(n: number) => void>();

function emit() {
  listeners.forEach((f) => f(active));
}

if (typeof window !== 'undefined') {
  const mark = () => {
    lastAct = Date.now();
  };
  window.addEventListener('pointerdown', mark, { capture: true, passive: true });
  window.addEventListener('keydown', mark, { capture: true, passive: true });
  window.addEventListener('hashchange', mark);
  // The first load counts as asked for.
  mark();
}

/** A fetch that reports the requests a person is waiting on. Pass to the Supabase client. */
export const trackedFetch: typeof fetch = async (input, init) => {
  const counted = Date.now() - lastAct < RECENT_MS;
  if (counted) {
    active += 1;
    emit();
  }
  try {
    return await fetch(input, init);
  } finally {
    if (counted) {
      active -= 1;
      emit();
    }
  }
};

/** How many requests the person is waiting on right now. */
export function useActive(): number {
  const [n, setN] = useState(active);
  useEffect(() => {
    listeners.add(setN);
    setN(active);
    return () => {
      listeners.delete(setN);
    };
  }, []);
  return n;
}
