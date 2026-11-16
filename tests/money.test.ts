// Spec §8, A10, A11: an auditable ledger. Synthetic amounts only, no client data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshDb, as, HASSAN, MARKETER, SHARED, MARKETER_PRIVATE } from './helpers/db.ts';
import type { PGlite } from '@electric-sql/pglite';

async function client(db: PGlite, user = HASSAN, space = SHARED) {
  return (await as<{ id: string }>(db, user, `insert into clients (space_id, name) values ($1, 'Fictional Dental') returning id`, [space]))[0].id;
}
const outstanding = async (db: PGlite, c: string) =>
  (await as<{ outstanding_minor: string; currency: string }>(db, HASSAN,
    `select currency, outstanding_minor from client_balances where client_id = $1 order by currency`, [c]));
const pay = (db: PGlite, user: string, c: string, cents: number, op = randomUUID(), currency = 'ZAR') =>
  as<{ r: { payment_id: string; replayed: boolean; allocated_minor: number } }>(db, user,
    `select record_payment($1, $2, $3, $4, '2026-11-16') as r`, [op, c, cents, currency]);

test('A10: charge R1,700, pay R500 then R200, replay, reverse the R200: balances and history are exact', async () => {
  const db = await freshDb();
  const c = await client(db);
  await as(db, HASSAN, `select add_charge($1, $2, 'Website build', 170000, 'ZAR', '2026-11-30')`, [randomUUID(), c]);

  await pay(db, MARKETER, c, 50000);
  assert.deepEqual(await outstanding(db, c), [{ currency: 'ZAR', outstanding_minor: 120000 }]);

  const op = randomUUID();
  const [{ r: second }] = await pay(db, HASSAN, c, 20000, op);
  assert.deepEqual(await outstanding(db, c), [{ currency: 'ZAR', outstanding_minor: 100000 }]);

  const [{ r: replay }] = await pay(db, HASSAN, c, 20000, op); // same op sent again after a lost acknowledgement
  assert.equal(replay.replayed, true);
  assert.deepEqual(await outstanding(db, c), [{ currency: 'ZAR', outstanding_minor: 100000 }], 'replay adds no money');

  assert.deepEqual(await as(db, MARKETER, `select reverse_payment($1, $2, 'Bank says it bounced') as r`, [randomUUID(), second.payment_id]), [{ r: 'reversed' }]);
  assert.deepEqual(await outstanding(db, c), [{ currency: 'ZAR', outstanding_minor: 120000 }]);

  const ledger = await as(db, HASSAN, `select amount_minor, reversed, reversal_reason, recorded_by from payment_ledger where client_id = $1 order by recorded_at, amount_minor desc`, [c]);
  assert.deepEqual(ledger, [
    { amount_minor: 50000, reversed: false, reversal_reason: null, recorded_by: MARKETER },
    { amount_minor: 20000, reversed: true, reversal_reason: 'Bank says it bounced', recorded_by: HASSAN },
  ], 'the reversed payment stays in history');
});

test('ledger is append-only: payments cannot be edited or deleted, balances are never stored', async () => {
  const db = await freshDb();
  const c = await client(db);
  await as(db, HASSAN, `select add_charge($1, $2, 'Hosting', 50000, 'ZAR', '2026-12-01')`, [randomUUID(), c]);
  const [{ r }] = await pay(db, HASSAN, c, 10000);
  await assert.rejects(as(db, HASSAN, `update payments set amount_minor = 1 where id = $1`, [r.payment_id]), /permission denied/);
  await assert.rejects(as(db, HASSAN, `delete from payments where id = $1`, [r.payment_id]), /permission denied/);
  await assert.rejects(as(db, HASSAN, `delete from charges`), /permission denied/);
  await assert.rejects(as(db, MARKETER, `update reversals set reason = 'x'`), /permission denied/);
});

test('payments go to the oldest charge first and never over-fill a charge or payment', async () => {
  const db = await freshDb();
  const c = await client(db);
  await as(db, HASSAN, `select add_charge($1, $2, 'Later', 30000, 'ZAR', '2026-12-31')`, [randomUUID(), c]);
  await as(db, HASSAN, `select add_charge($1, $2, 'Earlier', 20000, 'ZAR', '2026-11-01')`, [randomUUID(), c]);
  const [{ r }] = await pay(db, HASSAN, c, 25000);
  assert.equal(r.allocated_minor, 25000);
  const rows = await as(db, HASSAN, `select description, paid_minor, state from charge_balances where client_id = $1 order by due_on`, [c]);
  assert.deepEqual(rows.map((x) => [x.description, x.paid_minor]), [['Earlier', 20000], ['Later', 5000]]);

  const [{ r: big }] = await pay(db, HASSAN, c, 100000); // more than is owed: the rest stays unallocated (credit)
  assert.equal(big.allocated_minor, 25000);
  const [charge] = await as<{ id: string }>(db, HASSAN, `select id from charges where description = 'Earlier'`);
  await assert.rejects(as(db, HASSAN, `select record_payment($1, $2, 5000, 'ZAR', '2026-11-16', null, null, null, $3::jsonb)`,
    [randomUUID(), c, JSON.stringify([{ charge_id: charge.id, amount_minor: 5000 }])]), /allocation_exceeds_charge/);
});

