import { hosted } from './supabase';
import * as inBrowser from './library.local';
import * as onServer from './library.cloud';
import type { Library } from './library.types';

// One library, two places it can live. The hosted build keeps it in Supabase
// behind a sign-in; the offline build keeps it in this browser. Everything
// else in the app talks to the functions below and never needs to know which.

const library: Library = hosted ? onServer : inBrowser;

export const listAccounts = library.listAccounts;
export const openNarration = library.openNarration;
export const createAccount = library.createAccount;
export const deleteAccount = library.deleteAccount;
export const duplicateNarration = library.duplicateNarration;
export const renameNarration = library.renameNarration;
export const deleteNarration = library.deleteNarration;
export const saveSandbox = library.saveSandbox;
export const peekNarration = library.peekNarration;
export const saveSavePoint = library.saveSavePoint;
export const mediaInUse = library.mediaInUse;

export { SaveConflict, nextNarrationName } from './library.types';
export type { Account, NarrationMeta, NarrationState, OpenNarration, Person, ShareRole } from './library.types';
