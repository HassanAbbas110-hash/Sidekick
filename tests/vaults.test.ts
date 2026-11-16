// Private-area keys on the server: owner-only, and only ever the locked form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, as, HASSAN, MARKETER } from './helpers/db.ts';

const W = JSON.stringify({ v: 1, salt: 's', iv: 'i', wrapped: 'w', iterations: 600000 });

test('vaults: each person sees and changes only their own locked key — not even Hassan sees the marketer\'s', async () => {
  const db = await freshDb();
  await as(db, MARKETER, `insert into vaults (by_passphrase, by_recovery) values ($1, $1)`, [W]);
  assert.equal((await as(db, HASSAN, `select * from vaults`)).length, 0);
  assert.equal((await as(db, HASSAN, `update vaults set by_passphrase = '{}' returning 1`)).length, 0);
  assert.equal((await as(db, MARKETER, `select user_id from vaults`))[0].user_id, MARKETER);
  await assert.rejects(as(db, HASSAN, `insert into vaults (user_id, by_passphrase, by_recovery) values ($1, $2, $2)`, [MARKETER, W]), /row-level security|duplicate/);
});

test('vaults: the recovery wrapper cannot be swapped and vaults cannot be deleted', async () => {
  const db = await freshDb();
  await as(db, MARKETER, `insert into vaults (by_passphrase, by_recovery) values ($1, $1)`, [W]);
  await as(db, MARKETER, `update vaults set by_passphrase = $1`, [W.replace('"w"', '"w2"')]);
  await assert.rejects(as(db, MARKETER, `update vaults set by_recovery = $1`, [W.replace('"w"', '"w3"')]), /recovery_wrapper_fixed/);
  await assert.rejects(as(db, MARKETER, `delete from vaults`), /permission denied/);
  await assert.rejects(as(db, MARKETER, `update vaults set by_passphrase = '{"x":1}'`), /check constraint/);
});
