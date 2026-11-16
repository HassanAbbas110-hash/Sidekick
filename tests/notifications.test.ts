// A7/A8 (database part): the inbox gets one row per important shared change, for the other person only,
// never for private items, never twice for a replayed op; each user's read state is their own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshDb, as, newItem, HASSAN, MARKETER, SHARED, MARKETER_PRIVATE } from './helpers/db.ts';
import type { PGlite } from '@electric-sql/pglite';

const apply = (db: PGlite, user: string, op: object) => as(db, user, `select apply_op($1::jsonb) as r`, [JSON.stringify(op)]);
const inbox = (db: PGlite, user: string) =>
  as<{ kind: string; title: string; body: string }>(db, user, `select kind, title, body from notifications order by created_at, kind`);

test('A7: assigning a shared task notifies only the assignee; replaying the op does not duplicate it', async () => {
  const db = await freshDb();
  const op = { op_id: randomUUID(), type: 'create', id: randomUUID(), space_id: SHARED, kind: 'task',
    fields: { title: 'Send invoice', assignee: HASSAN, status: 'open' } };
  await apply(db, MARKETER, op);
  await apply(db, MARKETER, op); // lost-ack replay
  assert.deepEqual(await inbox(db, HASSAN), [{ kind: 'task_assigned', title: 'Marketer assigned you a task', body: 'Send invoice' }]);
  assert.deepEqual(await inbox(db, MARKETER), [], 'no self-notification');
});

test('A7: completion and deadline changes notify the other person; ordinary edits do not', async () => {
  const db = await freshDb();
  const id = randomUUID();
  await apply(db, HASSAN, { op_id: randomUUID(), type: 'create', id, space_id: SHARED, kind: 'task', fields: { title: 'Logo files', status: 'open' } });
  await apply(db, HASSAN, { op_id: randomUUID(), type: 'update', id, base_version: 1, fields: { body: 'typo fix' } });
  await apply(db, MARKETER, { op_id: randomUUID(), type: 'update', id, base_version: 2, fields: { due_at: '2026-11-21T09:00:00Z' } });
  await apply(db, MARKETER, { op_id: randomUUID(), type: 'update', id, base_version: 3, fields: { status: 'done' } });
  assert.deepEqual((await inbox(db, MARKETER)).map((n) => n.kind), ['task_created']);
  assert.deepEqual((await inbox(db, HASSAN)).map((n) => n.kind).sort(), ['deadline_changed', 'task_done']);
});

test('A3/A7: private tasks never notify anyone else', async () => {
  const db = await freshDb();
  await newItem(db, MARKETER, MARKETER_PRIVATE, { kind: 'task', title: 'enc:private' });
  assert.deepEqual(await inbox(db, HASSAN), []);
});

test('A7: deletion request goes to Hassan; his decision goes back to the requester', async () => {
  const db = await freshDb();
  const id = await newItem(db, MARKETER, SHARED, { kind: 'note', title: 'Old brief' });
  const [{ rid }] = await as<{ rid: string }>(db, MARKETER,
    `insert into deletion_requests (item_id, item_version, reason) values ($1, 1, 'duplicate') returning id as rid`, [id]);
  await as(db, HASSAN, `select decide_deletion($1, false)`, [rid]);
  assert.deepEqual(await inbox(db, HASSAN), [{ kind: 'deletion_requested', title: 'Marketer asked to delete an item', body: 'Old brief — duplicate' }]);
  assert.deepEqual((await inbox(db, MARKETER)).map((n) => n.title), ['Deletion request rejected']);
});

test('A7: read state is per user and users can only change read_at on their own rows', async () => {
  const db = await freshDb();
  await apply(db, MARKETER, { op_id: randomUUID(), type: 'create', id: randomUUID(), space_id: SHARED, kind: 'task', fields: { title: 'A' } });
  await apply(db, HASSAN, { op_id: randomUUID(), type: 'create', id: randomUUID(), space_id: SHARED, kind: 'task', fields: { title: 'B' } });
  assert.equal((await as(db, HASSAN, `update notifications set read_at = now() returning id`)).length, 1);
  assert.equal((await as(db, MARKETER, `select id from notifications where read_at is null`)).length, 1, 'marketer\'s row still unread');
  await assert.rejects(as(db, HASSAN, `update notifications set title = 'x'`), /permission denied/);
  await assert.rejects(as(db, HASSAN, `insert into notifications (user_id, kind, title, dedupe_key) values ($1, 'task_done', 'fake', 'x')`, [MARKETER]), /permission denied/);
  await assert.rejects(as(db, HASSAN, `select * from claim_pushes(10)`), /permission denied/);
});

test('A8: a push worker claims each notification once, even with two workers', async () => {
  const db = await freshDb();
  await apply(db, MARKETER, { op_id: randomUUID(), type: 'create', id: randomUUID(), space_id: SHARED, kind: 'task', fields: { title: 'A' } });
  const first = (await db.query(`select * from claim_pushes(10)`)).rows;
  const second = (await db.query(`select * from claim_pushes(10)`)).rows;
  assert.deepEqual([first.length, second.length], [1, 0]);
});

test('device tokens move to whoever signed in last, and sign-out removes them', async () => {
  const db = await freshDb();
  await as(db, HASSAN, `select register_device('tok-1', 'android')`);
  await as(db, MARKETER, `select register_device('tok-1', 'android')`); // same phone, other account
  assert.deepEqual((await db.query(`select user_id from device_tokens`)).rows, [{ user_id: MARKETER }]);
  await as(db, HASSAN, `select unregister_device('tok-1')`); // cannot remove someone else's
  assert.equal((await db.query(`select 1 from device_tokens`)).rows.length, 1);
  await as(db, MARKETER, `select unregister_device('tok-1')`);
  assert.equal((await db.query(`select 1 from device_tokens`)).rows.length, 0);
});
