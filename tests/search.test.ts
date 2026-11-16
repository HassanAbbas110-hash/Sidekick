// Search can only find what the person could already open; private and trashed items stay out unless allowed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshDb, as, newItem, HASSAN, MARKETER, SHARED, MARKETER_PRIVATE } from './helpers/db.ts';
import type { PGlite } from '@electric-sql/pglite';

type Hit = { kind: string; title: string; snippet: string; trashed: boolean; rank: number };
const search = (db: PGlite, user: string, q: string, trash = false) =>
  as<Hit>(db, user, `select kind, title, snippet, trashed, rank from search_all($1, $2)`, [q, trash]);

async function seed(db: PGlite) {
  await newItem(db, MARKETER, SHARED, { kind: 'task', title: 'Send Bright Dental invoice' });
  await newItem(db, HASSAN, SHARED, { kind: 'note', title: 'Kickoff', body: 'Bright Dental wants a booking form' });
  await as(db, HASSAN, `insert into items (space_id, kind, title, url) values ($1, 'link', 'Admin', 'https://brightdental.example/admin')`, [SHARED]);
  await as(db, HASSAN, `insert into clients (space_id, name, contact_name, notes) values ($1, 'Lumen Studio', 'Dr Bright', 'prefers email')`, [SHARED]);
  await newItem(db, MARKETER, MARKETER_PRIVATE, { kind: 'note', title: 'Bright idea (private)' });
}

test('search: finds tasks, notes, links (by address) and clients (by contact); title matches rank first', async () => {
  const db = await freshDb();
  await seed(db);
  const hits = await search(db, HASSAN, 'bright');
  assert.deepEqual(hits.map((h) => h.kind).sort(), ['client', 'link', 'note', 'task']);
  assert.equal(hits[0].rank, 0, 'a title match comes first');
  assert.ok(hits.every((h) => !h.title.includes('private')));
});

test('search: never returns the partner\'s private items, and no private ciphertext even for the owner', async () => {
  const db = await freshDb();
  await seed(db);
  assert.equal((await search(db, HASSAN, 'idea')).length, 0);
  assert.equal((await search(db, MARKETER, 'idea')).length, 0, 'owner searches private items on the device instead');
  assert.equal((await search(db, MARKETER, 'enc1')).length, 0);
});

test('search: trash only when asked; wildcards are literal; very short searches return nothing', async () => {
  const db = await freshDb();
  const id = await newItem(db, HASSAN, SHARED, { kind: 'note', title: '100% done list' });
  await newItem(db, HASSAN, SHARED, { kind: 'note', title: '1000 done' });
  await as(db, HASSAN, `select trash_item($1)`, [id]);
  assert.equal((await search(db, HASSAN, '100%')).length, 0);
  assert.deepEqual((await search(db, HASSAN, '100%', true)).map((h) => [h.title, h.trashed]), [['100% done list', true]]);
  assert.equal((await search(db, HASSAN, '_')).length, 0);
  assert.equal((await search(db, HASSAN, 'a')).length, 0);
});

test('search: signed-out visitors cannot search at all', async () => {
  const db = await freshDb();
  await db.exec(`set role anon`);
  await assert.rejects(db.query(`select * from search_all('bright')`), /permission denied/);
  await db.exec(`reset role`);
  void randomUUID;
});
