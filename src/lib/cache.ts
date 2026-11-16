// Read cache: the last copy of what this account could see, so the app still shows records offline.
// One IndexedDB database per account. It holds nothing that is not on the server, so sign-out deletes it.
// Private titles/bodies arrive here already encrypted (docs/architecture.md §3).

export type Cached<T> = { value: T; savedAt: string; fromCache: boolean };

const dbName = (userId: string) => `sidekick-cache-${userId}`;

function open(userId: string, idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(dbName(userId), 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(userId: string, idb: IDBFactory, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await open(userId, idb);
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction('kv', mode);
      const req = fn(t.objectStore('kv'));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(req.error ?? t.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Try the server first; on success save a copy. If the server cannot be reached, return the saved copy
 * marked fromCache with its timestamp. With no saved copy, the original error is thrown.
 */
export async function withCache<T>(userId: string, key: string, load: () => Promise<T>, idb: IDBFactory = indexedDB): Promise<Cached<T>> {
  try {
    const value = await load();
    const savedAt = new Date().toISOString();
    await tx(userId, idb, 'readwrite', (s) => s.put({ value, savedAt }, key));
    return { value, savedAt, fromCache: false };
  } catch (error) {
    const hit = await tx<{ value: T; savedAt: string } | undefined>(userId, idb, 'readonly', (s) => s.get(key));
    if (!hit) throw error;
    return { ...hit, fromCache: true };
  }
}

export function dropCache(userId: string, idb: IDBFactory = indexedDB): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = idb.deleteDatabase(dbName(userId));
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // deleted once the last open connection closes
  });
}
