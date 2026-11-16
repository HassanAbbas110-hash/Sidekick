// Durable upload queue: picked files and photos are stored on the device first, then uploaded.
// A queued upload survives app restarts and lost connections, and only leaves the queue once the server
// has confirmed the stored bytes (finish_file_upload = 'verified'). It never shows as available before that.

export const MAX_BYTES = 50 * 1024 * 1024; // Supabase free plan per-file limit (also enforced by the server)

export type QueuedUpload = {
  op_id: string; space_id: string; item_id: string | null; name: string; mime: string; size: number; sha256: string;
  blob: Blob; state: 'queued' | 'uploading' | 'failed'; error?: string; progress: number; added_at: string;
  reserved?: { item_id: string; version: number; path: string };
};

export type UploadDeps = {
  begin: (u: QueuedUpload) => Promise<{ item_id: string; version: number; path: string }>;
  put: (path: string, u: QueuedUpload, onProgress: (fraction: number) => void) => Promise<'stored' | 'already_stored'>;
  finish: (itemId: string, version: number) => Promise<string>;
};

const dbName = (userId: string) => `sidekick-uploads-${userId}`;

function open(userId: string, idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(dbName(userId), 1);
    req.onupgradeneeded = () => req.result.createObjectStore('queue', { keyPath: 'op_id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(userId: string, idb: IDBFactory, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await open(userId, idb);
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction('queue', mode);
      const req = fn(t.objectStore('queue'));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(req.error ?? t.error);
    });
  } finally {
    db.close();
  }
}

export async function sha256Hex(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Queue files. Too-large files are refused here with a clear reason, never silently dropped. */
export async function enqueue(userId: string, files: File[], spaceId: string, itemId: string | null = null, idb: IDBFactory = indexedDB) {
  const refused: { name: string; reason: string }[] = [];
  for (const f of files) {
    if (f.size === 0) { refused.push({ name: f.name, reason: 'The file is empty.' }); continue; }
    if (f.size > MAX_BYTES) { refused.push({ name: f.name, reason: `It is ${(f.size / 1048576).toFixed(1)} MB; the limit is 50 MB per file on the current free plan.` }); continue; }
    const u: QueuedUpload = {
      op_id: crypto.randomUUID(), space_id: spaceId, item_id: itemId, name: f.name || 'photo.jpg', mime: f.type || 'application/octet-stream',
      size: f.size, sha256: await sha256Hex(f), blob: f, state: 'queued', progress: 0, added_at: new Date().toISOString(),
    };
    await tx(userId, idb, 'readwrite', (s) => s.put(u));
  }
  return refused;
}

export const listQueue = (userId: string, idb: IDBFactory = indexedDB) =>
  tx<QueuedUpload[]>(userId, idb, 'readonly', (s) => s.getAll() as IDBRequest<QueuedUpload[]>);

export const removeFromQueue = (userId: string, opId: string, idb: IDBFactory = indexedDB) =>
  tx(userId, idb, 'readwrite', (s) => s.delete(opId));

const save = (userId: string, u: QueuedUpload, idb: IDBFactory) => tx(userId, idb, 'readwrite', (s) => s.put(u));

/**
 * Upload everything queued, one at a time. Each step is safe to repeat: the slot is reserved once (op_id),
 * an object that already arrived is accepted, and the item leaves the queue only when the server verifies it.
 */
export async function processQueue(userId: string, deps: UploadDeps, onChange: (q: QueuedUpload[]) => void, idb: IDBFactory = indexedDB) {
  let verified = 0;
  for (const u of await listQueue(userId, idb)) {
    try {
      u.state = 'uploading';
      u.error = undefined;
      u.reserved ??= await deps.begin(u);
      await save(userId, u, idb);
      onChange(await listQueue(userId, idb));
      await deps.put(u.reserved.path, u, (fraction) => { u.progress = fraction; onChange([u]); });
      const result = await deps.finish(u.reserved.item_id, u.reserved.version);
      if (result.startsWith('verified')) {
        await removeFromQueue(userId, u.op_id, idb);
        verified++;
      } else {
        throw new Error(result === 'size_mismatch' ? 'The stored copy did not match the original size. Try again.' : 'The server has not received the file yet.');
      }
    } catch (e) {
      u.state = 'failed';
      u.error = navigator.onLine ? String(e).replace(/^Error: /, '') : 'Offline. It will upload when you reconnect.';
      await save(userId, u, idb);
    }
    onChange(await listQueue(userId, idb));
  }
  return verified;
}
