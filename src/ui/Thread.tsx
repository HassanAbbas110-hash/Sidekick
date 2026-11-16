import { useEffect, useRef, useState, type FormEvent } from 'react';
import { loadComments, type Comment } from '../lib/data.ts';
import { withCache } from '../lib/cache.ts';
import type { Op } from '../sync/outbox.ts';

const when = new Intl.DateTimeFormat('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' });

/** The conversation inside a task or note. Yours sit on the gold side, theirs on the ivory side. */
export function Thread({ itemId, userId, nameOf, pending, queue, refreshKey }: {
  itemId: string; userId: string; nameOf: (id: string | null) => string; pending: Op[]; queue: (op: Op) => Promise<void>; refreshKey: number;
}) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    let alive = true;
    withCache(userId, `comments:${itemId}`, () => loadComments(itemId)).then((r) => alive && setComments(r.value)).catch(() => alive && setComments((c) => c ?? []));
    return () => { alive = false; };
  }, [itemId, userId, refreshKey]);

  const unsent = pending.filter((o): o is Extract<Op, { type: 'call' }> => o.type === 'call' && o.fn === 'add_comment' && o.args.p_item === itemId)
    .filter((o) => !(comments ?? []).some((c) => c.id === o.args.p_id))
    .map((o): Comment => ({ id: String(o.args.p_id), item_id: itemId, author: userId, body: String(o.args.p_body), created_at: new Date().toISOString(), pending: true }));
  const all = [...(comments ?? []), ...unsent];

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return box.current?.focus();
    setText('');
    await queue({ op_id: crypto.randomUUID(), type: 'call', fn: 'add_comment', label: 'Comment', args: { p_id: crypto.randomUUID(), p_item: itemId, p_body: body } });
  }

  return (
    <section className="thread" aria-label="Comments">
      {comments === null ? <p className="hint">Loading comments…</p> : all.length === 0 ? <p className="hint">No comments yet. Ask a question or leave an update here instead of on WhatsApp.</p> : (
        <ol className="thread-list">
          {all.map((c) => (
            <li key={c.id} className={c.author === userId ? 'mine' : 'theirs'}>
              <p className="bubble">{c.body}</p>
              <p className="thread-meta">{c.author === userId ? 'You' : nameOf(c.author)}, {c.pending ? 'sending…' : when.format(new Date(c.created_at))}</p>
            </li>
          ))}
        </ol>
      )}
      <form className="thread-form" onSubmit={send}>
        <label className="sr-only" htmlFor={`cmt-${itemId}`}>Write a comment</label>
        <textarea id={`cmt-${itemId}`} ref={box} rows={1} maxLength={4000} value={text} placeholder="Write a comment"
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } }} />
        <button className="primary" disabled={!text.trim()}>Send</button>
      </form>
    </section>
  );
}

export function CommentIcon() {
  return <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden className="icon"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.5 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /></svg>;
}
