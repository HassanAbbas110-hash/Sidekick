// Repeat choices for tasks. The rule format is the one events already use (items.recur).
import type { Recur } from './recur.ts';

export const REPEATS: { key: string; label: string; recur: Recur | null }[] = [
  { key: 'none', label: 'Does not repeat', recur: null },
  { key: 'daily', label: 'Every day', recur: { freq: 'daily' } },
  { key: 'weekdays', label: 'Every weekday', recur: { freq: 'weekly', byweekday: [1, 2, 3, 4, 5] } },
  { key: 'weekly', label: 'Every week', recur: { freq: 'weekly' } },
  { key: 'biweekly', label: 'Every 2 weeks', recur: { freq: 'weekly', interval: 2 } },
  { key: 'monthly', label: 'Every month', recur: { freq: 'monthly' } },
];

/** Which choice a stored rule matches ('custom' for anything else, e.g. set elsewhere). */
export function repeatKey(r: Recur | null | undefined) {
  if (!r) return 'none';
  const hit = REPEATS.find((o) => o.recur && o.recur.freq === r.freq && (o.recur.interval ?? 1) === (r.interval ?? 1)
    && (o.recur.byweekday ?? []).join() === (r.byweekday ?? []).join());
  return hit?.key ?? 'custom';
}
export const repeatLabel = (r: Recur | null | undefined) => REPEATS.find((o) => o.key === repeatKey(r))?.label ?? 'Repeats';
