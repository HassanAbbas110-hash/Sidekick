import { supabase } from './supabase.ts';
import type { UploadDeps } from './uploads.ts';

const BUCKET = 'sidekick-files';

export type FileRow = {
  id: string; space_id: string; title: string | null; body: string | null; created_by: string; updated_at: string; item_version: number;
  version: number; storage_path: string; original_name: string; mime: string; size_bytes: number; sha256: string;
  review: Review | null; uploaded_by: string; uploaded_at: string;
};
export type Review = 'received' | 'reviewing' | 'approved' | 'used';
export type FileVersion = {
  item_id: string; version: number; storage_path: string; original_name: string; mime: string; size_bytes: number;
  sha256: string; state: 'pending' | 'verified' | 'missing'; review: Review | null; uploaded_by: string; uploaded_at: string;
};
export type FileLink = { file_id: string; target_item: string | null; target_client: string | null };

function check<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export const loadFiles = async (spaceId: string) =>
  check(await supabase.from('files_current').select('*').eq('space_id', spaceId).is('deleted_at', null).order('uploaded_at', { ascending: false })) as FileRow[];

export const loadVersions = async (itemId: string) =>
  check(await supabase.from('file_versions').select('item_id, version, storage_path, original_name, mime, size_bytes, sha256, state, review, uploaded_by, uploaded_at')
    .eq('item_id', itemId).order('version', { ascending: false })) as FileVersion[];

export const loadLinks = async (fileId: string) =>
  check(await supabase.from('file_links').select('file_id, target_item, target_client').eq('file_id', fileId)) as FileLink[];

export async function setReview(itemId: string, version: number, review: Review | null) {
  check(await supabase.from('file_versions').update({ review }).eq('item_id', itemId).eq('version', version));
}

export async function addLink(fileId: string, target: { item?: string; client?: string }, userId: string) {
  check(await supabase.from('file_links').insert({ file_id: fileId, target_item: target.item ?? null, target_client: target.client ?? null, linked_by: userId }));
}

export async function removeLink(l: FileLink) {
  let q = supabase.from('file_links').delete().eq('file_id', l.file_id);
  q = l.target_item ? q.eq('target_item', l.target_item) : q.eq('target_client', l.target_client!);
  check(await q);
}

/** Short-lived download link (5 minutes). Files are never public. */
export async function signedUrl(path: string, download?: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300, download ? { download } : undefined);
  if (error) throw new Error(error.message);
  if (!data?.signedUrl) throw new Error('No download link returned');
  return data.signedUrl;
}

export async function signedUrls(paths: string[]) {
  if (!paths.length) return new Map<string, string>();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 300);
  if (error) throw new Error(error.message);
  return new Map(data.flatMap((d) => (d.signedUrl && d.path ? [[d.path, d.signedUrl] as [string, string]] : [])));
}

/** Permanent deletion (Hassan, from the trash): database record first, then the stored bytes. */
export async function purgeFile(itemId: string) {
  const paths = check(await supabase.rpc('purge_file', { p_item: itemId, p_confirm: 'DELETE' })) as string[];
  if (paths.length) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths);
    // The record is already gone; leftover bytes are harmless clutter that can be cleaned up later.
    if (error) console.warn('stored bytes not removed yet', error.message);
  }
}

export const uploadDeps: UploadDeps = {
  begin: async (u) => {
    const r = check(await supabase.rpc('begin_file_upload', {
      p_op_id: u.op_id, p_space: u.space_id, p_item: u.item_id, p_name: u.name, p_mime: u.mime, p_size: u.size, p_sha256: u.sha256,
    })) as { item_id: string; version: number; path: string };
    return { item_id: r.item_id, version: r.version, path: r.path };
  },
  // XHR rather than fetch so the screen can show real upload progress.
  put: async (path, u, onProgress) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Signed out. Sign in again to finish uploading.');
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('apikey', import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
      xhr.setRequestHeader('Content-Type', u.mime);
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve('stored');
        else if (/already exists|Duplicate/i.test(xhr.responseText)) resolve('already_stored'); // arrived before the connection dropped
        else reject(new Error(`Upload refused (${xhr.status}): ${xhr.responseText.slice(0, 160)}`));
      };
      xhr.onerror = () => reject(new Error(navigator.onLine ? 'The upload was interrupted.' : 'Offline.'));
      xhr.send(u.blob);
    });
  },
  finish: async (itemId, version) => check(await supabase.rpc('finish_file_upload', { p_item: itemId, p_version: version })) as string,
};

// ---------- keep on this device (selective offline files) ----------
const keepDb = (userId: string) => `sidekick-files-${userId}`;
function openKeep(userId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(keepDb(userId), 1);
    req.onupgradeneeded = () => req.result.createObjectStore('blobs');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function keepTx<T>(userId: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await openKeep(userId);
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction('blobs', mode);
      const req = fn(t.objectStore('blobs'));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(req.error ?? t.error);
    });
  } finally { db.close(); }
}

/** Download one version and keep it on this device. Only files the user picks are kept (spec §6). */
export async function keepOffline(userId: string, path: string) {
  const res = await fetch(await signedUrl(path));
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  await keepTx(userId, 'readwrite', (s) => s.put(blob, path));
}

export const getKept = (userId: string, path: string) => keepTx<Blob | undefined>(userId, 'readonly', (s) => s.get(path));
export const forget = (userId: string, path: string) => keepTx(userId, 'readwrite', (s) => s.delete(path));

/** Paths kept on this device and the bytes they use, for the storage line. */
export async function keptSummary(userId: string) {
  const all = await keepTx<Blob[]>(userId, 'readonly', (s) => s.getAll() as IDBRequest<Blob[]>);
  const keys = await keepTx<IDBValidKey[]>(userId, 'readonly', (s) => s.getAllKeys());
  return { paths: new Set(keys.map(String)), bytes: all.reduce((n, b) => n + b.size, 0) };
}

/** Sign-out: kept copies are re-downloadable, so they are removed from the device. */
export const dropKept = (userId: string) => new Promise<void>((resolve) => {
  const req = indexedDB.deleteDatabase(keepDb(userId));
  req.onsuccess = req.onerror = req.onblocked = () => resolve();
});

/** Total stored in the project (all versions), to show against the free plan's 1 GB. */
export async function projectUsage() {
  const rows = check(await supabase.from('file_versions').select('size_bytes').eq('state', 'verified')) as { size_bytes: number }[];
  return rows.reduce((n, r) => n + Number(r.size_bytes), 0);
}
