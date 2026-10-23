import type { Sandbox, SavePoint } from '../types';
import { isReadyPlatform } from '../platforms';
import { referencedMedia } from '../state';
import { blobDelete, blobGet, setStorageOverride } from './db';
import * as local from './library.local';
import * as cloud from './library.cloud';
import { currentUserId, supabase } from './supabase';

// Moving a guest's Playground work into the account they just made or signed in to.
// Each narration, its save point and its photos and videos are copied to the account,
// and only once a whole account copied cleanly is it removed from this browser. If
// anything fails, the browser copy stays, so nothing is ever lost on the way.

type Read = { platform: string; narrations: Array<{ name: string; sandbox: Sandbox; savePoint?: SavePoint }>; blobs: Map<string, Blob> };

// One guest read at a time, so one finishing can never switch storage back under another.
let turn: Promise<unknown> = Promise.resolve();

/** Reads and writes the guest store, then always points storage back at the account's cache. */
function fromGuest<T>(work: () => Promise<T>): Promise<T> {
  const run = turn.then(async () => {
    setStorageOverride('backlot-guest');
    try {
      return await work();
    } finally {
      setStorageOverride(null);
    }
  });
  turn = run.catch(() => undefined);
  return run;
}

/** How many narrations this browser holds from trying Backlot without an account. */
export async function guestNarrationCount(): Promise<number> {
  try {
    const accounts = await fromGuest(() => local.listAccounts());
    return accounts.filter((a) => isReadyPlatform(a.platform)).reduce((n, a) => n + a.narrations.length, 0);
  } catch {
    return 0;
  }
}

async function readAccount(accountId: string): Promise<Read | null> {
  return fromGuest(async () => {
    const account = (await local.listAccounts()).find((a) => a.id === accountId);
    if (!account) return null;
    const narrations: Read['narrations'] = [];
    const ids = new Set<string>();
    for (const meta of account.narrations) {
      const open = await local.openNarration(meta.id);
      if (!open) continue;
      narrations.push({ name: meta.name, sandbox: open.sandbox, savePoint: open.savePoint });
      for (const id of referencedMedia(open.sandbox)) ids.add(id);
      if (open.savePoint) for (const id of referencedMedia(open.savePoint.sandbox)) ids.add(id);
    }
    const blobs = new Map<string, Blob>();
    for (const id of ids) {
      // The example profile's pictures are drawn in code and have no stored file.
      const blob = await blobGet(id).catch(() => undefined);
      if (blob) blobs.set(id, blob);
    }
    return { platform: account.platform, narrations, blobs };
  });
}

/** Copies every guest narration into the signed-in account. Resolves to how many moved. */
export async function moveGuestWork(onStep?: (done: number, total: number) => void): Promise<{ moved: number; failed: number }> {
  if (!supabase) return { moved: 0, failed: 0 };
  const owner = await currentUserId();
  if (!owner) throw new Error('Sign in first.');
  const accounts = (await fromGuest(() => local.listAccounts())).filter((a) => isReadyPlatform(a.platform));
  const total = accounts.reduce((n, a) => n + a.narrations.length, 0);
  let moved = 0;
  let failed = 0;

  for (const account of accounts) {
    const read = await readAccount(account.id);
    if (!read || read.narrations.length === 0 || !isReadyPlatform(read.platform)) continue;
    let made: string | null = null;
    const before = moved;
    try {
      // Same file names in the account's folder, so every narration still points at them.
      for (const [id, blob] of read.blobs) {
        const { error } = await supabase.storage
          .from('media')
          .upload(`${owner}/${id}`, blob, { contentType: blob.type || 'application/octet-stream', cacheControl: '31536000', upsert: false });
        if (error && !/exists|duplicate/i.test(error.message)) throw error;
      }
      const [first, ...rest] = read.narrations;
      const meta = await cloud.createAccount(read.platform, first.sandbox, first.name);
      made = meta.id;
      if (first.savePoint) await cloud.saveSavePoint(meta.id, first.savePoint);
      moved += 1;
      onStep?.(moved, total);
      for (const n of rest) {
        const copy = await cloud.duplicateNarration(meta.id, n.name);
        if (!copy) throw new Error('Could not copy a narration.');
        await cloud.saveSandbox(copy.id, n.sandbox);
        await cloud.saveSavePoint(copy.id, n.savePoint ?? { sandbox: n.sandbox, savedAt: Date.now() });
        moved += 1;
        onStep?.(moved, total);
      }
      // Copied cleanly: now it can leave this browser.
      await fromGuest(async () => {
        await local.deleteAccount(account.id);
        for (const id of read.blobs.keys()) await blobDelete(id).catch(() => undefined);
      });
    } catch (err) {
      console.error('moving guest work failed', err instanceof Error ? err.message : err);
      // Undo a half-made copy, so trying again cannot leave two of the same account.
      // The browser copy is untouched; files already uploaded are tidied by the usual cleanup.
      if (made) {
        try {
          const open = await cloud.openNarration(made);
          if (open) await cloud.deleteAccount(open.account.id);
        } catch {
          // Leaving a stray copy is better than losing anything.
        }
      }
      moved = before;
      failed += read.narrations.length;
    }
  }
  return { moved, failed };
}
