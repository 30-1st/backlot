import { setStorageName } from './db';

// Guest mode: someone trying the Playground in the hosted build without an account.
// Their narrations and photos stay in this browser, in a store of their own, until they
// make an account and move the work into it (lib/adopt.ts). Nothing is uploaded before.

let guest = false;

export function setGuest(on: boolean): void {
  guest = on;
  setStorageName(on ? 'backlot-guest' : 'backlot');
}

export function isGuest(): boolean {
  return guest;
}

const FLAG = 'backlot.guest';

/** Remembers that this browser chose to try Backlot without an account. */
export function rememberGuest(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(FLAG, '1');
    else window.localStorage.removeItem(FLAG);
  } catch {
    // Private windows may refuse; the choice then lasts for this visit only.
  }
}

export function wasGuest(): boolean {
  try {
    return window.localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}
