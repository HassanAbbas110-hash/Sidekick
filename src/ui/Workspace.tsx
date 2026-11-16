import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';
import { createSharedSpace, loadItems, loadProfiles, loadSpaces, sendOp, type Item, type Profile, type Space, type TaskStatus } from '../lib/data.ts';
import { dropCache, withCache } from '../lib/cache.ts';
import { Outbox, type Fields, type Op } from '../sync/outbox.ts';

type SyncState = { state: 'synced' | 'syncing' | 'offline' | 'failed'; error?: string };
type RowSync = 'synced' | 'pending' | 'failed';
type Row = {
  id: string; kind: string; title: string | null; body: string | null; createdBy: string;
  assignee: string | null; status: TaskStatus | null; due_at: string | null; version?: number; sync: RowSync;
};
type Filter = 'all' | 'mine' | 'theirs';

const SYNC_LABEL: Record<SyncState['state'], string> = {
  synced: 'All changes synced', syncing: 'Syncing…', offline: 'Offline · changes saved on this device', failed: 'Sync problem',
};
const STATUS_LABEL: Record<TaskStatus, string> = { open: 'To do', in_progress: 'In progress', waiting: 'Waiting', done: 'Done' };
// Proposed default display timezone (spec §9), not yet confirmed by Hassan.
const when = new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' });
const time = new Intl.DateTimeFormat('en-ZA', { timeStyle: 'short', timeZone: 'Africa/Johannesburg' });

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
        status: (f.status as TaskStatus) ?? null, due_at: f.due_at ?? null, sync: mark };
    });
  const known = new Set(creates.map((c) => c.id));
  return [
    ...creates,
    ...items.filter((i) => !known.has(i.id)).map((i): Row => {
      const e = edits.get(i.id);
      return { id: i.id, kind: i.kind, title: e?.title !== undefined ? e.title : i.title, body: e?.body !== undefined ? e.body : i.body,
        createdBy: i.created_by, assignee: e?.assignee !== undefined ? e.assignee : i.assignee,
        status: (e?.status as TaskStatus | undefined) ?? i.status, due_at: e?.due_at !== undefined ? e.due_at : i.due_at,
        version: i.version, sync: e ? mark : 'synced' };
    }),
  ];
}

