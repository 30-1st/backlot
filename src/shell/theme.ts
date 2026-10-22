import { useEffect, useState } from 'react';

// Light (off-white and teal) or Night (the original stage colours and brass).
// "Match phone" follows the device's dark mode. The choice is a per-device convenience,
// so it lives in this browser only; if storage is blocked, Match phone is used.

export type ThemeChoice = 'light' | 'night' | 'system';
export type Theme = 'light' | 'night';

const KEY = 'backlot.theme';

function readChoice(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'light' || v === 'night' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'light';
  } catch {
    return 'light';
  }
}

export function useTheme(): { theme: Theme; choice: ThemeChoice; setChoice: (c: ThemeChoice) => void } {
  const [choice, setChoiceState] = useState<ThemeChoice>(readChoice);
  const [system, setSystem] = useState<Theme>(systemTheme);

  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const on = () => setSystem(mq!.matches ? 'night' : 'light');
    mq.addEventListener('change', on);
    return () => mq!.removeEventListener('change', on);
  }, []);

  const theme: Theme = choice === 'system' ? system : choice;

  // The page behind the app (overscroll, the address bar on phones) matches too.
  useEffect(() => {
    document.body.dataset.bl = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'night' ? '#0e1412' : '#f3f2ee');
    return () => {
      delete document.body.dataset.bl;
    };
  }, [theme]);

  const setChoice = (c: ThemeChoice) => {
    setChoiceState(c);
    try {
      window.localStorage.setItem(KEY, c);
    } catch {
      // Storage blocked: the choice lasts until the page closes.
    }
  };

  return { theme, choice, setChoice };
}
