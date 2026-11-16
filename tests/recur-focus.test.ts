// A11 (calendar part) and A13 (device part): repeating events land on the right local days and times;
// the timer survives restarts and pauses exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expand, fromWall, dayKey, wall } from '../src/lib/recur.ts';
import { elapsedMs, pause, resume, remainingMs, cyclePhase, endsAt, looksForgotten, type Timer } from '../src/lib/focus.ts';

const ev = (starts: string, ends: string, recur: Parameters<typeof expand>[0]['recur'] = null) => ({ id: 'e', starts_at: starts, ends_at: ends, all_day: false, recur });
const keys = (o: { start: Date }[]) => o.map((x) => `${dayKey(x.start)} ${String(wall(x.start).h).padStart(2, '0')}:${String(wall(x.start).mi).padStart(2, '0')}`);

test('A11: weekly on Mon and Wed keeps 08:00 Johannesburg time across a month boundary', async () => {
  const e = ev('2026-11-30T06:00:00Z', '2026-11-30T07:00:00Z', { freq: 'weekly', byweekday: [1, 3] }); // Mon 30 Nov 08:00 SAST
  const got = keys(expand(e, fromWall(2026, 10, 30), fromWall(2026, 11, 10)));
  assert.deepEqual(got, ['2026-11-30 08:00', '2026-12-02 08:00', '2026-12-07 08:00', '2026-12-09 08:00']);
});

test('A11: monthly from the 31st clamps to month-end, across a year change and a leap year', async () => {
  const e = ev('2027-12-31T08:00:00Z', '2027-12-31T09:00:00Z', { freq: 'monthly' });
  const got = expand(e, fromWall(2027, 11, 1), fromWall(2028, 3, 1)).map((o) => dayKey(o.start));
  assert.deepEqual(got, ['2027-12-31', '2028-01-31', '2028-02-29', '2028-03-31']);
});

test('A11: "until" is inclusive, skipped occurrences disappear, other occurrences are untouched', async () => {
  const e = ev('2026-11-16T07:00:00Z', '2026-11-16T07:30:00Z', { freq: 'daily', until: '2026-11-20' });
  const skip = new Set([new Date('2026-11-18T07:00:00Z').getTime()]);
  assert.deepEqual(expand(e, fromWall(2026, 10, 1), fromWall(2026, 11, 31), skip).map((o) => dayKey(o.start)),
    ['2026-11-16', '2026-11-17', '2026-11-19', '2026-11-20']);
});

test('A11: an occurrence that started before the window but is still running is included', async () => {
  const e = ev('2026-11-16T21:00:00Z', '2026-11-17T01:00:00Z'); // 23:00–03:00 SAST
  assert.equal(expand(e, fromWall(2026, 10, 17), fromWall(2026, 10, 18)).length, 1);
});

test('A11: the display day does not depend on the device timezone', async () => {
  // 23:30 UTC on 16 Nov is 01:30 on 17 Nov in Johannesburg, whatever timezone the phone is set to.
  assert.equal(dayKey(new Date('2026-11-16T23:30:00Z')), '2026-11-17');
});

const T0 = Date.UTC(2026, 10, 16, 8, 0, 0);
const timer = (o: Partial<Timer> = {}): Timer => ({ id: 't', mode: 'stopwatch', started_at: T0, paused_at: null, paused_ms: 0, planned_seconds: null, break_seconds: null, label: '', task_id: null, ...o });

test('A13: elapsed time comes from timestamps, so a restart (save/load) changes nothing', () => {
  const t = JSON.parse(JSON.stringify(timer())) as Timer; // as if read back after the app was killed
  assert.equal(elapsedMs(t, T0 + 25 * 60_000), 25 * 60_000);
});

test('A13: pauses are excluded, and pausing twice does not lose time', () => {
  let t = pause(timer(), T0 + 10 * 60_000);
  t = pause(t, T0 + 12 * 60_000); // second pause ignored
  t = resume(t, T0 + 15 * 60_000);
  assert.equal(elapsedMs(t, T0 + 20 * 60_000), 15 * 60_000);
});

