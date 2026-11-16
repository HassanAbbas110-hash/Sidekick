import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPrivateSpace, deletePrivateForGood, hide, loadPrivateTrash, reveal, setPrivateTrashed, vaultRemote, type Item, type Space } from '../lib/data.ts';
import { recover, setUp, unlockWithPassphrase } from '../lib/keystore.ts';
import type { Fields, Op } from '../sync/outbox.ts';
import { Mark } from './Mark.tsx';

const MIN = 12;

/** First-time setup: explains exactly what stays private and what the other person can see. */
export function PrivateSetup({ userId, isOwner, ownerName, partnerName, onDone }: {
  userId: string; isOwner: boolean; ownerName: string; partnerName: string; onDone: (key: CryptoKey) => void;
}) {
  const [step, setStep] = useState<'explain' | 'passphrase' | 'recovery' | 'confirm'>('explain');
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [check, setCheck] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create(e: FormEvent) {
    e.preventDefault();
    if (pass.length < MIN || pass !== again) return;
    setBusy(true); setError('');
    try {
      setRecoveryKey(await setUp(userId, pass, vaultRemote(userId)));
      setStep('recovery');
    } catch (err) {
      setError(navigator.onLine ? String(err).replace(/^Error: /, '') : 'Setting up needs a connection once.');
    } finally { setBusy(false); }
  }

  async function finish(e: FormEvent) {
    e.preventDefault();
    if (check.trim().toUpperCase() !== recoveryKey.slice(-8)) return;
    setBusy(true);
    try {
      const { storedKey } = await import('../lib/keystore.ts');
      const key = (await storedKey(userId))!;
      await createPrivateSpace(userId, key, 'Private');
      onDone(key);
    } catch (err) { setError(String(err)); } finally { setBusy(false); }
  }

  return (
    <section className="private-setup" aria-label="Set up your private area">
      <Mark size={44} />
      {step === 'explain' && (
        <>
          <h1>Your private area</h1>
          <p className="lede">A place for your own notes, tasks, study plans and appointments. What you write here is locked on this device before it is saved, so nobody else can read it: not {isOwner ? partnerName : ownerName}, not the person who runs the server, and not Supabase.</p>
          <div className="privacy-grid">
            <div><h3>Stays private</h3><ul><li>Titles and text of your private notes, tasks and events</li><li>The names of your private spaces</li><li>What your focus sessions were about</li></ul></div>
            <div><h3>{isOwner ? partnerName : ownerName} can see</h3><ul>
              <li>“Busy” at the times of your private events, with no titles</li>
              <li>How long you focused each day and how many sessions you marked complete</li>
              {!isOwner && <li>A notice when you delete something private, saying only the kind of thing (for example “a private note”) and when. Never its name or content.</li>}
            </ul></div>
          </div>
          <p className="hint">The server can also tell that private items exist, when your events are, and whether tasks are done. This keeps Busy times and syncing working.</p>
          <button className="primary" onClick={() => setStep('passphrase')}>Continue</button>
        </>
      )}
      {step === 'passphrase' && (
        <form className="panel-form narrow" onSubmit={create}>
          <h2>Choose a passphrase</h2>
          <p className="quiet">At least {MIN} characters. A few unrelated words are easiest to remember, like “river lamp seven toast”. Use one you do not use anywhere else.</p>
          <label>Passphrase<input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus /></label>
          <label>Type it again<input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></label>
          {pass.length > 0 && pass.length < MIN && <p className="field-error">{MIN - pass.length} more characters needed.</p>}
          {again.length > 0 && pass !== again && <p className="field-error">The two do not match yet.</p>}
          {error && <p className="field-error" role="alert">{error}</p>}
          <button className="primary" disabled={busy || pass.length < MIN || pass !== again}>{busy ? 'Locking…' : 'Create my private area'}</button>
        </form>
      )}
      {step === 'recovery' && (
        <div className="panel-form narrow">
          <h2>Your recovery key</h2>
          <p>If you forget your passphrase, this is the only way back in. Write it down on paper or save it in a password manager. <b>It will not be shown again</b>, and nobody, including {isOwner ? 'Supabase' : ownerName}, can reset it for you.</p>
          <p className="recovery-key" aria-label="Recovery key">{recoveryKey}</p>
          <button onClick={() => navigator.clipboard?.writeText(recoveryKey)}>Copy</button>
          <button className="primary" onClick={() => setStep('confirm')}>I have saved it</button>
        </div>
      )}
      {step === 'confirm' && (
        <form className="panel-form narrow" onSubmit={finish}>
          <h2>Check you saved it</h2>
          <label>Type the last 8 characters of your recovery key<input value={check} onChange={(e) => setCheck(e.target.value)} autoFocus autoComplete="off" maxLength={8} /></label>
          {check.length === 8 && check.trim().toUpperCase() !== recoveryKey.slice(-8) && <p className="field-error">That does not match. Look at what you saved.</p>}
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="row-end">
            <button type="button" className="ghost" onClick={() => setStep('recovery')}>Show it again</button>
            <button className="primary" disabled={busy || check.trim().toUpperCase() !== recoveryKey.slice(-8)}>Open my private area</button>
          </div>
        </form>
      )}
    </section>
  );
}

