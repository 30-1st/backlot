import { AGENT_NAMES, banterOn, pickLine } from './banter';

// The opening screen lives in index.html, so it shows before any script arrives. This
// file gives it the person's chosen look and a line of banter, and lifts it once the first
// real screen is ready.
//
// How long it stays:
//   * The first open of the day on this device plays in full (about 2.4 seconds), so the
//     door lights up and the agents finish their exchange. A tap skips it.
//   * Every other open lifts the moment the app is ready, so a busy day of quick check-ins
//     never waits on it.
//   * If something goes wrong before the first screen, it gets out of the way at 12 seconds.

const FULL_MS = 2400;
const DAY_KEY = 'backlot.splash.day';

let lifted = false;
let started = 0;
let full = false;
let ready = false;

function el(): HTMLElement | null {
  try {
    return document.getElementById('bl-splash');
  } catch {
    return null;
  }
}

function themeChoice(): 'light' | 'night' {
  try {
    const v = window.localStorage.getItem('backlot.theme');
    if (v === 'night') return 'night';
    if (v === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'light';
  } catch {
    // Fall through to the default look.
  }
  return 'light';
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function firstOpenToday(): boolean {
  try {
    if (window.localStorage.getItem(DAY_KEY) === today()) return false;
    window.localStorage.setItem(DAY_KEY, today());
    return true;
  } catch {
    // No storage: never hold people up.
    return false;
  }
}

export function dressSplash(): void {
  const s = el();
  if (!s) return;
  started = 0; // Count from when the page began loading, not from when this script ran.
  s.dataset.theme = themeChoice();
  full = firstOpenToday();
  const line = document.getElementById('bl-splash-line');
  if (line && banterOn()) {
    line.replaceChildren(
      ...pickLine('open').map(([who, text]) => {
        const row = document.createElement('span');
        const b = document.createElement('b');
        b.textContent = AGENT_NAMES[who];
        row.append(b, document.createTextNode(` ${text}`));
        return row;
      }),
    );
  }
  if (full) {
    const skip = document.getElementById('bl-splash-skip');
    if (skip) skip.hidden = false;
    // Skipping only lifts it once the app is ready behind it; until then a tap does nothing.
    s.addEventListener('pointerdown', () => {
      full = false;
      if (ready) lift();
    });
  }
  window.setTimeout(lift, 12_000);
}

function lift(): void {
  if (lifted) return;
  const s = el();
  if (!s) return;
  lifted = true;
  s.classList.add('gone');
  window.setTimeout(() => s.remove(), 450);
}

/** Called when the first real screen is ready. */
export function liftSplash(): void {
  ready = true;
  if (lifted) return;
  const wait = full ? FULL_MS - (performance.now() - started) : 0;
  if (wait > 0) window.setTimeout(() => lift(), wait);
  else lift();
}
