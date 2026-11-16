import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createClient, loadBalances, loadClientMoney, loadClients, updateClient, type Balance, type Charge, type Client, type ClientMoney, type Stage } from '../lib/data.ts';
import { withCache } from '../lib/cache.ts';
import { formatMoney, parseMoney } from '../lib/money.ts';
import type { MoneyFn, Op } from '../sync/outbox.ts';

export const STAGES: { id: Stage; label: string }[] = [
  { id: 'approached', label: 'Approached' }, { id: 'discussion', label: 'In discussion' }, { id: 'proposal', label: 'Proposal sent' },
  { id: 'client', label: 'Client' }, { id: 'paused', label: 'Paused' }, { id: 'lost', label: 'Lost' }, { id: 'archived', label: 'Archived' },
];
const stageLabel = (s: Stage) => STAGES.find((x) => x.id === s)?.label ?? s;
const PIPELINE: Stage[] = ['approached', 'discussion', 'proposal', 'client'];
const TZ = 'Africa/Johannesburg';
const day = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
const fmtDay = (d: string) => day.format(new Date(`${d}T12:00:00Z`));
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); // YYYY-MM-DD

type Props = {
  spaceId: string; userId: string; nameOf: (id: string | null) => string; pending: Op[];
  queue: (op: Op) => Promise<void>; online: boolean;
};

