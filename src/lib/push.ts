// Phone push registration (Android only; the browser relies on the in-app inbox for now).
// The device token is stored server-side for the signed-in account and removed again on sign-out.
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from './supabase.ts';

const TOKEN_KEY = 'sidekick-push-token';
export const pushSupported = () => Capacitor.isNativePlatform();

export type PushStatus = 'unsupported' | 'denied' | 'registered' | 'error';

/** Ask permission, register with FCM and attach the token to this account. Safe to call on every start. */
export async function enablePush(onOpen: (notificationId: string) => void): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return 'denied';

  await PushNotifications.createChannel({ id: 'sidekick-updates', name: 'Shared updates', importance: 4, visibility: 0 });
  await PushNotifications.removeAllListeners();
  const result = new Promise<PushStatus>((resolve) => {
    PushNotifications.addListener('registration', async ({ value }) => {
      localStorage.setItem(TOKEN_KEY, value);
      const { error } = await supabase.rpc('register_device', { p_token: value, p_platform: 'android' });
      resolve(error ? 'error' : 'registered');
    });
    PushNotifications.addListener('registrationError', () => resolve('error'));
  });
  PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
    const id = a.notification.data?.notification_id;
    if (id) onOpen(id);
  });
  await PushNotifications.register();
  return result;
}

/** Called before sign-out so this phone stops receiving the previous account's pushes. */
export async function disablePush() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;
  await supabase.rpc('unregister_device', { p_token: token });
  localStorage.removeItem(TOKEN_KEY);
  if (pushSupported()) await PushNotifications.removeAllListeners();
}

/** Nudge the server to send queued pushes now instead of waiting for the next minute. Best effort. */
export function kickPushQueue() {
  supabase.functions.invoke('send-push').catch(() => {});
}
