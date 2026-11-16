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