export function ClientsView({ spaceId, userId, nameOf, pending, queue, online }: Props) {
  const [clients, setClients] = useState<Client[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<Stage | 'active'>('active');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      const cs = (await withCache(userId, `clients:${spaceId}`, () => loadClients(spaceId))).value;
      setClients(cs);
      setBalances((await withCache(userId, `balances:${spaceId}`, () => loadBalances(cs.map((c) => c.id)))).value);
      setError('');
    } catch (e) {
      setError(online ? String(e) : 'Clients have not been opened on this device before, so there is no offline copy yet.');
    }
  }, [spaceId, userId, online]);

  useEffect(() => { reload(); }, [reload, pending.length]);

  const owed = (id: string) => balances.filter((b) => b.client_id === id && b.outstanding_minor > 0);
  const shown = clients.filter((c) => stageFilter === 'active' ? !['lost', 'archived'].includes(c.stage) : c.stage === stageFilter);
  const open = clients.find((c) => c.id === openId);
  const totals = new Map<string, { out: number; late: number }>();
  for (const b of balances) {
    const t = totals.get(b.currency) ?? { out: 0, late: 0 };
    totals.set(b.currency, { out: t.out + b.outstanding_minor, late: t.late + b.overdue_minor });
  }

  if (open) {
    return <ClientDetail client={open} userId={userId} nameOf={nameOf} pending={pending.filter((p) => p.type === 'call' && p.client_id === open.id)}
      queue={queue} online={online} onBack={() => setOpenId(null)}
      onSaved={(c) => setClients((cs) => cs.map((x) => (x.id === c.id ? c : x)))} reloadList={reload} />;
  }

  return (
    <section className="clients" aria-label="Clients">
      {[...totals].some(([, t]) => t.out > 0) && (
        <p className="money-line">
          {[...totals].filter(([, t]) => t.out > 0).map(([cur, t], i) => (
            <span key={cur}>{i > 0 && '; '}<b>{formatMoney(t.out, cur)}</b> still to come in{t.late > 0 && <>, <span className="late">{formatMoney(t.late, cur)} overdue</span></>}</span>
          ))}
        </p>
      )}

      <div className="pipeline" role="group" aria-label="Filter by stage">
        <button className={stageFilter === 'active' ? 'on' : ''} aria-pressed={stageFilter === 'active'} onClick={() => setStageFilter('active')}>
          All active <b>{clients.filter((c) => !['lost', 'archived'].includes(c.stage)).length}</b>
        </button>
        {PIPELINE.map((s) => (
          <button key={s} className={stageFilter === s ? 'on' : ''} aria-pressed={stageFilter === s} onClick={() => setStageFilter(s)}>
            {stageLabel(s)} <b>{clients.filter((c) => c.stage === s).length}</b>
          </button>
        ))}
        <select aria-label="Other stages" value={['paused', 'lost', 'archived'].includes(stageFilter) ? stageFilter : ''}
          onChange={(e) => e.target.value && setStageFilter(e.target.value as Stage)}>
          <option value="">More…</option>
          {(['paused', 'lost', 'archived'] as Stage[]).map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
        </select>
      </div>

      {error && <p className="field-error" role="alert">{error}</p>}

      {adding ? (
        <NewClient online={online} onCancel={() => setAdding(false)} onCreate={async (f) => {
          const c = await createClient(spaceId, userId, f);
          setAdding(false);
          await reload();
          setOpenId(c.id);
        }} />
      ) : (
        <button className="ghost add-client" onClick={() => setAdding(true)}>Add a client or lead</button>
      )}

      {shown.length === 0 ? <p className="quiet">{clients.length ? 'No clients at this stage.' : 'No clients yet. Add the first one, even if they are only a lead.'}</p> : (
        <ul className="client-list">
          {shown.map((c) => {
            const due = owed(c.id);
            const late = due.some((b) => b.overdue_minor > 0);
            const followUp = c.follow_up_on && c.follow_up_on <= today();
            return (
              <li key={c.id}>
                <button className={`client-row stage-${c.stage}`} onClick={() => setOpenId(c.id)}>
                  <span className="client-name">{c.name}</span>
                  <span className="client-stage">{stageLabel(c.stage)}{c.contact_name ? `, ${c.contact_name}` : ''}</span>
                  <span className="client-money">
                    {due.length === 0 ? <span className="quiet">Nothing owed</span> : due.map((b) => (
                      <span key={b.currency} className={late ? 'late' : ''}>{formatMoney(b.outstanding_minor, b.currency)} owed</span>
                    ))}
                    {followUp && <span className="follow">Follow up {c.follow_up_on === today() ? 'today' : 'overdue'}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function NewClient({ online, onCreate, onCancel }: { online: boolean; onCreate: (f: Partial<Client>) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [stage, setStage] = useState<Stage>('approached');
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await onCreate({ name: name.trim(), contact_name: contact.trim() || null, stage });
    } catch (err) {
      setError(online ? String(err) : 'Adding a client needs a connection for now. Write it as a note and add it when you are back online.');
    }
  }
  return (
    <form className="panel-form" onSubmit={submit}>
      <div className="grid-2">
        <label>Business name<input autoFocus required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Contact person<input maxLength={120} value={contact} onChange={(e) => setContact(e.target.value)} /></label>
      </div>
      <label>Where things stand
        <select value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
          {STAGES.slice(0, 5).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="row-end"><button type="button" className="ghost" onClick={onCancel}>Cancel</button><button className="primary">Add client</button></div>
    </form>
  );
}

type DetailProps = {
  client: Client; userId: string; nameOf: (id: string | null) => string; pending: Op[]; queue: (op: Op) => Promise<void>;
  online: boolean; onBack: () => void; onSaved: (c: Client) => void; reloadList: () => Promise<void>;
};

function ClientDetail({ client: c, userId, nameOf, pending, queue, online, onBack, onSaved, reloadList }: DetailProps) {
  const [money, setMoney] = useState<ClientMoney | null>(null);
  const [form, setForm] = useState<'payment' | 'charge' | 'agreement' | null>(null);
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);

  const reload = useCallback(async () => {
    try {
      setMoney((await withCache(userId, `money:${c.id}`, () => loadClientMoney(c.id))).value);
    } catch {
      setNotice('No offline copy of this client\'s money yet. Connect once to download it.');
    }
  }, [c.id, userId]);
  useEffect(() => { reload(); }, [reload, pending.length]);

  async function act(fn: MoneyFn, label: string, args: Record<string, string | number | null>) {
    const full = fn === 'reverse_payment' ? args : { ...args, p_client: c.id };
    await queue({ op_id: crypto.randomUUID(), type: 'call', fn, client_id: c.id, label, args: full });
    setForm(null);
    await reload();
    await reloadList();
  }

  async function saveStage(stage: Stage) {
    const saved = await updateClient(c, { stage }).catch(() => null);
    if (saved) onSaved(saved);
    else setNotice(online ? 'Someone else changed this client a moment ago. Reopen it to see their version before changing it.' : 'Changing client details needs a connection for now.');
  }

  const byCurrency = new Map<string, { out: number; late: number; paid: number }>();
  for (const ch of money?.charges ?? []) {
    const t = byCurrency.get(ch.currency) ?? { out: 0, late: 0, paid: 0 };
    byCurrency.set(ch.currency, { out: t.out + ch.outstanding_minor, late: t.late + (ch.state === 'overdue' ? ch.outstanding_minor : 0), paid: t.paid + ch.paid_minor });
  }

  return (
    <section className="client-detail" aria-label={c.name}>
      <button className="ghost back" onClick={onBack}>All clients</button>
      <header className="client-head">
        <h2>{c.name}</h2>
        <label className="stage-pick">
          <span className="sr-only">Stage</span>
          <select value={c.stage} onChange={(e) => saveStage(e.target.value as Stage)}>
            {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      </header>
      {notice && <p className="field-error" role="status">{notice}</p>}

      {editing ? <ClientFields client={c} onCancel={() => setEditing(false)} onSave={async (f) => {
        const saved = await updateClient(c, f).catch(() => null);
        if (saved) { onSaved(saved); setEditing(false); }
        else setNotice(online ? 'Someone else changed this client a moment ago. Reopen it to see their version.' : 'Changing client details needs a connection for now.');
      }} /> : (
        <dl className="facts">
          {c.contact_name && <><dt>Contact</dt><dd>{c.contact_name}</dd></>}
          {c.email && <><dt>Email</dt><dd><a href={`mailto:${c.email}`}>{c.email}</a></dd></>}
          {c.phone && <><dt>Phone</dt><dd><a href={`tel:${c.phone}`}>{c.phone}</a></dd></>}
          {c.website && <><dt>Website</dt><dd><a href={c.website.startsWith('http') ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer">{c.website}</a></dd></>}
          {c.follow_up_on && <><dt>Follow up</dt><dd>{fmtDay(c.follow_up_on)}</dd></>}
          <dt>Responsible</dt><dd>{c.responsible ? nameOf(c.responsible) : 'Not set'}</dd>
          {c.notes && <><dt>Notes</dt><dd className="pre">{c.notes}</dd></>}
          <dd className="facts-edit"><button className="ghost" onClick={() => setEditing(true)}>Edit details</button></dd>
        </dl>
      )}

      <div className="money-head">
        <h3>Money</h3>
        <div className="money-actions">
          <button className={form === 'payment' ? 'primary' : ''} onClick={() => setForm(form === 'payment' ? null : 'payment')}>Record payment</button>
          <button className={form === 'charge' ? 'primary' : ''} onClick={() => setForm(form === 'charge' ? null : 'charge')}>Add charge</button>
          <button className={form === 'agreement' ? 'primary' : ''} onClick={() => setForm(form === 'agreement' ? null : 'agreement')}>New agreement</button>
        </div>
      </div>
      <p className="hint">Internal tracking only. Recording a payment does not collect money, and a proof photo is not a confirmed receipt.</p>

      {[...byCurrency].map(([cur, t]) => (
        <p key={cur} className="balance-big">
          <span className={t.out === 0 ? 'settled' : ''}>{t.out === 0 ? 'Settled' : `${formatMoney(t.out, cur)} outstanding`}</span>
          <span className="quiet">{formatMoney(t.paid, cur)} received{t.late > 0 && <>, <span className="late">{formatMoney(t.late, cur)} of it overdue</span></>}</span>
        </p>
      ))}

      {form === 'payment' && <PaymentForm onCancel={() => setForm(null)} onSave={(a) => act('record_payment', `Payment ${formatMoney(a.p_amount_minor as number, a.p_currency as string)}`, a)} />}
      {form === 'charge' && <ChargeForm onCancel={() => setForm(null)} onSave={(a) => act('add_charge', `Charge ${a.p_description}`, a)} />}
      {form === 'agreement' && <AgreementForm onCancel={() => setForm(null)} onSave={(a) => act('create_agreement', `Agreement ${a.p_title}`, a)} />}

      {pending.length > 0 && (
        <ul className="pending-money" aria-label="Waiting for the server">
          {pending.map((p) => p.type === 'call' && <li key={p.op_id}>{p.label}: saved on this device, not yet confirmed by the server, not counted in the balance yet</li>)}
        </ul>
      )}

      {money && money.charges.length > 0 && (
        <>
          <h4>What is owed</h4>
          <ul className="charges">{money.charges.map((ch) => <ChargeRow key={ch.id} ch={ch} />)}</ul>
        </>
      )}

      {money && money.payments.length > 0 && (
        <>
          <h4>Payments received</h4>
          <ul className="payments">
            {money.payments.map((p) => (
              <li key={p.id} className={p.reversed ? 'reversed' : ''}>
                <div className="pay-main">
                  <span className="pay-amount">{formatMoney(p.amount_minor, p.currency)}</span>
                  <span>{fmtDay(p.received_on)}{p.method ? `, ${p.method}` : ''}{p.reference ? `, ref ${p.reference}` : ''}</span>
                </div>
                <p className="byline">
                  Recorded by {nameOf(p.recorded_by)}
                  {p.allocated_minor < p.amount_minor && !p.reversed && <span>{formatMoney(p.amount_minor - p.allocated_minor, p.currency)} not yet matched to a charge (credit)</span>}
                  {p.reversed && <span className="late">Reversed by {nameOf(p.reversed_by)}: {p.reversal_reason}</span>}
                </p>
                {!p.reversed && <ReverseButton onReverse={(reason) => act('reverse_payment', `Reversal of ${formatMoney(p.amount_minor, p.currency)}`, { p_payment: p.id, p_reason: reason })} />}
              </li>
            ))}
          </ul>
        </>
      )}

      {money && money.agreements.length > 0 && (
        <>
          <h4>Agreements</h4>
          <ul className="agreements">
            {money.agreements.map((a) => (
              <li key={a.id}>
                <b>{a.title}</b> {formatMoney(a.price_minor, a.currency)}{a.billing === 'monthly' ? ' a month' : ' once-off'}
                {a.deposit_minor > 0 && `, deposit ${formatMoney(a.deposit_minor, a.currency)}`}, from {fmtDay(a.starts_on)}{a.ends_on ? ` to ${fmtDay(a.ends_on)}` : ''}
                {a.inclusions && <p className="quiet pre">{a.inclusions}</p>}
              </li>
            ))}
          </ul>
        </>
      )}

      {money && money.charges.length === 0 && money.payments.length === 0 && !form && (
        <p className="quiet">No money recorded for {c.name} yet. Start with a new agreement, or add a single charge.</p>
      )}
    </section>
  );
}

function ChargeRow({ ch }: { ch: Charge }) {
  const pct = Math.round((ch.paid_minor / ch.amount_minor) * 100);
  return (
    <li className={`charge ${ch.state}`}>
      <div className="charge-top">
        <span className="charge-desc">{ch.description}</span>
        <span className="charge-amt">{formatMoney(ch.amount_minor, ch.currency)}</span>
      </div>
      <div className="paidbar" role="img" aria-label={`${pct}% paid`}><span style={{ width: `${pct}%` }} /></div>
      <div className="charge-bottom">
        <span>{ch.state === 'paid' ? 'Paid' : ch.state === 'overdue' ? `Overdue since ${fmtDay(ch.due_on)}` : `Due ${fmtDay(ch.due_on)}`}</span>
        {ch.state !== 'paid' && <span>{formatMoney(ch.outstanding_minor, ch.currency)} left</span>}
      </div>
    </li>
  );
}

function ReverseButton({ onReverse }: { onReverse: (reason: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) return <button className="ghost small-btn" onClick={() => setOpen(true)}>Reverse this payment</button>;
  return (
    <form className="reverse" onSubmit={(e) => { e.preventDefault(); onReverse(reason.trim()); }}>
      <label>Why is it being reversed?<input autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: entered twice, payment bounced" /></label>
      <p className="hint">The payment stays in the history, marked as reversed. Nothing is deleted.</p>
      <div className="row-end"><button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button><button className="primary">Reverse payment</button></div>
    </form>
  );
}

function AmountField({ label, value, onChange, currency, setCurrency }: { label: string; value: string; onChange: (v: string) => void; currency?: string; setCurrency?: (c: string) => void }) {
  const cents = parseMoney(value);
  return (
    <label>{label}
      <span className="amount-row">
        {setCurrency && (
          <select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {['ZAR', 'USD', 'EUR', 'GBP'].map((c) => <option key={c}>{c}</option>)}
          </select>
        )}
        <input inputMode="decimal" required value={value} onChange={(e) => onChange(e.target.value)} placeholder="1 700,00" aria-invalid={value !== '' && cents === null} />
      </span>
      {value !== '' && cents === null && <span className="field-error">Type an amount like 1700 or 1 700,50</span>}
    </label>
  );
}

function PaymentForm({ onSave, onCancel }: { onSave: (a: Record<string, string | number | null>) => Promise<void>; onCancel: () => void }) {
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('ZAR');
  const [on, setOn] = useState(today());
  const [method, setMethod] = useState('EFT');
  const [ref, setRef] = useState('');
  const cents = parseMoney(amount);
  return (
    <form className="panel-form" onSubmit={(e) => { e.preventDefault(); if (cents) onSave({ p_client: null, p_amount_minor: cents, p_currency: currency, p_received_on: on, p_method: method || null, p_reference: ref || null }); }}>
      <div className="grid-2">
        <AmountField label="Amount received" value={amount} onChange={setAmount} currency={currency} setCurrency={setCurrency} />
        <label>Received on<input type="date" required value={on} onChange={(e) => setOn(e.target.value)} /></label>
        <label>Method<input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="EFT, cash, card" /></label>
        <label>Reference<input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Bank reference (optional)" /></label>
      </div>
      <p className="hint">It goes against the oldest unpaid charges in the same currency first. Anything extra stays as credit.</p>
      <div className="row-end"><button type="button" className="ghost" onClick={onCancel}>Cancel</button><button className="primary" disabled={!cents}>Record payment</button></div>
    </form>
  );
}

function ChargeForm({ onSave, onCancel }: { onSave: (a: Record<string, string | number | null>) => Promise<void>; onCancel: () => void }) {
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('ZAR');
  const [due, setDue] = useState(today());
  const cents = parseMoney(amount);
  return (
    <form className="panel-form" onSubmit={(e) => { e.preventDefault(); if (cents) onSave({ p_client: null, p_description: desc.trim(), p_amount_minor: cents, p_currency: currency, p_due_on: due }); }}>
      <div className="grid-2">
        <label>What it is for<input required value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Extra page, logo redesign" /></label>
        <AmountField label="Amount" value={amount} onChange={setAmount} currency={currency} setCurrency={setCurrency} />
        <label>Due on<input type="date" required value={due} onChange={(e) => setDue(e.target.value)} /></label>
      </div>
      <div className="row-end"><button type="button" className="ghost" onClick={onCancel}>Cancel</button><button className="primary" disabled={!cents}>Add charge</button></div>
    </form>
  );
}

function AgreementForm({ onSave, onCancel }: { onSave: (a: Record<string, string | number | null>) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const [billing, setBilling] = useState<'once' | 'monthly'>('once');
  const [price, setPrice] = useState('');
  const [deposit, setDeposit] = useState('');
  const [start, setStart] = useState(today());
  const [balanceDue, setBalanceDue] = useState('');
  const [inclusions, setInclusions] = useState('');
  const p = parseMoney(price);
  const d = deposit ? parseMoney(deposit) : 0;
  const invalid = !p || d === null || (billing === 'once' && (d ?? 0) > (p ?? 0));
  return (
    <form className="panel-form" onSubmit={(e) => {
      e.preventDefault();
      if (!invalid) onSave({ p_client: null, p_title: title.trim(), p_currency: 'ZAR', p_price_minor: p!, p_deposit_minor: d ?? 0, p_billing: billing,
        p_starts_on: start, p_inclusions: inclusions.trim() || null, p_balance_due_on: billing === 'once' && balanceDue ? balanceDue : null });
    }}>
      <div className="kind-toggle" role="radiogroup" aria-label="Billing">
        {(['once', 'monthly'] as const).map((b) => <button type="button" key={b} role="radio" aria-checked={billing === b} className={billing === b ? 'on' : ''} onClick={() => setBilling(b)}>{b === 'once' ? 'Once-off' : 'Monthly'}</button>)}
      </div>
      <div className="grid-2">
        <label>Agreement<input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder={billing === 'once' ? 'Website build' : 'Care plan'} /></label>
        <AmountField label={billing === 'once' ? 'Agreed total (ZAR)' : 'Monthly amount (ZAR)'} value={price} onChange={setPrice} />
        <AmountField label="Deposit (optional)" value={deposit} onChange={setDeposit} />
        <label>Starts on<input type="date" required value={start} onChange={(e) => setStart(e.target.value)} /></label>
        {billing === 'once' && <label>Balance due on<input type="date" value={balanceDue} onChange={(e) => setBalanceDue(e.target.value)} /></label>}
      </div>
      <label>What is included<textarea rows={2} value={inclusions} onChange={(e) => setInclusions(e.target.value)} placeholder="Pages, revisions, hosting, anything promised" /></label>
      {billing === 'once' && p && d !== null && d > p && <p className="field-error">The deposit cannot be more than the agreed total.</p>}
      <p className="hint">{billing === 'once' ? 'Creates a deposit charge on the start date and the balance on its due date.' : 'Creates one charge a month on the start day (month-end when shorter). The agreement itself cannot be edited later; end it and start a new one when terms change.'}</p>
      <div className="row-end"><button type="button" className="ghost" onClick={onCancel}>Cancel</button><button className="primary" disabled={invalid}>Save agreement</button></div>
    </form>
  );
}

function ClientFields({ client: c, onSave, onCancel }: { client: Client; onSave: (f: Partial<Client>) => Promise<void>; onCancel: () => void }) {
  const [f, setF] = useState({ contact_name: c.contact_name ?? '', email: c.email ?? '', phone: c.phone ?? '', website: c.website ?? '', follow_up_on: c.follow_up_on ?? '', notes: c.notes ?? '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="panel-form" onSubmit={(e) => { e.preventDefault(); onSave(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]))); }}>
      <div className="grid-2">
        <label>Contact person<input value={f.contact_name} onChange={set('contact_name')} /></label>
        <label>Email<input type="email" value={f.email} onChange={set('email')} /></label>
        <label>Phone<input type="tel" value={f.phone} onChange={set('phone')} /></label>
        <label>Website<input value={f.website} onChange={set('website')} /></label>
        <label>Follow up on<input type="date" value={f.follow_up_on} onChange={set('follow_up_on')} /></label>
      </div>
      <label>Notes<textarea rows={3} value={f.notes} onChange={set('notes')} /></label>
      <div className="row-end"><button type="button" className="ghost" onClick={onCancel}>Cancel</button><button className="primary">Save details</button></div>
    </form>
  );
}
