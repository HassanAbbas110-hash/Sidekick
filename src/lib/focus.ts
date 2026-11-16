// Focus timer state. Everything is derived from saved timestamps, so backgrounding the app, closing it or
// restarting the phone never resets elapsed time (spec §10). The label stays on this device only.

export type Timer = {
  id: string; mode: 'stopwatch' | 'countdown' | 'cycle';
  started_at: number; paused_at: number | null; paused_ms: number;
  planned_seconds: number | null; // countdown length, or one focus block for cycles
  break_seconds: number | null;   // cycles only
  label: string; task_id: string | null;
};

export const elapsedMs = (t: Timer, now = Date.now()) => Math.max(0, (t.paused_at ?? now) - t.started_at - t.paused_ms);

export function pause(t: Timer, now = Date.now()): Timer {
  return t.paused_at ? t : { ...t, paused_at: now };
}
export function resume(t: Timer, now = Date.now()): Timer {
  return t.paused_at ? { ...t, paused_ms: t.paused_ms + (now - t.paused_at), paused_at: null } : t;
}

/** Countdown: milliseconds left (never negative). */
export const remainingMs = (t: Timer, now = Date.now()) => Math.max(0, (t.planned_seconds ?? 0) * 1000 - elapsedMs(t, now));

/** Cycles: which phase we are in, how far through it, and how many focus blocks are complete. */
export function cyclePhase(t: Timer, now = Date.now()) {
  const f = (t.planned_seconds ?? 1500) * 1000, b = (t.break_seconds ?? 300) * 1000;
  const e = elapsedMs(t, now), within = e % (f + b);
  const focus = within < f;
  return { phase: focus ? 'focus' as const : 'break' as const, leftMs: focus ? f - within : f + b - within, blocksDone: Math.floor(e / (f + b)) + (focus ? 0 : 1) };
}

/** When the countdown will end, if running — used to schedule the phone alarm. */
export const endsAt = (t: Timer) => (t.mode === 'countdown' && !t.paused_at ? t.started_at + t.paused_ms + (t.planned_seconds ?? 0) * 1000 : null);

/** A timer left running far longer than planned is probably forgotten (prompt to check, never auto-correct). */
export const looksForgotten = (t: Timer, now = Date.now()) => elapsedMs(t, now) > 12 * 3600_000;

/** What to record when a session stops. A paused session ended when it was paused, so time spent paused
 * after that is not subtracted again; a finished countdown ended at its finish, not when someone noticed. */
export function stopPoint(t: Timer, now = Date.now()) {
  let ended = t.paused_at ?? now;
  const end = t.mode === 'countdown' ? t.started_at + t.paused_ms + (t.planned_seconds ?? 0) * 1000 : Infinity;
  ended = Math.min(ended, end);
  return { ended_at: ended, paused_seconds: Math.round(t.paused_ms / 1000) };
}

/** Countdowns round up, so 25:00 shows for the first second and 0:00 only once it is actually done. */
export const clockDown = (ms: number) => clock(Math.ceil(ms / 1000) * 1000);

export const clock = (ms: number) => {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};
/** Exact duration to the second, for records: "1 h 05 min 12 s", "25 min 03 s", "42 s". */
export const exact = (secs: number) => {
  const s = Math.max(0, Math.floor(secs)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60, p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h} h ${p(m)} min ${p(r)} s` : m ? `${m} min ${p(r)} s` : `${r} s`;
};
export const minutes = (s: number) => { if (s < 60) return `${Math.max(0, Math.floor(s))} s`; const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim(); };

const key = (userId: string) => `sidekick-timer-${userId}`;
export function saveTimer(userId: string, t: Timer | null) {
  try { if (t) localStorage.setItem(key(userId), JSON.stringify(t)); else localStorage.removeItem(key(userId)); } catch { /* storage blocked: timer still runs in memory */ }
}
export function loadTimer(userId: string): Timer | null {
  try { const raw = localStorage.getItem(key(userId)); return raw ? JSON.parse(raw) as Timer : null; } catch { return null; }
}
