import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';

// Light (off-white and teal) or Night (the original stage colours and brass).
// "Match phone" follows the device's dark mode. The choice is a per-device convenience,
// so it lives in this browser only. Light is the default until someone picks otherwise.

export type ThemeChoice = 'light' | 'night' | 'system';
export type Theme = 'light' | 'night';

const KEY = 'backlot.theme';

function readChoice(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'light' || v === 'night' || v === 'system' ? v : 'light';
  } catch {
    return 'light';
  }
}

function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'light';
  } catch {
    return 'light';
  }
}

export type ThemeState = { theme: Theme; choice: ThemeChoice; setChoice: (c: ThemeChoice) => void };

const ThemeContext = createContext<ThemeState | null>(null);

/** One theme for the whole app, so a switch anywhere changes every screen at once. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return createElement(ThemeContext.Provider, { value: useThemeState() }, children);
}

export function useTheme(): ThemeState {
  const t = useContext(ThemeContext);
  if (!t) throw new Error('useTheme needs ThemeProvider');
  return t;
}

function useThemeState(): ThemeState {
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
