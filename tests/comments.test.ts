// Comments: shared tasks and notes only, both people read the thread, the other person is notified once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshDb, as, newItem, HASSAN, MARKETER, SHARED, HASSAN_PRIVATE } from './helpers/db.ts';
import type { PGlite } from '@electric-sql/pglite';

const add = (db: PGlite, user: string, id: string, item: string, body: string) =>
  as<{ r: string }>(db, user, `select add_comment($1, $2, $3, $4) as r`, [randomUUID(), id, item, body]);

test('comments: both see the thread; the other person is notified once even if the outbox replays', async () => {
  const db = await freshDb();
  const task = await newItem(db, HASSAN, SHARED, { kind: 'task', title: 'Homepage copy' });
  await db.query(`delete from notifications`);
  const id = randomUUID();
  assert.equal((await add(db, MARKETER, id, task, '  Which headline do you prefer?  '))[0].r, 'added');
  assert.equal((await add(db, MARKETER, id, task, 'Which headline do you prefer?'))[0].r, 'replayed');
  await add(db, HASSAN, randomUUID(), task, 'The second one');
  const thread = await as<{ author: string; body: string }>(db, HASSAN, `select author, body from comments order by created_at`);
  assert.deepEqual(thread.map((c) => c.body), ['Which headline do you prefer?', 'The second one']);
  assert.equal((await as(db, MARKETER, `select 1 from comments`)).length, 2);
  const hInbox = await as<{ kind: string; title: string; body: string }>(db, HASSAN, `select kind, title, body from notifications`);
  assert.deepEqual(hInbox, [{ kind: 'comment', title: 'Marketer commented on Homepage copy', body: 'Which headline do you prefer?' }]);
  assert.equal((await as(db, MARKETER, `select 1 from notifications`)).length, 1, 'Marketer hears about Hassan’s reply only');
});

test('comments: private items, other kinds, empty text and direct inserts are refused', async () => {
  const db = await freshDb();
  const secret = await newItem(db, HASSAN, HASSAN_PRIVATE, { kind: 'task', title: 'enc1:x' });
  await assert.rejects(add(db, HASSAN, randomUUID(), secret, 'hi'), /comments_shared_only/);
  const link = await newItem(db, HASSAN, SHARED, { kind: 'link', title: 'Site' });
  await assert.rejects(add(db, HASSAN, randomUUID(), link, 'hi'), /comments_not_supported/);
  const task = await newItem(db, HASSAN, SHARED, { kind: 'task', title: 'T' });
  await assert.rejects(add(db, HASSAN, randomUUID(), task, '   '), /check constraint/);
  await assert.rejects(as(db, HASSAN, `insert into comments (id, item_id, space_id, author, body) values ($1, $2, $3, $4, 'x')`, [randomUUID(), task, SHARED, MARKETER]),
    /permission denied/, 'no forging comments as someone else');
});
