// Weekly review maths, kept apart from the screen so it can be tested. Weeks run Monday to Sunday, Johannesburg time.
import { addDays, dayKey, fromWall, wall } from './recur.ts';

export function weekOf(now = new Date(), offset = 0) {
  const w = wall(now);
  const back = (w.dow + 6) % 7; // days since Monday
  const from = fromWall(w.y, w.m, w.d - back + offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return { from, to: addDays(from, 7), days, keys: days.map(dayKey) };
}

type Summary = { user_id: string; day: string; measured_seconds: number };
/** Measured focus per day for you and for everyone else. Corrections by hand are left out on purpose. */
export function focusByDay(summaries: Summary[], keys: string[], userId: string) {
  return keys.map((k) => ({
    key: k,
    mine: summaries.filter((s) => s.day === k && s.user_id === userId).reduce((a, s) => a + s.measured_seconds, 0),
    theirs: summaries.filter((s) => s.day === k && s.user_id !== userId).reduce((a, s) => a + s.measured_seconds, 0),
  }));
}

type TaskLike = { kind: string; status: string | null; updated_at: string; assignee: string | null };
/** Tasks marked done whose last change falls in the week.
 * shortcut: there is no completed_at column, so a done task edited later moves to that later week; add one if this matters. */
export const finishedIn = <T extends TaskLike>(items: T[], from: Date, to: Date) =>
  items.filter((i) => i.kind === 'task' && i.status === 'done' && new Date(i.updated_at) >= from && new Date(i.updated_at) < to);

type PaymentLike = { amount_minor: number; currency: string; received_on: string; reversed: boolean };
/** Money received in the week, per currency, ignoring reversed payments. */
export function receivedIn(payments: PaymentLike[], fromKey: string, toKey: string) {
  const out = new Map<string, number>();
  for (const p of payments) if (!p.reversed && p.received_on >= fromKey && p.received_on < toKey) out.set(p.currency, (out.get(p.currency) ?? 0) + p.amount_minor);
  return [...out].map(([currency, minor]) => ({ currency, minor }));
}
