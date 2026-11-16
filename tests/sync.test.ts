// Stage 0 proof 1 (logic part): queued changes survive a restart and reach the server exactly once;
// independent edits merge and same-field edits are preserved as conflicts, not silently overwritten.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Outbox, type Op, type OpResult } from '../src/sync/outbox.ts';
import { freshDb, as, newItem, HASSAN, MARKETER, SHARED, HASSAN_PRIVATE } from './helpers/db.ts';
import type { PGlite } from '@electric-sql/pglite';

const applyAs = (db: PGlite, user: string) => async (op: Op) =>
  (await as<{ r: OpResult }>(db, user, `select apply_op($1::jsonb) as r`, [JSON.stringify(op)]))[0].r;

test('A9: queued work survives restart, and a lost acknowledgement does not duplicate it', async () => {
  const db = await freshDb();
  const user = MARKETER;
  const create: Op = { op_id: randomUUID(), type: 'create', id: randomUUID(), space_id: SHARED, kind: 'task', fields: { title: 'Call client' } };

  let box = await Outbox.open(user);
  await box.add(create);
  await assert.rejects(box.add(create), /ConstraintError/); // same change cannot be queued twice
  box.close();

  box = await Outbox.open(user); // "app restart"
  assert.deepEqual((await box.pending()).map((o) => o.op_id), [create.op_id]);

  // Server applies it, but the connection drops before the device hears back.
  const send = applyAs(db, user);
  const first = await box.flush(async (op) => {
    await send(op);
    throw new Error('network lost before acknowledgement');
  });
  assert.equal(first.failed?.op_id, create.op_id);
  assert.equal((await box.pending()).length, 1, 'op stays queued when unacknowledged');

  const second = await box.flush(send);
  assert.equal(second.failed, null);
  assert.equal(second.results[0].result.replayed, true);
  assert.equal((await box.pending()).length, 0);

  const rows = await as(db, HASSAN, `select title, created_by from items where id = $1`, [create.id]);
  assert.deepEqual(rows, [{ title: 'Call client', created_by: MARKETER }], 'exactly one task, attributed to the marketer');
  box.close();
});

test('A9: another account on the same device cannot see the previous account\'s queue', async () => {
  const a = await Outbox.open(`acct-a-${randomUUID()}`);
  await a.add({ op_id: randomUUID(), type: 'update', id: randomUUID(), base_version: 1, fields: { body: 'x' } });
  const b = await Outbox.open(`acct-b-${randomUUID()}`);
  assert.equal((await b.pending()).length, 0);
  a.close();
  b.close();
});

test('A9: edits to different fields from two devices both survive', async () => {
  const db = await freshDb();
  const id = await newItem(db, HASSAN, SHARED, { title: 'Brief', body: 'v1' });
  await applyAs(db, HASSAN)({ op_id: randomUUID(), type: 'update', id, base_version: 1, fields: { title: 'Brief (final)' } });
  const r = await applyAs(db, MARKETER)({ op_id: randomUUID(), type: 'update', id, base_version: 1, fields: { body: 'v2' } });
  assert.equal(r.status, 'applied');
  assert.deepEqual(await as(db, HASSAN, `select title, body, version from items where id = $1`, [id]),
    [{ title: 'Brief (final)', body: 'v2', version: 3 }]);
});

test('A9: the same field changed on two offline devices keeps both values for review', async () => {
  const db = await freshDb();
  const id = await newItem(db, HASSAN, SHARED, { title: 'Deadline Friday' });
  await applyAs(db, HASSAN)({ op_id: randomUUID(), type: 'update', id, base_version: 1, fields: { title: 'Deadline Monday' } });
  const r = await applyAs(db, MARKETER)({ op_id: randomUUID(), type: 'update', id, base_version: 1, fields: { title: 'Deadline Tuesday' } });
  assert.deepEqual([r.status, r.conflicts], ['conflict', ['title']]);
  assert.deepEqual(await as(db, HASSAN, `select title from items where id = $1`, [id]), [{ title: 'Deadline Monday' }]);
  assert.deepEqual(await as(db, HASSAN, `select field, server_value, client_value from conflicts where item_id = $1`, [id]),
    [{ field: 'title', server_value: 'Deadline Monday', client_value: 'Deadline Tuesday' }]);
});

test('A9: same value from both devices, and equivalent timestamps, are not conflicts', async () => {
  const db = await freshDb();
  const id = await newItem(db, HASSAN, SHARED, { kind: 'event', starts_at: '2026-11-20T09:00:00Z' });
  await applyAs(db, HASSAN)({ op_id: randomUUID(), type: 'update', id, base_version: 1, fields: { starts_at: '2026-11-20T10:00:00Z' } });
  const r = await applyAs(db, MARKETER)({ op_id: randomUUID(), type: 'update', id, base_version: 1, fields: { starts_at: '2026-11-20T12:00:00+02:00' } });
  assert.equal(r.status, 'applied');
});

test('sync respects privacy and rejects unknown fields', async () => {
  const db = await freshDb();
  const his = await newItem(db, HASSAN, HASSAN_PRIVATE, { title: 'enc:x' });
  await assert.rejects(applyAs(db, MARKETER)({ op_id: randomUUID(), type: 'update', id: his, base_version: 1, fields: { title: 'mine now' } }), /not_found/);
  await assert.rejects(applyAs(db, HASSAN)({ op_id: randomUUID(), type: 'update', id: his, base_version: 1, fields: { deleted_at: null } as never }), /unsupported_field/);
  await assert.rejects(applyAs(db, MARKETER)({ op_id: randomUUID(), type: 'create', id: randomUUID(), space_id: HASSAN_PRIVATE, kind: 'note', fields: {} }), /row-level security/);
});

test('A2: the marketer assigns a task to Hassan; he sees assignee, status and due date', async () => {
  const db = await freshDb();
  const id = randomUUID();
  await applyAs(db, MARKETER)({ op_id: randomUUID(), type: 'create', id, space_id: SHARED, kind: 'task',
    fields: { title: 'Approve homepage copy', assignee: HASSAN, status: 'open', due_at: '2026-11-20T15:00:00Z' } });
  await applyAs(db, HASSAN)({ op_id: randomUUID(), type: 'update', id, base_version: 1, fields: { status: 'done' } });
  const [row] = await as(db, HASSAN, `select assignee, status, created_by, updated_by, due_at = '2026-11-20T15:00:00Z' as due_ok from items where id = $1`, [id]);
  assert.deepEqual(row, { assignee: HASSAN, status: 'done', created_by: MARKETER, updated_by: HASSAN, due_ok: true });
  await assert.rejects(applyAs(db, MARKETER)({ op_id: randomUUID(), type: 'update', id, base_version: 2, fields: { status: 'finished' } }), /check constraint/);
});
