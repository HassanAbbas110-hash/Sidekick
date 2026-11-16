import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShared } from '../src/lib/share.ts';

test('share: a link shared with words keeps the words as the title', () => {
  assert.deepEqual(parseShared('Check this out https://webrift.co.za/pricing.', null),
    { url: 'https://webrift.co.za/pricing', title: 'Check this out', body: null });
});
test('share: a bare link is titled by its site; the app subject wins when given', () => {
  assert.equal(parseShared('https://www.behance.net/gallery/123', null).title, 'behance.net');
  assert.equal(parseShared('https://youtu.be/x', 'Booking form walkthrough').title, 'Booking form walkthrough');
});
test('share: plain text becomes a title and body; unsafe addresses are not links', () => {
  assert.deepEqual(parseShared('Call Thabo about the menu\nHe wants copper accents', null),
    { url: null, title: 'Call Thabo about the menu', body: 'Call Thabo about the menu\nHe wants copper accents' });
  assert.equal(parseShared('javascript:alert(1)', null).url, null);
  assert.equal(parseShared(null, null).title, 'Shared item');
});
