// Stage 0 proof 3: privacy, deletion authority and projections are enforced by the database, not the UI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, as, newItem, HASSAN, MARKETER, STRANGER, SHARED, HASSAN_PRIVATE, MARKETER_PRIVATE } from './helpers/db.ts';

test('A1: an email that is not on the invite list cannot sign up', async () => {
  const db = await freshDb();
  await assert.rejects(db.query(`insert into auth.users values ($1, 'someone@example.test')`, [STRANGER]), /not_invited/);
  const roles = await as(db, HASSAN, `select email, role from profiles order by role`);
  assert.deepEqual(roles, [
    { email: 'Marketer@Example.test', role: 'member' },
    { email: 'hassan@example.test', role: 'owner' },
  ]);
});

test('A2: a shared item made by the marketer is visible to Hassan with its actor', async () => {
  const db = await freshDb();
  const id = await newItem(db, MARKETER, SHARED, { kind: 'task', title: 'Send onboarding form' });
  const [row] = await as(db, HASSAN, `select title, created_by from items where id = $1`, [id]);
  assert.deepEqual(row, { title: 'Send onboarding form', created_by: MARKETER });
});

test('A3: neither user can read, edit, delete or see revisions of the other\'s private item by id', async () => {
  const db = await freshDb();
  const mine = await newItem(db, MARKETER, MARKETER_PRIVATE, { title: 'enc:abc' });
  const his = await newItem(db, HASSAN, HASSAN_PRIVATE, { title: 'enc:def' });
  for (const [reader, id] of [[HASSAN, mine], [MARKETER, his]]) {
    assert.equal((await as(db, reader, `select id from items where id = $1`, [id])).length, 0);
    assert.equal((await as(db, reader, `select item_id from item_versions where item_id = $1`, [id])).length, 0);
    assert.equal((await as(db, reader, `update items set title = 'x' where id = $1 returning id`, [id])).length, 0);
    assert.equal((await as(db, reader, `delete from items where id = $1 returning id`, [id])).length, 0);
  }
  // Owner role grants shared-deletion powers, not private reads.
  assert.equal((await as(db, HASSAN, `select id from spaces where id = $1`, [MARKETER_PRIVATE])).length, 0);
  await assert.rejects(newItem(db, MARKETER, HASSAN_PRIVATE), /row-level security/);
});

test('A5: the marketer cannot delete, trash, or privatise shared content directly', async () => {
  const db = await freshDb();
  const id = await newItem(db, MARKETER, SHARED, { title: 'Client brief' });
  assert.equal((await as(db, MARKETER, `delete from items where id = $1 returning id`, [id])).length, 0);
  await assert.rejects(as(db, MARKETER, `update items set deleted_at = now() where id = $1`, [id]), /shared_deletion_requires_owner/);
  await assert.rejects(as(db, MARKETER, `update items set space_id = $2 where id = $1`, [id, MARKETER_PRIVATE]), /shared_to_private_requires_owner/);
  await assert.rejects(as(db, MARKETER, `update spaces set visibility = 'private', owner_id = $2 where id = $1`, [SHARED, MARKETER]), /space_visibility_immutable/);
  await assert.rejects(as(db, MARKETER, `insert into item_versions (item_id, version, snapshot) values ($1, 99, '{}')`, [id]), /permission denied|row-level security/);
  const [row] = await as(db, HASSAN, `select deleted_at from items where id = $1`, [id]);
  assert.equal(row.deleted_at, null);
});

test('A5: Hassan approves a deletion request; an edit after the request makes it stale', async () => {
  const db = await freshDb();
  const id = await newItem(db, MARKETER, SHARED, { title: 'Old draft' });
  const request = async () => (await as<{ id: string }>(db, MARKETER,
    `insert into deletion_requests (item_id, item_version, reason) select id, version, 'duplicate' from items where id = $1 returning id`, [id]))[0].id;

  const first = await request();
  await assert.rejects(as(db, MARKETER, `select decide_deletion($1, true)`, [first]), /owner_only/);
  await as(db, MARKETER, `update items set body = 'changed after request' where id = $1`, [id]);
  assert.deepEqual(await as(db, HASSAN, `select decide_deletion($1, true) as outcome`, [first]), [{ outcome: 'stale' }]);
  assert.equal((await as(db, HASSAN, `select deleted_at from items where id = $1`, [id]))[0].deleted_at, null);

  const second = await request();
  assert.deepEqual(await as(db, HASSAN, `select decide_deletion($1, true) as outcome`, [second]), [{ outcome: 'approved' }]);
  assert.notEqual((await as(db, MARKETER, `select deleted_at from items where id = $1`, [id]))[0].deleted_at, null);
  // Restore from trash is Hassan's, and the item was never hard-deleted.
  await as(db, HASSAN, `update items set deleted_at = null where id = $1`, [id]);
  assert.equal((await as(db, MARKETER, `select deleted_at from items where id = $1`, [id]))[0].deleted_at, null);
});

test('spec §12: clearing shared content keeps the original in revision history', async () => {
  const db = await freshDb();
  const id = await newItem(db, HASSAN, SHARED, { body: 'Agreed: 3 revisions' });
  await as(db, MARKETER, `update items set body = '' where id = $1`, [id]);
  const rows = await as(db, MARKETER, `select version, snapshot->>'body' as body from item_versions where item_id = $1 order by version`, [id]);
  assert.deepEqual(rows, [{ version: 1, body: 'Agreed: 3 revisions' }, { version: 2, body: '' }]);
});

test('A4: Busy slots show only owner and times, never ids or titles', async () => {
  const db = await freshDb();
  await newItem(db, MARKETER, MARKETER_PRIVATE, { kind: 'event', title: 'enc:exam-prep', starts_at: '2026-11-17T08:00:00Z', ends_at: '2026-11-17T10:00:00Z' });
  await newItem(db, MARKETER, MARKETER_PRIVATE, { kind: 'note', title: 'enc:not-an-event' });
  const rows = await as(db, HASSAN, `select * from busy_slots('2026-11-17T00:00:00Z', '2026-11-18T00:00:00Z')`);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['all_day', 'ends_at', 'recur', 'starts_at', 'user_id']);
  assert.equal(rows[0].user_id, MARKETER);
});

test('A6: the marketer trashing a private note gives Hassan a fixed-category notice only', async () => {
  const db = await freshDb();
  const id = await newItem(db, MARKETER, MARKETER_PRIVATE, { kind: 'note', title: 'enc:secret' });
  await as(db, MARKETER, `update items set deleted_at = now() where id = $1`, [id]);
  await as(db, MARKETER, `delete from items where id = $1`, [id]);
  const hisOwn = await newItem(db, HASSAN, HASSAN_PRIVATE, { kind: 'task' });
  await as(db, HASSAN, `delete from items where id = $1`, [hisOwn]);

  const notices = await as(db, HASSAN, `select actor, category, action from private_deletion_notices order by at, action desc`);
  assert.deepEqual(notices, [
    { actor: MARKETER, category: 'private_note', action: 'trashed' },
    { actor: MARKETER, category: 'private_note', action: 'deleted' },
  ]);
  assert.equal((await as(db, MARKETER, `select * from private_deletion_notices`)).length, 0);
});
