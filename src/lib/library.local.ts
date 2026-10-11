import type { Sandbox, SavePoint } from '../types';
import { PLATFORMS, type Platform } from '../platforms';
import { referencedMedia } from '../state';
import { uid } from './media';
import { kvDelete, kvGet, kvSet } from './db';
import {
  describe,
  isSandbox,
  isSavePoint,
  type Account,
  type NarrationMeta,
  type NarrationState,
  type OpenNarration,
} from './library.types';

// The library kept in this browser (IndexedDB). Used by the offline build,
// where there is no sign-in and nothing leaves the device.

interface Index {
  version: 1;
  accounts: Account[];
}

const INDEX_KEY = 'library';
const sandboxKey = (id: string) => `narration:${id}:sandbox`;
const savePointKey = (id: string) => `narration:${id}:savePoint`;

// Changes to the index read it, alter it, and write it back. Running them one
// at a time keeps two quick actions from overwriting each other.
let queue: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

async function readIndex(): Promise<Index> {
  const found = await kvGet<Index>(INDEX_KEY);
  if (found?.version === 1 && Array.isArray(found.accounts)) return found;

  // First run with accounts. Earlier builds kept one profile per platform
  // (and before that, a single profile). Carry those over as accounts so
  // nobody loses their work.
  const index: Index = { version: 1, accounts: [] };
  const stale: string[] = [];
  for (const { id: platform } of PLATFORMS) {
    let sandbox = await kvGet<unknown>(`sandbox:${platform}`);
    let point = await kvGet<unknown>(`savePoint:${platform}`);
    stale.push(`sandbox:${platform}`, `savePoint:${platform}`);
    if (platform === 'instagram' && !isSandbox(sandbox)) {
      sandbox = await kvGet<unknown>('sandbox');
      point = await kvGet<unknown>('savePoint');
    }
    if (!isSandbox(sandbox)) continue;
    const now = Date.now();
    const meta: NarrationMeta = { id: uid('n'), name: 'Original', createdAt: now, updatedAt: now, ...describe(sandbox) };
    await kvSet(sandboxKey(meta.id), sandbox);
    if (isSavePoint(point)) await kvSet(savePointKey(meta.id), point);
    index.accounts.push({ id: uid('a'), platform, createdAt: now, narrations: [meta] });
  }
  await kvSet(INDEX_KEY, index);
  for (const key of [...stale, 'sandbox', 'savePoint']) await kvDelete(key).catch(() => undefined);
  return index;
}

function find(index: Index, narrationId: string): { account: Account; meta: NarrationMeta } | null {
  for (const account of index.accounts) {
    const meta = account.narrations.find((n) => n.id === narrationId);
    if (meta) return { account, meta };
  }
  return null;
}

/* ---------- Reading ---------- */

export function listAccounts(platform?: Platform): Promise<Account[]> {
  return inTurn(async () => {
    const { accounts } = await readIndex();
    return platform ? accounts.filter((a) => a.platform === platform) : accounts;
  });
}

export function openNarration(id: string): Promise<OpenNarration | null> {
  return inTurn(async () => {
    const hit = find(await readIndex(), id);
    if (!hit) return null;
    const sandbox = await kvGet<unknown>(sandboxKey(id));
    if (!isSandbox(sandbox)) return null;
    const point = await kvGet<unknown>(savePointKey(id));
    return { ...hit, sandbox, savePoint: isSavePoint(point) ? point : undefined, revision: 0 };
  });
}

/* ---------- Accounts ---------- */

/** A new account starts with one narration, and that first state is its save point. */
export function createAccount(platform: Platform, sandbox: Sandbox, name = 'Original'): Promise<NarrationMeta> {
  return inTurn(async () => {
    const index = await readIndex();
    const now = Date.now();
    const meta: NarrationMeta = { id: uid('n'), name, createdAt: now, updatedAt: now, ...describe(sandbox) };
    await kvSet(sandboxKey(meta.id), sandbox);
    await kvSet(savePointKey(meta.id), { sandbox, savedAt: now } satisfies SavePoint);
    index.accounts.push({ id: uid('a'), platform, createdAt: now, narrations: [meta] });
    await kvSet(INDEX_KEY, index);
    return meta;
  });
}

