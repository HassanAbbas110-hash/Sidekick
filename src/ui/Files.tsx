import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import { addLink, forget, getKept, keepOffline, keptSummary, loadFiles, loadLinks, loadVersions, projectUsage, removeLink, setReview, signedUrl, signedUrls,
  type FileLink, type FileRow, type FileVersion, type Review } from '../lib/files.ts';
import { loadClients, type Client, type DeletionRequest } from '../lib/data.ts';
import { withCache } from '../lib/cache.ts';
import type { QueuedUpload } from '../lib/uploads.ts';
import { DeleteControls } from './Deletion.tsx';

const REVIEW: Record<Review, string> = { received: 'Received', reviewing: 'Reviewing', approved: 'Approved', used: 'Used' };
const when = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' });
export const size = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`);
const ext = (name: string) => (name.includes('.') ? name.split('.').pop()!.slice(0, 4) : 'file');
const previewable = (mime: string) => mime.startsWith('image/') || mime === 'application/pdf' || mime === 'text/plain';
const FREE_PLAN_BYTES = 1024 ** 3;

type Props = {
  spaceId: string; userId: string; isOwner: boolean; online: boolean; nameOf: (id: string | null) => string;
  tasks: { id: string; title: string | null }[];
  uploads: QueuedUpload[]; refused: { name: string; reason: string }[];
  onPick: (files: File[], itemId?: string | null) => Promise<void>; onRetry: () => void; onRemoveUpload: (opId: string) => void;
  onRename: (f: FileRow, title: string, body: string | null) => Promise<void>;
  requestFor: (id: string) => DeletionRequest | undefined;
  onAskDelete: (f: FileRow, reason: string) => Promise<void>; onTrash: (f: FileRow) => Promise<void>;
  refreshKey: number;
};

export function FilesView(p: Props) {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [kept, setKept] = useState<{ paths: Set<string>; bytes: number }>({ paths: new Set(), bytes: 0 });
  const [used, setUsed] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      const fs = (await withCache(p.userId, `files:${p.spaceId}`, () => loadFiles(p.spaceId))).value;
      setFiles(fs);
      setKept(await keptSummary(p.userId));
      if (navigator.onLine) {
        setThumbs(await signedUrls(fs.filter((f) => f.mime.startsWith('image/')).map((f) => f.storage_path)));
        setUsed(await projectUsage());
      }
      setError('');
    } catch (e) {
      setError(p.online ? String(e) : 'Files have not been opened on this device before, so there is no offline list yet.');
    }
  }, [p.spaceId, p.userId, p.online]);
  useEffect(() => { reload(); }, [reload, p.refreshKey]);

  const pending = p.uploads.filter((u) => u.space_id === p.spaceId);
  const open = files.find((f) => f.id === openId);
  const drop = (e: DragEvent) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) p.onPick([...e.dataTransfer.files]); };

  return (
    <section className={`files${dragging ? ' dragging' : ''}`} aria-label="Files"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
      <div className="files-bar">
        <label className="file-pick primary-look">
          Add files<input type="file" multiple onChange={(e) => { p.onPick([...(e.target.files ?? [])]); e.target.value = ''; }} />
        </label>
        <label className="file-pick">
          Take a photo<input type="file" accept="image/*" capture="environment" onChange={(e) => { p.onPick([...(e.target.files ?? [])]); e.target.value = ''; }} />
        </label>
        <p className="usage">
          {used !== null && <>{size(used)} of the free plan's 1 GB used</>}
          {kept.bytes > 0 && <>{used !== null ? '; ' : ''}{size(kept.bytes)} kept on this device</>}
        </p>
      </div>
      <p className="hint drop-hint">Drag files here on a laptop. Up to 50 MB each. Pictures, PDFs and plain text preview here; other types download.</p>

      {p.refused.length > 0 && (
        <ul className="refused" role="alert">{p.refused.map((r) => <li key={r.name}><b>{r.name}</b> was not added. {r.reason}</li>)}</ul>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}

      {pending.length > 0 && (
        <ul className="upload-list" aria-label="Uploads">
          {pending.map((u) => (
            <li key={u.op_id} className={`upload ${u.state}`}>
              <div className="upload-top"><b>{u.name}</b><span className="quiet">{size(u.size)}</span></div>
              <div className="paidbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(u.progress * 100)} aria-label={`Uploading ${u.name}`}>
                <span style={{ width: `${Math.round(u.progress * 100)}%` }} />
              </div>
              <div className="upload-bottom">
                <span>{u.state === 'failed' ? `Not uploaded yet: ${u.error}` : u.state === 'uploading' ? (u.progress >= 1 ? 'Checking it arrived safely' : 'Uploading') : 'Saved on this device, waiting to upload'}</span>
                {u.state === 'failed' && <span className="upload-actions"><button className="ghost" onClick={p.onRetry}>Retry</button><button className="ghost" onClick={() => p.onRemoveUpload(u.op_id)}>Remove</button></span>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {files.length === 0 && pending.length === 0 ? (
        <p className="quiet">No files in this space yet. Add logos, briefs, screenshots of what was agreed, or proof of payment.</p>
      ) : (
        <ul className="gallery">
          {files.map((f) => (
            <li key={f.id}>
              <button className="tile" onClick={() => setOpenId(f.id)}>
                <span className="tile-art">
                  {thumbs.get(f.storage_path) ? <img src={thumbs.get(f.storage_path)} alt="" loading="lazy" /> : <span className="tile-ext">{ext(f.original_name)}</span>}
                  {kept.paths.has(f.storage_path) && <span className="kept-dot" title="Kept on this device" aria-label="Kept on this device" />}
                </span>
                <span className="tile-name">{f.title || f.original_name}</span>
                <span className="tile-meta">{size(f.size_bytes)}{f.version > 1 ? `, version ${f.version}` : ''}{f.review ? `, ${REVIEW[f.review].toLowerCase()}` : ''}</span>
                {p.requestFor(f.id) && <span className="del-flag">Deletion requested</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && <FileDrawer f={open} {...p} kept={kept.paths} onClose={() => setOpenId(null)} onChanged={reload} />}
    </section>
  );
}

function FileDrawer({ f, userId, isOwner, nameOf, tasks, spaceId, kept, onClose, onChanged, onPick, onRename, requestFor, onAskDelete, onTrash }:
  Props & { f: FileRow; kept: Set<string>; onClose: () => void; onChanged: () => Promise<void> }) {
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [links, setLinks] = useState<FileLink[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [title, setTitle] = useState(f.title || f.original_name);
  const [body, setBody] = useState(f.body ?? '');
  const [msg, setMsg] = useState('');
  const isKept = kept.has(f.storage_path);

  const load = useCallback(async () => {
    try {
      const [v, l, c] = await Promise.all([loadVersions(f.id), loadLinks(f.id), loadClients(spaceId)]);
      setVersions(v); setLinks(l); setClients(c);
    } catch { setMsg('Version history and links need a connection.'); }
  }, [f.id, spaceId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let url: string | null = null;
    (async () => {
      const local = await getKept(userId, f.storage_path).catch(() => undefined);
      if (local) { url = URL.createObjectURL(local); setPreview(url); }
      else if (navigator.onLine && f.mime.startsWith('image/')) setPreview(await signedUrl(f.storage_path).catch(() => null));
    })();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [f.storage_path, f.mime, userId]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    try { setMsg(''); await fn(); if (done) setMsg(done); await load(); await onChanged(); }
    catch (e) { setMsg(navigator.onLine ? String(e).replace(/^Error: /, '') : 'This needs a connection.'); }
  };
  const openVersion = async (v: { storage_path: string; original_name: string; mime: string }) => {
    const local = await getKept(userId, v.storage_path).catch(() => undefined);
    const url = local ? URL.createObjectURL(local) : await signedUrl(v.storage_path, previewable(v.mime) ? undefined : v.original_name);
    window.open(url, '_blank', 'noopener');
  };
  const linkedNames = links.map((l) => ({ l, name: l.target_item ? tasks.find((t) => t.id === l.target_item)?.title ?? 'A task or note' : clients.find((c) => c.id === l.target_client)?.name ?? 'A client' }));

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <aside className="drawer file-drawer" aria-label={f.title || f.original_name}>
        <div className="drawer-head"><h2>{f.title || f.original_name}</h2><button className="ghost close" aria-label="Close" onClick={onClose}>✕</button></div>

        <div className="preview">
          {preview && f.mime.startsWith('image/') ? <img src={preview} alt={`Preview of ${f.title || f.original_name}`} />
            : <div className="preview-none"><span className="tile-ext">{ext(f.original_name)}</span>
                <p className="quiet">{previewable(f.mime) ? 'Opens in a new tab.' : 'No preview for this type. It downloads as the original file.'}</p></div>}
        </div>
        <div className="row-start">
          <button className="primary" onClick={() => openVersion(f)}>{previewable(f.mime) ? 'Open' : 'Download'}</button>
          <button onClick={() => run(() => (isKept ? forget(userId, f.storage_path) : keepOffline(userId, f.storage_path)), isKept ? 'Removed from this device.' : 'Kept on this device for offline use.')}>
            {isKept ? 'Remove from this device' : 'Keep on this device'}
          </button>
        </div>
        {msg && <p className="hint" role="status">{msg}</p>}

        <form className="panel-form" onSubmit={(e) => { e.preventDefault(); run(() => onRename(f, title.trim(), body.trim() || null), 'Saved.'); }}>
          <label>Name<input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} /></label>
          <label>Description<textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What this is, where it came from" /></label>
          <div className="row-end"><button className="primary">Save</button></div>
        </form>

        <h3 className="drawer-sub">Versions</h3>
        <p className="hint">A new upload never replaces an older version. Labels are your own notes, not automatic checks.</p>
        <ul className="versions">
          {versions.map((v) => (
            <li key={v.version} className={v.state !== 'verified' ? 'unverified' : ''}>
              <div className="version-top"><b>Version {v.version}</b><span className="quiet">{size(v.size_bytes)}</span></div>
              <p className="byline"><span>{nameOf(v.uploaded_by)}, {when.format(new Date(v.uploaded_at))}</span>
                {v.state === 'pending' && <span className="late">Upload not finished</span>}{v.state === 'missing' && <span className="late">Stored copy missing or damaged</span>}</p>
              <p className="byline"><span title={v.sha256}>Checksum {v.sha256.slice(0, 12)}…</span><span>{v.original_name}</span></p>
              {v.state === 'verified' && (
                <div className="row-start">
                  <select aria-label={`Label for version ${v.version}`} value={v.review ?? ''} onChange={(e) => run(() => setReview(f.id, v.version, (e.target.value || null) as Review | null))}>
                    <option value="">No label</option>
                    {(Object.keys(REVIEW) as Review[]).map((r) => <option key={r} value={r}>{REVIEW[r]}</option>)}
                  </select>
                  <button className="ghost" onClick={() => openVersion(v)}>{previewable(v.mime) ? 'Open' : 'Download'}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <label className="file-pick wide-pick">Upload a new version<input type="file" onChange={(e) => { if (e.target.files?.[0]) onPick([e.target.files[0]], f.id); e.target.value = ''; }} /></label>

        <h3 className="drawer-sub">Linked to</h3>
        {linkedNames.length === 0 ? <p className="quiet">Not linked to anything yet. Linking does not copy the file.</p> : (
          <ul className="links">{linkedNames.map(({ l, name }) => (
            <li key={`${l.target_item}${l.target_client}`}><span>{name}</span><button className="ghost" onClick={() => run(() => removeLink(l))}>Unlink</button></li>
          ))}</ul>
        )}
        <LinkPicker tasks={tasks.filter((t) => t.id !== f.id && !links.some((l) => l.target_item === t.id))}
          clients={clients.filter((c) => !links.some((l) => l.target_client === c.id))}
          onLink={(target) => run(() => addLink(f.id, target, userId))} />

        <div className="drawer-foot">
          <DeleteControls isOwner={isOwner} pending={requestFor(f.id)} onAsk={(r) => onAskDelete(f, r)} onTrash={async () => { await onTrash(f); onClose(); }} />
          {links.length > 0 && <p className="hint">Moving this file to the trash does not remove the tasks or clients it is linked to.</p>}
        </div>
      </aside>
    </>
  );
}

function LinkPicker({ tasks, clients, onLink }: { tasks: { id: string; title: string | null }[]; clients: Client[]; onLink: (t: { item?: string; client?: string }) => void }) {
  const options = useMemo(() => [
    ...clients.map((c) => ({ key: `c:${c.id}`, label: `Client: ${c.name}` })),
    ...tasks.map((t) => ({ key: `i:${t.id}`, label: t.title || 'Untitled' })),
  ], [tasks, clients]);
  if (!options.length) return null;
  return (
    <label className="link-pick">
      <span className="sr-only">Link to</span>
      <select value="" onChange={(e) => {
        const [kind, id] = e.target.value.split(':');
        if (id) onLink(kind === 'c' ? { client: id } : { item: id });
      }}>
        <option value="">Link to a task, note or client…</option>
        {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </label>
  );
}
