// Repeating tasks: ticking one off makes the next, once, with the right due date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshDb, as, HASSAN, MARKETER, SHARED, HASSAN_PRIVATE } from './helpers/db.ts';
import type { PGlite } from '@electric-sql/pglite';

const apply = (db: PGlite, user: string, op: object) => as(db, user, `select apply_op($1::jsonb) as r`, [JSON.stringify(op)]);
const next = async (db: PGlite, due: string, recur: object, from: string) =>
  (await db.query<{ n: string | null }>(`select next_due($1::timestamptz, $2::jsonb, $3::timestamptz)::text as n`, [due, JSON.stringify(recur), from])).rows[0].n;

test('next due: daily, weekly, weekdays, every 2 weeks, monthly at month end, catching up when done late, until', async () => {
  const db = await freshDb();
  // Fri 20 Nov 2026 09:00 Johannesburg = 07:00 UTC
  const fri = '2026-11-20T07:00:00Z';
  assert.equal(await next(db, fri, { freq: 'daily' }, fri), '2026-11-21 07:00:00+00');
  assert.equal(await next(db, fri, { freq: 'weekly' }, fri), '2026-11-27 07:00:00+00');
  assert.equal(await next(db, fri, { freq: 'weekly', interval: 2 }, fri), '2026-12-04 07:00:00+00');
  assert.equal(await next(db, fri, { freq: 'weekly', byweekday: [1, 2, 3, 4, 5] }, fri), '2026-11-23 07:00:00+00', 'weekdays skip the weekend');
  assert.equal(await next(db, '2026-01-31T07:00:00Z', { freq: 'monthly' }, '2026-01-31T07:00:00Z'), '2026-02-28 07:00:00+00', 'month end clamps');
  assert.equal(await next(db, fri, { freq: 'daily' }, '2026-11-25T12:00:00Z'), '2026-11-26 07:00:00+00', 'done late: next one is in the future');
  assert.equal(await next(db, fri, { freq: 'weekly', until: '2026-11-25T00:00:00Z' }, fri), null, 'past the end date: no more');
  assert.equal(await next(db, fri, { freq: 'hourly' }, fri), null);
});

test('repeating: done makes the next one once, for the same person, without an extra ping; private tasks are not copied', async () => {
  const db = await freshDb();
  const id = randomUUID();
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString();
  await apply(db, HASSAN, { op_id: randomUUID(), type: 'create', id, space_id: SHARED, kind: 'task',
    fields: { title: 'Post on Instagram', status: 'open', assignee: MARKETER, due_at: due, recur: { freq: 'weekly' } } });
  await db.query(`delete from notifications`);
  await apply(db, MARKETER, { op_id: randomUUID(), type: 'update', id, base_version: 1, fields: { status: 'done' } });
  await apply(db, MARKETER, { op_id: randomUUID(), type: 'update', id, base_version: 2, fields: { status: 'open' } });
  await apply(db, MARKETER, { op_id: randomUUID(), type: 'update', id, base_version: 3, fields: { status: 'done' } });
  const rows = await as<{ title: string; status: string; assignee: string; due_at: string; series_id: string | null }>(db, HASSAN,
    `select title, status, assignee, due_at::text, series_id from items where kind = 'task' order by due_at`);
  assert.equal(rows.length, 2, 'un-ticking and re-ticking does not make a second copy');
  assert.equal(rows[1].status, 'open');
  assert.equal(rows[1].assignee, MARKETER);
  assert.equal(rows[1].series_id, id);
  assert.equal(new Date(rows[1].due_at).getTime() - new Date(due).getTime(), 7 * 86_400_000);
  const pings = await as<{ kind: string }>(db, HASSAN, `select kind from notifications`);
  assert.deepEqual(pings.map((p) => p.kind), ['task_done', 'task_done'], 'Hassan hears it was done, not that a task was added');

  const pid = randomUUID();
  await apply(db, HASSAN, { op_id: randomUUID(), type: 'create', id: pid, space_id: HASSAN_PRIVATE, kind: 'task',
    fields: { title: 'enc1:x', status: 'open', due_at: due, recur: { freq: 'daily' } } });
  await apply(db, HASSAN, { op_id: randomUUID(), type: 'update', id: pid, base_version: 1, fields: { status: 'done' } });
  assert.equal((await as(db, HASSAN, `select 1 from items where space_id = $1`, [HASSAN_PRIVATE])).length, 1);
});
