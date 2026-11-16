// Spec §6, A12 (database part): versions never overwrite, uploads are not "available" until confirmed,
// retries never duplicate, one file links to several records, removing a link never deletes the file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshDb, as, newItem, HASSAN, MARKETER, SHARED, MARKETER_PRIVATE } from './helpers/db.ts';
import type { PGlite } from '@electric-sql/pglite';

const SHA = 'a'.repeat(64);
type Begin = { item_id: string; version: number; path: string; state: string; replayed: boolean };
const begin = async (db: PGlite, user: string, opts: { op?: string; item?: string | null; name?: string; size?: number; space?: string } = {}) =>
  (await as<{ r: Begin }>(db, user, `select begin_file_upload($1, $2, $3, $4, 'image/jpeg', $5, $6) as r`,
    [opts.op ?? randomUUID(), opts.space ?? SHARED, opts.item ?? null, opts.name ?? 'Logo final.jpg', opts.size ?? 2048, SHA]))[0].r;
const finish = async (db: PGlite, user: string, item: string, v: number) =>
  (await as<{ r: string }>(db, user, `select finish_file_upload($1, $2) as r`, [item, v]))[0].r;
const current = (db: PGlite, user: string) => as(db, user, `select id, version, original_name from files_current`);

test('A12: a reserved but unfinished upload is not shown as available', async () => {
  const db = await freshDb();
  const b = await begin(db, MARKETER);
  assert.equal(b.state, 'pending');
  assert.match(b.path, new RegExp(`^${SHARED}/${b.item_id}/v1-Logo-final\\.jpg$`));
  assert.deepEqual(await current(db, HASSAN), [], 'pending upload is not a file yet');
  await finish(db, MARKETER, b.item_id, 1);
  assert.deepEqual(await current(db, HASSAN), [{ id: b.item_id, version: 1, original_name: 'Logo final.jpg' }]);
});

test('A12: retrying the same upload (lost connection) reuses the same slot', async () => {
  const db = await freshDb();
  const op = randomUUID();
  const a = await begin(db, MARKETER, { op });
  const b = await begin(db, MARKETER, { op });
  assert.deepEqual([b.item_id, b.version, b.replayed], [a.item_id, a.version, true]);
  assert.equal((await as(db, HASSAN, `select 1 from items where kind = 'file'`)).length, 1);
});

test('A12: a new version never overwrites the old one; both stay downloadable', async () => {
  const db = await freshDb();
  const v1 = await begin(db, MARKETER);
  await finish(db, MARKETER, v1.item_id, 1);
  await as(db, HASSAN, `update file_versions set review = 'approved' where item_id = $1 and version = 1`, [v1.item_id]);
  const v2 = await begin(db, HASSAN, { item: v1.item_id, name: 'Logo final v2.jpg' });
  await finish(db, HASSAN, v1.item_id, 2);
  const rows = await as(db, MARKETER, `select version, review, storage_path <> $2 as new_path from file_versions where item_id = $1 order by version`, [v1.item_id, v1.path]);
  assert.deepEqual(rows, [{ version: 1, review: 'approved', new_path: false }, { version: 2, review: null, new_path: true }]);
  assert.equal(v2.version, 2);
  await assert.rejects(as(db, HASSAN, `update file_versions set storage_path = 'x' where item_id = $1`, [v1.item_id]), /permission denied/);
});

test('A12: one file links to a task and a client; removing a link keeps the file', async () => {
  const db = await freshDb();
  const f = await begin(db, MARKETER);
  await finish(db, MARKETER, f.item_id, 1);
  const task = await newItem(db, HASSAN, SHARED, { kind: 'task', title: 'Use new logo on homepage' });
  const [{ id: client }] = await as<{ id: string }>(db, HASSAN, `insert into clients (space_id, name) values ($1, 'Fictional Cafe') returning id`, [SHARED]);
  await as(db, MARKETER, `insert into file_links (file_id, target_item) values ($1, $2)`, [f.item_id, task]);
  await as(db, MARKETER, `insert into file_links (file_id, target_client) values ($1, $2)`, [f.item_id, client]);
  assert.equal((await as(db, HASSAN, `select 1 from file_links where file_id = $1`, [f.item_id])).length, 2);
  await as(db, HASSAN, `delete from file_links where file_id = $1 and target_item = $2`, [f.item_id, task]);
  assert.equal((await current(db, MARKETER)).length, 1, 'file still there after a link is removed');
});

test('A12: permanent deletion goes through the trash, is owner-only, and hands back every stored path', async () => {
  const db = await freshDb();
  const f = await begin(db, MARKETER);
  await finish(db, MARKETER, f.item_id, 1);
  await begin(db, MARKETER, { item: f.item_id });
  await assert.rejects(as(db, HASSAN, `select purge_file($1, 'DELETE')`, [f.item_id]), /move_to_trash_first/);
  await as(db, HASSAN, `select trash_item($1)`, [f.item_id]);
  await assert.rejects(as(db, MARKETER, `select purge_file($1, 'DELETE')`, [f.item_id]), /owner_only/);
  const [{ paths }] = await as<{ paths: string[] }>(db, HASSAN, `select purge_file($1, 'DELETE') as paths`, [f.item_id]);
  assert.equal(paths.length, 2);
  assert.equal((await db.query(`select 1 from file_versions where item_id = $1`, [f.item_id])).rows.length, 0);
});

test('files: private spaces refused until encryption; size limit and checksum format enforced', async () => {
  const db = await freshDb();
  await assert.rejects(begin(db, MARKETER, { space: MARKETER_PRIVATE }), /private_files_need_encryption/);
  await assert.rejects(begin(db, MARKETER, { size: 60 * 1024 * 1024 }), /check constraint/);
  await assert.rejects(as(db, MARKETER, `select begin_file_upload($1, $2, null, 'x.jpg', 'image/jpeg', 10, 'not-a-hash')`, [randomUUID(), SHARED]), /check constraint/);
});
