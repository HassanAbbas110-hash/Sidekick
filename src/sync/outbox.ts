// Durable outbox: every local change is queued here and survives app restarts until the server acknowledges it.
// The server dedupes by op_id (apply_op), so resending after a lost acknowledgement cannot apply anything twice.

export type Fields = Partial<Record<'title' | 'body' | 'starts_at' | 'ends_at', string | null>>;

export type Op =
  | { op_id: string; type: 'create'; id: string; space_id: string; kind: string; fields: Fields }
  | { op_id: string; type: 'update'; id: string; base_version: number; fields: Fields };

export type OpResult = { status: 'applied' | 'partial' | 'conflict'; version: number; conflicts: string[]; replayed?: boolean };

/** One IndexedDB database per signed-in user, so the next account on the device never reads this queue. */
export const outboxName = (userId: string) => `sidekick-${userId}`;

export class Outbox {
  #db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.#db = db;
  }

  static open(userId: string, idb: IDBFactory = indexedDB): Promise<Outbox> {
    return new Promise((resolve, reject) => {
      const req = idb.open(outboxName(userId), 1);
      req.onupgradeneeded = () => {
        // seq keeps send order; the unique op_id index stops the same change being queued twice.
        req.result.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true }).createIndex('op_id', 'op_id', { unique: true });
      };
      req.onsuccess = () => resolve(new Outbox(req.result));
      req.onerror = () => reject(req.error);
    });
  }

  #run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = this.#db.transaction('outbox', mode);
      const req = fn(tx.objectStore('outbox'));
      tx.oncomplete = () => resolve(req.result); // resolve only once the write is committed
      tx.onerror = () => reject(req.error ?? tx.error);
      tx.onabort = () => reject(req.error ?? tx.error);
    });
  }

  add(op: Op): Promise<IDBValidKey> {
    return this.#run('readwrite', (s) => s.add(op));
  }

  pending(): Promise<Op[]> {
    return this.#run('readonly', (s) => s.getAll() as IDBRequest<Op[]>);
  }

  async remove(opId: string): Promise<void> {
    const key = await this.#run('readonly', (s) => s.index('op_id').getKey(opId));
    if (key !== undefined) await this.#run('readwrite', (s) => s.delete(key));
  }

  close() {
    this.#db.close();
  }

  /**
   * Send queued ops in order. An op leaves the queue only after the server's answer arrives.
   * Stops at the first failure so later edits never overtake an earlier one.
   * shortcut: no backoff timer or attempt limit yet; the Stage 1 sync loop adds both.
   */
  async flush(send: (op: Op) => Promise<OpResult>) {
    const results: { op_id: string; result: OpResult }[] = [];
    for (const op of await this.pending()) {
      let result: OpResult;
      try {
        result = await send(op);
      } catch (error) {
        return { results, failed: { op_id: op.op_id, error: String(error) } };
      }
      await this.remove(op.op_id);
      results.push({ op_id: op.op_id, result });
    }
    return { results, failed: null };
  }
}
