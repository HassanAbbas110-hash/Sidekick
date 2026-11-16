// Spec §12, A5: the full shared deletion lifecycle, with only Hassan deciding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, as, newItem, HASSAN, MARKETER, SHARED, MARKETER_PRIVATE } from './helpers/db.ts';
import type { PGlite } from '@electric-sql/pglite';

const ask = async (db: PGlite, id: string, action: 'delete' | 'restore', who = MARKETER) =>
  (await as<{ id: string }>(db, who,
    `insert into deletion_requests (item_id, item_version, reason, action) select id, version, 'tidy up', $2 from items where id = $1 returning id`, [id, action]))[0].id;
const decide = async (db: PGlite, req: string, ok: boolean, who = HASSAN) =>
  (await as<{ r: string }>(db, who, `select decide_deletion($1, $2) as r`, [req, ok]))[0].r;
const trashed = async (db: PGlite, id: string) => (await as<{ d: string | null }>(db, HASSAN, `select deleted_at as d from items where id = $1`, [id]))[0]?.d !== null;

test('A5: request → approve → trash; ask to restore → approve → back', async () => {
  const db = await freshDb();
  const id = await newItem(db, MARKETER, SHARED, { title: 'Old brief' });
  assert.equal(await decide(db, await ask(db, id, 'delete'), true), 'approved');
  assert.equal(await trashed(db, id), true);
  await assert.rejects(ask(db, id, 'delete'), /row-level security/, 'cannot ask to delete something already in the trash');
  assert.equal(await decide(db, await ask(db, id, 'restore'), true), 'approved');
  assert.equal(await trashed(db, id), false);
});

test('A5: one open request per item, and rejection leaves the item untouched', async () => {
  const db = await freshDb();
  const id = await newItem(db, MARKETER, SHARED, { title: 'Keep me' });
  const req = await ask(db, id, 'delete');
  await assert.rejects(ask(db, id, 'delete'), /duplicate key|unique/);
  assert.equal(await decide(db, req, false), 'rejected');
  assert.equal(await trashed(db, id), false);
});

test('A5: only Hassan can trash directly, purge, or decide; purge needs the trash and typed confirmation', async () => {
  const db = await freshDb();
  const id = await newItem(db, MARKETER, SHARED, { title: 'Draft' });
  await assert.rejects(as(db, MARKETER, `select trash_item($1)`, [id]), /shared_deletion_requires_owner/);
  await assert.rejects(as(db, HASSAN, `select purge_item($1, 'DELETE')`, [id]), /move_to_trash_first/);
  await as(db, HASSAN, `select trash_item($1)`, [id]);
  await assert.rejects(as(db, MARKETER, `select purge_item($1, 'DELETE')`, [id]), /owner_only/);
  await assert.rejects(as(db, HASSAN, `select purge_item($1, 'delete')`, [id]), /confirmation_required/);
  await as(db, HASSAN, `select purge_item($1, 'DELETE')`, [id]);
  assert.equal((await as(db, HASSAN, `select 1 from items where id = $1`, [id])).length, 0);
  assert.equal((await db.query(`select 1 from item_versions where item_id = $1`, [id])).rows.length, 0, 'history removed with it');
});

test('A5: permanent deletion leaves only content-free metadata, and scrubs the item text from inboxes', async () => {
  const db = await freshDb();
  const id = await newItem(db, MARKETER, SHARED, { kind: 'task', title: 'Secret pricing idea' });
  await as(db, HASSAN, `select trash_item($1)`, [id]);
  await as(db, HASSAN, `select purge_item($1, 'DELETE')`, [id]);
  const log = await as(db, MARKETER, `select * from purge_log`);
  assert.equal(log.length, 1);
  assert.ok(!JSON.stringify(log).includes('Secret'), 'purge log holds no title or content');
  const inbox = await as(db, HASSAN, `select body from notifications`);
  assert.ok(inbox.length > 0 && inbox.every((n) => !String(n.body).includes('Secret')));
});

test('A5: restore and delete requests never apply to private items', async () => {
  const db = await freshDb();
  const id = await newItem(db, MARKETER, MARKETER_PRIVATE, { title: 'enc:x' });
  await assert.rejects(ask(db, id, 'delete'), /row-level security/);
  await assert.rejects(as(db, HASSAN, `select purge_item($1, 'DELETE')`, [id]), /not_found/);
});

test('A5: Hassan is told about restore requests in plain words', async () => {
  const db = await freshDb();
  const id = await newItem(db, MARKETER, SHARED, { title: 'Logo v1' });
  await as(db, HASSAN, `select trash_item($1)`, [id]);
  await ask(db, id, 'restore');
  const [n] = await as<{ title: string }>(db, HASSAN, `select title from notifications where kind = 'deletion_requested'`);
  assert.equal(n.title, 'Marketer asked to restore an item');
});
