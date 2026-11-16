// Calendar dates in the display timezone, and expansion of repeating events into occurrences.
// shortcut: Africa/Johannesburg is a fixed UTC+2 with no daylight saving, so wall-clock maths uses a fixed
// offset. Supporting a DST timezone needs a timezone library (Temporal) — upgrade before adding one.

export const TZ_OFFSET_MS = 2 * 3600_000;
export type Recur = { freq: 'daily' | 'weekly' | 'monthly'; interval?: number; byweekday?: number[]; until?: string };
export type EventLike = { id: string; starts_at: string; ends_at: string; all_day: boolean; recur: Recur | null };
export type Occurrence = { id: string; start: Date; end: Date; original: string };

/** Wall-clock parts in the display timezone. */
export function wall(d: Date) {
  const w = new Date(d.getTime() + TZ_OFFSET_MS);
  return { y: w.getUTCFullYear(), m: w.getUTCMonth(), d: w.getUTCDate(), dow: w.getUTCDay(), h: w.getUTCHours(), mi: w.getUTCMinutes() };
}
/** Instant for a wall-clock time in the display timezone. */
export const fromWall = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(Date.UTC(y, m, d, h, mi) - TZ_OFFSET_MS);
export const dayKey = (d: Date) => { const w = wall(d); return `${w.y}-${String(w.m + 1).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`; };
export const startOfDay = (d: Date) => { const w = wall(d); return fromWall(w.y, w.m, w.d); };
export const addDays = (d: Date, n: number) => { const w = wall(d); return fromWall(w.y, w.m, w.d + n, w.h, w.mi); };
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Occurrences overlapping [from, to), minus skipped ones. Past occurrences are never rewritten by a rule change. */
export function expand(ev: EventLike, from: Date, to: Date, skipped: Set<number> = new Set()): Occurrence[] {
  const start = new Date(ev.starts_at);
  const dur = new Date(ev.ends_at).getTime() - start.getTime();
  const out: Occurrence[] = [];
  const push = (s: Date) => {
    const e = new Date(s.getTime() + dur);
    if (s < to && (e > from || (dur === 0 && s >= from)) && !skipped.has(s.getTime())) out.push({ id: ev.id, start: s, end: e, original: s.toISOString() });
  };
  if (!ev.recur) { push(start); return out; }

  const r = ev.recur;
  const step = Math.max(1, r.interval ?? 1);
  const until = r.until ? fromWall(+r.until.slice(0, 4), +r.until.slice(5, 7) - 1, +r.until.slice(8, 10) + 1) : null; // inclusive day
  const w = wall(start);
  const past = (s: Date) => s >= to || (until !== null && s >= until);

  for (let i = 0; i < 2000; i++) {
    if (r.freq === 'daily') {
      const s = fromWall(w.y, w.m, w.d + i * step, w.h, w.mi);
      if (past(s)) break;
      push(s);
    } else if (r.freq === 'weekly') {
      const days = (r.byweekday?.length ? [...r.byweekday] : [w.dow]).sort();
      const weekStart = w.d - w.dow + i * 7 * step; // Sunday of this rule week
      const first = fromWall(w.y, w.m, weekStart, w.h, w.mi);
      if (past(first)) break;
      for (const dow of days) {
        const s = fromWall(w.y, w.m, weekStart + dow, w.h, w.mi);
        if (s >= start && !past(s)) push(s);
      }
    } else {
      const mm = w.m + i * step;
      const y = w.y + Math.floor(mm / 12), m = ((mm % 12) + 12) % 12;
      const s = fromWall(y, m, Math.min(w.d, daysInMonth(y, m)), w.h, w.mi); // 31st → last day of shorter months
      if (past(s)) break;
      push(s);
    }
  }
  return out;
}
