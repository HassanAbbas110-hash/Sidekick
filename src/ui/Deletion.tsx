import { useState, type FormEvent } from 'react';
import type { DeletionRequest, TrashedItem } from '../lib/data.ts';

const when = new Intl.DateTimeFormat('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' });

/** Inline controls on a task or note: Hassan moves to trash; the marketer asks with a reason. */
export function DeleteControls({ isOwner, pending, disabled, onAsk, onTrash }: {
  isOwner: boolean; pending: DeletionRequest | undefined; disabled?: boolean;
  onAsk: (reason: string) => Promise<void>; onTrash: () => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>) => {
    try { setError(''); await fn(); } catch (e) { setError(navigator.onLine ? String(e).replace(/^Error: /, '') : 'Deleting needs a connection, so it can never look done while offline.'); }
  };

  if (pending) return <p className="del-pending">{pending.action === 'delete' ? 'Waiting for Hassan to approve deleting this' : 'Waiting for Hassan to approve restoring this'}</p>;
  if (isOwner) {
    return (
      <span className="del-controls">
        <button type="button" className="ghost danger-quiet" disabled={disabled} onClick={() => run(onTrash)}>Move to trash</button>
        {error && <span className="field-error">{error}</span>}
      </span>
    );
  }
  if (!asking) return <button type="button" className="ghost danger-quiet" disabled={disabled} onClick={() => setAsking(true)}>Ask to delete</button>;
  return (
    <form className="ask-delete" onSubmit={(e: FormEvent) => { e.preventDefault(); run(async () => { await onAsk(reason.trim()); setAsking(false); }); }}>
      <label>Why should this go?<input autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Duplicate, out of date, added by mistake" /></label>
      <p className="hint">Hassan decides. Until then it stays exactly as it is.</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="row-end"><button type="button" className="ghost" onClick={() => setAsking(false)}>Cancel</button><button className="primary">Send request</button></div>
    </form>
  );
}

/** Hassan's decision queue. */
export function Approvals({ requests, nameOf, onDecide }: {
  requests: DeletionRequest[]; nameOf: (id: string | null) => string; onDecide: (r: DeletionRequest, approve: boolean) => Promise<string>;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (!requests.length) return null;
  const decide = async (r: DeletionRequest, ok: boolean) => {
    try {
      const out = await onDecide(r, ok);
      if (out === 'stale') setNotes((n) => ({ ...n, [r.id]: 'This changed after the request was made, so nothing happened. Ask for a fresh request if it should still go.' }));
    } catch (e) {
      setNotes((n) => ({ ...n, [r.id]: navigator.onLine ? String(e).replace(/^Error: /, '') : 'Decisions need a connection.' }));
    }
  };
  return (
    <section className="approvals" aria-labelledby="approvals-h">
      <h2 id="approvals-h">Waiting for your decision</h2>
      <ul>
        {requests.map((r) => (
          <li key={r.id}>
            <p className="appr-what"><b>{nameOf(r.requested_by)}</b> wants to {r.action} <b>“{r.items?.title || 'Untitled'}”</b></p>
            <p className="appr-why">{r.reason}</p>
            <p className="byline">{when.format(new Date(r.created_at))}</p>
            {notes[r.id] && <p className="field-error" role="status">{notes[r.id]}</p>}
            <div className="appr-actions">
              <button className="ghost" onClick={() => decide(r, false)}>Keep it</button>
              <button className="primary" onClick={() => decide(r, true)}>{r.action === 'delete' ? 'Move to trash' : 'Restore it'}</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Trash: everyone can see it; Hassan restores or permanently deletes, the marketer asks to restore. */
export function TrashView({ items, isOwner, requests, nameOf, onAskRestore, onRestore, onPurge }: {
  items: TrashedItem[]; isOwner: boolean; requests: DeletionRequest[]; nameOf: (id: string | null) => string;
  onAskRestore: (t: TrashedItem, reason: string) => Promise<void>; onRestore: (t: TrashedItem) => Promise<void>; onPurge: (t: TrashedItem) => Promise<void>;
}) {
  return (
    <section className="trash" aria-label="Trash">
      <p className="quiet">Things here are hidden from the workspace but not gone. {isOwner ? 'Only you can restore them or delete them for good.' : 'Ask Hassan if something should come back.'} Nothing is emptied automatically.</p>
      {items.length === 0 ? <p className="quiet">The trash is empty.</p> : (
        <ul className="trash-list">
          {items.map((t) => <TrashRow key={t.id} t={t} isOwner={isOwner} pending={requests.find((r) => r.item_id === t.id)} nameOf={nameOf}
            onAskRestore={onAskRestore} onRestore={onRestore} onPurge={onPurge} />)}
        </ul>
      )}
    </section>
  );
}

function TrashRow({ t, isOwner, pending, nameOf, onAskRestore, onRestore, onPurge }: {
  t: TrashedItem; isOwner: boolean; pending: DeletionRequest | undefined; nameOf: (id: string | null) => string;
  onAskRestore: (t: TrashedItem, reason: string) => Promise<void>; onRestore: (t: TrashedItem) => Promise<void>; onPurge: (t: TrashedItem) => Promise<void>;
}) {
  const [mode, setMode] = useState<'idle' | 'ask' | 'purge'>('idle');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>) => {
    try { setError(''); await fn(); setMode('idle'); setText(''); } catch (e) { setError(navigator.onLine ? String(e).replace(/^Error: /, '') : 'This needs a connection.'); }
  };
  return (
    <li className="trash-row">
      <div className="trash-main">
        <span className={`kind kind-${t.kind}`}>{t.kind}</span>
        <b>{t.title || 'Untitled'}</b>
        <span className="byline">Added by {nameOf(t.created_by)}, trashed {when.format(new Date(t.deleted_at))}</span>
      </div>
      {pending ? <p className="del-pending">Restore requested</p> : mode === 'idle' && (
        <div className="trash-actions">
          {isOwner ? (
            <>
              <button onClick={() => run(() => onRestore(t))}>Restore</button>
              <button className="ghost danger" onClick={() => setMode('purge')}>Delete for good</button>
            </>
          ) : <button onClick={() => setMode('ask')}>Ask to restore</button>}
        </div>
      )}
      {mode === 'ask' && (
        <form className="ask-delete" onSubmit={(e) => { e.preventDefault(); run(() => onAskRestore(t, text.trim())); }}>
          <label>Why should it come back?<input autoFocus required value={text} onChange={(e) => setText(e.target.value)} /></label>
          <div className="row-end"><button type="button" className="ghost" onClick={() => setMode('idle')}>Cancel</button><button className="primary">Send request</button></div>
        </form>
      )}
      {mode === 'purge' && (
        <form className="purge" onSubmit={(e) => { e.preventDefault(); if (text === 'DELETE') run(() => onPurge(t)); }}>
          <p><b>This cannot be undone.</b> “{t.title || 'Untitled'}” and its whole edit history will be removed for both of you. Only a note that something was deleted, by you, and when, is kept.</p>
          <label>Type DELETE to confirm<input autoFocus value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" /></label>
          <div className="row-end"><button type="button" className="ghost" onClick={() => { setMode('idle'); setText(''); }}>Cancel</button><button className="danger-solid" disabled={text !== 'DELETE'}>Delete for good</button></div>
        </form>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </li>
  );
}
