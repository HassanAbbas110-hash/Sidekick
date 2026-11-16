import { useState, type FormEvent } from 'react';
import { linkParts, openLink, safeUrl } from '../lib/links.ts';

export type LinkRow = { id: string; title: string | null; body: string | null; url: string | null; version?: number; pending: boolean };
type Save = { url: string; title: string; body: string | null };

/** A row of link cards at the top of a space: the site's own icon, its name, where it points, and a note. */
export function LinksStrip({ links, onAdd, onEdit, onRemove, removeLabel, removePending, privateNote }: {
  links: LinkRow[]; onAdd: (s: Save) => Promise<void>; onEdit: (l: LinkRow, s: Save) => Promise<void>;
  onRemove: (l: LinkRow) => Promise<void>; removeLabel: string; removePending: (id: string) => boolean; privateNote?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LinkRow | null>(null);
  return (
    <section className="links" aria-labelledby="links-h">
      <div className="links-head">
        <h2 id="links-h">Links</h2>
        {!adding && !editing && <button className="ghost add-link" onClick={() => setAdding(true)}>Add a link</button>}
      </div>
      {(adding || editing) && (
        <LinkForm initial={editing} privateNote={privateNote}
          onCancel={() => { setAdding(false); setEditing(null); }}
          onSave={async (s) => { if (editing) await onEdit(editing, s); else await onAdd(s); setAdding(false); setEditing(null); }} />
      )}
      {links.length === 0 && !adding ? (
        <p className="quiet">Keep the places you visit for this work one tap away: the live site, its admin, hosting, a shared drive folder.</p>
      ) : (
        <ul className="link-cards">
          {links.map((l) => <LinkCard key={l.id} l={l} onEdit={() => setEditing(l)} onRemove={() => onRemove(l)} removeLabel={removeLabel} removing={removePending(l.id)} />)}
        </ul>
      )}
    </section>
  );
}

function LinkCard({ l, onEdit, onRemove, removeLabel, removing }: { l: LinkRow; onEdit: () => void; onRemove: () => Promise<void>; removeLabel: string; removing: boolean }) {
  const url = l.url && safeUrl(l.url);
  const [iconOk, setIconOk] = useState(true);
  const [menu, setMenu] = useState(false);
  if (!url) return <li className="link-card broken"><span className="link-name">{l.title ?? 'Link'}</span><span className="quiet">This link cannot be opened here.</span></li>;
  const p = linkParts(url);
  const name = l.title || p.host;
  return (
    <li className={`link-card${l.pending ? ' pending' : ''}`}>
      <button className="link-main" onClick={() => openLink(url)} title={url}>
        <span className="link-icon" aria-hidden>
          {/* The initial always shows; the site's own icon (loaded from the site itself, no third-party service) covers it if it exists. */}
          <b>{name.charAt(0).toUpperCase()}</b>
          {iconOk && <img src={`${p.origin}/favicon.ico`} alt="" width={22} height={22} loading="lazy" referrerPolicy="no-referrer" onError={() => setIconOk(false)} onLoad={(e) => { if (e.currentTarget.naturalWidth < 8) setIconOk(false); }} />}
        </span>
        <span className="link-text">
          <span className="link-name">{name}</span>
          <span className="link-where">{p.host}{p.path}<span className="link-go" aria-hidden> ↗</span></span>
          {l.body && <span className="link-note">{l.body}</span>}
          {l.pending && <span className="row-sync pending">Waiting to sync</span>}
          {!l.pending && removing && <span className="del-flag">Deletion requested</span>}
        </span>
      </button>
      <span className="sr-only">Opens in your browser</span>
      {l.pending || removing ? null : (
        <span className="link-tools">
          <button className="ghost icon-btn" aria-label={`More for ${name}`} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>⋯</button>
          {menu && (
            <span className="link-menu" role="menu">
              <button role="menuitem" onClick={() => { setMenu(false); onEdit(); }}>Edit</button>
              <button role="menuitem" className="danger" onClick={() => { setMenu(false); onRemove(); }}>{removeLabel}</button>
            </span>
          )}
        </span>
      )}
    </li>
  );
}

function LinkForm({ initial, onSave, onCancel, privateNote }: { initial: LinkRow | null; onSave: (s: Save) => Promise<void>; onCancel: () => void; privateNote?: boolean }) {
  const [url, setUrl] = useState(initial?.url ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [error, setError] = useState('');
  const clean = safeUrl(url);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!clean) return setError('That is not a web address. Use something like webrift.co.za or https://7waves.co.za/admin.');
    try { await onSave({ url: clean, title: title.trim() || linkParts(clean).host, body: body.trim() || null }); }
    catch (err) { setError(String(err).replace(/^Error: /, '')); }
  }
  return (
    <form className="panel-form link-form" onSubmit={submit}>
      <div className="grid-2">
        <label>Address<input autoFocus inputMode="url" value={url} onChange={(e) => { setUrl(e.target.value); setError(''); }} placeholder="webrift.co.za/admin" required /></label>
        <label>Name (optional)<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={clean ? linkParts(clean).host : 'WebRift admin'} maxLength={80} /></label>
      </div>
      <label>Note (optional)<input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Login is in the password manager" maxLength={160} /></label>
      {url && !clean && <p className="field-error">Only web addresses (http or https) can be saved.</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      {privateNote && <p className="hint">Private: the address, name and note are locked on this device.</p>}
      <div className="row-end"><button type="button" className="ghost" onClick={onCancel}>Cancel</button><button className="primary" disabled={!clean}>{initial ? 'Save link' : 'Add link'}</button></div>
    </form>
  );
}
