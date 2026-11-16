// The push sender's Google sign-in token and message shape, checked without real Firebase credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { makeAssertion, fcmMessage } from '../supabase/functions/send-push/fcm.ts';

test('service-account assertion is a valid RS256 JWT for the FCM scope', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const jwt = await makeAssertion({ project_id: 'p', client_email: 'svc@p.iam.gserviceaccount.com', private_key: pem }, 1_800_000_000);
  const [h, c, s] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  assert.deepEqual(claims, {
    iss: 'svc@p.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: 1_800_000_000, exp: 1_800_003_600,
  });
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url')));
});

test('push message carries only inbox text and ids', () => {
  const m = fcmMessage({ token: 't', title: 'Miki assigned you a task', body: 'Send invoice', data: { notification_id: 'n1', item_id: 'i1' } });
  assert.deepEqual(Object.keys(m.message).sort(), ['android', 'data', 'notification', 'token']);
  assert.deepEqual(m.message.data, { notification_id: 'n1', item_id: 'i1' });
  assert.equal(m.message.android.notification.channel_id, 'sidekick-updates');
});
