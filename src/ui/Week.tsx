import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { loadCalendar, loadClients, loadFocusSummaries, loadItems, loadPaymentsSince, type FocusSummary, type Item, type Payment, type Space } from '../lib/data.ts';
import { withCache } from '../lib/cache.ts';
import { addDays, dayKey, expand } from '../lib/recur.ts';
import { finishedIn, focusByDay, receivedIn, weekOf } from '../lib/week.ts';
import { formatMoney } from '../lib/money.ts';
import { minutes } from '../lib/focus.ts';
import type { Op } from '../sync/outbox.ts';

const TZ = 'Africa/Johannesburg';
const dm = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'long', timeZone: TZ });
const dShort = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', timeZone: TZ });
const wd = new Intl.DateTimeFormat('en-ZA', { weekday: 'short', timeZone: TZ });
const wdTime = new Intl.DateTimeFormat('en-ZA', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });

type Ahead = { id: string; title: string; at: Date; kind: 'due' | 'event'; space_id: string };

/** Look back at a week together, then write down what matters for the next one. */
export function WeekView({ userId, partnerId, partnerName, spaces, queue, refreshKey, onOpenTask }: {
  userId: string; partnerId: string | null; partnerName: string; spaces: Space[]; queue: (op: Op) => Promise<void>;
  refreshKey: number; onOpenTask: (spaceId: string, id: string) => void;
}) {
  const shared = spaces.filter((s) => s.visibility === 'shared');
  const sharedKey = shared.map((s) => s.id).join();
  const [offset, setOffset] = useState(0);
  const week = useMemo(() => weekOf(new Date(), offset), [offset]);
  const [items, setItems] = useState<Item[]>([]);
  const [focus, setFocus] = useState<FocusSummary[] | null>(null);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [ahead, setAhead] = useState<Ahead[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const all = (await Promise.all(shared.map((s) => withCache(userId, `items:${s.id}`, () => loadItems(s.id)).then((r) => r.value).catch(() => [] as Item[])))).flat();
      if (alive) setItems(all);
      const f = await loadFocusSummaries(week.keys[0], week.keys[6]).catch(() => null);
      if (alive) setFocus(f);
      try {
        const ids = (await Promise.all(shared.map((s) => withCache(userId, `clients:${s.id}`, () => loadClients(s.id)).then((r) => r.value)))).flat().map((c) => c.id);
        const p = await loadPaymentsSince(ids, week.keys[0]);
        if (alive) setPayments(p);
      } catch { if (alive) setPayments(null); }
      const nextTo = addDays(week.to, 7);
      const cal = await loadCalendar(week.to, nextTo).catch(() => null);
      if (alive) {
        if (!cal) { setAhead(null); return; }
        const out: Ahead[] = cal.due.filter((t) => t.status !== 'done').map((t) => ({ id: t.id, title: t.title || 'Untitled', at: new Date(t.due_at), kind: 'due' as const, space_id: t.space_id }));
        for (const ev of cal.events) if (shared.some((s) => s.id === ev.space_id))
          for (const o of expand(ev, week.to, nextTo)) out.push({ id: `${ev.id}:${o.original}`, title: ev.title || 'Untitled', at: o.start, kind: 'event', space_id: ev.space_id });
        setAhead(out.sort((a, b) => a.at.getTime() - b.at.getTime()));
      }
    })();
    return () => { alive = false; };
  }, [userId, sharedKey, refreshKey, week]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = focusByDay(focus ?? [], week.keys, userId);
  const peak = Math.max(1800, ...days.flatMap((d) => [d.mine, d.theirs]));
  const myFocus = days.reduce((a, d) => a + d.mine, 0), theirFocus = days.reduce((a, d) => a + d.theirs, 0);
  const finished = finishedIn(items, week.from, week.to);
  const mineDone = finished.filter((t) => t.assignee === userId), theirsDone = finished.filter((t) => t.assignee && t.assignee !== userId);
  const now = new Date();
  const carried = items.filter((i) => i.kind === 'task' && i.status !== 'done' && i.due_at && new Date(i.due_at) < (offset === 0 ? now : week.to))
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''));
  const received = payments ? receivedIn(payments, week.keys[0], dayKey(week.to)) : null;
  const today = dayKey(now);
  const spaceOf = (id: string) => shared.find((s) => s.id === id)?.name ?? '';
  const who = (id: string | null) => (id === userId ? 'You' : id === partnerId ? partnerName : 'Unclaimed');

  return (
    <div className="weekly">
      <section className="week-hero">
        <div className="week-step">
          <button className="ghost icon-btn" aria-label="Previous week" onClick={() => setOffset((o) => o - 1)}>‹</button>
          <p className="date">{offset === 0 ? 'This week' : offset === -1 ? 'Last week' : `${-offset} weeks ago`}</p>
          <button className="ghost icon-btn" aria-label="Next week" disabled={offset >= 0} onClick={() => setOffset((o) => o + 1)}>›</button>
        </div>
        <h1>{dShort.format(week.days[0])} to {dm.format(week.days[6])}</h1>
        <p className="summary">
          You finished {mineDone.length} task{mineDone.length === 1 ? '' : 's'} and {partnerName} finished {theirsDone.length}.
          {' '}{focus ? `Together you focused for ${minutes(myFocus + theirFocus)}.` : 'Focus totals need a connection.'}
          {carried.length ? ` ${carried.length} overdue task${carried.length === 1 ? ' is' : 's are'} still open.` : ' Nothing overdue is left hanging.'}
        </p>
      </section>

      {/* the seam: your focus rises in gold above the line, your partner's falls in ivory below it */}
      <section className="seam-chart" aria-label="Focus per day">
        <div className="seam-legend"><span className="you">You, {minutes(myFocus)}</span><span className="them">{partnerName}, {minutes(theirFocus)}</span></div>
        <ol className="seam-days">
          {days.map((d, i) => (
            <li key={d.key} className={d.key === today ? 'is-today' : ''}>
              <span className="seam-up"><span style={{ height: `${(d.mine / peak) * 100}%` }} title={`You: ${minutes(d.mine)}`} /></span>
              <span className="seam-day">{wd.format(week.days[i])}</span>
              <span className="seam-down"><span style={{ height: `${(d.theirs / peak) * 100}%` }} title={`${partnerName}: ${minutes(d.theirs)}`} /></span>
              <span className="sr-only">{wd.format(week.days[i])}: you {minutes(d.mine)}, {partnerName} {minutes(d.theirs)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="week-figures" aria-label="The week in numbers">
        <div><h3>Finished</h3><p className="ledger-big">{mineDone.length} <span className="vs">/ {theirsDone.length}</span></p><p className="ledger-sub">you / {partnerName}</p></div>
        <div><h3>Focus</h3><p className="ledger-big">{minutes(myFocus)}</p><p className="ledger-sub">{partnerName}: {minutes(theirFocus)}</p></div>
        <div><h3>Received</h3>{received === null ? <p className="ledger-sub">Connect to see payments.</p> : received.length === 0 ? <p className="ledger-big">Nothing</p>
          : received.map((r) => <p key={r.currency} className="ledger-big">{formatMoney(r.minor, r.currency)}</p>)}</div>
      </section>

      <div className="week-cols">
        <section aria-labelledby="fin-h">
          <h2 id="fin-h">Finished</h2>
          {finished.length === 0 ? <p className="quiet">Nothing marked done this week yet.</p> : (
            <ul className="week-list">{finished.map((t) => (
              <li key={t.id} className={t.assignee === userId ? 'you' : 'them'}><span className="wl-title">{t.title || 'Untitled'}</span><span className="wl-meta">{who(t.assignee)}, {spaceOf(t.space_id)}</span></li>
            ))}</ul>
          )}
        </section>
        <section aria-labelledby="car-h">
          <h2 id="car-h">Still overdue</h2>
          {carried.length === 0 ? <p className="quiet">Clear. Nothing past its due date.</p> : (
            <ul className="week-list">{carried.map((t) => (
              <li key={t.id} className="late"><button className="wl-btn" onClick={() => onOpenTask(t.space_id, t.id)}><span className="wl-title">{t.title || 'Untitled'}</span>
                <span className="wl-meta">{who(t.assignee)}, due {dShort.format(new Date(t.due_at!))}, {spaceOf(t.space_id)}</span></button></li>
            ))}</ul>
          )}
        </section>
        <section aria-labelledby="next-h">
          <h2 id="next-h">The week after</h2>
          {ahead === null ? <p className="quiet">Connect to see what is coming.</p> : ahead.length === 0 ? <p className="quiet">Nothing due or scheduled yet.</p> : (
            <ul className="week-list">{ahead.slice(0, 12).map((a) => (
              <li key={a.id} className={a.kind}><span className="wl-title">{a.title}</span><span className="wl-meta">{a.kind === 'due' ? 'Due ' : ''}{wdTime.format(a.at)}, {spaceOf(a.space_id)}</span></li>
            ))}</ul>
          )}
        </section>
      </div>

      <Reflection spaces={shared} label={dShort.format(week.days[0])} queue={queue} />
    </div>
  );
}

function Reflection({ spaces, label, queue }: { spaces: Space[]; label: string; queue: (op: Op) => Promise<void> }) {
  const [well, setWell] = useState('');
  const [stuck, setStuck] = useState('');
  const [next, setNext] = useState('');
  const [space, setSpace] = useState(spaces[0]?.id ?? '');
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (!space && spaces[0]) setSpace(spaces[0].id); }, [spaces, space]);
  async function save(e: FormEvent) {
    e.preventDefault();
    const body = [['What went well', well], ['What got stuck', stuck], ['Focus for next week', next]].filter(([, v]) => v.trim()).map(([k, v]) => `${k}:\n${v.trim()}`).join('\n\n');
    if (!body || !space) return;
    await queue({ op_id: crypto.randomUUID(), type: 'create', id: crypto.randomUUID(), space_id: space, kind: 'note', fields: { title: `Week of ${label}: review`, body } });
    setWell(''); setStuck(''); setNext(''); setSaved(true);
  }
  return (
    <form className="reflect" onSubmit={save} aria-labelledby="ref-h">
      <h2 id="ref-h">Talk it through</h2>
      <p className="hint">Fill in any of these together. It is saved as a note in the space you pick, so you can both read it later.</p>
      <div className="reflect-grid">
        <label>What went well<textarea rows={3} value={well} onChange={(e) => { setWell(e.target.value); setSaved(false); }} placeholder="Bright Dental signed off the homepage" /></label>
        <label>What got stuck<textarea rows={3} value={stuck} onChange={(e) => { setStuck(e.target.value); setSaved(false); }} placeholder="Waiting on logo files for four days" /></label>
        <label>Focus for next week<textarea rows={3} value={next} onChange={(e) => { setNext(e.target.value); setSaved(false); }} placeholder="Launch the booking form" /></label>
      </div>
      <div className="row-end">
        {spaces.length > 1 && <label className="inline-pick">Save in<select value={space} onChange={(e) => setSpace(e.target.value)}>{spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
        {saved && <span className="saved-note" role="status">Saved as a note.</span>}
        <button className="primary" disabled={!(well.trim() || stuck.trim() || next.trim())}>Save the review</button>
      </div>
    </form>
  );
}
