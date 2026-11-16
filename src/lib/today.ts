// The Today screen's picking rules, kept apart from the screen so they can be tested.
import { addDays, startOfDay, wall } from './recur.ts';

export type PlanTask = { id: string; space_id: string; title: string | null; due_at: string | null; status: string | null; assignee: string | null; kind: string };
export type Planned = PlanTask & { why: 'overdue' | 'today' | 'doing' | 'soon' };

/** What is on my plate: overdue, due today, in progress, then due in the next 3 days. Done tasks never show. */
export function plan(tasks: PlanTask[], userId: string, now = new Date()): Planned[] {
  const today = startOfDay(now), tomorrow = addDays(today, 1), soon = addDays(today, 4);
  const out: Planned[] = [];
  for (const t of tasks) {
    if (t.kind !== 'task' || t.status === 'done' || t.assignee !== userId) continue;
    const due = t.due_at ? new Date(t.due_at) : null;
    const why = due && due < now ? 'overdue' : due && due < tomorrow ? 'today' : t.status === 'in_progress' ? 'doing' : due && due < soon ? 'soon' : null;
    if (why) out.push({ ...t, why });
  }
  const rank = { overdue: 0, today: 1, doing: 2, soon: 3 };
  return out.sort((a, b) => rank[a.why] - rank[b.why] || (a.due_at ?? '').localeCompare(b.due_at ?? ''));
}

/** Greeting by the hour in Johannesburg time. */
export function greeting(now = new Date()) {
  const h = wall(now).h;
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Where a moment sits on the day ribbon (06:00 to 23:00), from 0 to 1, clamped. */
export const RIBBON = { from: 6, to: 23 };
export function ribbonPos(d: Date) {
  const w = wall(d);
  return Math.min(1, Math.max(0, (w.h + w.mi / 60 - RIBBON.from) / (RIBBON.to - RIBBON.from)));
}
