// Dev-only design preview with fictional data (not part of the app build: vite builds index.html only).
import { createRoot } from 'react-dom/client';
import './styles.css';
import { Mark } from './ui/Mark.tsx';
import { BellIcon, Inbox, Lane, QuickAdd, SyncPill, TaskCard, type Row } from './ui/Workspace.tsx';
import { ClientsView } from './ui/Clients.tsx';

// Fictional fixtures answered in place of the database, so the clients screens can be reviewed without signing in.
const FIX: Record<string, unknown[]> = {
  clients: [
    { id: 'c1', space_id: 's', name: 'Bright Dental', contact_name: 'Dr N. Khumalo', email: 'hello@example.test', phone: '010 000 0000', website: 'brightdental.example', location: null, stage: 'client', responsible: 'me', follow_up_on: null, notes: 'Prefers WhatsApp voice notes. Wants booking form live before December.', version: 3, created_by: 'miki', updated_at: '' },
    { id: 'c2', space_id: 's', name: 'Kasi Coffee', contact_name: 'Thabo', email: null, phone: null, website: null, location: null, stage: 'proposal', responsible: 'miki', follow_up_on: '2026-11-16', notes: null, version: 1, created_by: 'me', updated_at: '' },
    { id: 'c3', space_id: 's', name: 'Lumen Studio', contact_name: null, email: null, phone: null, website: null, location: null, stage: 'client', responsible: null, follow_up_on: null, notes: null, version: 1, created_by: 'me', updated_at: '' },
    { id: 'c4', space_id: 's', name: 'Ridge Plumbing', contact_name: 'Anele', email: null, phone: null, website: null, location: null, stage: 'approached', responsible: null, follow_up_on: '2026-11-20', notes: null, version: 1, created_by: 'me', updated_at: '' },
  ],
  client_balances: [
    { client_id: 'c1', currency: 'ZAR', charged_minor: 215000, paid_minor: 50000, outstanding_minor: 165000, overdue_minor: 45000 },
    { client_id: 'c3', currency: 'ZAR', charged_minor: 90000, paid_minor: 90000, outstanding_minor: 0, overdue_minor: 0 },
  ],
  charge_balances: [
    { id: 'h1', client_id: 'c1', agreement_id: 'a1', description: 'Website build — deposit', amount_minor: 50000, currency: 'ZAR', due_on: '2026-11-01', paid_minor: 50000, outstanding_minor: 0, state: 'paid', created_by: 'me' },
    { id: 'h2', client_id: 'c1', agreement_id: 'a1', description: 'Website build — balance', amount_minor: 120000, currency: 'ZAR', due_on: '2026-12-15', paid_minor: 0, outstanding_minor: 120000, state: 'due', created_by: 'me' },
    { id: 'h3', client_id: 'c1', agreement_id: null, description: 'Extra page: careers', amount_minor: 45000, currency: 'ZAR', due_on: '2026-11-10', paid_minor: 0, outstanding_minor: 45000, state: 'overdue', created_by: 'miki' },
  ],
  payment_ledger: [
    { id: 'p2', client_id: 'c1', amount_minor: 20000, currency: 'ZAR', received_on: '2026-11-12', method: 'EFT', reference: 'BD-1102', note: null, recorded_by: 'miki', recorded_at: '', reversed: true, reversal_reason: 'Entered twice', reversed_by: 'me', allocated_minor: 20000 },
    { id: 'p1', client_id: 'c1', amount_minor: 50000, currency: 'ZAR', received_on: '2026-11-02', method: 'EFT', reference: 'BD-DEP', note: null, recorded_by: 'me', recorded_at: '', reversed: false, reversal_reason: null, reversed_by: null, allocated_minor: 50000 },
  ],
  agreements: [
    { id: 'a1', client_id: 'c1', title: 'Website build', inclusions: '5 pages, booking form, 2 revision rounds', currency: 'ZAR', price_minor: 170000, deposit_minor: 50000, billing: 'once', starts_on: '2026-11-01', ends_on: null, created_by: 'me' },
  ],
};
if (location.hash === '#clients') {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const table = url.pathname.match(/\/rest\/v1\/(\w+)/)?.[1];
    if (table && FIX[table]) {
      const q = url.searchParams.get('client_id') ?? '';
      const ids = q.startsWith('eq.') ? [q.slice(3)] : q.startsWith('in.(') ? q.slice(4, -1).split(',') : null;
      const rows = ids ? FIX[table].filter((r) => ids.includes((r as { client_id: string }).client_id)) : FIX[table];
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return real(input, init);
  };
}

