// On-device alarms for the focus timer (Android local notifications): they fire even when Sidekick is closed.
// Texts are generic on purpose: a private session label must never appear on the lock screen (spec §11).
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { Timer } from './focus.ts';

const BASE_ID = 7100; // fixed id range for timer alarms
const native = () => Capacitor.isNativePlatform();

export async function clearTimerAlarms() {
  if (!native()) return;
  await LocalNotifications.cancel({ notifications: Array.from({ length: 10 }, (_, i) => ({ id: BASE_ID + i })) }).catch(() => {});
}

/** Schedule the end of a countdown, or the next focus/break changes of a cycle. Paused timers get none. */
export async function scheduleTimerAlarms(t: Timer) {
  await clearTimerAlarms();
  if (!native() || t.paused_at || t.mode === 'stopwatch') return;
  const perm = await LocalNotifications.checkPermissions();
  if (perm.display !== 'granted' && (await LocalNotifications.requestPermissions()).display !== 'granted') return;

  const base = t.started_at + t.paused_ms;
  const at: { when: number; title: string }[] = [];
  if (t.mode === 'countdown') at.push({ when: base + (t.planned_seconds ?? 0) * 1000, title: 'Focus block finished' });
  else {
    const f = (t.planned_seconds ?? 1500) * 1000, b = (t.break_seconds ?? 300) * 1000;
    for (let i = 0; at.length < 8; i++) {
      at.push({ when: base + i * (f + b) + f, title: 'Time for a break' });
      at.push({ when: base + (i + 1) * (f + b), title: 'Break over, back to focus' });
    }
  }
  const future = at.filter((a) => a.when > Date.now() + 1000);
  await LocalNotifications.schedule({
    notifications: future.map((a, i) => ({ id: BASE_ID + i, title: a.title, body: 'Sidekick focus timer', schedule: { at: new Date(a.when), allowWhileIdle: true } })),
  }).catch(() => {});
}
