// Links: only web addresses are stored, so clicking a saved link can never run code; private ones stay encrypted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshDb, as, HASSAN, MARKETER, SHARED, MARKETER_PRIVATE } from './helpers/db.ts';
import { safeUrl, linkParts } from '../src/lib/links.ts';
import type { PGlite } from '@electric-sql/pglite';

const create = (db: PGlite, user: string, space: string, url: string, title = 'Site') =>
  as(db, user, `select apply_op($1::jsonb) as r`, [JSON.stringify({ op_id: randomUUID(), type: 'create', id: randomUUID(), space_id: space, kind: 'link', fields: { title, url } })]);

test('links: web addresses are saved and visible to both; edits sync', async () => {
  const db = await freshDb();
  await create(db, MARKETER, SHARED, 'https://webrift.co.za/admin?tab=quotes', 'WebRift admin');
  const [l] = await as<{ id: string; url: string; version: number }>(db, HASSAN, `select id, url, version from items where kind = 'link'`);
  assert.equal(l.url, 'https://webrift.co.za/admin?tab=quotes');
  await as(db, HASSAN, `select apply_op($1::jsonb)`, [JSON.stringify({ op_id: randomUUID(), type: 'update', id: l.id, base_version: l.version, fields: { url: 'https://webrift.co.za/' } })]);
  assert.equal((await as<{ url: string }>(db, MARKETER, `select url from items where id = $1`, [l.id]))[0].url, 'https://webrift.co.za/');
});

test('links: anything that is not http(s) is refused by the database', async () => {
  const db = await freshDb();
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'file:///C:/secrets.txt', 'https://ok.example/<script>', 'ftp://old.example']) {
    await assert.rejects(create(db, HASSAN, SHARED, bad), /items_url_safe/, bad);
  }
});

test('links: private addresses are stored encrypted and never shown to the partner', async () => {
  const db = await freshDb();
  await create(db, MARKETER, MARKETER_PRIVATE, 'enc1:AAAA', 'enc1:BBBB');
  assert.equal((await as(db, HASSAN, `select 1 from items where kind = 'link'`)).length, 0);
});

test('links (app side): only http(s) addresses are opened; typed addresses get https:// added', () => {
  assert.equal(safeUrl('webrift.co.za'), 'https://webrift.co.za/');
  assert.equal(safeUrl('  https://7waves.co.za/order '), 'https://7waves.co.za/order');
  assert.equal(safeUrl('http://localhost:5180'), 'http://localhost:5180/');
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', 'mailto:x@y.z', '', 'not a url at all']) assert.equal(safeUrl(bad), null, bad);
  assert.deepEqual(linkParts('https://www.webrift.co.za/pricing?x=1'), { host: 'webrift.co.za', path: '/pricing', origin: 'https://www.webrift.co.za' });
});

test('WhatsApp links: South African numbers become international, junk gives no link', async () => {
  const { whatsappLink } = await import('../src/lib/links.ts');
  assert.equal(whatsappLink('082 123 4567'), 'https://wa.me/27821234567');
  assert.equal(whatsappLink('+27 82 123 4567'), 'https://wa.me/27821234567');
  assert.equal(whatsappLink('0027821234567'), 'https://wa.me/27821234567');
  assert.equal(whatsappLink('call me'), null);
  assert.equal(whatsappLink(null), null);
});