const ME = 'me', MIKI = 'miki';
const soon = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const t = (id: string, title: string, assignee: string | null, extra: Partial<Row> = {}): Row => ({
  id, kind: 'task', title, body: null, createdBy: MIKI, assignee, status: 'open', due_at: null, version: 1, sync: 'synced', updated_at: soon(-id.length), ...extra,
});
const mine = [
  t('a1', 'Approve homepage copy for Bright Dental', ME, { due_at: soon(-3), body: 'Miki left two options in the shared doc. Pick one and comment.' }),
  t('a2', 'Send deposit reminder to Lumen Studio', ME, { due_at: soon(26), status: 'waiting' }),
  t('a3', 'Record walkthrough video of the new booking form', ME, { sync: 'pending', version: undefined }),
  t('a4', 'Renew webrift.co.za hosting', ME, { status: 'done' }),
];
const theirs = [
  t('b1', 'Draft three Instagram captions for the launch', MIKI, { due_at: soon(50), createdBy: ME }),
  t('b2', 'Collect logo files from Kasi Coffee', MIKI, { status: 'in_progress', createdBy: ME }),
];
const loose = [t('c1', 'Find a photographer for the 7 Waves shoot', null, { createdBy: ME })];
const nameOf = (id: string | null) => (id === ME ? 'You' : id === MIKI ? 'Miki' : 'Anyone');
const partner = { id: MIKI, email: 'miki@gmail.com', role: 'member' as const, display_name: null };
const card = { userId: ME, partner, nameOf, onEdit: async () => {}, onHandOver: async () => {}, arrived: null };
const inbox = location.hash === '#inbox';
const clientsMode = location.hash === '#clients';

createRoot(document.getElementById('root')!).render(
  <div className="app">
    <header className="bar">
      <Mark size={30} animate /><span className="wordmark">Sidekick</span>
      <SyncPill sync={{ state: 'synced' }} waiting={1} /><span className="grow" />
      <button className="ghost inbox-btn"><BellIcon /><span className="label-wide">Inbox</span><span className="count">2</span></button>
      <details className="account"><summary><span className="avatar">H</span></summary></details>
    </header>
    {inbox && <Inbox push="registered" onRead={async () => {}} onClose={() => {}} items={[
      { id: 'n1', kind: 'task_assigned', title: 'Miki assigned you a task', body: 'Approve homepage copy for Bright Dental', item_id: null, created_at: soon(-1), read_at: null },
      { id: 'n2', kind: 'task_done', title: 'Miki completed a task', body: 'Collect testimonials', item_id: null, created_at: soon(-20), read_at: soon(-2) },
    ]} />}
    <div className="frame">
      <nav className="rail"><p className="rail-title">Spaces</p><ul>
        <li><button className="space on"><span className="space-dot" />WebRift</button></li>
        <li><button className="space"><span className="space-dot" />7 Waves</button></li>
        <li><button className="space"><span className="space-dot" />Shared study</button></li>
      </ul><button className="ghost new-space-btn">New shared space</button></nav>
      <main className="stage">
        <section className="intro"><p className="date">Monday, 16 November</p><h1>WebRift</h1>
          <p className="summary">You have 3 tasks on your side. Miki has 2 tasks. One task is still unclaimed.</p></section>
        <div className="views"><button className={clientsMode ? '' : 'on'}>Tasks and notes</button><button className={clientsMode ? 'on' : ''}>Clients and money</button></div>
        {clientsMode ? <ClientsView spaceId="s" userId={ME} nameOf={nameOf} pending={[]} queue={async () => {}} online /> : <>
        <QuickAdd userId={ME} partnerId={MIKI} partnerName="Miki" onAdd={async () => {}} />
        <div className="side-switch"><button className="on you">Your side <b>3</b></button><button className="them">Miki <b>2</b></button></div>
        <div className="lanes" data-side="you">
          <Lane side="you" title="Your side" rows={mine} empty="" {...card} />
          <div className="seam" />
          <Lane side="them" title="Miki's side" rows={theirs} empty="" {...card} />
        </div>
        <section className="loose"><h2>Unclaimed</h2><ul className="task-list">{loose.map((r) => <TaskCard key={r.id} row={r} side="loose" {...card} />)}</ul></section>
        <section className="notes"><h2>Notes</h2><ul className="note-list">
          <li className="note"><h3>Bright Dental agreed scope</h3><p>5 pages, 2 revision rounds, booking form. Deposit R1,700 before design starts.</p><p className="byline">Miki, Fri 14 Nov 16:20</p></li>
          <li className="note"><h3>Brand colours for Kasi Coffee</h3><p>Deep green #1F3B2D, cream, copper accents. No stock photos.</p><p className="byline">You, Thu 13 Nov 09:05</p></li>
        </ul></section>
        </>}
      </main>
    </div>
  </div>,
);
