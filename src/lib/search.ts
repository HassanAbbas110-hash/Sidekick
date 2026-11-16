// Search helpers. Shared work is searched on the server (search_all, permission-checked); private items and
// offline searches are matched here, on the device, against text that is already decrypted or saved locally.

export type HitKind = 'task' | 'note' | 'link' | 'event' | 'file' | 'client';
export type Hit = {
  kind: HitKind; id: string; space_id: string; title: string | null; snippet: string | null; extra: string | null;
  updated_at: string | null; trashed: boolean; rank: number; source: 'server' | 'device' | 'private';
};
export type LocalRow = { kind: string; id: string; space_id: string; title: string | null; body?: string | null; url?: string | null; updated_at?: string | null };

export const MIN_QUERY = 2;
export const ORDER: HitKind[] = ['task', 'note', 'client', 'file', 'link', 'event'];
const KINDS = new Set<string>(ORDER);

/** Case-insensitive substring match; title matches rank first, then most recently changed. */
export function matchLocal(rows: LocalRow[], query: string, source: Hit['source']): Hit[] {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_QUERY) return [];
  const has = (v: string | null | undefined) => Boolean(v && v.toLowerCase().includes(q));
  return rows
    .filter((r) => KINDS.has(r.kind) && (has(r.title) || has(r.body) || has(r.url)))
    .map((r): Hit => ({
      kind: r.kind as HitKind, id: r.id, space_id: r.space_id, title: r.title, snippet: (r.body || r.url || '').slice(0, 200) || null,
      extra: r.url ?? null, updated_at: r.updated_at ?? null, trashed: false, rank: has(r.title) ? 0 : 1, source,
    }))
    .sort(byRank);
}

export function byRank(a: Hit, b: Hit) {
  return a.rank - b.rank || (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
}

/** Merge result lists, dropping duplicates (same item found twice), best first. */
export function mergeHits(...lists: Hit[][]): Hit[] {
  const seen = new Set<string>();
  return lists.flat().sort(byRank).filter((h) => (seen.has(h.kind + h.id) ? false : (seen.add(h.kind + h.id), true)));
}

/** Split text into plain and matched pieces for highlighting (no HTML is ever built from the text). */
export function highlight(text: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim();
  if (q.length < MIN_QUERY || !text) return [{ text, hit: false }];
  const out: { text: string; hit: boolean }[] = [];
  const lower = text.toLowerCase(), ql = q.toLowerCase();
  let i = 0;
  for (let at = lower.indexOf(ql); at !== -1; at = lower.indexOf(ql, i)) {
    if (at > i) out.push({ text: text.slice(i, at), hit: false });
    out.push({ text: text.slice(at, at + q.length), hit: true });
    i = at + q.length;
  }
  if (i < text.length) out.push({ text: text.slice(i), hit: false });
  return out;
}

/** A short excerpt around the first match, so long notes show the part that matched. */
export function excerpt(text: string | null, query: string, width = 110): string | null {
  if (!text) return null;
  const at = text.toLowerCase().indexOf(query.trim().toLowerCase());
  if (at < 0 || text.length <= width) return text.slice(0, width);
  const start = Math.max(0, at - Math.floor(width / 3));
  return `${start > 0 ? '…' : ''}${text.slice(start, start + width)}${start + width < text.length ? '…' : ''}`;
}