export function Unlock({ userId, onUnlocked }: { userId: string; onUnlocked: (key: CryptoKey) => void }) {
  const [mode, setMode] = useState<'pass' | 'recover'>('pass');
  const [pass, setPass] = useState('');
  const [rk, setRk] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<CryptoKey>) => {
    setBusy(true); setError('');
    try { onUnlocked(await fn()); }
    catch (e) {
      const m = String(e);
      setError(m.includes('wrong_secret') ? (mode === 'pass' ? 'That passphrase does not open your private area.' : 'That recovery key does not match.') : navigator.onLine ? m.replace(/^Error: /, '') : 'Unlocking on a new device needs a connection once.');
    } finally { setBusy(false); }
  };
  return (
    <section className="private-setup" aria-label="Unlock your private area">
      <Mark size={44} />
      {mode === 'pass' ? (
        <form className="panel-form narrow" onSubmit={(e) => { e.preventDefault(); run(() => unlockWithPassphrase(userId, pass, vaultRemote(userId))); }}>
          <h1>Private area is locked</h1>
          <label>Passphrase<input type="password" autoComplete="current-password" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} /></label>
          {error && <p className="field-error" role="alert">{error}</p>}
          <button className="primary" disabled={busy || !pass}>{busy ? 'Unlocking…' : 'Unlock'}</button>
          <button type="button" className="ghost" onClick={() => { setMode('recover'); setError(''); }}>Forgot it? Use your recovery key</button>
          <p className="hint">Unlocking takes a moment on purpose: it makes guessing passphrases slow.</p>
        </form>
      ) : (
        <form className="panel-form narrow" onSubmit={(e) => { e.preventDefault(); if (next.length >= MIN) run(() => recover(userId, rk.trim(), next, vaultRemote(userId))); }}>
          <h1>Use your recovery key</h1>
          <label>Recovery key<input value={rk} onChange={(e) => setRk(e.target.value)} autoFocus autoComplete="off" placeholder="XXXXXXXX-XXXXXXXX-…" /></label>
          <label>New passphrase (at least {MIN} characters)<input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
          {error && <p className="field-error" role="alert">{error}</p>}
          <button className="primary" disabled={busy || !rk || next.length < MIN}>{busy ? 'Checking…' : 'Set new passphrase and unlock'}</button>
          <button type="button" className="ghost" onClick={() => setMode('pass')}>Back</button>
        </form>
      )}
    </section>
  );
}

type Shown = { id: string; kind: string; title: string | null; body: string | null; status: string | null; version: number; starts_at?: string | null };

/** Decrypt rows for display; anything that cannot be opened with this key says so plainly. */
export function useRevealed(rows: { id: string; kind: string; title: string | null; body: string | null; status?: string | null; version?: number; starts_at?: string | null }[], key: CryptoKey | null) {
  const [shown, setShown] = useState<Shown[]>([]);
  // Re-decrypt only when the rows' content changes. Callers pass freshly built arrays on every render, so
  // depending on the array itself re-ran this on every render: decrypt → setState → render → decrypt (a freeze).
  const signature = rows.map((r) => `${r.id}:${r.version ?? 0}:${r.status ?? ''}:${r.title ?? ''}:${r.body ?? ''}`).join('|');
  const latest = useRef(rows);
  latest.current = rows;
  useEffect(() => {
    let alive = true;
    Promise.all(latest.current.map(async (r) => ({
      id: r.id, kind: r.kind, status: r.status ?? null, version: r.version ?? 0, starts_at: r.starts_at,
      title: await reveal(key, r.title, r.id, 'title'), body: await reveal(key, r.body, r.id, 'body'),
    }))).then((s) => alive && setShown(s));
    return () => { alive = false; };
  }, [signature, key]);
  return shown;
}

