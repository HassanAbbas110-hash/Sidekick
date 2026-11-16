import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finishedIn, focusByDay, receivedIn, weekOf } from '../src/lib/week.ts';
import { fromWall } from '../src/lib/recur.ts';

test('week: runs Monday to Sunday in Johannesburg time, and steps back whole weeks', () => {
  const sunNight = fromWall(2026, 10, 22, 23, 30); // Sun 22 Nov
  const w = weekOf(sunNight);
  assert.deepEqual([w.keys[0], w.keys[6]], ['2026-11-16', '2026-11-22']);
  assert.equal(weekOf(fromWall(2026, 10, 16, 0, 5)).keys[0], '2026-11-16', 'Monday just after midnight');
  assert.equal(weekOf(sunNight, -1).keys[0], '2026-11-09');
  assert.equal(w.to.getTime(), fromWall(2026, 10, 23).getTime());
});

test('week: focus per day splits you from your partner; done tasks and payments are counted inside the week only', () => {
  const { keys, from, to } = weekOf(fromWall(2026, 10, 18, 12));
  const f = focusByDay([
    { user_id: 'me', day: '2026-11-16', measured_seconds: 3600 },
    { user_id: 'miki', day: '2026-11-16', measured_seconds: 600 },
    { user_id: 'me', day: '2026-11-15', measured_seconds: 999 },
  ], keys, 'me');
  assert.deepEqual(f[0], { key: '2026-11-16', mine: 3600, theirs: 600 });
  assert.equal(f.reduce((a, d) => a + d.mine, 0), 3600, 'the Sunday before is not this week');

  const task = (status: string, at: Date) => ({ kind: 'task', status, assignee: 'me', updated_at: at.toISOString() });
  assert.equal(finishedIn([task('done', fromWall(2026, 10, 17, 9)), task('open', fromWall(2026, 10, 17, 9)), task('done', fromWall(2026, 10, 23, 1))], from, to).length, 1);

  assert.deepEqual(receivedIn([
    { amount_minor: 50000, currency: 'ZAR', received_on: '2026-11-16', reversed: false },
    { amount_minor: 20000, currency: 'ZAR', received_on: '2026-11-22', reversed: false },
    { amount_minor: 99999, currency: 'ZAR', received_on: '2026-11-18', reversed: true },
    { amount_minor: 1000, currency: 'USD', received_on: '2026-11-23', reversed: false },
  ], keys[0], '2026-11-23'), [{ currency: 'ZAR', minor: 70000 }]);
});