test('currencies are never mixed or summed together', async () => {
  const db = await freshDb();
  const c = await client(db);
  await as(db, HASSAN, `select add_charge($1, $2, 'Local', 10000, 'ZAR', '2026-12-01')`, [randomUUID(), c]);
  await as(db, HASSAN, `select add_charge($1, $2, 'Abroad', 5000, 'usd', '2026-12-01')`, [randomUUID(), c]);
  const [{ r }] = await pay(db, HASSAN, c, 5000, randomUUID(), 'USD');
  assert.equal(r.allocated_minor, 5000);
  assert.deepEqual(await outstanding(db, c), [{ currency: 'USD', outstanding_minor: 0 }, { currency: 'ZAR', outstanding_minor: 10000 }]);
  const [zarCharge] = await as<{ id: string }>(db, HASSAN, `select id from charges where currency = 'ZAR'`);
  await assert.rejects(as(db, HASSAN, `select record_payment($1, $2, 1000, 'USD', '2026-11-16', null, null, null, $3::jsonb)`,
    [randomUUID(), c, JSON.stringify([{ charge_id: zarCharge.id, amount_minor: 1000 }])]), /allocation_currency_mismatch/);
});

test('A11: monthly agreement from 31 Jan gives distinct periods clamped to month-end, and re-running adds nothing', async () => {
  const db = await freshDb();
  const c = await client(db);
  const [{ id }] = await as<{ id: string }>(db, HASSAN,
    `select create_agreement($1, $2, 'Care plan', 'ZAR', 45000, 0, 'monthly', '2028-01-31') as id`, [randomUUID(), c]);
  await as(db, HASSAN, `select ensure_monthly_charges($1, '2028-04-30')`, [id]);
  await as(db, MARKETER, `select ensure_monthly_charges($1, '2028-04-30')`, [id]); // second device / retry
  const rows = await as(db, HASSAN, `select period_key, due_on::text as due from charges where agreement_id = $1 order by due_on`, [id]);
  assert.deepEqual(rows, [
    { period_key: '2028-01', due: '2028-01-31' },
    { period_key: '2028-02', due: '2028-02-29' }, // leap year
    { period_key: '2028-03', due: '2028-03-31' },
    { period_key: '2028-04', due: '2028-04-30' },
  ]);
  await as(db, HASSAN, `select end_agreement($1, '2028-05-15')`, [id]);
  await as(db, HASSAN, `select ensure_monthly_charges($1, '2028-08-31')`, [id]);
  assert.equal((await as(db, HASSAN, `select 1 from charges where agreement_id = $1`, [id])).length, 4, 'May would fall due on the 31st, after the 15 May end: no new charges');
  await assert.rejects(as(db, HASSAN, `update agreements set price_minor = 1 where id = $1`, [id]), /permission denied/);
});

test('once-off agreement creates deposit and balance charges from the agreed (not list) price', async () => {
  const db = await freshDb();
  const c = await client(db);
  const op = randomUUID();
  await as(db, MARKETER, `select create_agreement($1, $2, 'Website', 'ZAR', 170000, 50000, 'once', '2026-11-20', '5 pages', '2026-12-20')`, [op, c]);
  await as(db, MARKETER, `select create_agreement($1, $2, 'Website', 'ZAR', 170000, 50000, 'once', '2026-11-20', '5 pages', '2026-12-20')`, [op, c]);
  const rows = await as(db, HASSAN, `select description, amount_minor, due_on::text as due from charges where client_id = $1 order by due_on`, [c]);
  assert.deepEqual(rows, [
    { description: 'Website — deposit', amount_minor: 50000, due: '2026-11-20' },
    { description: 'Website — balance', amount_minor: 120000, due: '2026-12-20' },
  ]);
});

test('clients live only in shared spaces and keep an edit history', async () => {
  const db = await freshDb();
  await assert.rejects(client(db, MARKETER, MARKETER_PRIVATE), /clients_live_in_shared_spaces/);
  const c = await client(db);
  await as(db, MARKETER, `update clients set stage = 'proposal', notes = '' where id = $1`, [c]);
  const hist = await as(db, HASSAN, `select version, snapshot->>'stage' as stage from client_versions where client_id = $1 order by version`, [c]);
  assert.deepEqual(hist, [{ version: 1, stage: 'approached' }, { version: 2, stage: 'proposal' }]);
});
