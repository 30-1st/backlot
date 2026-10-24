import { AGENT_NAMES, banterOn, pickLine } from './banter';

// The opening screen lives in index.html, so it shows before any script arrives. This
// file gives it the person's chosen look and a line of banter, and lifts it as soon as the
// first real screen is ready. It never waits longer than the app does.

let lifted = false;

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

export function dressSplash(): void {
  const s = el();
  if (!s) return;
  s.dataset.theme = themeChoice();
  const line = document.getElementById('bl-splash-line');
  if (line && banterOn()) {
    line.replaceChildren(
      ...pickLine('open').flatMap(([who, text], i) => {
        const b = document.createElement('b');
        b.textContent = AGENT_NAMES[who];
        const parts: Node[] = [b, document.createTextNode(` ${text}`)];
        if (i > 0) parts.unshift(document.createElement('br'));
        return parts;
      }),
    );
  }
  // If something goes wrong before the first screen, never leave people staring at it.
  window.setTimeout(liftSplash, 12_000);
}

export function liftSplash(): void {
  if (lifted) return;
  const s = el();
  if (!s) return;
  lifted = true;
  s.classList.add('gone');
  window.setTimeout(() => s.remove(), 400);
}
