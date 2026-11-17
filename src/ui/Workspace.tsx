import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';
import { createSharedSpace, loadInbox, loadItems, loadProfiles, loadSpaces, markRead, sendOp, type Item, type Notification, type Profile, type Space, type TaskStatus } from '../lib/data.ts';
import { disablePush, enablePush, kickPushQueue, type PushStatus } from '../lib/push.ts';
import { dropCache, withCache } from '../lib/cache.ts';
import { Outbox, type Fields, type Op } from '../sync/outbox.ts';
import { Mark } from './Mark.tsx';
import { ClientsView } from './Clients.tsx';
import { Approvals, DeleteControls, TrashView } from './Deletion.tsx';
import { FilesView } from './Files.tsx';
import { CalendarView, type Prefill } from './Calendar.tsx';
import { FocusPanel, FocusPill } from './Focus.tsx';
import { PrivateSetup, Unlock } from './Private.tsx';
import { PrivateView } from './PrivateRoom.tsx';
import { LinksStrip, type LinkRow } from './Links.tsx';
import { SearchPanel } from './Search.tsx';
import { TodayView } from './Today.tsx';
import { WeekView } from './Week.tsx';
import { IconCalendar, IconLock, IconSearch, IconSpaces, IconToday, IconWeek } from './Icons.tsx';
import { RemindControl, reminderTime, BellSmall } from './Remind.tsx';
import { loadReminders, loadCommentCounts, type Reminder } from '../lib/data.ts';
import { Thread, CommentIcon } from './Thread.tsx';
import { REPEATS, repeatKey, repeatLabel } from '../lib/repeat.ts';
import { clearShareCache, onShare, takeShare, type Incoming } from '../lib/share.ts';
import { ShareSheet, type ShareChoice } from './ShareSheet.tsx';
import type { Recur } from '../lib/recur.ts';
import type { ReactNode } from 'react';
import { openLink } from '../lib/links.ts';
import type { Hit } from '../lib/search.ts';
import { lock, storedKey } from '../lib/keystore.ts';
import { loadPrivacyNotices, reveal, vaultRemote, type PrivacyNotice } from '../lib/data.ts';
import { loadTimer, type Timer } from '../lib/focus.ts';
import { clearTimerAlarms, scheduleTimerAlarms } from '../lib/alarms.ts';
import { enqueue, listQueue, processQueue, removeFromQueue, type QueuedUpload } from '../lib/uploads.ts';
import { dropKept, purgeFile, uploadDeps } from '../lib/files.ts';
import { decideRequest, loadRequests, loadTrash, purgeItem, requestDeletion, restoreItem, trashItem, type DeletionRequest, type TrashedItem } from '../lib/data.ts';

type SyncState = { state: 'synced' | 'syncing' | 'offline' | 'failed'; error?: string; opId?: string };
type RowSync = 'synced' | 'pending' | 'failed';
export type Row = {
  id: string; kind: string; title: string | null; body: string | null; createdBy: string;
  assignee: string | null; status: TaskStatus | null; due_at: string | null; version?: number; sync: RowSync; updated_at?: string; recur?: Recur | null;
};
type Side = 'you' | 'them';

const STATUS_LABEL: Record<TaskStatus, string> = { open: 'To do', in_progress: 'In progress', waiting: 'Waiting', done: 'Done' };
// Proposed default display timezone (spec §9), not yet confirmed by Hassan.
const TZ = 'Africa/Johannesburg';
const dayLine = new Intl.DateTimeFormat('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const when = new Intl.DateTimeFormat('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
const clock = new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: TZ });

/** Server rows with this device's unsent changes laid on top, so the screen shows what the user just did. */
function buildRows(items: Item[], pending: Op[], spaceId: string | null, failed: boolean): Row[] {
  const mark: RowSync = failed ? 'failed' : 'pending';
  const edits = new Map<string, Fields>();
  for (const op of pending) if (op.type === 'update') edits.set(op.id, { ...edits.get(op.id), ...op.fields });
  const creates = pending
    .filter((op): op is Extract<Op, { type: 'create' }> => op.type === 'create' && op.space_id === spaceId)
    .map((op): Row => {
      const f = { ...op.fields, ...edits.get(op.id) };
      return { id: op.id, kind: op.kind, title: f.title ?? null, body: f.body ?? null, createdBy: '', assignee: f.assignee ?? null,
        status: (f.status as TaskStatus) ?? null, due_at: f.due_at ?? null, sync: mark, recur: (f.recur as Recur | null | undefined) ?? null };
    });
  const known = new Set(creates.map((c) => c.id));
  return [
    ...creates,
    ...items.filter((i) => !known.has(i.id)).map((i): Row => {
      const e = edits.get(i.id);
      return { id: i.id, kind: i.kind, title: e?.title !== undefined ? e.title : i.title, body: e?.body !== undefined ? e.body : i.body,
        createdBy: i.created_by, assignee: e?.assignee !== undefined ? e.assignee : i.assignee,
        status: (e?.status as TaskStatus | undefined) ?? i.status, due_at: e?.due_at !== undefined ? e.due_at : i.due_at,
        version: i.version, sync: e ? mark : 'synced', updated_at: i.updated_at, recur: e?.recur !== undefined ? (e.recur as Recur | null) : i.recur ?? null };
    }),
  ];
}

const isOverdue = (r: Row) => r.kind === 'task' && !!r.due_at && r.status !== 'done' && new Date(r.due_at) < new Date();

/** Overdue first, then soonest due, then newest. */
function byUrgency(a: Row, b: Row) {
  const o = Number(isOverdue(b)) - Number(isOverdue(a));
  if (o) return o;
  if (a.due_at && b.due_at) return a.due_at.localeCompare(b.due_at);
  if (a.due_at || b.due_at) return a.due_at ? -1 : 1;
  return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
}

const plural = (n: number, one: string, many: string) => `${n === 0 ? 'nothing' : n} ${n === 1 ? one : many}`;

