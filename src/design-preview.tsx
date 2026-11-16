// Dev-only design preview with fictional data (not part of the app build: vite builds index.html only).
import { createRoot } from 'react-dom/client';
import './styles.css';
import { Mark } from './ui/Mark.tsx';
import { BellIcon, Inbox, Lane, QuickAdd, SyncPill, TaskCard, type Row } from './ui/Workspace.tsx';

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
      </main>
    </div>
  </div>,
);
