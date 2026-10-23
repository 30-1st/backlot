import { hosted } from './supabase';
import { isGuest } from './mode';
import * as inBrowser from './library.local';
import * as onServer from './library.cloud';
import type { Library } from './library.types';

// One library, two places it can live. The hosted build keeps it in Supabase
// behind a sign-in; the offline build, and someone trying the Playground without an
// account, keep it in this browser. Everything else in the app talks to the functions
// below and never needs to know which. The choice is made on every call, because a
// guest can make an account without reloading the page.

const pick = (): Library => (hosted && !isGuest() ? onServer : inBrowser);

export const listAccounts: Library['listAccounts'] = (...a) => pick().listAccounts(...a);
export const openNarration: Library['openNarration'] = (...a) => pick().openNarration(...a);
export const createAccount: Library['createAccount'] = (...a) => pick().createAccount(...a);
export const deleteAccount: Library['deleteAccount'] = (...a) => pick().deleteAccount(...a);
export const duplicateNarration: Library['duplicateNarration'] = (...a) => pick().duplicateNarration(...a);
export const renameNarration: Library['renameNarration'] = (...a) => pick().renameNarration(...a);
export const deleteNarration: Library['deleteNarration'] = (...a) => pick().deleteNarration(...a);
export const saveSandbox: Library['saveSandbox'] = (...a) => pick().saveSandbox(...a);
export const peekNarration: Library['peekNarration'] = (...a) => pick().peekNarration(...a);
export const saveSavePoint: Library['saveSavePoint'] = (...a) => pick().saveSavePoint(...a);
export const mediaInUse: Library['mediaInUse'] = (...a) => pick().mediaInUse(...a);

/** True when narrations are saved to an account rather than kept in this browser. */
export const savesToAccount = (): boolean => hosted && !isGuest();

export { SaveConflict, nextNarrationName } from './library.types';
export type { Account, NarrationMeta, NarrationState, OpenNarration, Person, ShareRole } from './library.types';
