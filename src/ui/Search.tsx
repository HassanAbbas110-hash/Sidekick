import { useEffect, useMemo, useRef, useState } from 'react';
import { loadItems, reveal, searchShared, type Client, type Item, type Space } from '../lib/data.ts';
import { withCache } from '../lib/cache.ts';
import { excerpt, highlight, matchLocal, mergeHits, MIN_QUERY, ORDER, type Hit, type HitKind, type LocalRow } from '../lib/search.ts';

const LABEL: Record<HitKind, string> = { task: 'Tasks', note: 'Notes', client: 'Clients', file: 'Files', link: 'Links', event: 'Events' };
const GLYPH: Record<HitKind, string> = { task: '○', note: '¶', client: '◆', file: '▤', link: '↗', event: '◷' };
const noLoad = async (): Promise<never> => { throw new Error('offline'); };

/** One box to find anything you can open. Shared work is searched on the server under the same access rules;
 * private items are decrypted and matched only on this device; offline, it searches what is saved here. */
export function SearchPanel({ userId, spaces, privateKey, onPick, onClose }: {
  userId: string; spaces: Space[]; privateKey: CryptoKey | null; onPick: (h: Hit) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [trash, setTrash] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const [privateRows, setPrivateRows] = useState<LocalRow[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const privateSpaces = spaces.filter((s) => s.visibility === 'private' && s.owner_id === userId);
  const spaceName = (id: string) => (privateSpaces.some((s) => s.id === id) ? 'Private' : spaces.find((s) => s.id === id)?.name ?? '');

  useEffect(() => { input.current?.focus(); }, []);

  // Decrypt private items once per opening, on this device only.
  useEffect(() => {
    if (!privateKey) return;
    let alive = true;
    (async () => {
      const out: LocalRow[] = [];
      for (const s of privateSpaces) {
        const rows = await withCache(userId, `items:${s.id}`, () => loadItems(s.id)).then((r) => r.value).catch(() => []);
        for (const r of rows) {
          out.push({ kind: r.kind, id: r.id, space_id: s.id, updated_at: r.updated_at,
            title: await reveal(privateKey, r.title, r.id, 'title'), body: await reveal(privateKey, r.body, r.id, 'body'), url: await reveal(privateKey, r.url ?? null, r.id, 'url') });
        }
      }
      if (alive) setPrivateRows(out);
    })();
    return () => { alive = false; };
  }, [privateKey, userId, privateSpaces.map((s) => s.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (q.trim().length < MIN_QUERY) { setHits([]); return; }
    let alive = true;
    setBusy(true);
    const t = setTimeout(async () => {
      let shared: Hit[] = [];
      let wentOffline = false;
      try {
        shared = (await searchShared(q, trash)).map((h) => ({ ...h, kind: h.kind as HitKind, source: 'server' as const }));
      } catch {
        // Offline: search the copies saved on this device (shared spaces only; trash is not kept offline).
        wentOffline = true;
        const local: LocalRow[] = [];
        for (const s of spaces.filter((x) => x.visibility === 'shared')) {
          const items = await withCache<Item[]>(userId, `items:${s.id}`, noLoad).then((r) => r.value).catch(() => []);
          local.push(...items.map((i) => ({ kind: i.kind, id: i.id, space_id: s.id, title: i.title, body: i.body, url: i.url, updated_at: i.updated_at })));
          const clients = await withCache<Client[]>(userId, `clients:${s.id}`, noLoad).then((r) => r.value).catch(() => []);
          local.push(...clients.map((c) => ({ kind: 'client', id: c.id, space_id: s.id, title: c.name, body: [c.contact_name, c.email, c.notes].filter(Boolean).join(', '), updated_at: c.updated_at })));
        }
        shared = matchLocal(local, q, 'device');
      }
      if (!alive) return;
      setOffline(wentOffline);
      setHits(mergeHits(shared, matchLocal(privateRows, q, 'private')));
      setActive(0);
      setBusy(false);
    }, 180);
    return () => { alive = false; clearTimeout(t); };
  }, [q, trash, privateRows, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => ORDER.map((k) => ({ kind: k, hits: hits.filter((h) => h.kind === k) })).filter((g) => g.hits.length), [hits]);
  const flat = groups.flatMap((g) => g.hits);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && flat[active]) { e.preventDefault(); onPick(flat[active]); }
  }
  useEffect(() => { document.getElementById(`hit-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const Marked = ({ text }: { text: string }) => <>{highlight(text, q).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}</>;
  let index = -1;

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <div className="search" role="dialog" aria-modal="true" aria-label="Search" onKeyDown={onKey}>
        <div className="search-bar">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden className="icon"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <label className="sr-only" htmlFor="search-q">Search</label>
          <input id="search-q" ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks, notes, clients, files, links…" autoComplete="off"
            role="combobox" aria-expanded={flat.length > 0} aria-controls="search-results" aria-activedescendant={flat.length ? `hit-${active}` : undefined} />
          <kbd className="esc" aria-hidden>Esc</kbd>
        </div>
        <div className="search-opts">
          <label className="check"><input type="checkbox" checked={trash} onChange={(e) => setTrash(e.target.checked)} /> Include trash and archived</label>
          <span className="hint">{privateKey ? 'Private items are searched on this device only.' : privateSpaces.length ? 'Unlock your private area to include it.' : ''}</span>
        </div>
        {offline && <p className="notice warn search-note">Offline: searching what is saved on this device. Newer changes and files may be missing.</p>}

        <div id="search-results" className="search-results" role="listbox" aria-label="Results">
          {q.trim().length < MIN_QUERY ? <p className="quiet search-empty">Type at least two letters. Try a client name, a phrase from a note, or part of a web address.</p>
            : !busy && flat.length === 0 ? <p className="quiet search-empty">Nothing matches “{q.trim()}”.{!trash ? ' Try including trash.' : ''}</p>
            : groups.map((g) => (
              <section key={g.kind} className="hit-group" aria-label={LABEL[g.kind]}>
                <h3>{LABEL[g.kind]} <span className="lane-count">{g.hits.length}</span></h3>
                {g.hits.map((h) => {
                  index += 1;
                  const i = index;
                  const snip = excerpt(h.kind === 'link' ? h.extra : h.snippet, q);
                  return (
                    <button key={h.kind + h.id} id={`hit-${i}`} role="option" aria-selected={i === active} className={`hit${i === active ? ' active' : ''}`}
                      onMouseEnter={() => setActive(i)} onClick={() => onPick(h)}>
                      <span className={`hit-glyph g-${h.kind}`} aria-hidden>{GLYPH[h.kind]}</span>
                      <span className="hit-text">
                        <span className="hit-title"><Marked text={h.title || 'Untitled'} /></span>
                        {snip && snip !== h.title && <span className="hit-snip"><Marked text={snip} /></span>}
                      </span>
                      <span className="hit-meta">
                        <span>{spaceName(h.space_id)}</span>
                        {h.source === 'private' && <span className="tag tag-private">Private</span>}
                        {h.trashed && <span className="tag tag-trash">In trash</span>}
                        {h.source === 'device' && <span className="tag">Saved copy</span>}
                      </span>
                    </button>
                  );
                })}
              </section>
            ))}
        </div>
        <p className="search-foot hint"><kbd>↑</kbd><kbd>↓</kbd> to move, <kbd>Enter</kbd> to open, <kbd>/</kbd> or <kbd>Ctrl K</kbd> to search from anywhere</p>
      </div>
    </>
  );
}