export function PrivateView({ space, name, items, keyFor, queue, onLock, isOwner, partnerName, reload }: {
  space: Space; name: string; items: Item[]; keyFor: CryptoKey; queue: (op: Op) => Promise<void>; onLock: () => void;
  isOwner: boolean; partnerName: string; reload: () => Promise<void>;
}) {
  const shown = useRevealed(items.filter((i) => i.kind !== 'file'), keyFor);
  const [kind, setKind] = useState<'task' | 'note'>('task');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [trash, setTrash] = useState<{ id: string; kind: string; title: string | null; deleted_at: string }[]>([]);
  const trashShown = useRevealed(trash.map((t) => ({ ...t, body: null })), keyFor);
  const [error, setError] = useState('');

  const loadTrash = () => loadPrivateTrash(space.id).then(setTrash).catch(() => setTrash([]));
  useEffect(() => { loadTrash(); }, [space.id, items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const id = crypto.randomUUID();
    const fields: Fields = { title: await hide(keyFor, title.trim(), id, 'title'), body: await hide(keyFor, body.trim() || null, id, 'body') };
    if (kind === 'task') fields.status = 'open';
    await queue({ op_id: crypto.randomUUID(), type: 'create', id, space_id: space.id, kind, fields });
    setTitle(''); setBody('');
  }
  const act = async (fn: () => Promise<void>) => {
    try { setError(''); await fn(); await reload(); await loadTrash(); }
    catch (e) { setError(navigator.onLine ? String(e).replace(/^Error: /, '') : 'Deleting and restoring need a connection.'); }
  };
  const notice = isOwner ? '' : ` ${partnerName} will see that a private ${'item'} was removed, but not what it was.`;
  const tasks = shown.filter((s) => s.kind === 'task');
  const notes = shown.filter((s) => s.kind === 'note');

  return (
    <section className="private" aria-label={name}>
      <div className="private-head">
        <div>
          <p className="date">Private, locked on your devices</p>
          <h1>{name}</h1>
        </div>
        <button className="ghost" onClick={onLock}>Lock</button>
      </div>

      <form className="quick open" onSubmit={add} aria-label="Add something private">
        <div className="quick-line">
          <div className="kind-toggle" role="radiogroup" aria-label="Type">
            {(['task', 'note'] as const).map((k) => <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'task' ? 'Task' : 'Note'}</button>)}
          </div>
          <label className="sr-only" htmlFor="p-title">Title</label>
          <input id="p-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'task' ? 'Something only you need to do' : 'Something only you should see'} autoComplete="off" />
          <button className="primary add">Add</button>
        </div>
        <div className="quick-more"><textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Details (optional, also private)" aria-label="Details" /></div>
      </form>
      <p className="hint">For appointments that should show as Busy to {partnerName}, add an event in the Calendar and choose this space.</p>
      {error && <p className="field-error" role="alert">{error}</p>}

      <section className="lane lane-you" aria-label="Private tasks">
        <h2 className="lane-title">Tasks<span className="lane-count">{tasks.filter((t) => t.status !== 'done').length}</span></h2>
        {tasks.length === 0 ? <p className="quiet">No private tasks yet.</p> : (
          <ul className="task-list">
            {tasks.sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done')).map((t) => (
              <li key={t.id} className={`task you ${t.status === 'done' ? 'is-done' : ''}`}>
                <button className="ring" aria-pressed={t.status === 'done'} aria-label={t.status === 'done' ? 'Mark not done' : 'Mark done'} disabled={!t.version}
                  onClick={() => queue({ op_id: crypto.randomUUID(), type: 'update', id: t.id, base_version: t.version, fields: { status: t.status === 'done' ? 'open' : 'done' } })}>
                  <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="10" /><path d="M7 12.5l3.2 3.2L17 9" /></svg>
                </button>
                <div className="task-body">
                  <span className="task-title static">{t.title ?? 'Cannot be read on this device'}</span>
                  {t.body && <p className="instructions">{t.body}</p>}
                  {t.version > 0 && <button className="ghost danger-quiet" onClick={() => act(() => setPrivateTrashed(t.id, true))}>Move to trash</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="notes" aria-label="Private notes">
        <h2>Notes</h2>
        {notes.length === 0 ? <p className="quiet">No private notes yet.</p> : (
          <ul className="note-list">{notes.map((n) => (
            <li key={n.id} className="note private-note">
              <h3>{n.title ?? 'Cannot be read on this device'}</h3>
              {n.body && <p>{n.body}</p>}
              {n.version > 0 && <button className="ghost danger-quiet" onClick={() => act(() => setPrivateTrashed(n.id, true))}>Move to trash</button>}
            </li>
          ))}</ul>
        )}
      </section>

      {trashShown.length > 0 && (
        <details className="done-group">
          <summary>Private trash ({trashShown.length})</summary>
          <ul className="trash-list">{trashShown.map((t) => (
            <li key={t.id} className="trash-row">
              <div className="trash-main"><b>{t.title ?? 'Cannot be read on this device'}</b></div>
              <div className="trash-actions">
                <button onClick={() => act(() => setPrivateTrashed(t.id, false))}>Restore</button>
                <button className="ghost danger" onClick={() => {
                  if (confirm(`Delete this for good? It cannot be recovered.${notice.replace('item', t.kind)}`)) act(() => deletePrivateForGood(t.id));
                }}>Delete for good</button>
              </div>
            </li>
          ))}</ul>
          {!isOwner && <p className="hint">Moving to trash and deleting each tell {partnerName} only that a private {`item`} was removed, and when.</p>}
        </details>
      )}
    </section>
  );
}
