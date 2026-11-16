// Quick choices for "Remind me", in Johannesburg time.
import { fromWall, wall } from './recur.ts';

export type Preset = { label: string; at: Date };

export function presets(now = new Date(), due: Date | null = null): Preset[] {
  const w = wall(now);
  const out: Preset[] = [{ label: 'In 1 hour', at: new Date(now.getTime() + 3600_000) }];
  if (w.h < 17) out.push({ label: 'This evening, 18:00', at: fromWall(w.y, w.m, w.d, 18) });
  out.push({ label: 'Tomorrow, 08:00', at: fromWall(w.y, w.m, w.d + 1, 8) });
  if (due) {
    const d = wall(due);
    const morning = fromWall(d.y, d.m, d.d, 8);
    // only when the due day is after tomorrow, otherwise it repeats an option above
    if (morning.getTime() > fromWall(w.y, w.m, w.d + 1, 8).getTime() && morning < due) out.push({ label: 'Morning it is due, 08:00', at: morning });
  }
  return out;
}

/** Value for a datetime-local input, in Johannesburg time. */
export function localInput(d: Date) {
  const w = wall(d), p = (n: number) => String(n).padStart(2, '0');
  return `${w.y}-${p(w.m + 1)}-${p(w.d)}T${p(w.h)}:${p(w.mi)}`;
}
/** Parse a datetime-local value as Johannesburg time (not the device's own timezone). */
export function fromLocalInput(v: string) {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? fromWall(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}
