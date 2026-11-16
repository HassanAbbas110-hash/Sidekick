import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';
import { createSharedSpace, loadItems, loadProfiles, loadSpaces, sendOp, type Item, type Profile, type Space } from '../lib/data.ts';
import { Outbox, type Op } from '../sync/outbox.ts';

type SyncState = { state: 'synced' | 'syncing' | 'offline' | 'failed'; error?: string };
type Row = { id: string; kind: string; title: string | null; body: string | null; by: string; status: 'synced' | 'pending' | 'failed'; version?: number };

const SYNC_LABEL: Record<SyncState['state'], string> = {
  synced: 'All changes synced', syncing: 'Syncing…', offline: 'Offline · changes saved on this device', failed: 'Sync problem',
};

export function Workspace({ userId, email }: { userId: string; email: string }) {
  const [box, setBox] = useState<Outbox | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [pending, setPending] = useState<Op[]>([]);
  const [sync, setSync] = useState<SyncState>({ state: navigator.onLine ? 'synced' : 'offline' });
  const [loadError, setLoadError] = useState('');

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
      const [sp, pr] = await Promise.all([loadSpaces(), loadProfiles()]);
      setSpaces(sp);
      setProfiles(pr);
      setSpaceId((cur) => cur ?? sp[0]?.id ?? null);
      setLoadError('');
    } catch (e) {
      setLoadError(navigator.onLine ? String(e) : 'Offline. Saved records will show here once offline reading is added (next slice).');
    }
  }, []);

  const reloadItems = useCallback(async () => {
    if (!spaceId) return setItems([]);
    try {
      setItems(await loadItems(spaceId));
    } catch (e) {
      if (navigator.onLine) setLoadError(String(e));
    }
  }, [spaceId]);

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
    const onOnline = () => { refresh(); flush(); };
    const onOffline = () => setSync({ state: 'offline' });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const timer = setInterval(flush, 30_000); // shortcut: fixed retry interval; backoff + attempt limit in Stage 1 sync loop
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(timer);
    };
  }, [flush, refresh]);

  const nameOf = (id: string) => {
    if (id === userId) return 'You';
    const p = profiles.find((x) => x.id === id);
    return p?.display_name || p?.email.split('@')[0] || 'Someone';
  };

  const queued: Row[] = pending
    .filter((op): op is Extract<Op, { type: 'create' }> => op.type === 'create' && op.space_id === spaceId)
    .map((op) => ({ id: op.id, kind: op.kind, title: op.fields.title ?? null, body: op.fields.body ?? null, by: 'You', status: sync.state === 'failed' ? 'failed' : 'pending' }));
  const rows: Row[] = [
    ...queued,
    ...items.filter((i) => !queued.some((q) => q.id === i.id))
      .map((i) => ({ id: i.id, kind: i.kind, title: i.title, body: i.body, by: nameOf(i.created_by), status: 'synced' as const, version: i.version })),
  ];

  async function addItem(kind: string, title: string, body: string) {
    if (!box || !spaceId) return;
    await box.add({ op_id: crypto.randomUUID(), type: 'create', id: crypto.randomUUID(), space_id: spaceId, kind, fields: { title, body: body || null } });
    await flush();
  }

  async function signOut() {
    const waiting = box ? (await box.pending()).length : 0;
    if (waiting && !confirm(`${waiting} change(s) have not reached the server yet. They stay saved on this device for this account and will sync when you sign in again here. Sign out anyway?`)) return;
    await supabase.auth.signOut();
  }

  const space = spaces.find((s) => s.id === spaceId);

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
              <Composer onAdd={addItem} />
              {rows.length === 0 ? (
                <p className="muted empty-line">Nothing here yet. Add a note or task above.</p>
              ) : (
                <ul className="items">
                  {rows.map((r) => (
                    <li key={r.id} className="item card">
                      <div className="item-head">
                        <span className={`kind kind-${r.kind}`}>{r.kind}</span>
                        <strong>{r.title || 'Untitled'}</strong>
                      </div>
                      {r.body && <p className="item-body">{r.body}</p>}
                      <p className="meta">
                        <span>{r.by}</span>
                        <span className={`state state-${r.status}`}>
                          {r.status === 'synced' ? `Synced · v${r.version}` : r.status === 'pending' ? 'Saved on this device · waiting to sync' : 'Not synced · will retry'}
                        </span>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </main>
      </div>
    </div>
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

function Composer({ onAdd }: { onAdd: (kind: string, title: string, body: string) => Promise<void> }) {
  const [kind, setKind] = useState('note');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    await onAdd(kind, title.trim(), body.trim());
    setTitle('');
    setBody('');
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
      <textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Details (optional)" rows={2} />
      <button className="primary">Add {kind}</button>
    </form>
  );
}
