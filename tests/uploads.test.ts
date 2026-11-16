// A12 (device part): queued uploads survive, interrupted uploads retry without duplicating, and a file only
// leaves the queue when the server confirms it.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { enqueue, listQueue, processQueue, MAX_BYTES, type UploadDeps } from '../src/lib/uploads.ts';

const file = (name: string, bytes: number) => new File([new Uint8Array(bytes).fill(7)], name, { type: 'image/jpeg' });

test('upload queue: checksum recorded, too-large and empty files refused with a reason', async () => {
  const user = randomUUID();
  const refused = await enqueue(user, [file('ok.jpg', 1000), file('huge.mov', MAX_BYTES + 1), file('empty.txt', 0)], 'space');
  assert.deepEqual(refused.map((r) => r.name), ['huge.mov', 'empty.txt']);
  assert.match(refused[0].reason, /50 MB/);
  const [q] = await listQueue(user);
  assert.equal(q.sha256, createHash('sha256').update(new Uint8Array(1000).fill(7)).digest('hex'));
});

test('upload queue: interrupted upload stays queued, retry reuses the slot, verified upload leaves the queue', async () => {
  const user = randomUUID();
  await enqueue(user, [file('photo.jpg', 500)], 'space');
  const calls = { begin: 0, put: 0 };
  let network = false;
  const deps: UploadDeps = {
    begin: async () => { calls.begin++; return { item_id: 'i1', version: 1, path: 'space/i1/v1-photo.jpg' }; },
    put: async (_p, _u, progress) => { calls.put++; progress(0.5); if (!network) throw new Error('Failed to fetch'); return 'stored'; },
    finish: async () => 'verified',
  };
  assert.equal(await processQueue(user, deps, () => {}), 0);
  const [failed] = await listQueue(user);
  assert.equal(failed.state, 'failed');
  assert.ok(failed.reserved, 'slot is remembered for the retry');

  network = true;
  assert.equal(await processQueue(user, deps, () => {}), 1);
  assert.deepEqual(calls, { begin: 1, put: 2 }, 'the slot was reserved once, the bytes sent again');
  assert.equal((await listQueue(user)).length, 0);
});

test('upload queue: a file the server has not confirmed is never treated as uploaded', async () => {
  const user = randomUUID();
  await enqueue(user, [file('doc.pdf', 300)], 'space');
  const deps: UploadDeps = {
    begin: async () => ({ item_id: 'i', version: 1, path: 'p' }),
    put: async () => 'stored',
    finish: async () => 'not_uploaded',
  };
  assert.equal(await processQueue(user, deps, () => {}), 0);
  assert.equal((await listQueue(user))[0].state, 'failed');
});
