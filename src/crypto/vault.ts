// On-device encryption for private content (docs/architecture.md §3). Uses only the platform's WebCrypto,
// which exists in browsers, the Android WebView and Node. The server stores wrapped keys and ciphertext only.
//
// A random data key encrypts content. That key is stored twice, each copy locked ("wrapped") by a key derived
// from a secret only the user holds: their passphrase, or their one-time recovery key. Lose both = data lost.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

// OWASP 2023 guidance for PBKDF2-HMAC-SHA256.
export const PBKDF2_ITERATIONS = 600_000;

export type WrappedKey = { v: 1; salt: string; iv: string; wrapped: string; iterations: number };

// btoa/atob exist in browsers, the Android WebView and Node (Buffer does not exist in browsers).
const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

async function keyFromSecret(secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const material = await subtle.importKey('raw', enc.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

async function wrap(dataKey: CryptoKey, secret: string): Promise<WrappedKey> {
  const salt = random(16);
  const iv = random(12);
  const kek = await keyFromSecret(secret, salt, PBKDF2_ITERATIONS);
  const wrapped = new Uint8Array(await subtle.wrapKey('raw', dataKey, kek, { name: 'AES-GCM', iv }));
  return { v: 1, salt: b64(salt), iv: b64(iv), wrapped: b64(wrapped), iterations: PBKDF2_ITERATIONS };
}

/** 32 random bytes shown once as 8 groups of 8 hex characters, for the user to keep offline. */
function newRecoveryKey() {
  const hex = Array.from(random(32), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return hex.match(/.{8}/g)!.join('-');
}

export async function createVault(passphrase: string) {
  if (passphrase.length < 12) throw new Error('passphrase_too_short');
  // Extractable only so it can be wrapped; the copy kept for daily use is non-extractable (see unlock).
  const dataKey = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const recoveryKey = newRecoveryKey();
  return {
    byPassphrase: await wrap(dataKey, passphrase),
    byRecovery: await wrap(dataKey, recoveryKey.replaceAll('-', '')),
    recoveryKey,
  };
}

/** Throws if the secret is wrong (AES-GCM authentication fails). */
export async function unlock(secret: string, w: WrappedKey, { extractable = false } = {}): Promise<CryptoKey> {
  const clean = /^[0-9A-F]{8}(-[0-9A-F]{8}){7}$/i.test(secret) ? secret.replaceAll('-', '').toUpperCase() : secret;
  const kek = await keyFromSecret(clean, unb64(w.salt), w.iterations);
  try {
    return await subtle.unwrapKey('raw', unb64(w.wrapped), kek, { name: 'AES-GCM', iv: unb64(w.iv) },
      { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
  } catch {
    throw new Error('wrong_secret');
  }
}

/** Change passphrase: re-lock the same data key. Existing ciphertext is untouched. */
export async function changePassphrase(oldSecret: string, w: WrappedKey, newPassphrase: string) {
  if (newPassphrase.length < 12) throw new Error('passphrase_too_short');
  return wrap(await unlock(oldSecret, w, { extractable: true }), newPassphrase);
}

// Associated data binds ciphertext to its row and field, so it cannot be swapped into another item.
const aadFor = (itemId: string, field: string) => enc.encode(`sidekick:v1:${itemId}:${field}`);

export async function sealBytes(key: CryptoKey, data: Uint8Array<ArrayBuffer>, itemId: string, field: string): Promise<Uint8Array<ArrayBuffer>> {
  const iv = random(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadFor(itemId, field) }, key, data));
  const out = new Uint8Array(1 + iv.length + ct.length);
  out.set([1]);
  out.set(iv, 1);
  out.set(ct, 13);
  return out;
}

export async function openBytes(key: CryptoKey, sealed: Uint8Array<ArrayBuffer>, itemId: string, field: string): Promise<Uint8Array<ArrayBuffer>> {
  if (sealed[0] !== 1) throw new Error('unknown_format');
  try {
    return new Uint8Array(await subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.subarray(1, 13), additionalData: aadFor(itemId, field) }, key, sealed.subarray(13)));
  } catch {
    throw new Error('cannot_decrypt');
  }
}

export const sealText = async (key: CryptoKey, text: string, itemId: string, field: string) =>
  'enc1:' + b64(await sealBytes(key, enc.encode(text), itemId, field));

export async function openText(key: CryptoKey, sealed: string, itemId: string, field: string) {
  if (!sealed.startsWith('enc1:')) throw new Error('unknown_format');
  return dec.decode(await openBytes(key, unb64(sealed.slice(5)), itemId, field));
}
