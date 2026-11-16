// Spec §9–10, A4, A13 (database part).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshDb, as, newItem, HASSAN, MARKETER, SHARED, MARKETER_PRIVATE } from './helpers/db.ts';
import type { PGlite } from '@electric-sql/pglite';

const start = (db: PGlite, user: string, id: string, at: string, op = randomUUID()) =>
  as(db, user, `select start_focus($1, $2, 'stopwatch', null, $3) as r`, [op, id, at]);
const end = (db: PGlite, user: string, id: string, at: string, paused = 0, done = true) =>
  as(db, user, `select end_focus($1, $2, $3, $4, $5)`, [randomUUID(), id, at, paused, done]);
const summary = (db: PGlite, user: string) =>
  as<Record<string, unknown>>(db, user, `select * from focus_summaries('2026-11-10', '2026-11-10')`);

test('A13: overlapping sessions from two devices are not double-counted', async () => {
  const db = await freshDb();
  const a = randomUUID(), b = randomUUID();
  await start(db, MARKETER, a, '2026-11-10T08:00:00Z');
  await end(db, MARKETER, a, '2026-11-10T09:00:00Z');
  await start(db, MARKETER, b, '2026-11-10T08:30:00Z'); // phone started offline while the laptop timer ran
  await end(db, MARKETER, b, '2026-11-10T09:30:00Z', 0, false);
  const [s] = await summary(db, HASSAN);
  assert.deepEqual(s, { user_id: MARKETER, day: s.day, measured_seconds: 90 * 60, adjusted_seconds: 0, sessions: 2, completed: 1, running: false });
});

test('A13: one running timer per person; a new start closes the forgotten one; replay is harmless', async () => {
  const db = await freshDb();
  const a = randomUUID(), b = randomUUID(), op = randomUUID();
  await start(db, HASSAN, a, '2026-11-10T06:00:00Z');
  await start(db, HASSAN, b, '2026-11-10T07:00:00Z', op);
  await start(db, HASSAN, b, '2026-11-10T07:00:00Z', op);
  const rows = await as(db, HASSAN, `select id = $1 as first, ended_at is not null as ended from focus_sessions order by started_at`, [a]);
  assert.deepEqual(rows, [{ first: true, ended: true }, { first: false, ended: false }]);
});

test('A13: pauses are subtracted, manual corrections are separate and need a reason', async () => {
  const db = await freshDb();
  const a = randomUUID();
  await start(db, MARKETER, a, '2026-11-10T10:00:00Z');
  await end(db, MARKETER, a, '2026-11-10T11:00:00Z', 600);
  await assert.rejects(as(db, MARKETER, `select adjust_focus($1, $2, 900, '')`, [randomUUID(), a]), /reason_required/);
  await as(db, MARKETER, `select adjust_focus($1, $2, 900, 'Forgot to start the timer')`, [randomUUID(), a]);
  const [s] = await summary(db, HASSAN);
  assert.equal(s.measured_seconds, 50 * 60);
  assert.equal(s.adjusted_seconds, 15 * 60);
});

test('A4: the partner sees totals only — never the session rows, ids or links', async () => {
  const db = await freshDb();
  const task = await newItem(db, MARKETER, SHARED, { kind: 'task', title: 'Revise chapter 3' });
  await as(db, MARKETER, `select start_focus($1, $2, 'countdown', 1500, '2026-11-10T12:00:00Z', $3)`, [randomUUID(), randomUUID(), task]);
  assert.equal((await as(db, HASSAN, `select * from focus_sessions`)).length, 0);
  const [s] = await summary(db, HASSAN);
  assert.deepEqual(Object.keys(s).sort(), ['adjusted_seconds', 'completed', 'day', 'measured_seconds', 'running', 'sessions', 'user_id']);
  assert.equal(s.running, true);
});

test('calendar: invalid ranges and repeat rules are refused; skips only apply to repeating events', async () => {
  const db = await freshDb();
  await assert.rejects(newItem(db, HASSAN, SHARED, { kind: 'event', starts_at: '2026-11-20T10:00:00Z', ends_at: '2026-11-20T09:00:00Z' }), /items_event_range/);
  await assert.rejects(as(db, HASSAN, `insert into items (space_id, kind, starts_at, ends_at, recur) values ($1, 'event', now(), now(), '{"freq":"hourly"}')`, [SHARED]), /items_recur_shape/);
  const single = await newItem(db, HASSAN, SHARED, { kind: 'event', starts_at: '2026-11-20T10:00:00Z', ends_at: '2026-11-20T11:00:00Z' });
  await assert.rejects(as(db, HASSAN, `insert into event_exceptions (item_id, occurrence_start) values ($1, '2026-11-20T10:00:00Z')`, [single]), /row-level security/);
});

test('calendar: a work block linked to a task never moves the task deadline', async () => {
  const db = await freshDb();
  const task = randomUUID(), block = randomUUID();
  const apply = (user: string, op: object) => as(db, user, `select apply_op($1::jsonb)`, [JSON.stringify(op)]);
  await apply(HASSAN, { op_id: randomUUID(), type: 'create', id: task, space_id: SHARED, kind: 'task', fields: { title: 'Launch page', due_at: '2026-11-25T15:00:00Z' } });
  await apply(HASSAN, { op_id: randomUUID(), type: 'create', id: block, space_id: SHARED, kind: 'event',
    fields: { title: 'Work on launch page', starts_at: '2026-11-21T08:00:00Z', ends_at: '2026-11-21T10:00:00Z', task_id: task } });
  await apply(HASSAN, { op_id: randomUUID(), type: 'update', id: block, base_version: 1, fields: { starts_at: '2026-11-24T08:00:00Z', ends_at: '2026-11-24T10:00:00Z' } });
  const [t] = await as<{ due: string }>(db, HASSAN, `select due_at = '2026-11-25T15:00:00Z' as due from items where id = $1`, [task]);
  assert.equal(t.due, true);
});

test('A4: Busy shows repeating private events as times only', async () => {
  const db = await freshDb();
  await as(db, MARKETER, `insert into items (space_id, kind, title, starts_at, ends_at, recur) values ($1, 'event', 'enc:class', '2026-11-03T06:00:00Z', '2026-11-03T08:00:00Z', '{"freq":"weekly","byweekday":[1]}')`, [MARKETER_PRIVATE]);
  const rows = await as(db, HASSAN, `select * from busy_slots('2026-11-16', '2026-11-23')`);
  assert.equal(rows.length, 1);
  assert.ok(!JSON.stringify(rows).includes('class'));
});