export function deleteAccount(accountId: string): Promise<void> {
  return inTurn(async () => {
    const index = await readIndex();
    const account = index.accounts.find((a) => a.id === accountId);
    if (!account) return;
    index.accounts = index.accounts.filter((a) => a.id !== accountId);
    await kvSet(INDEX_KEY, index);
    for (const n of account.narrations) {
      await kvDelete(sandboxKey(n.id));
      await kvDelete(savePointKey(n.id));
    }
  });
}

/* ---------- Narrations ---------- */

/** Copy a narration, save point included, into a new one on the same account. */
export function duplicateNarration(sourceId: string, name: string): Promise<NarrationMeta | null> {
  return inTurn(async () => {
    const index = await readIndex();
    const hit = find(index, sourceId);
    if (!hit) return null;
    const sandbox = await kvGet<unknown>(sandboxKey(sourceId));
    if (!isSandbox(sandbox)) return null;
    const point = await kvGet<unknown>(savePointKey(sourceId));
    const now = Date.now();
    const meta: NarrationMeta = { id: uid('n'), name, createdAt: now, updatedAt: now, ...describe(sandbox) };
    await kvSet(sandboxKey(meta.id), sandbox);
    await kvSet(savePointKey(meta.id), isSavePoint(point) ? point : ({ sandbox, savedAt: now } satisfies SavePoint));
    hit.account.narrations.push(meta);
    await kvSet(INDEX_KEY, index);
    return meta;
  });
}

export function renameNarration(id: string, name: string): Promise<void> {
  return inTurn(async () => {
    const index = await readIndex();
    const hit = find(index, id);
    if (!hit) return;
    hit.meta.name = name;
    await kvSet(INDEX_KEY, index);
  });
}

/** Removes one narration. An account always keeps at least one, so the last one stays. */
export function deleteNarration(id: string): Promise<void> {
  return inTurn(async () => {
    const index = await readIndex();
    const hit = find(index, id);
    if (!hit || hit.account.narrations.length < 2) return;
    hit.account.narrations = hit.account.narrations.filter((n) => n.id !== id);
    await kvSet(INDEX_KEY, index);
    await kvDelete(sandboxKey(id));
    await kvDelete(savePointKey(id));
  });
}

export function saveSandbox(id: string, sandbox: Sandbox): Promise<number> {
  return inTurn(async () => {
    const index = await readIndex();
    const hit = find(index, id);
    if (!hit) return 0; // Deleted while open. Nothing to save into.
    await kvSet(sandboxKey(id), sandbox);
    Object.assign(hit.meta, describe(sandbox), { updatedAt: Date.now() });
    await kvSet(INDEX_KEY, index);
    // One browser, one creator: nobody else can change the page, so revisions stay at zero.
    return 0;
  });
}

export async function peekNarration(id: string): Promise<NarrationState | null> {
  const hit = find(await readIndex(), id);
  return hit ? { revision: 0, role: 'owner' } : null;
}

export function saveSavePoint(id: string, point: SavePoint): Promise<void> {
  return inTurn(async () => {
    if (!find(await readIndex(), id)) return;
    await kvSet(savePointKey(id), point);
  });
}

/* ---------- Media ---------- */

/** Every photo and video some narration or save point still uses, optionally leaving one narration out. */
export function mediaInUse(exceptNarrationId?: string): Promise<Set<string>> {
  return inTurn(async () => {
    const keep = new Set<string>();
    const { accounts } = await readIndex();
    for (const account of accounts) {
      for (const n of account.narrations) {
        if (n.id === exceptNarrationId) continue;
        const sandbox = await kvGet<unknown>(sandboxKey(n.id));
        const point = await kvGet<unknown>(savePointKey(n.id));
        if (isSandbox(sandbox)) for (const m of referencedMedia(sandbox)) keep.add(m);
        if (isSavePoint(point)) for (const m of referencedMedia(point.sandbox)) keep.add(m);
      }
    }
    return keep;
  });
}
