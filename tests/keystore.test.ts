// Private area on the device: setup, lock/unlock, recovery, and that the stored key cannot be read out.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setUp, unlockWithPassphrase, recover, lock, storedKey, type Remote } from '../src/lib/keystore.ts';
import { sealText, openText, type WrappedKey } from '../src/crypto/vault.ts';

function fakeRemote() {
  let row: { by_passphrase: WrappedKey; by_recovery: WrappedKey } | null = null;
  const sent: string[] = [];
  const remote: Remote = {
    get: async () => row,
    create: async (p, r) => { sent.push(JSON.stringify([p, r])); row = { by_passphrase: p, by_recovery: r }; },
    setPassphraseWrapper: async (p) => { sent.push(JSON.stringify(p)); row = { ...row!, by_passphrase: p }; },
  };
  return { remote, sent };
}

const PASS = 'quiet orange harbour 7';

test('private area: setup stores only locked keys on the server, and the device key works but cannot be exported', async () => {
  const user = randomUUID();
  const { remote, sent } = fakeRemote();
  const recoveryKey = await setUp(user, PASS, remote);
  assert.ok(!sent.join('').includes(PASS) && !sent.join('').includes(recoveryKey.replaceAll('-', '')), 'no secret ever leaves the device');
  const key = (await storedKey(user))!;
  const sealed = await sealText(key, 'Exam on Friday', 'item-1', 'title');
  assert.equal(await openText(key, sealed, 'item-1', 'title'), 'Exam on Friday');
  await assert.rejects(crypto.subtle.exportKey('raw', key));
  await assert.rejects(setUp(user, PASS, remote), /already_set_up/);
});

test('private area: lock forgets the key; the right passphrase opens it again; the wrong one does not', async () => {
  const user = randomUUID();
  const { remote } = fakeRemote();
  await setUp(user, PASS, remote);
  const sealed = await sealText((await storedKey(user))!, 'Private note', 'n', 'body');
  await lock(user);
  assert.equal(await storedKey(user), undefined);
  await assert.rejects(unlockWithPassphrase(user, 'not my passphrase!', remote), /wrong_secret/);
  const key = await unlockWithPassphrase(user, PASS, remote);
  assert.equal(await openText(key, sealed, 'n', 'body'), 'Private note');
});

test('private area: the recovery key sets a new passphrase and old data stays readable; the old passphrase stops working', async () => {
  const user = randomUUID();
  const { remote } = fakeRemote();
  const rk = await setUp(user, PASS, remote);
  const sealed = await sealText((await storedKey(user))!, 'Kept', 'x', 'title');
  await lock(user);
  const key = await recover(user, rk, 'brand new passphrase', remote);
  assert.equal(await openText(key, sealed, 'x', 'title'), 'Kept');
  await assert.rejects(unlockWithPassphrase(user, PASS, remote), /wrong_secret/);
});

test('private area: another account on the same device has no key', async () => {
  const { remote } = fakeRemote();
  await setUp(randomUUID(), PASS, remote);
  assert.equal(await storedKey(randomUUID()), undefined);
});

test('private area: an encrypted private task and event save through the normal sync path, unreadable to the partner', async () => {
  const { freshDb, as, HASSAN, MARKETER, MARKETER_PRIVATE } = await import('./helpers/db.ts');
  const db = await freshDb();
  const user = randomUUID();
  const { remote } = fakeRemote();
  await setUp(user, PASS, remote);
  const key = (await storedKey(user))!;
  const task = randomUUID(), ev = randomUUID();
  const op = async (o: object) => as(db, MARKETER, `select apply_op($1::jsonb)`, [JSON.stringify(o)]);
  await op({ op_id: randomUUID(), type: 'create', id: task, space_id: MARKETER_PRIVATE, kind: 'task',
    fields: { title: await sealText(key, 'Dentist forms', task, 'title'), status: 'open' } });
  await op({ op_id: randomUUID(), type: 'create', id: ev, space_id: MARKETER_PRIVATE, kind: 'event',
    fields: { title: await sealText(key, 'Exam', ev, 'title'), starts_at: '2026-11-20T08:00:00Z', ends_at: '2026-11-20T10:00:00Z', all_day: false, recur: null } });
  const mine = await as<{ id: string; title: string }>(db, MARKETER, `select id, title from items where space_id = $1 order by kind desc`, [MARKETER_PRIVATE]);
  assert.equal(mine.length, 2);
  assert.ok(mine.every((r) => r.title.startsWith('enc1:') && !r.title.includes('Dentist') && !r.title.includes('Exam')), 'server holds ciphertext only');
  assert.deepEqual(await Promise.all(mine.map((r) => openText(key, r.title, r.id, 'title'))), ['Dentist forms', 'Exam'], 'owner decrypts exactly');
  assert.equal((await as(db, HASSAN, `select 1 from items where space_id = $1`, [MARKETER_PRIVATE])).length, 0);
  const busy = await as(db, HASSAN, `select * from busy_slots('2026-11-20', '2026-11-21')`);
  assert.equal(busy.length, 1);
});
