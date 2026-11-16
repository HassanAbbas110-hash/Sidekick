// Firebase Cloud Messaging (HTTP v1) helpers. Pure WebCrypto + fetch, so the same code runs in the
// Supabase Edge runtime (Deno) and in Node tests. The service-account key only ever lives in server secrets.

export type ServiceAccount = { project_id: string; client_email: string; private_key: string };
export type PushMessage = { token: string; title: string; body?: string | null; data: Record<string, string> };

const b64url = (bytes: Uint8Array | string) =>
  btoa(typeof bytes === 'string' ? bytes : Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

async function signingKey(pem: string) {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/** Signed JWT that Google exchanges for a short-lived access token. */
export async function makeAssertion(sa: ServiceAccount, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(sa.private_key), new TextEncoder().encode(`${header}.${claims}`)));
  return `${header}.${claims}.${b64url(sig)}`;
}

export async function accessToken(sa: ServiceAccount): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await makeAssertion(sa) }),
  });
  if (!res.ok) throw new Error(`google_token_${res.status}`);
  return (await res.json()).access_token;
}

/** Message body. Carries only the inbox text and ids; the app re-checks permission when opened. */
export function fcmMessage(m: PushMessage) {
  return {
    message: {
      token: m.token,
      notification: { title: m.title, ...(m.body ? { body: m.body } : {}) },
      data: m.data,
      android: { priority: 'HIGH', notification: { channel_id: 'sidekick-updates', tag: m.data.notification_id } },
    },
  };
}

export type SendOutcome = 'sent' | 'unregistered' | 'retry';

export async function send(sa: ServiceAccount, token: string, m: PushMessage): Promise<{ outcome: SendOutcome; detail?: string }> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(fcmMessage(m)),
  });
  if (res.ok) return { outcome: 'sent' };
  const detail = await res.text();
  // Token no longer valid (app uninstalled / data cleared): drop it rather than retrying forever.
  if (res.status === 404 || detail.includes('UNREGISTERED')) return { outcome: 'unregistered', detail };
  return { outcome: 'retry', detail: `${res.status} ${detail.slice(0, 300)}` };
}
