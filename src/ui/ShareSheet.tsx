import { useEffect, useState, type FormEvent } from 'react';
import { loadClients, type Client, type Space } from '../lib/data.ts';
import { withCache } from '../lib/cache.ts';
import type { Incoming } from '../lib/share.ts';
import { size } from './Files.tsx';

export type ShareChoice = { spaceId: string; kind: 'link' | 'task' | 'note' | 'files'; title: string; body: string | null; url: string | null; files: File[]; clientId: string | null };

/** What arrives from another app's share menu: pick the space and what it becomes, then save. */
export function ShareSheet({ incoming, spaces, spaceId, userId, onSave, onClose }: {
  incoming: Incoming; spaces: Space[]; spaceId: string | null; userId: string;
  onSave: (c: ShareChoice) => Promise<void>; onClose: () => void;
}) {
  const shared = spaces.filter((s) => s.visibility === 'shared');
  const hasFiles = incoming.files.length > 0;
  const [space, setSpace] = useState(shared.find((s) => s.id === spaceId)?.id ?? shared[0]?.id ?? '');
  const [kind, setKind] = useState<ShareChoice['kind']>(hasFiles ? 'files' : incoming.url ? 'link' : 'note');
  const [title, setTitle] = useState(incoming.title);
  const [body, setBody] = useState(incoming.body ?? '');
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!space) return;
    setClientId('');
    withCache(userId, `clients:${space}`, () => loadClients(space)).then((r) => setClients(r.value.filter((c) => !['lost', 'archived'].includes(c.stage)))).catch(() => setClients([]));
  }, [space, userId]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!space) return setError('Create a shared space first.');
    if (kind !== 'files' && !title.trim()) return setError('Give it a title.');
    setBusy(true);
    try {
      await onSave({ spaceId: space, kind, title: title.trim(), body: body.trim() || null, url: incoming.url, files: incoming.files, clientId: clientId || null });
    } catch (err) { setError(String(err).replace(/^Error: /, '')); setBusy(false); }
  }

  const kinds = hasFiles ? [] : ([...(incoming.url ? [['link', 'Link']] : []), ['task', 'Task'], ['note', 'Note']] as [ShareChoice['kind'], string][]);
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <form className="drawer share-sheet" aria-label="Save to Sidekick" onSubmit={save}>
        <div className="drawer-head"><h2>Save to Sidekick</h2><button type="button" className="ghost close" aria-label="Close" onClick={onClose}>✕</button></div>

        {hasFiles ? (
          <ul className="share-files">{incoming.files.map((f) => <li key={f.name + f.size}><span className="tile-ext">{f.name.split('.').pop()?.slice(0, 4) ?? 'file'}</span><span>{f.name}</span><span className="quiet">{size(f.size)}</span></li>)}</ul>
        ) : incoming.url && <p className="share-url">{incoming.url}</p>}
        {incoming.refused.length > 0 && <p className="field-error">Not added: {incoming.refused.join('; ')}.</p>}

        <fieldset className="share-spaces">
          <legend>Which space?</legend>
          {shared.length === 0 ? <p className="quiet">You have no shared spaces yet.</p> : shared.map((s) => (
            <button type="button" key={s.id} aria-pressed={space === s.id} className={space === s.id ? 'on' : ''} onClick={() => setSpace(s.id)}>
              <span className="mono" aria-hidden>{s.name.trim().charAt(0).toUpperCase()}</span>{s.name}
            </button>
          ))}
        </fieldset>

        {kinds.length > 0 && (
          <div className="kind-toggle" role="radiogroup" aria-label="Save as">
            {kinds.map(([k, l]) => <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}
          </div>
        )}

        {kind !== 'files' && <>
          <label>Title<input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></label>
          <label>{kind === 'link' ? 'Note about it (optional)' : 'Details (optional)'}<textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} /></label>
        </>}

        {kind === 'files' && clients.length > 0 && (
          <label>File under a client (optional)
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Not filed under a client</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}

        {error && <p className="field-error" role="alert">{error}</p>}
        <p className="hint">{kind === 'files' ? 'Files upload in the background and keep going if you lose signal.' : 'Saved on this phone first, then synced.'} Private spaces are not offered here yet.</p>
        <div className="row-end"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !space}>{kind === 'files' ? `Upload ${incoming.files.length} file${incoming.files.length === 1 ? '' : 's'}` : `Save ${kind}`}</button></div>
      </form>
    </>
  );
}
