import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greeting, plan, ribbonPos } from '../src/lib/today.ts';
import { fromWall } from '../src/lib/recur.ts';

const now = fromWall(2026, 10, 16, 10, 0); // Mon 16 Nov 10:00 Johannesburg
const t = (id: string, due: Date | null, extra: object = {}) => ({ id, space_id: 's', title: id, due_at: due?.toISOString() ?? null, status: 'open', assignee: 'me', kind: 'task', ...extra });

test('today: picks my overdue, due-today, in-progress and soon tasks, in that order', () => {
  const rows = [
    t('soon', fromWall(2026, 10, 18, 9)),
    t('later', fromWall(2026, 10, 30, 9)),
    t('today', fromWall(2026, 10, 16, 17)),
    t('late', fromWall(2026, 10, 15, 9)),
    t('doing', null, { status: 'in_progress' }),
    t('done', fromWall(2026, 10, 15, 9), { status: 'done' }),
    t('theirs', fromWall(2026, 10, 15, 9), { assignee: 'them' }),
    t('note', fromWall(2026, 10, 15, 9), { kind: 'note' }),
  ];
  assert.deepEqual(plan(rows, 'me', now).map((p) => `${p.id}:${p.why}`), ['late:overdue', 'today:today', 'doing:doing', 'soon:soon']);
});

test('today: due earlier today counts as overdue; greeting and ribbon follow Johannesburg time', () => {
  assert.equal(plan([t('x', fromWall(2026, 10, 16, 9))], 'me', now)[0].why, 'overdue');
  assert.equal(greeting(now), 'Good morning');
  assert.equal(greeting(fromWall(2026, 10, 16, 19)), 'Good evening');
  assert.equal(ribbonPos(fromWall(2026, 10, 16, 6)), 0);
  assert.equal(ribbonPos(fromWall(2026, 10, 16, 3)), 0, 'clamped');
  assert.equal(ribbonPos(fromWall(2026, 10, 16, 23, 30)), 1);
});

test('reminder presets: evening only before 17:00, due-morning only when it adds something; inputs use Johannesburg time', async () => {
  const { presets, localInput, fromLocalInput } = await import('../src/lib/reminders.ts');
  const labels = (d: Date, due: Date | null = null) => presets(d, due).map((p) => p.label);
  assert.deepEqual(labels(fromWall(2026, 10, 16, 10)), ['In 1 hour', 'This evening, 18:00', 'Tomorrow, 08:00']);
  assert.deepEqual(labels(fromWall(2026, 10, 16, 19)), ['In 1 hour', 'Tomorrow, 08:00']);
  assert.deepEqual(labels(fromWall(2026, 10, 16, 19), fromWall(2026, 10, 17, 12)), ['In 1 hour', 'Tomorrow, 08:00'], 'due tomorrow: no duplicate');
  assert.equal(presets(fromWall(2026, 10, 16, 10), fromWall(2026, 10, 19, 15)).at(-1)!.at.getTime(), fromWall(2026, 10, 19, 8).getTime());
  assert.equal(localInput(fromWall(2026, 10, 16, 8, 5)), '2026-11-16T08:05');
  assert.equal(fromLocalInput('2026-11-16T08:05')!.getTime(), fromWall(2026, 10, 16, 8, 5).getTime());
  assert.equal(fromLocalInput('nonsense'), null);
});

test('repeat choices round-trip to the stored rule', async () => {
  const { REPEATS, repeatKey, repeatLabel } = await import('../src/lib/repeat.ts');
  for (const o of REPEATS) assert.equal(repeatKey(o.recur), o.key);
  assert.equal(repeatLabel({ freq: 'weekly', byweekday: [1, 2, 3, 4, 5] }), 'Every weekday');
  assert.equal(repeatKey({ freq: 'daily', interval: 3 }), 'custom');
});