export function Workspace({ userId, email }: { userId: string; email: string }) {
  const [box, setBox] = useState<Outbox | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [pending, setPending] = useState<Op[]>([]);
  const [sync, setSync] = useState<SyncState>({ state: navigator.onLine ? 'synced' : 'offline' });
  const [savedCopy, setSavedCopy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

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
      setLoadError(navigator.onLine ? String(e) : 'Offline, and nothing has been saved on this device yet. Connect once to download your spaces.');
    }
  }, [userId]);

  const reloadItems = useCallback(async () => {
    if (!spaceId) return setItems([]);
    try {
      const r = await withCache(userId, `items:${spaceId}`, () => loadItems(spaceId));
      setItems(r.value);
      setSavedCopy((cur) => (r.fromCache ? r.savedAt : cur));
    } catch (e) {
      setItems([]);
      setLoadError(navigator.onLine ? String(e) : 'This space has not been opened on this device before, so nothing is saved offline yet.');
    }
  }, [spaceId, userId]);

  const flush = useCallback(async () => {
    if (!box) return;
    setPending(await box.pending());
    if (!navigator.onLine) return setSync({ state: 'offline' });
    setSync({ state: 'syncing' });
    const r = await box.flush(sendOp);
    setPending(await box.pending());
    setSync(r.failed ? { state: navigator.onLine ? 'failed' : 'offline', error: r.failed.error } : { state: 'synced' });
    if (r.results.length) await reloadItems();
  }, [box, reloadItems]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { reloadItems(); }, [reloadItems]);
  useEffect(() => {
    flush();
    const onOnline = () => { refresh(); reloadItems(); flush(); };
    const onOffline = () => setSync({ state: 'offline' });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const timer = setInterval(() => { flush(); reloadItems(); }, 30_000); // shortcut: polling; realtime updates come with the inbox slice
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(timer);
    };
  }, [flush, refresh, reloadItems]);

  const nameOf = (id: string | null) => {
    if (!id) return 'Unassigned';
    if (id === userId) return 'You';
    const p = profiles.find((x) => x.id === id);
    return p?.display_name || p?.email.split('@')[0] || 'Someone';
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

  async function signOut() {
    const waiting = box ? (await box.pending()).length : 0;
    if (waiting && !confirm(`${waiting} change(s) have not reached the server yet. They stay saved on this device for this account and will sync when you sign in again here. Sign out anyway?`)) return;
    await supabase.auth.signOut();
    await dropCache(userId); // the read copy is re-downloadable; unsent changes (outbox) are kept
  }

  const space = spaces.find((s) => s.id === spaceId);
  const rows = buildRows(items, pending, spaceId, sync.state === 'failed').filter((r) =>
    filter === 'all' ? true : r.kind === 'task' && (filter === 'mine' ? r.assignee === userId : r.assignee !== null && r.assignee !== userId));
  const others = profiles.filter((p) => p.id !== userId);

  return (
    <div className="shell">
      <header className="topbar">
        <img src="./icon.svg" alt="" width={32} height={32} />
        <strong className="brand">Sidekick</strong>
        <span className={`chip chip-${sync.state}`} role="status" title={sync.error}>{SYNC_LABEL[sync.state]}{pending.length ? ` · ${pending.length} waiting` : ''}</span>
        <span className="spacer" />
        <span className="muted small hide-narrow">{email}</span>
        <button onClick={signOut}>Sign out</button>
      </header>

      {savedCopy && <p className="banner warn" role="status">Showing the copy saved on this device at {time.format(new Date(savedCopy))}. It may be out of date.</p>}
      {loadError && <p className="banner error" role="alert">{loadError}</p>}
      {sync.state === 'failed' && <p className="banner error" role="alert">A change could not be saved on the server: {sync.error}. It is kept on this device.</p>}

      <div className="layout">
        <nav className="sidebar" aria-label="Spaces">
          <h2 className="eyebrow">Shared spaces</h2>
          <ul className="space-list">
            {spaces.filter((s) => s.visibility === 'shared').map((s) => (
              <li key={s.id}>
                <button className={s.id === spaceId ? 'space active' : 'space'} aria-current={s.id === spaceId} onClick={() => setSpaceId(s.id)}>{s.name}</button>
              </li>
            ))}
          </ul>
          <NewSpace onCreate={async (name) => { await createSharedSpace(name, userId); await refresh(); }} />
        </nav>

        <main className="content">
          {!space ? (
            <div className="empty">
              <h2>No spaces yet</h2>
              <p className="muted">Create your first shared space on the left, for example “WebRift” or “7 Waves”.</p>
            </div>
          ) : (
            <>
              <div className="content-head">
                <h1>{space.name}</h1>
                <span className="muted small">Shared · visible to both of you</span>
              </div>
              <Composer me={userId} others={others} onAdd={addItem} />
              <div className="filters" role="group" aria-label="Show">
                {(['all', 'mine', 'theirs'] as Filter[]).map((f) => (
                  <button key={f} className={filter === f ? 'pill active' : 'pill'} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                    {f === 'all' ? 'Everything' : f === 'mine' ? 'My tasks' : 'Their tasks'}
                  </button>
                ))}
              </div>
              {rows.length === 0 ? (
                <p className="muted empty-line">{filter === 'all' ? 'Nothing here yet. Add a note or task above.' : 'No tasks match.'}</p>
              ) : (
                <ul className="items">
                  {rows.map((r) => <ItemCard key={r.id} row={r} nameOf={nameOf} onEdit={(f) => editItem(r, f)} />)}
                </ul>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function ItemCard({ row: r, nameOf, onEdit }: { row: Row; nameOf: (id: string | null) => string; onEdit: (f: Fields) => Promise<void> }) {
  const overdue = r.kind === 'task' && r.due_at && r.status !== 'done' && new Date(r.due_at) < new Date();
  return (
    <li className={`item card${r.status === 'done' ? ' done' : ''}`}>
      <div className="item-head">
        <span className={`kind kind-${r.kind}`}>{r.kind}</span>
        <strong>{r.title || 'Untitled'}</strong>
      </div>
      {r.body && <p className="item-body">{r.body}</p>}
      {r.kind === 'task' && (
        <div className="task-line">
          <span>For: <b>{nameOf(r.assignee)}</b></span>
          {r.due_at && <span className={overdue ? 'overdue' : ''}>Due {when.format(new Date(r.due_at))}{overdue ? ' · overdue' : ''}</span>}
          <label className="inline">
            <span className="sr-only">Status of {r.title}</span>
            <select value={r.status ?? 'open'} disabled={!r.version} onChange={(e) => onEdit({ status: e.target.value })}
              title={r.version ? undefined : 'Available once this task has synced'}>
              {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
        </div>
      )}
      <p className="meta">
        <span>{r.createdBy ? `Added by ${nameOf(r.createdBy)}` : 'Added by You'}</span>
        <span className={`state state-${r.sync}`}>
          {r.sync === 'synced' ? `Synced · v${r.version}` : r.sync === 'pending' ? 'Saved on this device · waiting to sync' : 'Not synced · will retry'}
        </span>
      </p>
    </li>
  );
}

function NewSpace({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await onCreate(name.trim());
      setName('');
      setError('');
    } catch (err) {
      setError(navigator.onLine ? String(err) : 'Creating a space needs a connection for now.');
    }
  }
  return (
    <form className="new-space" onSubmit={submit}>
      <label className="small">New shared space
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. WebRift" required maxLength={80} />
      </label>
      <p className="hint">Both of you will see everything in it.</p>
      {error && <p className="error small" role="alert">{error}</p>}
      <button>Create shared space</button>
    </form>
  );
}

function Composer({ me, others, onAdd }: { me: string; others: Profile[]; onAdd: (kind: string, fields: Fields) => Promise<void> }) {
  const [kind, setKind] = useState('note');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const fields: Fields = { title: title.trim(), body: body.trim() || null };
    if (kind === 'task') {
      Object.assign(fields, { status: 'open', assignee: assignee || null, due_at: due ? new Date(due).toISOString() : null });
    }
    await onAdd(kind, fields);
    setTitle('');
    setBody('');
    setDue('');
  }
  return (
    <form className="composer card" onSubmit={submit} aria-label="Add to this space">
      <div className="row">
        <label className="sr-only" htmlFor="kind">Type</label>
        <select id="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="note">Note</option>
          <option value="task">Task</option>
        </select>
        <label className="sr-only" htmlFor="title">Title</label>
        <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'task' ? 'What needs doing?' : 'Title'} required maxLength={200} />
      </div>
      <label className="sr-only" htmlFor="body">Details</label>
      <textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} placeholder={kind === 'task' ? 'Instructions (optional)' : 'Details (optional)'} rows={2} />
      {kind === 'task' && (
        <div className="row two">
          <label className="small">Who is responsible
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Unassigned</option>
              <option value={me}>Me</option>
              {others.map((p) => <option key={p.id} value={p.id}>{p.display_name || p.email.split('@')[0]}</option>)}
            </select>
          </label>
          <label className="small">Due (optional)
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        </div>
      )}
      <button className="primary">Add {kind}</button>
    </form>
  );
}