export function Workspace({ userId, email }: { userId: string; email: string }) {
  const [box, setBox] = useState<Outbox | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [threadKey, setThreadKey] = useState(0);
  const [live, setLive] = useState(false);
  const liveRef = useRef(false);
  liveRef.current = live;
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  useEffect(() => onShare(async () => { const s = await takeShare(); if (s) setIncoming(s); }), []);
  const [liveKey, setLiveKey] = useState(0); // bumps when the other person changes something
  const [pending, setPending] = useState<Op[]>([]);
  const [sync, setSync] = useState<SyncState>({ state: navigator.onLine ? 'synced' : 'offline' });
  const [savedCopy, setSavedCopy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [inbox, setInbox] = useState<Notification[]>([]);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [side, setSide] = useState<Side>('you');
  const [view, setView] = useState<'tasks' | 'clients' | 'files' | 'trash'>('tasks');
  const [uploads, setUploads] = useState<QueuedUpload[]>([]);
  const [refused, setRefused] = useState<{ name: string; reason: string }[]>([]);
  const [filesKey, setFilesKey] = useState(0);
  const uploading = useRef(false);
  const [page, setPage] = useState<'today' | 'week' | 'space' | 'calendar' | 'private-setup'>('today');
  const [privKey, setPrivKey] = useState<CryptoKey | null>(null);
  const [vaultExists, setVaultExists] = useState<boolean | null>(null);
  const [privateNames, setPrivateNames] = useState<Record<string, string>>({});
  const [notices, setNotices] = useState<PrivacyNotice[]>([]);
  useEffect(() => {
    storedKey(userId).then((k) => setPrivKey(k ?? null)).catch(() => setPrivKey(null));
    vaultRemote(userId).get().then((v) => setVaultExists(Boolean(v))).catch(() => setVaultExists(null));
  }, [userId]);
  const [prefill, setPrefill] = useState<Prefill>(null);
  const [timer, setTimer] = useState<Timer | null>(() => loadTimer(userId));
  const [focusOpen, setFocusOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false); // phone: the spaces sheet
  const [jump, setJump] = useState<{ kind: string; id: string } | null>(null);
  // "/" or Ctrl/Cmd+K opens search from anywhere (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.closest('input, textarea, select, [contenteditable]') !== null);
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // After jumping to a task or note, bring it into view and light it up briefly.
  useEffect(() => {
    if (!jump) return;
    if (jump.kind === 'client' || jump.kind === 'file') { const t = setTimeout(() => setJump(null), 800); return () => clearTimeout(t); }
    const t = setTimeout(() => {
      const el = document.getElementById(`item-${jump.id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1800);
        setJump(null); // done: later refreshes must not scroll or flash again
      }
    }, 350);
    return () => clearTimeout(t);
  }, [jump, items]);
  useEffect(() => { if (timer) scheduleTimerAlarms(timer); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- re-arm the alarm after a restart
  const [requests, setRequests] = useState<DeletionRequest[]>([]);
  const [trash, setTrash] = useState<TrashedItem[]>([]);
  const [arrived, setArrived] = useState<{ id: string; to: Side } | null>(null);

  // Each account has its own outbox database on this device.
  useEffect(() => {
    let opened: Outbox | null = null;
    let cancelled = false;
    Outbox.open(userId).then((b) => (cancelled ? b.close() : setBox((opened = b))));
    return () => {
      cancelled = true;
      opened?.close();
    };
  }, [userId]);

  const refresh = useCallback(async () => {
    try {
      const [sp, pr] = await Promise.all([withCache(userId, 'spaces', loadSpaces), withCache(userId, 'profiles', loadProfiles)]);
      setSpaces(sp.value);
      setProfiles(pr.value);
      setSpaceId((cur) => cur ?? sp.value.find((s) => s.visibility === 'shared')?.id ?? null);
      setSavedCopy(sp.fromCache ? sp.savedAt : null);
      setLoadError('');
    } catch (e) {
      setLoadError(navigator.onLine ? String(e) : 'You are offline and nothing is saved on this device yet. Connect once to download your spaces.');
    }
  }, [userId]);

  const reloadInbox = useCallback(async () => {
    try {
      setInbox((await withCache(userId, 'inbox', loadInbox)).value);
    } catch {
      /* inbox stays as last shown; the offline banner already explains why */
    }
    try { setReminders((await withCache(userId, 'reminders', loadReminders)).value); } catch { /* same */ }
  }, [userId]);

  useEffect(() => {
    enablePush(() => { setInboxOpen(true); reloadInbox(); }).then(setPush).catch(() => setPush('error'));
  }, [reloadInbox]);

  const reloadItems = useCallback(async () => {
    if (!spaceId) return setItems([]);
    try {
      const r = await withCache(userId, `items:${spaceId}`, () => loadItems(spaceId));
      setItems(r.value);
      withCache(userId, `comment-counts:${spaceId}`, () => loadCommentCounts(spaceId)).then((c) => setCommentCounts(c.value)).catch(() => {});
      setThreadKey((k) => k + 1);
      setSavedCopy((cur) => (r.fromCache ? r.savedAt : cur));
    } catch (e) {
      setItems([]);
      setLoadError(navigator.onLine ? String(e) : 'This space has not been opened on this device before, so there is no offline copy yet.');
    }
  }, [spaceId, userId]);

  // Uploads keep going whichever tab is open; one run at a time.
  const runUploads = useCallback(async () => {
    if (uploading.current || !navigator.onLine) { setUploads(await listQueue(userId).catch(() => [])); return; }
    uploading.current = true;
    try {
      const done = await processQueue(userId, uploadDeps, (q) => setUploads((cur) => q.length === 1 && cur.some((c) => c.op_id === q[0].op_id)
        ? cur.map((c) => (c.op_id === q[0].op_id ? { ...q[0] } : c)) : q));
      if (done) setFilesKey((k) => k + 1);
    } finally {
      uploading.current = false;
      setUploads(await listQueue(userId).catch(() => []));
    }
  }, [userId]);

  const reloadDeletion = useCallback(async () => {
    if (!spaceId) return;
    try {
      const [r, t] = await Promise.all([withCache(userId, `requests:${spaceId}`, () => loadRequests(spaceId)), withCache(userId, `trash:${spaceId}`, () => loadTrash(spaceId))]);
      setRequests(r.value);
      setTrash(t.value);
    } catch { /* shown as last known; deletion actions themselves need a connection */ }
  }, [spaceId, userId]);

  const flush = useCallback(async () => {
    if (!box) return;
    setPending(await box.pending());
    if (!navigator.onLine) return setSync({ state: 'offline' });
    setSync({ state: 'syncing' });
    const r = await box.flush(sendOp);
    setPending(await box.pending());
    setSync(r.failed ? { state: navigator.onLine ? 'failed' : 'offline', error: r.failed.error, opId: r.failed.op_id } : { state: 'synced' });
    if (r.results.length) {
      kickPushQueue();
      await reloadItems();
      await reloadInbox();
    }
  }, [box, reloadItems, reloadInbox]);

  useEffect(() => { refresh(); reloadInbox(); }, [refresh, reloadInbox]);

  // Instant sync: Supabase Realtime tells us when a row we are allowed to read changes. Bursts are folded
  // into one refresh. The 30-second check below stays as a safety net if the connection drops.
  const onLive = useRef<() => void>(() => {});
  onLive.current = () => { reloadItems(); reloadInbox(); reloadDeletion(); setFilesKey((k) => k + 1); setLiveKey((k) => k + 1); };
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const bump = () => { if (!t) t = setTimeout(() => { t = null; onLive.current(); }, 350); };
    let ch = supabase.channel(`live:${userId}`);
    for (const table of ['items', 'comments', 'notifications', 'deletion_requests', 'clients', 'charges', 'payments', 'reminders'])
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, bump);
    ch.subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => { if (t) clearTimeout(t); supabase.removeChannel(ch); };
  }, [userId]);
  useEffect(() => { reloadItems(); reloadDeletion(); }, [reloadItems, reloadDeletion]);
  useEffect(() => {
    flush();
    const onOnline = () => { refresh(); reloadItems(); reloadInbox(); flush(); runUploads(); };
    const onOffline = () => setSync({ state: 'offline' });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    runUploads();
    // safety net: unsent changes and uploads always retry; full reloads only when the live connection is down
    const timer = setInterval(() => { flush(); runUploads(); if (!liveRef.current) { reloadItems(); reloadInbox(); reloadDeletion(); } }, 30_000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(timer);
    };
  }, [flush, refresh, reloadItems, reloadInbox, reloadDeletion, runUploads]);

  const partner = profiles.find((p) => p.id !== userId);
  const me = profiles.find((p) => p.id === userId);
  const myName = me?.display_name || cap((me?.email ?? email).split('@')[0]);
  const partnerName = partner ? partner.display_name || cap(partner.email.split('@')[0]) : 'Your partner';
  const nameOf = (id: string | null) => {
    if (!id) return 'Anyone';
    if (id === userId) return 'You';
    const p = profiles.find((x) => x.id === id);
    return p ? p.display_name || cap(p.email.split('@')[0]) : 'Someone';
  };

  async function queue(op: Op) {
    if (!box) return;
    await box.add(op);
    await flush();
  }

  const addItem = (kind: string, fields: Fields) =>
    spaceId ? queue({ op_id: crypto.randomUUID(), type: 'create', id: crypto.randomUUID(), space_id: spaceId, kind, fields }) : Promise.resolve();

  const editItem = (row: Row, fields: Fields) =>
    row.version ? queue({ op_id: crypto.randomUUID(), type: 'update', id: row.id, base_version: row.version, fields }) : Promise.resolve();

  function handOver(row: Row, to: string | null) {
    const dest: Side = to === userId ? 'you' : 'them';
    setArrived({ id: row.id, to: dest });
    setTimeout(() => setArrived((a) => (a?.id === row.id ? null : a)), 900);
    return editItem(row, { assignee: to });
  }

  const isOwner = profiles.find((p) => p.id === userId)?.role === 'owner';
  const afterDeletion = async () => { await Promise.all([reloadItems(), reloadDeletion()]); };
  const deletion = {
    isOwner,
    requestFor: (id: string) => requests.find((r) => r.item_id === id),
    onAskDelete: async (row: Row, reason: string) => { await requestDeletion(row.id, row.version!, reason, 'delete', userId); await afterDeletion(); },
    onTrash: async (row: Row) => { await trashItem(row.id); await afterDeletion(); },
  };

  async function signOut() {
    const waiting = box ? (await box.pending()).length : 0;
    if (waiting && !confirm(`${waiting} change(s) have not reached the server yet. They stay on this device for this account and sync when you sign in here again. Sign out anyway?`)) return;
    await disablePush().catch(() => {}); // stop this phone receiving this account's pushes
    await clearTimerAlarms();
    await lock(userId).catch(() => {}); // the private area is locked on sign-out
    await supabase.auth.signOut();
    await dropCache(userId); // the read copy is re-downloadable; unsent changes (outbox) are kept
    await dropKept(userId); // kept files are re-downloadable too; queued uploads stay for this account
  }

  const space = spaces.find((s) => s.id === spaceId);
  const privateSpaces = spaces.filter((s) => s.visibility === 'private' && s.owner_id === userId);
  const ownerName = nameOf(profiles.find((p) => p.role === 'owner')?.id ?? null);
  useEffect(() => {
    Promise.all(privateSpaces.map(async (s) => [s.id, (await reveal(privKey, s.name, s.id, 'name')) ?? 'Private (locked)'] as const))
      .then((pairs) => setPrivateNames(Object.fromEntries(pairs)));
  }, [privKey, privateSpaces.map((s) => s.id + s.name).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const isOwnerNow = profiles.find((p) => p.id === userId)?.role === 'owner';
  useEffect(() => { if (isOwnerNow && inboxOpen) loadPrivacyNotices().then(setNotices).catch(() => {}); }, [isOwnerNow, inboxOpen]);
  const rows = buildRows(items, pending, spaceId, sync.state === 'failed');
  const tasks = rows.filter((r) => r.kind === 'task');
  const notes = rows.filter((r) => r.kind === 'note');
  const linkRows: LinkRow[] = [
    ...pending.filter((o): o is Extract<Op, { type: 'create' }> => o.type === 'create' && o.kind === 'link' && o.space_id === spaceId)
      .map((o) => ({ id: o.id, title: o.fields.title ?? null, body: o.fields.body ?? null, url: o.fields.url ?? null, pending: true })),
    ...items.filter((i) => i.kind === 'link' && !pending.some((o) => o.type === 'create' && o.id === i.id))
      .map((i) => ({ id: i.id, title: i.title, body: i.body, url: i.url ?? null, version: i.version, pending: false })),
  ];
  const mine = tasks.filter((t) => t.assignee === userId);
  const theirs = tasks.filter((t) => t.assignee && t.assignee !== userId);
  const loose = tasks.filter((t) => !t.assignee && t.status !== 'done').sort(byUrgency);
  const active = (list: Row[]) => list.filter((t) => t.status !== 'done');
  const unread = inbox.filter((n) => !n.read_at).length;

  // My reminders, with ones set or cancelled on this device but not yet synced laid on top.
  const shownReminders = (() => {
    const m = new Map(reminders.map((r) => [r.id, r]));
    for (const op of pending) {
      if (op.type !== 'call') continue;
      const id = String(op.args.p_id);
      if (op.fn === 'set_reminder') m.set(id, { id, item_id: String(op.args.p_item), remind_at: String(op.args.p_at), note: (op.args.p_note as string | null) ?? null, items: m.get(id)?.items ?? null, pending: true });
      else if (op.fn === 'cancel_reminder') m.delete(id);
    }
    return [...m.values()].sort((a, b) => a.remind_at.localeCompare(b.remind_at));
  })();
  const reminderFor = (itemId: string) => shownReminders.find((r) => r.item_id === itemId);
  const onRemind = (itemId: string, at: Date, note: string | null) => queue({ op_id: crypto.randomUUID(), type: 'call', fn: 'set_reminder', label: 'Reminder',
    args: { p_id: reminderFor(itemId)?.id ?? crypto.randomUUID(), p_item: itemId, p_at: at.toISOString(), p_note: note } });
  const onCancelRemind = (id: string) => queue({ op_id: crypto.randomUUID(), type: 'call', fn: 'cancel_reminder', label: 'Cancel reminder', args: { p_id: id } });

  const commentCount = (id: string) => (commentCounts[id] ?? 0)
    + pending.filter((o) => o.type === 'call' && o.fn === 'add_comment' && o.args.p_item === id).length;
  const renderThread = (id: string): ReactNode => <Thread itemId={id} userId={userId} nameOf={nameOf} pending={pending} queue={queue} refreshKey={threadKey} />;

  // The Files screen, for the whole space or (with a client) for one client's page.
  const renderFilesFor = (clientId: string | null): ReactNode => !space ? null : (
                <FilesView key={clientId ?? 'all'} clientId={clientId} spaceId={space.id} userId={userId} isOwner={isOwner} online={sync.state !== 'offline'} nameOf={nameOf}
                  tasks={rows.filter((r) => r.kind !== 'file' && r.version).map((r) => ({ id: r.id, title: r.title }))}
                  uploads={uploads} refused={refused} refreshKey={filesKey} focusId={jump?.kind === 'file' ? jump.id : null}
                  onPick={async (files, itemId, cid) => { setRefused(await enqueue(userId, files, space.id, itemId ?? null, cid ?? null)); setUploads(await listQueue(userId)); runUploads(); }}
                  onRetry={runUploads} onRemoveUpload={async (op) => { await removeFromQueue(userId, op); setUploads(await listQueue(userId)); }}
                  onRename={async (f, title, body) => { await queue({ op_id: crypto.randomUUID(), type: 'update', id: f.id, base_version: f.item_version, fields: { title, body } }); setFilesKey((k) => k + 1); }}
                  requestFor={deletion.requestFor}
                  onAskDelete={async (f, reason) => { await requestDeletion(f.id, f.item_version, reason, 'delete', userId); await afterDeletion(); setFilesKey((k) => k + 1); }}
                  onTrash={async (f) => { await trashItem(f.id); await afterDeletion(); setFilesKey((k) => k + 1); }} />
  );

  const onSchedule = (row: Row) => { if (!space) return; setPrefill({ space_id: space.id, task_id: row.id, title: `Work on: ${row.title ?? 'task'}` }); setPage('calendar'); };
  const cardProps = { userId, partner, nameOf, onEdit: editItem, onHandOver: handOver, arrived, deletion, onSchedule, reminderFor, onRemind, onCancelRemind, commentCount, renderThread };

  return (
    <div className="app">
      <header className="bar">
        <Mark size={30} animate />
        <span className="wordmark">Sidekick</span>
        <SyncPill sync={sync} waiting={pending.length} live={live} />
        <span className="grow" />
        <button className="ghost search-btn" onClick={() => setSearchOpen(true)} aria-label="Search (press / or Ctrl K)">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden className="icon"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <span className="label-wide">Search</span>
        </button>
        <FocusPill timer={timer} onOpen={() => setFocusOpen(true)} />
        <button className="ghost inbox-btn" aria-expanded={inboxOpen} aria-controls="inbox" onClick={() => setInboxOpen((o) => !o)}>
          <BellIcon />
          <span className="label-wide">Inbox</span>
          {unread > 0 && <span className="count" aria-label={`${unread} unread`}>{unread}</span>}
        </button>
        <AccountMenu email={email} onSignOut={signOut} />
      </header>

      {searchOpen && <SearchPanel userId={userId} spaces={spaces} privateKey={privKey} onClose={() => setSearchOpen(false)} onPick={(h: Hit) => {
        setSearchOpen(false);
        if (h.kind === 'link' && h.extra && !h.trashed) { openLink(h.extra); return; }
        if (h.kind === 'event') { setPage('calendar'); return; }
        setSpaceId(h.space_id);
        setPage('space');
        if (spaces.find((s) => s.id === h.space_id)?.visibility === 'shared') setView(h.trashed ? 'trash' : h.kind === 'client' ? 'clients' : h.kind === 'file' ? 'files' : 'tasks');
        setJump({ kind: h.kind, id: h.id });
      }} />}
      {focusOpen && <FocusPanel userId={userId} timer={timer} setTimer={setTimer} queue={queue} nameOf={nameOf} online={sync.state !== 'offline'}
        tasks={tasks.filter((t) => t.status !== 'done' && t.version).map((t) => ({ id: t.id, title: t.title }))} onClose={() => setFocusOpen(false)} />}
      {incoming && <ShareSheet incoming={incoming} spaces={spaces} spaceId={spaceId} userId={userId} onClose={() => { setIncoming(null); clearShareCache(); }}
        onSave={async (c: ShareChoice) => {
          if (c.kind === 'files') {
            setRefused(await enqueue(userId, c.files, c.spaceId, null, c.clientId));
            setUploads(await listQueue(userId));
            runUploads();
          } else {
            const fields: Fields = c.kind === 'link' ? { url: c.url, title: c.title, body: c.body }
              : c.kind === 'task' ? { title: c.title, body: [c.body, c.url].filter(Boolean).join('\n') || null, status: 'open', assignee: userId }
              : { title: c.title, body: [c.body, c.url].filter(Boolean).join('\n') || null };
            await queue({ op_id: crypto.randomUUID(), type: 'create', id: crypto.randomUUID(), space_id: c.spaceId, kind: c.kind, fields });
          }
          await clearShareCache(); // the upload queue keeps its own copy
          setIncoming(null);
          setSpaceId(c.spaceId); setPage('space'); setView(c.kind === 'files' ? 'files' : 'tasks');
        }} />}
      {inboxOpen && <Inbox items={inbox} push={push} notices={notices} nameOf={nameOf} onClose={() => setInboxOpen(false)} reminders={shownReminders} onCancelRemind={onCancelRemind}
        onRead={async (ids) => { await markRead(ids).catch(() => {}); await reloadInbox(); }} />}

      {savedCopy && <p className="notice warn" role="status">Showing what this device saved at {clock.format(new Date(savedCopy))}. Changes from {partnerName} since then will appear when you reconnect.</p>}
      {loadError && <p className="notice bad" role="alert">{loadError}</p>}
      {sync.state === 'failed' && (() => {
        const stuck = pending.find((p) => p.op_id === sync.opId);
        const what = !stuck ? 'A change' : stuck.type === 'call' ? stuck.label : stuck.type === 'create' ? `New ${stuck.kind}` : 'An edit';
        const behind = pending.length - 1;
        return (
          <div className="notice bad stuck" role="alert">
            <p><b>{what}</b> was refused by the server: {sync.error}.{behind > 0 ? ` ${behind} later change${behind === 1 ? ' is' : 's are'} waiting behind it.` : ''} It is kept on this device.</p>
            <span className="row-start">
              <button onClick={() => flush()}>Retry</button>
              {stuck && box && <button className="ghost danger" onClick={async () => {
                if (!confirm(`Skip "${what}"? It will be removed from this device and never sent. Everything after it will then sync.`)) return;
                await box.remove(stuck.op_id);
                await flush();
              }}>Skip this change</button>}
            </span>
          </div>
        );
      })()}

      <div className="frame">
        {sheetOpen && <div className="scrim sheet-scrim" onClick={() => setSheetOpen(false)} aria-hidden />}
        <nav className={sheetOpen ? 'rail sheet-open' : 'rail'} aria-label="Spaces" onClick={(e) => { if ((e.target as HTMLElement).closest('.space')) setSheetOpen(false); }}>
          <span className="sheet-grip" aria-hidden />
          <div className="rail-main">
            {([['today', 'Today', IconToday], ['week', 'Week', IconWeek], ['calendar', 'Calendar', IconCalendar]] as const).map(([p, label, Icon]) => (
              <button key={p} className={page === p ? 'space nav on' : 'space nav'} aria-current={page === p} onClick={() => setPage(p)}><Icon />{label}</button>
            ))}
          </div>
          <p className="rail-title">Spaces</p>
          <ul>
            {spaces.filter((s) => s.visibility === 'shared').map((s) => (
              <li key={s.id}>
                <button className={s.id === spaceId && page === 'space' ? 'space on' : 'space'} aria-current={s.id === spaceId && page === 'space'} onClick={() => { setSpaceId(s.id); setPage('space'); }}>
                  <span className="mono" aria-hidden>{s.name.trim().charAt(0).toUpperCase()}</span><span className="space-name">{s.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <NewSpace onCreate={async (name) => { await createSharedSpace(name, userId); await refresh(); }} />
          <p className="rail-title rail-private">Private</p>
          {vaultExists === false ? (
            <button className={page === 'private-setup' ? 'space on' : 'space'} onClick={() => setPage('private-setup')}><span className="mono mono-lock" aria-hidden><IconLock /></span><span className="space-name">Set up your private area</span></button>
          ) : (
            <ul>{privateSpaces.map((s) => (
              <li key={s.id}>
                <button className={s.id === spaceId && page === 'space' ? 'space on' : 'space'} aria-current={s.id === spaceId && page === 'space'} onClick={() => { setSpaceId(s.id); setPage('space'); }}>
                  <span className="mono mono-lock" aria-hidden><IconLock /></span><span className="space-name">{privateNames[s.id] ?? '…'}</span>
                </button>
              </li>
            ))}</ul>
          )}
        </nav>

        <main className="stage" key={page === 'space' ? `space:${spaceId}` : page}>
          {page === 'private-setup' ? (
            <PrivateSetup userId={userId} isOwner={isOwnerNow} ownerName={ownerName} partnerName={partnerName}
              onDone={async (k) => { setPrivKey(k); setVaultExists(true); await refresh(); setPage('space'); }} />
          ) : page === 'space' && space?.visibility === 'private' ? (
            privKey ? (
              <PrivateView space={space} name={privateNames[space.id] ?? 'Private'} items={items} pending={pending} keyFor={privKey} queue={queue}
                isOwner={isOwnerNow} partnerName={partnerName} reload={reloadItems}
                onLock={async () => { await lock(userId); setPrivKey(null); }} />
            ) : <Unlock userId={userId} onUnlocked={(k) => setPrivKey(k)} />
          ) : page === 'today' ? (
            <TodayView userId={userId} name={myName} partnerId={partner?.id ?? null} partnerName={partnerName} spaces={spaces} privateKey={privKey} timer={timer}
              refreshKey={pending.length + items.length + liveKey} onOpenCalendar={() => setPage('calendar')} onFocus={() => setFocusOpen(true)}
              onOpenTask={(sid, id) => { setSpaceId(sid); setPage('space'); setView('tasks'); setJump({ kind: 'task', id }); }} />
          ) : page === 'week' ? (
            <WeekView userId={userId} partnerId={partner?.id ?? null} partnerName={partnerName} spaces={spaces} queue={queue} refreshKey={pending.length + items.length + liveKey}
              onOpenTask={(sid, id) => { setSpaceId(sid); setPage('space'); setView('tasks'); setJump({ kind: 'task', id }); }} />
          ) : page === 'calendar' ? (
            <CalendarView userId={userId} spaces={spaces} privateKey={privKey} nameOf={nameOf} partnerName={partnerName} queue={queue} pendingCount={pending.length + liveKey /* also reloads on live changes */}
              online={sync.state !== 'offline'} prefill={prefill} onPrefillUsed={() => setPrefill(null)} />
          ) : !space ? (
            <section className="intro empty-intro">
              <p className="date">{cap(dayLine.format(new Date()))}</p>
              <h1>Start with a shared space</h1>
              <p className="summary">Spaces hold the work you both see, like WebRift or 7 Waves. Create one to begin.</p>
            </section>
          ) : (
            <>
              <section className="intro hero">
                <span className="mono mono-lg" aria-hidden>{space.name.trim().charAt(0).toUpperCase()}</span>
                <p className="date">{cap(dayLine.format(new Date()))}</p>
                <h1>{space.name}</h1>
                <p className="summary">
                  You have {plural(active(mine).length, 'task', 'tasks')} on your side. {partnerName} has {plural(active(theirs).length, 'task', 'tasks')}.
                  {loose.length > 0 && <> {loose.length === 1 ? 'One task is' : `${loose.length} tasks are`} still unclaimed.</>}
                </p>
              </section>

              <LinksStrip links={linkRows} removeLabel={isOwner ? 'Move to trash' : 'Ask to delete'} removePending={(id) => Boolean(deletion.requestFor(id))}
                onAdd={(s) => addItem('link', { url: s.url, title: s.title, body: s.body })}
                onEdit={(l, s) => (l.version ? queue({ op_id: crypto.randomUUID(), type: 'update', id: l.id, base_version: l.version, fields: { url: s.url, title: s.title, body: s.body } }) : Promise.resolve())}
                onRemove={async (l) => {
                  if (!l.version) return;
                  if (isOwner) { await trashItem(l.id); await afterDeletion(); return; }
                  const reason = prompt(`Why should "${l.title ?? 'this link'}" be removed? Hassan decides.`);
                  if (reason?.trim()) { await requestDeletion(l.id, l.version, reason.trim(), 'delete', userId); await afterDeletion(); }
                }} />

              <div className="views" role="tablist" aria-label="What to show">
                <button role="tab" aria-selected={view === 'tasks'} className={view === 'tasks' ? 'on' : ''} onClick={() => setView('tasks')}>Tasks and notes</button>
                <button role="tab" aria-selected={view === 'clients'} className={view === 'clients' ? 'on' : ''} onClick={() => setView('clients')}>Clients and money</button>
                <button role="tab" aria-selected={view === 'files'} className={view === 'files' ? 'on' : ''} onClick={() => setView('files')}>Files{uploads.length ? ` (${uploads.length} uploading)` : ''}</button>
                <button role="tab" aria-selected={view === 'trash'} className={view === 'trash' ? 'on' : ''} onClick={() => setView('trash')}>Trash{trash.length ? ` (${trash.length})` : ''}</button>
              </div>

              {view === 'trash' ? (
                <TrashView items={trash} isOwner={isOwner} requests={requests} nameOf={nameOf}
                  onAskRestore={async (t, reason) => { await requestDeletion(t.id, t.version, reason, 'restore', userId); await afterDeletion(); }}
                  onRestore={async (t) => { await restoreItem(t.id); await afterDeletion(); }}
                  onPurge={async (t) => { await (t.kind === 'file' ? purgeFile(t.id) : purgeItem(t.id)); await afterDeletion(); setFilesKey((k) => k + 1); }} />
              ) : view === 'files' ? (
                renderFilesFor(null)
              ) : view === 'clients' ? (
                <ClientsView spaceId={space.id} userId={userId} nameOf={nameOf} pending={pending} queue={queue} online={sync.state !== 'offline'} focusId={jump?.kind === 'client' ? jump.id : null} renderFiles={(cid) => renderFilesFor(cid)} isOwner={isOwner} />
              ) : (<>
              {isOwner && <Approvals requests={requests} nameOf={nameOf} onDecide={async (r, ok) => { const out = await decideRequest(r.id, ok); await afterDeletion(); return out; }} />}
              <QuickAdd partnerName={partnerName} partnerId={partner?.id ?? null} userId={userId} onAdd={addItem} />

              <div className="side-switch" role="tablist" aria-label="Whose tasks">
                <button role="tab" aria-selected={side === 'you'} className={side === 'you' ? 'on you' : 'you'} onClick={() => setSide('you')}>Your side <b>{active(mine).length}</b></button>
                <button role="tab" aria-selected={side === 'them'} className={side === 'them' ? 'on them' : 'them'} onClick={() => setSide('them')}>{partnerName} <b>{active(theirs).length}</b></button>
              </div>

              <div className="lanes" data-side={side}>
                <Lane side="you" title="Your side" rows={mine} empty="Nothing on your side. Claim an unclaimed task or add one for yourself." {...cardProps} />
                <div className="seam" aria-hidden />
                <Lane side="them" title={`${partnerName}'s side`} rows={theirs} empty={`${partnerName} has nothing assigned in this space.`} {...cardProps} />
              </div>

              {loose.length > 0 && (
                <section className="loose" aria-labelledby="loose-h">
                  <h2 id="loose-h">Unclaimed</h2>
                  <ul className="task-list">{loose.map((r) => <TaskCard key={r.id} row={r} side="loose" {...cardProps} />)}</ul>
                </section>
              )}

              <section className="notes" aria-labelledby="notes-h">
                <h2 id="notes-h">Notes</h2>
                {notes.length === 0 ? <p className="quiet">Notes you add to {space.name} land here for both of you.</p> : (
                  <ul className="note-list">
                    {notes.map((n) => (
                      <li key={n.id} id={`item-${n.id}`} className="note">
                        <h3>{n.title || 'Untitled'}</h3>
                        {n.body && <p>{n.body}</p>}
                        <p className="byline">{n.createdBy ? nameOf(n.createdBy) : 'You'}{n.updated_at ? `, ${when.format(new Date(n.updated_at))}` : ''}<SyncNote sync={n.sync} /></p>
                        {n.version && space.visibility === 'shared' && <NoteThread count={commentCount(n.id)}>{renderThread(n.id)}</NoteThread>}
                        {n.version && <DeleteControls isOwner={isOwner} pending={deletion.requestFor(n.id)}
                          onAsk={(reason) => deletion.onAskDelete(n, reason)} onTrash={() => deletion.onTrash(n)} />}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              </>)}
            </>
          )}
        </main>
      </div>

      {/* phone only: the main places sit under the thumb */}
      <nav className="tabbar" aria-label="Main">
        {([['today', 'Today', IconToday], ['week', 'Week', IconWeek], ['calendar', 'Calendar', IconCalendar]] as const).map(([p, label, Icon]) => (
          <button key={p} className={page === p && !sheetOpen ? 'on' : ''} aria-current={page === p} onClick={() => { setSheetOpen(false); setPage(p); }}><Icon /><span>{label}</span></button>
        ))}
        <button className={(page === 'space' || page === 'private-setup') || sheetOpen ? 'on' : ''} aria-expanded={sheetOpen} onClick={() => setSheetOpen((o) => !o)}>
          {page === 'space' && space ? <span className="tab-mono" aria-hidden>{space.visibility === 'private' ? <IconLock /> : space.name.trim().charAt(0).toUpperCase()}</span> : <IconSpaces />}
          <span>Spaces</span>
        </button>
        <button onClick={() => { setSheetOpen(false); setSearchOpen(true); }}><IconSearch /><span>Search</span></button>
      </nav>
    </div>
  );
}

function NoteThread({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (<>
    <button className="ghost small-btn note-cmt" aria-expanded={open} onClick={() => setOpen((o) => !o)}><CommentIcon />{open ? 'Hide comments' : count ? `${count} comment${count === 1 ? '' : 's'}` : 'Comment'}</button>
    {open && children}
  </>);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function SyncPill({ sync, waiting, live = false }: { sync: SyncState; waiting: number; live?: boolean }) {
  const text = sync.state === 'syncing' ? 'Syncing'
    : sync.state === 'offline' ? (waiting ? `Offline, ${waiting} saved here` : 'Offline')
    : sync.state === 'failed' ? 'Sync problem'
    : waiting ? `${waiting} waiting` : live ? 'Live' : 'Synced';
  return <span className={`sync sync-${sync.state}${live && sync.state === 'synced' && !waiting ? ' sync-live' : ''}`} role="status" title={sync.error}><span className="sync-dot" aria-hidden />{text}</span>;
}

function SyncNote({ sync }: { sync: RowSync }) {
  if (sync === 'synced') return null;
  return <span className={`row-sync ${sync}`}>{sync === 'pending' ? 'Saved on this device, waiting to sync' : 'Not synced yet, will retry'}</span>;
}

type CardProps = {
  userId: string; partner: Profile | undefined; nameOf: (id: string | null) => string;
  onEdit: (row: Row, f: Fields) => Promise<void>; onHandOver: (row: Row, to: string | null) => Promise<void>;
  arrived: { id: string; to: Side } | null;
  onSchedule: (row: Row) => void;
  reminderFor?: (itemId: string) => Reminder | undefined;
  onRemind?: (itemId: string, at: Date, note: string | null) => Promise<void>;
  onCancelRemind?: (id: string) => Promise<void>;
  commentCount?: (itemId: string) => number;
  renderThread?: (itemId: string) => ReactNode;
  deletion: {
    isOwner: boolean; requestFor: (id: string) => DeletionRequest | undefined;
    onAskDelete: (row: Row, reason: string) => Promise<void>; onTrash: (row: Row) => Promise<void>;
  };
};

export function Lane({ side, title, rows, empty, ...card }: { side: Side; title: string; rows: Row[]; empty: string } & CardProps) {
  const open = rows.filter((r) => r.status !== 'done').sort(byUrgency);
  const done = rows.filter((r) => r.status === 'done');
  return (
    <section className={`lane lane-${side}`} aria-label={title}>
      <h2 className="lane-title">{title}<span className="lane-count">{open.length}</span></h2>
      {open.length === 0 ? <p className="quiet">{empty}</p> : (
        <ul className="task-list">{open.map((r) => <TaskCard key={r.id} row={r} side={side} {...card} />)}</ul>
      )}
      {done.length > 0 && (
        <details className="done-group">
          <summary>Done ({done.length})</summary>
          <ul className="task-list">{done.map((r) => <TaskCard key={r.id} row={r} side={side} {...card} />)}</ul>
        </details>
      )}
    </section>
  );
}

export function TaskCard({ row: r, side, userId, partner, nameOf, onEdit, onHandOver, arrived, deletion, onSchedule, reminderFor, onRemind, onCancelRemind, commentCount, renderThread }: { row: Row; side: Side | 'loose' } & CardProps) {
  const [open, setOpen] = useState(false);
  const done = r.status === 'done';
  const overdue = isOverdue(r);
  const synced = Boolean(r.version);
  const target = r.assignee === userId ? partner?.id ?? null : userId;
  const targetLabel = r.assignee === userId ? `Hand to ${nameOf(partner?.id ?? null)}` : r.assignee ? 'Take it back' : 'Claim it';
  const arriving = arrived?.id === r.id ? `arrive-${arrived.to}` : '';
  const reminder = reminderFor?.(r.id);
  const comments = commentCount?.(r.id) ?? 0;
  return (
    <li id={`item-${r.id}`} className={`task ${side} ${done ? 'is-done' : ''} ${overdue ? 'is-late' : ''} ${arriving}`}>
      <button className="ring" aria-pressed={done} disabled={!synced}
        aria-label={done ? `Mark "${r.title}" not done` : `Mark "${r.title}" done`}
        title={synced ? undefined : 'Available once this task has synced'}
        onClick={() => onEdit(r, { status: done ? 'open' : 'done' })}>
        <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="10" /><path d="M7 12.5l3.2 3.2L17 9" /></svg>
      </button>
      <div className="task-body">
        <button className="task-title" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{r.title || 'Untitled'}</button>
        <div className="task-facts">
          {r.due_at && <span className={overdue ? 'due late' : 'due'}>{overdue ? 'Overdue, was due ' : 'Due '}{when.format(new Date(r.due_at))}</span>}
          {r.status && r.status !== 'open' && r.status !== 'done' && <span className="state">{STATUS_LABEL[r.status]}</span>}
          {deletion.requestFor(r.id) && <span className="del-flag">Deletion requested</span>}
          {r.recur && !done && <span className="repeat-fact" title={repeatLabel(r.recur)}>↻ {repeatLabel(r.recur)}</span>}
          {comments > 0 && <span className="comment-fact"><CommentIcon />{comments}</span>}
          {reminder && !done && <span className="remind-fact"><BellSmall />{reminderTime(reminder.remind_at)}</span>}
          <SyncNote sync={r.sync} />
        </div>
        {open && (
          <div className="task-more">
            {r.body ? <p className="instructions">{r.body}</p> : <p className="quiet">No instructions added.</p>}
            <div className="task-actions">
              <label>
                <span>Status</span>
                <select value={r.status ?? 'open'} disabled={!synced} onChange={(e) => onEdit(r, { status: e.target.value })}>
                  {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </label>
              {(target || !r.assignee) && (
                <button className="handover" disabled={!synced} onClick={() => onHandOver(r, target)}>{targetLabel}</button>
              )}
              {synced && r.status !== 'done' && (
                <label>
                  <span>Repeat</span>
                  <select value={repeatKey(r.recur)} onChange={(e) => onEdit(r, { recur: REPEATS.find((o) => o.key === e.target.value)?.recur ?? null })}>
                    {REPEATS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                    {repeatKey(r.recur) === 'custom' && <option value="custom" disabled>Custom</option>}
                  </select>
                </label>
              )}
              {synced && r.status !== 'done' && <button className="ghost" onClick={() => onSchedule(r)}>Schedule time</button>}
            </div>
            {synced && !done && onRemind && onCancelRemind && <RemindControl due={r.due_at} current={reminder}
              onSet={(at, note) => onRemind(r.id, at, note)} onCancel={() => (reminder ? onCancelRemind(reminder.id) : Promise.resolve())} />}
            {synced && renderThread?.(r.id)}
            <p className="byline">Added by {r.createdBy ? nameOf(r.createdBy) : 'you'}</p>
            {synced && <DeleteControls isOwner={deletion.isOwner} pending={deletion.requestFor(r.id)}
              onAsk={(reason) => deletion.onAskDelete(r, reason)} onTrash={() => deletion.onTrash(r)} />}
          </div>
        )}
      </div>
    </li>
  );
}

export function QuickAdd({ userId, partnerId, partnerName, onAdd }: { userId: string; partnerId: string | null; partnerName: string; onAdd: (kind: string, f: Fields) => Promise<void> }) {
  const [kind, setKind] = useState<'task' | 'note'>('task');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [who, setWho] = useState<string>(userId);
  const [due, setDue] = useState('');
  const [repeat, setRepeat] = useState('none');
  const [expanded, setExpanded] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return input.current?.focus();
    const f: Fields = { title: title.trim(), body: body.trim() || null };
    if (kind === 'task') Object.assign(f, { status: 'open', assignee: who || null, due_at: due ? new Date(due).toISOString() : null, recur: REPEATS.find((o) => o.key === repeat)?.recur ?? null });
    await onAdd(kind, f);
    setTitle('');
    setBody('');
    setDue('');
    setRepeat('none');
    input.current?.focus();
  }

  return (
    <form className={`quick ${expanded ? 'open' : ''}`} onSubmit={submit} onFocus={() => setExpanded(true)} aria-label="Add a task or note">
      <div className="quick-line">
        <div className="kind-toggle" role="radiogroup" aria-label="Type">
          {(['task', 'note'] as const).map((k) => (
            <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'task' ? 'Task' : 'Note'}</button>
          ))}
        </div>
        <label className="sr-only" htmlFor="quick-title">{kind === 'task' ? 'What needs doing' : 'Note title'}</label>
        <input id="quick-title" ref={input} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200}
          placeholder={kind === 'task' ? 'What needs doing?' : 'What should you both remember?'} autoComplete="off" />
        <button className="primary add" type="submit">Add</button>
      </div>
      {expanded && (
        <div className="quick-more">
          <label className="sr-only" htmlFor="quick-body">Details</label>
          <textarea id="quick-body" value={body} onChange={(e) => setBody(e.target.value)} rows={2}
            placeholder={kind === 'task' ? 'Instructions, links, anything they need (optional)' : 'Details (optional)'} />
          {kind === 'task' && (
            <div className="quick-opts">
              <div className="who" role="radiogroup" aria-label="Who is responsible">
                <span className="opt-label">For</span>
                {[{ id: userId, label: 'Me', cls: 'you' }, ...(partnerId ? [{ id: partnerId, label: partnerName, cls: 'them' }] : []), { id: '', label: 'Anyone', cls: 'any' }].map((o) => (
                  <button type="button" key={o.label} role="radio" aria-checked={who === o.id} className={`${o.cls} ${who === o.id ? 'on' : ''}`} onClick={() => setWho(o.id)}>{o.label}</button>
                ))}
              </div>
              <label className="due-pick">
                <span className="opt-label">Due</span>
                <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
              </label>
              <label className="due-pick">
                <span className="opt-label">Repeat</span>
                <select value={repeat} onChange={(e) => setRepeat(e.target.value)}>{REPEATS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
              </label>
              {repeat !== 'none' && <p className="hint repeat-hint">When it is ticked off, the next one appears{due ? '' : ', counted from when it is done'}.</p>}
            </div>
          )}
        </div>
      )}
    </form>
  );
}

function NewSpace({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await onCreate(name.trim());
      setName('');
      setError('');
      setOpen(false);
    } catch (err) {
      setError(navigator.onLine ? String(err) : 'Creating a space needs a connection for now.');
    }
  }
  if (!open) return <button className="ghost new-space-btn" onClick={() => setOpen(true)}>New shared space</button>;
  return (
    <form className="new-space" onSubmit={submit}>
      <label htmlFor="space-name">Name</label>
      <input id="space-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="WebRift" required maxLength={80} />
      <p className="hint">You and your partner both see everything in it.</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="row-end">
        <button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button className="primary">Create space</button>
      </div>
    </form>
  );
}

function AccountMenu({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <details className="account">
      <summary aria-label="Account"><span className="avatar" aria-hidden>{email.charAt(0).toUpperCase()}</span></summary>
      <div className="account-pop">
        <p className="quiet">Signed in as<br /><b>{email}</b></p>
        <button onClick={onSignOut}>Sign out</button>
      </div>
    </details>
  );
}

const PUSH_NOTE: Record<PushStatus, string> = {
  unsupported: 'Pop-up notifications come through the Android app. In the browser, updates collect here.',
  denied: 'Notifications are off for Sidekick in your phone settings. Updates still collect here.',
  registered: 'This phone gets pop-up notifications.',
  error: 'This phone could not register for notifications. Updates still collect here.',
};

const CATEGORY: Record<string, string> = { private_note: 'a private note', private_task: 'a private task', private_file: 'a private file', private_event: 'a private event', private_item: 'a private item' };

export function Inbox({ items, push, onRead, onClose, notices = [], nameOf = () => 'Someone', reminders = [], onCancelRemind }: {
  items: Notification[]; push: PushStatus | null; onRead: (ids: string[]) => Promise<void>; onClose: () => void;
  notices?: PrivacyNotice[]; nameOf?: (id: string | null) => string; reminders?: Reminder[]; onCancelRemind?: (id: string) => Promise<void>;
}) {
  const unreadIds = items.filter((n) => !n.read_at).map((n) => n.id);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <aside id="inbox" className="drawer" aria-label="Inbox">
        <div className="drawer-head">
          <h2>Inbox</h2>
          <button className="ghost" disabled={!unreadIds.length} onClick={() => onRead(unreadIds)}>Mark all read</button>
          <button className="ghost close" aria-label="Close inbox" onClick={onClose}>✕</button>
        </div>
        {push && <p className="hint">{PUSH_NOTE[push]}</p>}
        {reminders.length > 0 && (
          <section className="upcoming" aria-label="Your reminders">
            <h3 className="drawer-sub">Coming up</h3>
            <ul className="inbox-list">{reminders.map((r) => (
              <li key={r.id} className="upcoming-row">
                <BellSmall />
                <span className="upcoming-text"><span className="note-title">{r.items?.title?.startsWith('enc1:') ? 'Something private' : r.items?.title || 'A task'}</span>
                  <span className="note-time">{reminderTime(r.remind_at)}{r.note ? `, ${r.note}` : ''}{r.pending ? ' (saving)' : ''}</span></span>
                {onCancelRemind && <button className="ghost small-btn" aria-label="Cancel this reminder" onClick={() => onCancelRemind(r.id)}>Cancel</button>}
              </li>
            ))}</ul>
          </section>
        )}
        {items.length === 0 ? <p className="quiet">When your partner assigns, finishes or changes something, it shows up here.</p> : (
          <ul className="inbox-list">
            {items.map((n) => (
              <li key={n.id}>
                <button className={n.read_at ? 'note-row' : 'note-row unread'} onClick={() => !n.read_at && onRead([n.id])}>
                  <span className="note-title">{n.title}</span>
                  {n.body && <span className="note-body">{n.body}</span>}
                  <span className="note-time">{when.format(new Date(n.created_at))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {notices.length > 0 && (
          <section className="privacy-notices" aria-label="Private deletions">
            <h3 className="drawer-sub">Private deletions</h3>
            <p className="hint">Only the kind of item and the time. What it was stays private.</p>
            <ul className="inbox-list">{notices.map((n) => (
              <li key={n.id} className="note-row"><span className="note-title">{nameOf(n.actor)} {n.action === 'trashed' ? 'moved' : 'permanently deleted'} {CATEGORY[n.category] ?? 'a private item'}{n.action === 'trashed' ? ' to their trash' : ''}</span>
                <span className="note-time">{when.format(new Date(n.at))}</span></li>
            ))}</ul>
          </section>
        )}
      </aside>
    </>
  );
}

export function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden className="icon">
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" /><path d="M10 20.5a2 2 0 0 0 4 0" />
    </svg>
  );
}
