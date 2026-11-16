// Dev-only design preview with fictional data (not part of the app build: vite builds index.html only).
import { createRoot } from 'react-dom/client';
import './styles.css';
import { Mark } from './ui/Mark.tsx';
import { BellIcon, Inbox, Lane, QuickAdd, SyncPill, TaskCard, type Row } from './ui/Workspace.tsx';
import { ClientsView } from './ui/Clients.tsx';
import { Approvals, TrashView } from './ui/Deletion.tsx';
import { FilesView } from './ui/Files.tsx';
import { LinksStrip } from './ui/Links.tsx';
import { SearchPanel } from './ui/Search.tsx';
import { CalendarView } from './ui/Calendar.tsx';
import { FocusPanel } from './ui/Focus.tsx';
import { PrivateSetup } from './ui/Private.tsx';
import { PrivateView } from './ui/PrivateRoom.tsx';
import { TodayView } from './ui/Today.tsx';
import { sealText } from './crypto/vault.ts';
import type { Item } from './lib/data.ts';
import type { DeletionRequest } from './lib/data.ts';

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
FIX.files_current = [
  { id: 'f1', space_id: 's', title: 'Bright Dental logo (final)', body: 'From Dr Khumalo by email, 12 Nov.', created_by: 'miki', updated_at: '', item_version: 3, version: 2, storage_path: 's/f1/v2-logo.svg', original_name: 'BD-logo-final.svg', mime: 'image/svg+xml', size_bytes: 48213, sha256: 'b'.repeat(64), review: 'approved', uploaded_by: 'me', uploaded_at: new Date().toISOString() },
  { id: 'f2', space_id: 's', title: 'Signed quote', body: null, created_by: 'me', updated_at: '', item_version: 1, version: 1, storage_path: 's/f2/v1-quote.pdf', original_name: 'Quote-BD-0042.pdf', mime: 'application/pdf', size_bytes: 210400, sha256: 'c'.repeat(64), review: 'received', uploaded_by: 'me', uploaded_at: new Date().toISOString() },
  { id: 'f3', space_id: 's', title: 'Homepage copy v3', body: null, created_by: 'miki', updated_at: '', item_version: 1, version: 1, storage_path: 's/f3/v1-copy.docx', original_name: 'homepage-copy-v3.docx', mime: 'application/msword', size_bytes: 31200, sha256: 'd'.repeat(64), review: 'reviewing', uploaded_by: 'miki', uploaded_at: new Date().toISOString() },
  { id: 'f4', space_id: 's', title: 'Proof of deposit', body: 'Screenshot from client. Not a confirmed receipt.', created_by: 'miki', updated_at: '', item_version: 1, version: 1, storage_path: 's/f4/v1-proof.png', original_name: 'IMG_2041.png', mime: 'image/png', size_bytes: 812000, sha256: 'e'.repeat(64), review: null, uploaded_by: 'miki', uploaded_at: new Date().toISOString() },
];
FIX.file_versions = [
  { item_id: 'f1', version: 2, storage_path: 's/f1/v2-logo.svg', original_name: 'BD-logo-final.svg', mime: 'image/svg+xml', size_bytes: 48213, sha256: 'b'.repeat(64), state: 'verified', review: 'approved', uploaded_by: 'me', uploaded_at: new Date().toISOString() },
  { item_id: 'f1', version: 1, storage_path: 's/f1/v1-logo.svg', original_name: 'BD-logo.svg', mime: 'image/svg+xml', size_bytes: 47002, sha256: 'f'.repeat(64), state: 'verified', review: 'used', uploaded_by: 'miki', uploaded_at: '2026-11-01T10:00:00Z' },
];
FIX.file_links = [{ file_id: 'f1', target_item: 'a1', target_client: null }, { file_id: 'f1', target_item: null, target_client: 'c1' }];
const at = (dayOffset: number, h: number, m = 0) => { const d = new Date(); d.setUTCHours(h - 2, m, 0, 0); d.setUTCDate(d.getUTCDate() + dayOffset); return d.toISOString(); };
const EVENTS = [
  { id: 'e1', space_id: 's', kind: 'event', title: 'Bright Dental: homepage review call', body: null, starts_at: at(0, 10), ends_at: at(0, 10, 45), all_day: false, recur: null, task_id: null, version: 1, created_by: 'miki' },
  { id: 'e2', space_id: 's', kind: 'event', title: 'Weekly planning', body: null, starts_at: at(-14, 8, 30), ends_at: at(-14, 9), all_day: false, recur: { freq: 'weekly', byweekday: [1, 4] }, task_id: null, version: 1, created_by: 'me' },
  { id: 'e3', space_id: 's', kind: 'event', title: 'Work on: booking form', body: null, starts_at: at(1, 13), ends_at: at(1, 15), all_day: false, recur: null, task_id: 'a3', version: 1, created_by: 'me' },
  { id: 'e4', space_id: 's', kind: 'event', title: 'Kasi Coffee shoot', body: null, starts_at: at(3, 0), ends_at: at(4, 0), all_day: true, recur: null, task_id: null, version: 1, created_by: 'miki' },
];
if (['#clients', '#files', '#calendar', '#focus', '#search', '#today'].includes(location.hash)) {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const table = url.pathname.match(/\/rest\/v1\/(\w+)/)?.[1];
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname.endsWith('/rpc/search_all')) return json([
      { kind: 'task', id: 'a1', space_id: 's', title: 'Approve homepage copy for Bright Dental', snippet: 'Miki left two options in the shared doc', extra: null, updated_at: at(0, 9), trashed: false, rank: 0 },
      { kind: 'client', id: 'c1', space_id: 's', title: 'Bright Dental', snippet: 'Dr N. Khumalo, hello@brightdental.example', extra: 'client', updated_at: at(-1, 9), trashed: false, rank: 0 },
      { kind: 'file', id: 'f1', space_id: 's', title: 'Bright Dental logo (final)', snippet: 'BD-logo-final.svg', extra: 'image/svg+xml', updated_at: at(-2, 9), trashed: false, rank: 0 },
      { kind: 'link', id: 'l2', space_id: 's', title: 'Quote admin', snippet: 'https://brightdental.example/admin', extra: 'https://brightdental.example/admin', updated_at: at(-3, 9), trashed: false, rank: 1 },
      { kind: 'note', id: 'n9', space_id: 's', title: 'Kickoff call notes', snippet: 'Bright Dental wants a booking form live before December, with SMS reminders for patients', extra: null, updated_at: at(-5, 9), trashed: false, rank: 1 },
      { kind: 'note', id: 'n8', space_id: 's', title: 'Old pricing (Bright)', snippet: 'superseded', extra: null, updated_at: at(-30, 9), trashed: true, rank: 0 },
    ]);
    if (url.pathname.endsWith('/rpc/busy_slots')) return json([{ user_id: 'miki', starts_at: at(0, 14), ends_at: at(0, 16), all_day: false, recur: null }, { user_id: 'miki', starts_at: at(-7, 18), ends_at: at(-7, 19), all_day: false, recur: { freq: 'weekly', byweekday: [2] } }]);
    if (url.pathname.endsWith('/rpc/focus_summaries')) return json([{ user_id: 'me', day: '', measured_seconds: 4800, adjusted_seconds: 0, sessions: 2, completed: 1, running: true }, { user_id: 'miki', day: '', measured_seconds: 2700, adjusted_seconds: 0, sessions: 1, completed: 1, running: false }]);
    if (table === 'focus_sessions') return json([{ id: 'fs1', mode: 'countdown', started_at: at(0, 7), ended_at: at(0, 7, 50), paused_seconds: 0, completed: true, adjust_seconds: 600, adjust_reason: 'Forgot to start the timer' }]);
    if (table === 'event_exceptions') return json([]);
    if (table === 'items' && url.searchParams.get('kind') === 'eq.event') return json(url.searchParams.get('recur') === 'is.null' ? EVENTS.filter((e) => !e.recur) : EVENTS.filter((e) => e.recur));
    if (table === 'items' && !url.searchParams.get('kind')) return json([
      { id: 'a1', space_id: 's', kind: 'task', title: 'Approve homepage copy for Bright Dental', body: null, version: 1, created_by: 'miki', updated_at: at(0, 9), assignee: 'me', status: 'open', due_at: at(0, 9), url: null },
      { id: 'a2', space_id: 's', kind: 'task', title: 'Send deposit reminder to Lumen Studio', body: null, version: 1, created_by: 'miki', updated_at: at(0, 9), assignee: 'me', status: 'open', due_at: at(0, 17), url: null },
      { id: 'a3', space_id: 's', kind: 'task', title: 'Record walkthrough video of the booking form', body: null, version: 1, created_by: 'me', updated_at: at(0, 9), assignee: 'me', status: 'in_progress', due_at: null, url: null },
      { id: 'a5', space_id: 's', kind: 'task', title: 'Renew webrift.co.za hosting', body: null, version: 1, created_by: 'me', updated_at: at(0, 9), assignee: 'me', status: 'open', due_at: at(2, 12), url: null },
      { id: 'b1', space_id: 's', kind: 'task', title: 'Draft captions', body: null, version: 1, created_by: 'me', updated_at: at(0, 9), assignee: 'miki', status: 'open', due_at: null, url: null },
      { id: 'b2', space_id: 's', kind: 'task', title: 'Collect logo files', body: null, version: 1, created_by: 'me', updated_at: at(0, 9), assignee: 'miki', status: 'in_progress', due_at: null, url: null },
      { id: 'c9', space_id: 's', kind: 'task', title: 'Find a photographer', body: null, version: 1, created_by: 'me', updated_at: at(0, 9), assignee: null, status: 'open', due_at: null, url: null },
    ]);
    if (table === 'items' && url.searchParams.get('kind') === 'eq.task') return json([{ id: 'a2', space_id: 's', title: 'Send deposit reminder to Lumen Studio', due_at: at(1, 16, 30), assignee: 'me', status: 'open' }]);
    if (url.pathname.includes('/storage/v1/object/sign/')) return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (table === 'file_versions' || table === 'file_links') {
      const key = table === 'file_versions' ? 'item_id' : 'file_id';
      const want = (url.searchParams.get(key) ?? '').replace(/^eq[.]/, '');
      return new Response(JSON.stringify(FIX[table].filter((r) => (r as Record<string, string>)[key] === want)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
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
const partner = { id: MIKI, email: 'miki@example.test', role: 'member' as const, display_name: null };
const asMember = location.search.includes('member');
const fakeReq: DeletionRequest = { id: 'r1', item_id: 'b2', item_version: 1, reason: 'Kasi Coffee sent the files on WhatsApp already, this is a duplicate.', requested_by: MIKI, status: 'pending', action: 'delete', created_at: soon(-2), items: { title: 'Collect logo files from Kasi Coffee', kind: 'task', space_id: 's' } };
const deletion = { isOwner: !asMember, requestFor: (id: string) => (id === 'b2' ? fakeReq : undefined), onAskDelete: async () => {}, onTrash: async () => {} };
const card = { userId: ME, partner, nameOf, onEdit: async () => {}, onHandOver: async () => {}, arrived: null, deletion, onSchedule: () => {} };
const trashMode = location.hash === '#trash';
const filesMode = location.hash === '#files';
const calMode = location.hash === '#calendar';
const focusMode = location.hash === '#focus';
const searchMode = location.hash === '#search';
const setupMode = location.hash === '#setup';
const privMode = location.hash === '#private';
// Genuinely encrypted demo rows, decrypted on screen with a key that exists only in this page.
const demoKey = privMode ? await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) : null;
const sealRow = async (id: string, kind: string, title: string, body: string | null, status: string | null): Promise<Item> => ({
  id, space_id: 'p', kind, title: await sealText(demoKey!, title, id, 'title'), body: body ? await sealText(demoKey!, body, id, 'body') : null,
  version: 1, created_by: ME, updated_at: '', assignee: null, status: status as Item['status'], due_at: null,
});
const privItems: Item[] = privMode ? [
  await sealRow('p1', 'task', 'Book follow-up with Dr Patel', null, 'open'),
  await sealRow('p2', 'task', 'Finish chapter 4 summary', 'Focus on the case studies section', 'open'),
  await sealRow('p3', 'task', 'Renew licence disc', null, 'done'),
  await sealRow('p4', 'note', 'Study plan for December', 'Mon/Wed: accounting\nTue/Thu: marketing law\nFri: past papers', null),
] : [];
const fakeUploads = [
  { op_id: 'u1', space_id: 's', item_id: null, name: 'site-visit-photo.jpg', mime: 'image/jpeg', size: 3400000, sha256: '', blob: new Blob(), state: 'uploading' as const, progress: 0.62, added_at: '' },
  { op_id: 'u2', space_id: 's', item_id: null, name: 'brand-guide.pdf', mime: 'application/pdf', size: 9800000, sha256: '', blob: new Blob(), state: 'failed' as const, error: 'Offline. It will upload when you reconnect.', progress: 0.1, added_at: '' },
];
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
    {searchMode && <SearchPanel userId={ME} spaces={[{ id: 's', name: 'WebRift', visibility: 'shared', owner_id: null }]} privateKey={null} onPick={() => {}} onClose={() => {}} />}
    {focusMode && <FocusPanel userId={ME} timer={{ id: 't', mode: 'cycle', started_at: Date.now() - 31 * 60_000, paused_at: null, paused_ms: 0, planned_seconds: 1500, break_seconds: 300, label: 'Chapter 4 revision', task_id: null }}
      setTimer={() => {}} queue={async () => {}} nameOf={nameOf} tasks={[]} onClose={() => {}} online />}
    {inbox && <Inbox push="registered" onRead={async () => {}} onClose={() => {}} items={[
      { id: 'n1', kind: 'task_assigned', title: 'Miki assigned you a task', body: 'Approve homepage copy for Bright Dental', item_id: null, created_at: soon(-1), read_at: null },
      { id: 'n2', kind: 'task_done', title: 'Miki completed a task', body: 'Collect testimonials', item_id: null, created_at: soon(-20), read_at: soon(-2) },
    ]} />}
    <div className="frame">
      <nav className="rail"><p className="rail-title">Spaces</p><ul>
        <li><button className="space on"><span className="mono">W</span><span className="space-name">WebRift</span></button></li>
        <li><button className="space"><span className="mono">7</span><span className="space-name">7 Waves</span></button></li>
        <li><button className="space"><span className="mono">S</span><span className="space-name">Shared study</span></button></li>
      </ul><button className="ghost new-space-btn">New shared space</button></nav>
      <main className="stage">
        <section className="intro hero"><span className="mono mono-lg">W</span><p className="date">Monday, 16 November</p><h1>WebRift</h1>
          <p className="summary">You have 3 tasks on your side. Miki has 2 tasks. One task is still unclaimed.</p></section>
        <LinksStrip removeLabel="Move to trash" removePending={() => false} onAdd={async () => {}} onEdit={async () => {}} onRemove={async () => {}} links={[
          { id: 'l1', title: 'WebRift (live site)', body: null, url: 'https://webrift.example/', version: 1, pending: false },
          { id: 'l2', title: 'Quote admin', body: 'Approve new quotes here first thing', url: 'https://webrift.example/admin/quotes', version: 1, pending: false },
          { id: 'l3', title: 'Vercel dashboard', body: null, url: 'https://vercel.com/dashboard', version: 1, pending: false },
          { id: 'l4', title: 'Client folder', body: 'Logos, briefs, signed quotes', url: 'https://drive.google.com/drive/folders/example', version: 1, pending: true },
        ]} />
        <div className="views"><button className={clientsMode ? '' : 'on'}>Tasks and notes</button><button className={clientsMode ? 'on' : ''}>Clients and money</button></div>
        {location.hash === '#today' ? <TodayView userId={ME} name="Hassan" partnerId={MIKI} partnerName="Miki" spaces={[{ id: 's', name: 'WebRift', visibility: 'shared', owner_id: null }]} privateKey={null} timer={null} refreshKey={0} onOpenTask={() => {}} onOpenCalendar={() => {}} onFocus={() => {}} />
        : setupMode ? <PrivateSetup userId={ME} isOwner={false} ownerName="Hassan" partnerName="Hassan" onDone={() => {}} />
        : privMode ? <PrivateView space={{ id: 'p', name: 'x', visibility: 'private', owner_id: ME }} name="Private" items={privItems} pending={[]} keyFor={demoKey!}
            queue={async () => {}} onLock={() => {}} isOwner={false} partnerName="Hassan" reload={async () => {}} />
        : calMode ? <CalendarView userId={ME} privateKey={null} spaces={[{ id: 's', name: 'WebRift', visibility: 'shared', owner_id: null }]} nameOf={nameOf} partnerName="Miki"
          queue={async () => {}} pendingCount={0} online prefill={null} onPrefillUsed={() => {}} /> : filesMode ? <FilesView spaceId="s" userId={ME} isOwner={!asMember} online nameOf={nameOf} tasks={[...mine, ...theirs].map((t) => ({ id: t.id, title: t.title }))}
          uploads={fakeUploads} refused={[{ name: 'drone-footage.mov', reason: 'It is 312.0 MB; the limit is 50 MB per file on the current free plan.' }]}
          onPick={async () => {}} onRetry={() => {}} onRemoveUpload={() => {}} onRename={async () => {}} requestFor={() => undefined}
          onAskDelete={async () => {}} onTrash={async () => {}} refreshKey={0} /> : trashMode ? <TrashView isOwner={!asMember} requests={[]} nameOf={nameOf} onAskRestore={async () => {}} onRestore={async () => {}} onPurge={async () => {}} items={[
          { id: 't1', kind: 'note', title: 'Old pricing sheet (2025)', body: null, version: 2, deleted_at: soon(-30), created_by: MIKI },
          { id: 't2', kind: 'task', title: 'Call printer about flyers', body: null, version: 4, deleted_at: soon(-80), created_by: ME },
        ]} /> : clientsMode ? <ClientsView spaceId="s" userId={ME} nameOf={nameOf} pending={[]} queue={async () => {}} online /> : <>
        {!asMember && <Approvals requests={[fakeReq]} nameOf={nameOf} onDecide={async () => 'approved'} />}
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
