// Reminders: set by a person for themself, fired once by the minute job into the inbox/push queue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshDb, as, newItem, HASSAN, MARKETER, SHARED, HASSAN_PRIVATE } from './helpers/db.ts';
import type { PGlite } from '@electric-sql/pglite';

const set = (db: PGlite, user: string, id: string, item: string, at: string, note: string | null = null) =>
  as(db, user, `select set_reminder($1, $2, $3, $4, $5) as r`, [randomUUID(), id, item, at, note]);
const fire = async (db: PGlite) => (await db.query<{ n: number }>(`select fire_reminders() as n`)).rows[0].n;
const inbox = (db: PGlite, user: string) => as<{ kind: string; title: string; body: string | null }>(db, user, `select kind, title, body from notifications order by title`);
const past = new Date(Date.now() - 60_000).toISOString();

test('reminders: fire once into my inbox only, with my note; my partner cannot see or move them', async () => {
  const db = await freshDb();
  const task = await newItem(db, HASSAN, SHARED, { kind: 'task', title: 'Call Bright Dental' });
  await db.query(`delete from notifications`); // ignore the "added a task" notice from the setup
  const id = randomUUID();
  await set(db, HASSAN, id, task, past, 'Ask about the deposit');
  assert.equal((await as(db, MARKETER, `select * from reminders`)).length, 0, 'partner sees none');
  await assert.rejects(set(db, MARKETER, id, task, past), /not_allowed/, 'partner cannot take over my reminder');
  assert.equal(await fire(db), 1);
  assert.equal(await fire(db), 0, 'second run sends nothing new');
  assert.deepEqual(await inbox(db, HASSAN), [{ kind: 'reminder', title: 'Reminder: Call Bright Dental', body: 'Ask about the deposit' }]);
  assert.deepEqual(await inbox(db, MARKETER), []);
  // moving it re-arms it
  await set(db, HASSAN, id, task, new Date(Date.now() + 3600_000).toISOString());
  assert.equal((await as<{ sent_at: string | null }>(db, HASSAN, `select sent_at from reminders`))[0].sent_at, null);
});

test('reminders: private items never put content in a reminder, and others cannot remind on them', async () => {
  const db = await freshDb();
  const secret = await newItem(db, HASSAN, HASSAN_PRIVATE, { kind: 'task', title: 'enc1:abc' });
  await assert.rejects(set(db, MARKETER, randomUUID(), secret, past), /not_found/);
  await assert.rejects(set(db, HASSAN, randomUUID(), secret, past, 'plain words'), /private_note_not_allowed/);
  await set(db, HASSAN, randomUUID(), secret, past);
  await fire(db);
  assert.deepEqual(await inbox(db, HASSAN), [{ kind: 'reminder', title: 'Reminder: something in your private area', body: null }]);
});

test('reminders: done or trashed tasks stay quiet; cancelled reminders never fire', async () => {
  const db = await freshDb();
  const done = await newItem(db, HASSAN, SHARED, { kind: 'task', title: 'Done already' });
  await db.query(`update items set status = 'done' where id = $1`, [done]);
  await set(db, HASSAN, randomUUID(), done, past);
  const gone = await newItem(db, HASSAN, SHARED, { kind: 'task', title: 'Cancelled' });
  const rid = randomUUID();
  await set(db, HASSAN, rid, gone, past);
  await as(db, HASSAN, `select cancel_reminder($1, $2)`, [randomUUID(), rid]);
  await fire(db);
  assert.deepEqual(await inbox(db, HASSAN), []);
});

test('due soon: the assignee hears once, an hour before; unassigned shared tasks do not ping anyone', async () => {
  const db = await freshDb();
  const t = await newItem(db, HASSAN, SHARED, { kind: 'task', title: 'Renew hosting' });
  const loose = await newItem(db, HASSAN, SHARED, { kind: 'task', title: 'Nobody owns this' });
  const far = await newItem(db, HASSAN, SHARED, { kind: 'task', title: 'Next week' });
  const soon = new Date(Date.now() + 30 * 60_000).toISOString();
  await db.query(`update items set due_at = $2, assignee = $3 where id = $1`, [t, soon, MARKETER]);
  await db.query(`update items set due_at = $2 where id = $1`, [loose, soon]);
  await db.query(`update items set due_at = now() + interval '7 days', assignee = $2 where id = $1`, [far, MARKETER]);
  await db.query(`delete from notifications`); // ignore the assignment notices from the setup
  await fire(db); await fire(db);
  assert.deepEqual(await inbox(db, MARKETER), [{ kind: 'due_soon', title: 'Due within the hour', body: 'Renew hosting' }]);
  assert.deepEqual(await inbox(db, HASSAN), []);
  assert.equal((await as(db, HASSAN, `select fire_reminders()`).catch((e) => e.message)), 'permission denied for function fire_reminders');
});
