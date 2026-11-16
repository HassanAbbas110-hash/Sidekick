import { useEffect, useState, type FormEvent } from 'react';
import { deletePrivateForGood, hide, loadPrivateTrash, setPrivateTrashed, type Item, type Space } from '../lib/data.ts';
import type { Fields, Op } from '../sync/outbox.ts';
import { useRevealed } from './Private.tsx';

const LockIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden className="icon"><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></svg>
);

/** The private area: a "vault room" visually set apart from the shared workspace. */
export function PrivateView({ space, name, items, pending, keyFor, queue, onLock, isOwner, partnerName, reload }: {
  space: Space; name: string; items: Item[]; pending: Op[]; keyFor: CryptoKey; queue: (op: Op) => Promise<void>; onLock: () => void;
  isOwner: boolean; partnerName: string; reload: () => Promise<void>;
}) {
  // Unsent creates show straight away (as in shared spaces), marked as waiting to sync.
  const waiting = pending.filter((o): o is Extract<Op, { type: 'create' }> => o.type === 'create' && o.space_id === space.id);
  const waitingIds = new Set(waiting.map((o) => o.id));
  const rows = [
    ...waiting.map((o) => ({ id: o.id, kind: o.kind, title: o.fields.title ?? null, body: o.fields.body ?? null, status: o.fields.status ?? null, version: 0 })),
    ...items.filter((i) => i.kind !== 'file' && !waitingIds.has(i.id)),
  ];
  const shown = useRevealed(rows, keyFor);
  const [kind, setKind] = useState<'task' | 'note'>('note');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [trash, setTrash] = useState<{ id: string; kind: string; title: string | null; deleted_at: string }[]>([]);
  const trashShown = useRevealed(trash.map((t) => ({ ...t, body: null })), keyFor);
  const [error, setError] = useState('');

  const loadTrash = () => loadPrivateTrash(space.id).then(setTrash).catch(() => setTrash([]));
  useEffect(() => { loadTrash(); }, [space.id, items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError(kind === 'note' ? 'Give the note a title first.' : 'Write what needs doing first.'); return; }
    setBusy(true); setError('');
    try {
      const id = crypto.randomUUID();
      const fields: Fields = { title: await hide(keyFor, title.trim(), id, 'title'), body: await hide(keyFor, body.trim() || null, id, 'body') };
      if (kind === 'task') fields.status = 'open';
      await queue({ op_id: crypto.randomUUID(), type: 'create', id, space_id: space.id, kind, fields });
      setTitle(''); setBody('');
    } catch (err) {
      setError(`Could not save this: ${String(err).replace(/^Error: /, '')}`);
    } finally { setBusy(false); }
  }
  const act = async (fn: () => Promise<void>) => {
    try { setError(''); await fn(); await reload(); await loadTrash(); }
    catch (e) { setError(navigator.onLine ? String(e).replace(/^Error: /, '') : 'Deleting and restoring need a connection.'); }
  };
  const tellPartner = (k: string) => (isOwner ? '' : ` ${partnerName} will see that a private ${k} was removed, but not what it was.`);
  const tasks = shown.filter((s) => s.kind === 'task').sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done'));
  const notes = shown.filter((s) => s.kind === 'note');
  const openTasks = tasks.filter((t) => t.status !== 'done').length;
  const unsynced = (id: string) => waitingIds.has(id);

  return (
    <section className="vault" aria-label={name}>
      <header className="vault-head">
        <span className="vault-badge" aria-hidden><LockIcon /></span>
        <div className="vault-title">
          <p className="vault-kicker">Only you can read this</p>
          <h1>{name}</h1>
        </div>
        <button className="ghost lock-btn" onClick={onLock}><LockIcon /><span>Lock</span></button>
      </header>

      <form className={`vault-compose kind-${kind}`} onSubmit={add} aria-label="Add something private">
        <div className="kind-toggle" role="radiogroup" aria-label="Type">
          {(['note', 'task'] as const).map((k) => (
            <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'task' ? 'Task' : 'Note'}</button>
          ))}
        </div>
        <label className="sr-only" htmlFor="p-title">{kind === 'note' ? 'Note title' : 'Task'}</label>
        <input id="p-title" className="vault-input" value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off"
          placeholder={kind === 'task' ? 'Something only you need to do' : 'Title of your note'} />
        <label className="sr-only" htmlFor="p-body">Details</label>
        <textarea id="p-body" className="vault-text" rows={kind === 'note' ? 4 : 2} value={body} onChange={(e) => setBody(e.target.value)}
          placeholder={kind === 'note' ? 'Write freely. It is locked on this device before it is saved.' : 'Details (optional)'} />
        <div className="vault-compose-foot">
          <span className="hint">Appointments go in the Calendar under this space; {partnerName} then sees only “Busy”.</span>
          <button className="primary" disabled={busy}>{busy ? 'Locking…' : kind === 'note' ? 'Save note' : 'Add task'}</button>
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
      </form>

      <div className="vault-grid">
        <section className="vault-col" aria-labelledby="v-tasks">
          <h2 id="v-tasks">Tasks <span className="lane-count">{openTasks ? `${openTasks} open` : tasks.length ? 'all clear' : ''}</span></h2>
          {tasks.length === 0 ? <p className="quiet">Nothing here yet.</p> : (
            <ul className="vault-tasks">
              {tasks.map((t) => (
                <li key={t.id} className={t.status === 'done' ? 'is-done' : ''}>
                  <button className="ring" aria-pressed={t.status === 'done'} aria-label={t.status === 'done' ? 'Mark not done' : 'Mark done'} disabled={!t.version}
                    onClick={() => queue({ op_id: crypto.randomUUID(), type: 'update', id: t.id, base_version: t.version, fields: { status: t.status === 'done' ? 'open' : 'done' } })}>
                    <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="10" /><path d="M7 12.5l3.2 3.2L17 9" /></svg>
                  </button>
                  <div className="vault-task-body">
                    <span className="vault-task-title">{t.title ?? 'Cannot be read on this device'}</span>
                    {t.body && <span className="vault-task-detail">{t.body}</span>}
                    {unsynced(t.id) && <span className="row-sync pending">Saved on this device, waiting to sync</span>}
                  </div>
                  {t.version > 0 && <button className="ghost icon-btn" aria-label="Move to trash" title="Move to trash" onClick={() => act(() => setPrivateTrashed(t.id, true))}>×</button>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="vault-col" aria-labelledby="v-notes">
          <h2 id="v-notes">Notes <span className="lane-count">{notes.length || ''}</span></h2>
          {notes.length === 0 ? <p className="quiet">Your first private note will appear here.</p> : (
            <ul className="vault-notes">{notes.map((n) => (
              <li key={n.id} className="page">
                <h3>{n.title ?? 'Cannot be read on this device'}</h3>
                {n.body && <p>{n.body}</p>}
                <div className="page-foot">
                  {unsynced(n.id) ? <span className="row-sync pending">Waiting to sync</span> : <span className="sealed"><LockIcon />Locked</span>}
                  {n.version > 0 && <button className="ghost page-del" onClick={() => act(() => setPrivateTrashed(n.id, true))}>Move to trash</button>}
                </div>
              </li>
            ))}</ul>
          )}
        </section>
      </div>

      {trashShown.length > 0 && (
        <details className="done-group">
          <summary>Private trash ({trashShown.length})</summary>
          <ul className="trash-list">{trashShown.map((t) => (
            <li key={t.id} className="trash-row">
              <div className="trash-main"><b>{t.title ?? 'Cannot be read on this device'}</b></div>
              <div className="trash-actions">
                <button onClick={() => act(() => setPrivateTrashed(t.id, false))}>Restore</button>
                <button className="ghost danger" onClick={() => {
                  if (confirm(`Delete this for good? It cannot be recovered.${tellPartner(t.kind)}`)) act(() => deletePrivateForGood(t.id));
                }}>Delete for good</button>
              </div>
            </li>
          ))}</ul>
          {!isOwner && <p className="hint">Moving to trash and deleting each tell {partnerName} only the kind of item removed, and when.</p>}
        </details>
      )}
    </section>
  );
}
