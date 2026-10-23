// A thin wrapper over IndexedDB. Two stores:
//   kv    -> the sandbox and its save point (plain JSON)
//   media -> uploaded photos and videos (Blobs), keyed by media id
// Every call can reject (private windows, blocked site data), so callers catch.

const DB_VERSION = 1;

// 'backlot' holds the offline build's library, or the signed-in cache in the hosted build.
// 'backlot-guest' holds work someone does in the Playground before making an account, kept
// apart so signing in, tidying the cache or signing out can never touch it.
type StoreName = 'backlot' | 'backlot-guest';
let dbName: StoreName = 'backlot';
// Set only while signed-in code reads a guest's work to move it (lib/adopt.ts). It wins
// over dbName, so a screen re-rendering meanwhile cannot switch storage under it.
let override: StoreName | null = null;
const openings = new Map<StoreName, Promise<IDBDatabase>>();

/** Point every call below at another database in this browser. */
export function setStorageName(name: StoreName): void {
  dbName = name;
}

/** For the duration of a move: read and write this database whatever the mode is. */
export function setStorageOverride(name: StoreName | null): void {
  override = name;
}

function open(): Promise<IDBDatabase> {
  const name = override ?? dbName;
  let opening = openings.get(name);
  if (!opening) {
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      try {
        const req = indexedDB.open(name, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
          if (!db.objectStoreNames.contains('media')) db.createObjectStore('media');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Could not open storage'));
        req.onblocked = () => reject(new Error('Storage is blocked'));
      } catch (err) {
        reject(err);
      }
    });
    openings.set(name, opening);
    opening.catch(() => {
      openings.delete(name);
    });
  }
  return opening;
}

async function run<T>(
  store: 'kv' | 'media',
  mode: IDBTransactionMode,
  work: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    try {
      const tx = db.transaction(store, mode);
      const req = work(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? req.error);
      tx.onabort = () => reject(tx.error ?? new Error('Storage write was cancelled'));
    } catch (err) {
      reject(err);
    }
  });
}

export function kvGet<T>(key: string): Promise<T | undefined> {
  return run<T | undefined>('kv', 'readonly', (s) => s.get(key));
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await run('kv', 'readwrite', (s) => s.put(value, key));
}

export function blobGet(id: string): Promise<Blob | undefined> {
  return run<Blob | undefined>('media', 'readonly', (s) => s.get(id));
}

export async function blobPut(id: string, blob: Blob): Promise<void> {
  await run('media', 'readwrite', (s) => s.put(blob, id));
}

export async function blobDelete(id: string): Promise<void> {
  await run('media', 'readwrite', (s) => s.delete(id));
}

export async function blobKeys(): Promise<string[]> {
  const keys = await run<IDBValidKey[]>('media', 'readonly', (s) => s.getAllKeys());
  return keys.map(String);
}

export async function kvDelete(key: string): Promise<void> {
  await run('kv', 'readwrite', (s) => s.delete(key));
}
