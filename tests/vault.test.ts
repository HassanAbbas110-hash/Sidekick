// Stage 0 proof: private content is encrypted on the device; the server (and its owner) holds only ciphertext.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createVault, unlock, changePassphrase, sealText, openText, sealBytes, openBytes } from '../src/crypto/vault.ts';

const PASS = 'correct horse battery staple';
const ITEM = '20000000-0000-4000-8000-000000000001';
const OTHER = '20000000-0000-4000-8000-000000000002';

test('vault: passphrase and recovery key both open the same data; wrong secrets do not', async () => {
  const v = await createVault(PASS);
  assert.match(v.recoveryKey, /^[0-9A-F]{8}(-[0-9A-F]{8}){7}$/);

  const key = await unlock(PASS, v.byPassphrase);
  const sealed = await sealText(key, 'Exam: organic chemistry', ITEM, 'title');
  assert.ok(sealed.startsWith('enc1:') && !sealed.includes('chemistry'));

  const viaRecovery = await unlock(v.recoveryKey.toLowerCase(), v.byRecovery);
  assert.equal(await openText(viaRecovery, sealed, ITEM, 'title'), 'Exam: organic chemistry');

  await assert.rejects(unlock('wrong passphrase!!', v.byPassphrase), /wrong_secret/);
  await assert.rejects(unlock(PASS, v.byRecovery), /wrong_secret/);
});

test('vault: the stored wrapper contains nothing usable without the secret', async () => {
  const v = await createVault(PASS);
  const stored = JSON.stringify([v.byPassphrase, v.byRecovery]);
  assert.ok(!stored.includes(PASS) && !stored.includes(v.recoveryKey.replaceAll('-', '')));
  await assert.rejects(createVault('short'), /passphrase_too_short/);
});

test('vault: ciphertext cannot be moved to another item or field, or tampered with', async () => {
  const v = await createVault(PASS);
  const key = await unlock(PASS, v.byPassphrase);
  const sealed = await sealText(key, 'private note', ITEM, 'body');
  await assert.rejects(openText(key, sealed, OTHER, 'body'), /cannot_decrypt/);
  await assert.rejects(openText(key, sealed, ITEM, 'title'), /cannot_decrypt/);
  const bytes = Buffer.from(sealed.slice(5), 'base64');
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(openText(key, 'enc1:' + bytes.toString('base64'), ITEM, 'body'), /cannot_decrypt/);
});

test('vault: same text encrypts differently each time (random IV)', async () => {
  const key = await unlock(PASS, (await createVault(PASS)).byPassphrase);
  assert.notEqual(await sealText(key, 'same', ITEM, 'title'), await sealText(key, 'same', ITEM, 'title'));
});

test('vault: file bytes round-trip', async () => {
  const key = await unlock(PASS, (await createVault(PASS)).byPassphrase);
  const file = new Uint8Array(randomBytes(200_000));
  const sealed = await sealBytes(key, file, ITEM, 'file');
  assert.deepEqual(await openBytes(key, sealed, ITEM, 'file'), file);
});

test('vault: changing passphrase keeps old data readable and retires the old passphrase', async () => {
  const v = await createVault(PASS);
  const sealed = await sealText(await unlock(PASS, v.byPassphrase), 'kept', ITEM, 'body');
  const rewrapped = await changePassphrase(PASS, v.byPassphrase, 'a brand new passphrase');
  assert.equal(await openText(await unlock('a brand new passphrase', rewrapped), sealed, ITEM, 'body'), 'kept');
  await assert.rejects(unlock(PASS, rewrapped), /wrong_secret/);
});

test('vault: the everyday unlocked key cannot be exported (limits theft by injected script)', async () => {
  const key = await unlock(PASS, (await createVault(PASS)).byPassphrase);
  await assert.rejects(globalThis.crypto.subtle.exportKey('raw', key));
});
