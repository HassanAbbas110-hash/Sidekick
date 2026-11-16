// Device-side search: used for private items (after decryption) and when offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchLocal, mergeHits, highlight, excerpt, type Hit } from '../src/lib/search.ts';

const rows = [
  { kind: 'note', id: 'n1', space_id: 'p', title: 'Study plan', body: 'Revise Bright chapter', updated_at: '2026-11-15' },
  { kind: 'task', id: 't1', space_id: 'p', title: 'Bright idea for logo', body: null, updated_at: '2026-11-10' },
  { kind: 'link', id: 'l1', space_id: 'p', title: 'Bank', url: 'https://bright.example/login', updated_at: '2026-11-16' },
  { kind: 'file', id: 'f1', space_id: 'p', title: 'nothing here', updated_at: '2026-11-16' },
  { kind: 'mystery', id: 'x', space_id: 'p', title: 'bright but unknown kind' },
];

test('local search: matches title, text and address; title matches first; unknown kinds ignored', () => {
  const hits = matchLocal(rows, 'BRIGHT', 'private');
  assert.deepEqual(hits.map((h) => h.id), ['t1', 'l1', 'n1']);
  assert.ok(hits.every((h) => h.source === 'private'));
  assert.deepEqual(matchLocal(rows, 'b', 'private'), [], 'one letter is too short');
});

test('local search: merging server and device results drops duplicates', () => {
  const a = matchLocal(rows, 'bright', 'device');
  const b: Hit[] = [{ ...a[0], source: 'server' }];
  assert.equal(mergeHits(b, a).length, a.length);
});

test('highlight splits text into plain and matched parts, case-insensitively, without building HTML', () => {
  assert.deepEqual(highlight('Bright and bright', 'bright'), [
    { text: 'Bright', hit: true }, { text: ' and ', hit: false }, { text: 'bright', hit: true },
  ]);
  assert.deepEqual(highlight('<b>hi</b> there', 'hi'), [{ text: '<b>', hit: false }, { text: 'hi', hit: true }, { text: '</b> there', hit: false }],
    'markup in a title stays plain text pieces');
});

test('excerpt shows the part of a long note around the match', () => {
  const long = 'a'.repeat(300) + ' booking form ' + 'b'.repeat(300);
  const e = excerpt(long, 'booking', 60)!;
  assert.ok(e.includes('booking') && e.startsWith('…') && e.endsWith('…'));
});