test('A13: countdown remaining and alarm time account for pauses', () => {
  let t = timer({ mode: 'countdown', planned_seconds: 1500 });
  t = resume(pause(t, T0 + 5 * 60_000), T0 + 8 * 60_000);
  assert.equal(remainingMs(t, T0 + 10 * 60_000), 18 * 60_000);
  assert.equal(endsAt(t), T0 + 28 * 60_000);
  assert.equal(remainingMs(t, T0 + 60 * 60_000), 0);
});

test('A13: focus/break cycles report the right phase and completed blocks', () => {
  const t = timer({ mode: 'cycle', planned_seconds: 1500, break_seconds: 300 });
  assert.deepEqual(cyclePhase(t, T0 + 10 * 60_000), { phase: 'focus', leftMs: 15 * 60_000, blocksDone: 0 });
  assert.deepEqual(cyclePhase(t, T0 + 27 * 60_000), { phase: 'break', leftMs: 3 * 60_000, blocksDone: 1 });
  assert.deepEqual(cyclePhase(t, T0 + 31 * 60_000).phase, 'focus');
});

test('A13: a timer left running for over 12 hours is flagged for checking', () => {
  assert.equal(looksForgotten(timer(), T0 + 13 * 3600_000), true);
  assert.equal(looksForgotten(timer(), T0 + 2 * 3600_000), false);
});

test('timer display: countdowns round up, stopping records the right end and pause time', async () => {
  const { clockDown, clock, stopPoint } = await import('../src/lib/focus.ts');
  assert.equal(clockDown(25 * 60_000 - 1), '25:00', 'first second still shows the full length');
  assert.equal(clockDown(1), '0:01');
  assert.equal(clockDown(0), '0:00');
  assert.equal(clock(59_999), '0:59', 'stopwatch rounds down');
  const T0 = Date.UTC(2026, 10, 16, 8);
  const base: Timer = { id: 'x', mode: 'stopwatch', started_at: T0, paused_at: null, paused_ms: 60_000, planned_seconds: null, break_seconds: null, label: '', task_id: null };
  // paused at +10 min, stopped an hour later: ends at the pause, only the earlier minute of pause counts
  const paused = { ...base, paused_at: T0 + 10 * 60_000 };
  assert.deepEqual(stopPoint(paused, T0 + 70 * 60_000), { ended_at: T0 + 10 * 60_000, paused_seconds: 60 });
  // a 25 min countdown noticed 40 min later ended when it finished
  const cd = { ...base, mode: 'countdown' as const, paused_ms: 0, planned_seconds: 1500 };
  assert.equal(stopPoint(cd, T0 + 40 * 60_000).ended_at, T0 + 25 * 60_000);
  assert.equal(stopPoint(cd, T0 + 5 * 60_000).ended_at, T0 + 5 * 60_000, 'stopped early: ends now');
});

test('stopping: the clock freezes at the click, answering the question later adds nothing; records show seconds', async () => {
  const { pause, stopPoint, exact, minutes, elapsedMs } = await import('../src/lib/focus.ts');
  const T0 = Date.UTC(2026, 10, 16, 8);
  const t: Timer = { id: 'x', mode: 'stopwatch', started_at: T0, paused_at: null, paused_ms: 0, planned_seconds: null, break_seconds: null, label: '', task_id: null };
  const clicked = pause(t, T0 + 25 * 60_000 + 7_000); // Stop pressed at 25:07
  assert.equal(elapsedMs(clicked, T0 + 40 * 60_000), 25 * 60_000 + 7_000, 'display stays frozen while the question is open');
  const end = stopPoint(clicked, T0 + 40 * 60_000); // answered 15 minutes later
  assert.equal(end.ended_at, T0 + 25 * 60_000 + 7_000);
  assert.equal(end.paused_seconds, 0);
  assert.equal(exact(1507), '25 min 07 s');
  assert.equal(exact(3912), '1 h 05 min 12 s');
  assert.equal(exact(42.9), '42 s');
  assert.equal(minutes(42), '42 s', 'short totals are not shown as 0 min');
});
