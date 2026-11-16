// Offline reading: the last server copy is shown when the server cannot be reached, labelled as such.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withCache, dropCache } from '../src/lib/cache.ts';

const offline = async (): Promise<string[]> => { throw new Error('Failed to fetch'); };

test('offline read: last copy is returned with its timestamp when the server is unreachable', async () => {
  const user = randomUUID();
  const live = await withCache(user, 'spaces', async () => ['WebRift', '7 Waves']);
  assert.equal(live.fromCache, false);
  const cached = await withCache(user, 'spaces', offline);
  assert.deepEqual([cached.value, cached.fromCache, cached.savedAt], [['WebRift', '7 Waves'], true, live.savedAt]);
});

test('offline read: no saved copy means the real error is shown, not an empty list', async () => {
  await assert.rejects(withCache(randomUUID(), 'spaces', offline), /Failed to fetch/);
});

test('offline read: another account cannot read this account\'s copy, and sign-out removes it', async () => {
  const a = randomUUID();
  await withCache(a, 'items:x', async () => ['private-ish']);
  await assert.rejects(withCache(randomUUID(), 'items:x', offline), /Failed to fetch/);
  await dropCache(a);
  await assert.rejects(withCache(a, 'items:x', offline), /Failed to fetch/);
});
