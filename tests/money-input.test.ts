import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, formatMoney } from '../src/lib/money.ts';

test('parseMoney: common ways of typing rand amounts become exact cents', () => {
  const cases: [string, number | null][] = [
    ['1700', 170000], ['1 700', 170000], ['R1 700', 170000], ['R 1700,50', 170050], ['1,700.50', 170050],
    ['1700.5', 170050], ['0,99', 99], ['ZAR 250', 25000], ['12,345,678', 1234567800], ['1 234 567,89', 123456789],
    ['', null], ['abc', null], ['-50', null], ['0', null], ['1.234', null], ['12,3456', null],
  ];
  for (const [input, cents] of cases) assert.equal(parseMoney(input), cents, input);
});

test('parseMoney never drifts like floating point (0.1 + 0.2 style)', () => {
  assert.equal(parseMoney('0.29'), 29);
  assert.equal(parseMoney('1005.10'), 100510);
});

test('formatMoney shows rands with two decimals', () => {
  assert.match(formatMoney(120000), /^R\s?1[\s ]200,00$/);
  assert.match(formatMoney(5000, 'USD'), /\$\s?50,00|\$50\.00/);
});
