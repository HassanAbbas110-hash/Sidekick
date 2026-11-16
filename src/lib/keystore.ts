// Keeps the unlocked private-area key on this device so the private area stays open until "Lock" or sign-out.
// The key is a non-extractable CryptoKey stored in IndexedDB: the app can use it, but cannot read its bytes out.
// Trade-off (documented): anyone holding this unlocked device can open the private area; "Lock" removes it.
import { changePassphrase, createVault, unlock, type WrappedKey } from '../crypto/vault.ts';

export type Remote = {
  get: () => Promise<{ by_passphrase: WrappedKey; by_recovery: WrappedKey } | null>;
  create: (byPassphrase: WrappedKey, byRecovery: WrappedKey) => Promise<void>;
  setPassphraseWrapper: (byPassphrase: WrappedKey) => Promise<void>;
};

const dbName = (userId: string) => `sidekick-key-${userId}`;
function open(userId: string, idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(dbName(userId), 1);
    req.onupgradeneeded = () => req.result.createObjectStore('k');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(userId: string, idb: IDBFactory, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await open(userId, idb);
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction('k', mode);
      const req = fn(t.objectStore('k'));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(req.error ?? t.error);
    });
  } finally { db.close(); }
}

export const storedKey = (userId: string, idb: IDBFactory = indexedDB) => tx<CryptoKey | undefined>(userId, idb, 'readonly', (s) => s.get('data'));
const keep = (userId: string, key: CryptoKey, idb: IDBFactory) => tx(userId, idb, 'readwrite', (s) => s.put(key, 'data'));

/** Lock this device: forget the unlocked key (the locked copy on the server is untouched). */
export const lock = (userId: string, idb: IDBFactory = indexedDB) => tx(userId, idb, 'readwrite', (s) => s.delete('data'));

/** First-time setup. Returns the recovery key, to be shown once and never stored. */
export async function setUp(userId: string, passphrase: string, remote: Remote, idb: IDBFactory = indexedDB) {
  if (await remote.get()) throw new Error('already_set_up');
  const v = await createVault(passphrase);
  await remote.create(v.byPassphrase, v.byRecovery);
  await keep(userId, await unlock(passphrase, v.byPassphrase), idb);
  return v.recoveryKey;
}

export async function unlockWithPassphrase(userId: string, passphrase: string, remote: Remote, idb: IDBFactory = indexedDB) {
  const v = await remote.get();
  if (!v) throw new Error('not_set_up');
  const key = await unlock(passphrase, v.by_passphrase); // throws wrong_secret
  await keep(userId, key, idb);
  return key;
}

/** Forgotten passphrase: the recovery key sets a new one. Existing private data stays readable. */
export async function recover(userId: string, recoveryKey: string, newPassphrase: string, remote: Remote, idb: IDBFactory = indexedDB) {
  const v = await remote.get();
  if (!v) throw new Error('not_set_up');
  const rewrapped = await changePassphrase(recoveryKey, v.by_recovery, newPassphrase);
  await remote.setPassphraseWrapper(rewrapped);
  return unlockWithPassphrase(userId, newPassphrase, remote, idb);
}
