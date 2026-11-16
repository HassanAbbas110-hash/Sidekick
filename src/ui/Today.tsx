import { useEffect, useMemo, useState } from 'react';
import { loadBalances, loadCalendar, loadClients, loadFocusSummaries, loadItems, reveal, type Balance, type CalEvent, type BusySlot, type Item, type Space, type FocusSummary } from '../lib/data.ts';
import { withCache } from '../lib/cache.ts';
import { addDays, dayKey, expand, startOfDay } from '../lib/recur.ts';
import { greeting, plan, ribbonPos, RIBBON, type Planned } from '../lib/today.ts';
import { formatMoney } from '../lib/money.ts';
import { minutes, type Timer } from '../lib/focus.ts';

const TZ = 'Africa/Johannesburg';
const dayLine = new Intl.DateTimeFormat('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const hm = new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const shortDay = new Intl.DateTimeFormat('en-ZA', { weekday: 'short', timeZone: TZ });
const WHY: Record<Planned['why'], string> = { overdue: 'Overdue', today: 'Today', doing: 'In progress', soon: 'Coming up' };

type Slot = { key: string; title: string; start: Date; end: Date; allDay: boolean; mine: boolean; space?: string };
type Totals = { currency: string; outstanding: number; overdue: number };

/** The first screen: what today asks of you, across every shared space. */
export function TodayView({ userId, name, partnerId, partnerName, spaces, privateKey, timer, refreshKey, onOpenTask, onOpenCalendar, onFocus }: {
  userId: string; name: string; partnerId: string | null; partnerName: string; spaces: Space[]; privateKey: CryptoKey | null; timer: Timer | null;
  refreshKey: number; onOpenTask: (spaceId: string, id: string) => void; onOpenCalendar: () => void; onFocus: () => void;
}) {
  const shared = spaces.filter((s) => s.visibility === 'shared');
  const sharedKey = shared.map((s) => s.id).join();
  const [items, setItems] = useState<Item[]>([]);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [money, setMoney] = useState<Totals[] | null>(null);
  const [focus, setFocus] = useState<FocusSummary[]>([]);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);

  useEffect(() => {
    let alive = true;
    const day0 = startOfDay(new Date()), day1 = addDays(day0, 1);
    (async () => {
      const all = (await Promise.all(shared.map((s) => withCache(userId, `items:${s.id}`, () => loadItems(s.id)).then((r) => r.value).catch(() => [] as Item[])))).flat();
      if (alive) setItems(all);

      const cal = await withCache(userId, `today:${dayKey(day0)}`, () => loadCalendar(day0, day1)).then((r) => r.value).catch(() => null);
      if (cal && alive) {
        const skips = new Map<string, Set<number>>();
        for (const s of cal.skips) { const set = skips.get(s.item_id) ?? new Set<number>(); set.add(new Date(s.occurrence_start).getTime()); skips.set(s.item_id, set); }
        const out: Slot[] = [];
        for (const ev of cal.events as CalEvent[]) {
          const title = ev.title?.startsWith('enc1:') ? (await reveal(privateKey, ev.title, ev.id, 'title')) ?? 'Private' : ev.title || 'Untitled';
          for (const o of expand(ev, day0, day1, skips.get(ev.id))) out.push({ key: `${ev.id}:${o.original}`, title, start: o.start, end: o.end, allDay: ev.all_day, mine: true, space: shared.find((s) => s.id === ev.space_id)?.name });
        }
        for (const b of cal.busy as BusySlot[]) if (b.user_id !== userId)
          for (const o of expand({ id: b.user_id, starts_at: b.starts_at, ends_at: b.ends_at, all_day: b.all_day, recur: b.recur }, day0, day1))
            out.push({ key: `busy:${o.original}`, title: `${partnerName} busy`, start: o.start, end: o.end, allDay: b.all_day, mine: false });
        if (alive) setSlots(out.sort((a, b) => a.start.getTime() - b.start.getTime()));
      } else if (alive) setSlots([]);

      try {
        const totals = new Map<string, Totals>();
        for (const s of shared) {
          const clients = (await withCache(userId, `clients:${s.id}`, () => loadClients(s.id))).value;
          const bal = (await withCache(userId, `balances:${s.id}`, () => loadBalances(clients.map((c) => c.id)))).value as Balance[];
          for (const b of bal) {
            const t = totals.get(b.currency) ?? { currency: b.currency, outstanding: 0, overdue: 0 };
            t.outstanding += b.outstanding_minor; t.overdue += b.overdue_minor; totals.set(b.currency, t);
          }
        }
        if (alive) setMoney([...totals.values()].filter((t) => t.outstanding > 0));
      } catch { if (alive) setMoney(null); }

      const d = dayKey(day0);
      const f = await loadFocusSummaries(d, d).catch(() => [] as FocusSummary[]);
      if (alive) setFocus(f);
    })();
    return () => { alive = false; };
  }, [userId, sharedKey, refreshKey, privateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const plate = useMemo(() => plan(items, userId, now), [items, userId, now]);
  const waitingOnThem = items.filter((i) => i.kind === 'task' && i.status !== 'done' && i.assignee === partnerId).length;
  const unclaimed = items.filter((i) => i.kind === 'task' && i.status !== 'done' && !i.assignee).length;
  const late = plate.filter((p) => p.why === 'overdue').length;
  const timed = (slots ?? []).filter((s) => !s.allDay);
  const allDay = (slots ?? []).filter((s) => s.allDay);
  const next = timed.find((s) => s.end > now && s.mine);
  const myFocus = focus.find((f) => f.user_id === userId);
  const theirFocus = focus.find((f) => f.user_id !== userId);
  const spaceOf = (id: string) => shared.find((s) => s.id === id)?.name ?? '';

  const lines: string[] = [];
  lines.push(plate.length ? `${plate.length} thing${plate.length === 1 ? '' : 's'} on your plate${late ? `, ${late} overdue` : ''}.` : 'Nothing pressing on your plate.');
  if (next) lines.push(next.start <= now ? `${next.title} is on now.` : `Next up: ${next.title} at ${hm.format(next.start)}.`);
  else if (slots && timed.length === 0) lines.push('Your calendar is clear today.');

  // ribbon lanes: overlapping blocks stack instead of hiding each other
  const laneEnds: number[] = [];
  const placed = timed.map((s) => {
    let lane = laneEnds.findIndex((e) => e <= s.start.getTime());
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = s.end.getTime();
    return { s, lane };
  });
  const hours = Array.from({ length: RIBBON.to - RIBBON.from + 1 }, (_, i) => RIBBON.from + i).filter((h) => h % 3 === 0);

  return (
    <div className="today">
      <section className="today-hero">
        <p className="date">{dayLine.format(now)}</p>
        <h1>{greeting(now)},<br /><span className="today-name">{name}.</span></h1>
        <p className="summary">{lines.join(' ')}</p>
      </section>

      <section className="ribbon-wrap" aria-label="Today's calendar">
        <div className="ribbon" style={{ height: `${Math.max(1, laneEnds.length) * 34 + 30}px` }}>
          {hours.map((h) => (
            <span key={h} className="ribbon-hour" style={{ left: `${((h - RIBBON.from) / (RIBBON.to - RIBBON.from)) * 100}%` }}>{String(h).padStart(2, '0')}</span>
          ))}
          {placed.map(({ s, lane }) => {
            const l = ribbonPos(s.start), r = ribbonPos(s.end);
            return (
              <span key={s.key} className={`ribbon-block${s.mine ? '' : ' busy'}`} title={`${s.title}, ${hm.format(s.start)} to ${hm.format(s.end)}`}
                style={{ left: `${l * 100}%`, width: `max(6px, ${(r - l) * 100}%)`, top: `${lane * 34 + 26}px` }}>
                <span className="ribbon-label">{s.title}</span>
              </span>
            );
          })}
          <span className={`ribbon-now${ribbonPos(now) > 0.85 ? ' flip' : ''}`} style={{ left: `${ribbonPos(now) * 100}%` }} aria-hidden><span>{hm.format(now)}</span></span>
        </div>
        <div className="ribbon-list">
          {slots === null ? <p className="quiet">Loading your day…</p> : slots.length === 0 ? <p className="quiet">No events today.</p> : (
            <ul>
              {allDay.map((s) => <li key={s.key} className={s.mine ? '' : 'busy'}><span className="rl-time">All day</span><span>{s.title}</span>{s.space && <span className="rl-space">{s.space}</span>}</li>)}
              {timed.map((s) => (
                <li key={s.key} className={`${s.mine ? '' : 'busy'}${s.end <= now ? ' past' : s.start <= now ? ' now' : ''}`}>
                  <span className="rl-time">{hm.format(s.start)}</span><span>{s.title}</span>{s.space && <span className="rl-space">{s.space}</span>}
                </li>
              ))}
            </ul>
          )}
          <button className="ghost small-btn" onClick={onOpenCalendar}>Open calendar</button>
        </div>
      </section>

      <div className="today-grid">
        <section className="plate" aria-labelledby="plate-h">
          <h2 id="plate-h">On your plate</h2>
          {plate.length === 0 ? (
            <p className="quiet plate-empty">Nothing overdue, due soon or in progress for you. {unclaimed ? `${unclaimed} unclaimed task${unclaimed === 1 ? ' is' : 's are'} waiting in your spaces.` : 'Enjoy the space.'}</p>
          ) : (
            <ol className="plate-list">
              {plate.map((p) => (
                <li key={p.id}>
                  <button className={`plate-item why-${p.why}`} onClick={() => onOpenTask(p.space_id, p.id)}>
                    <span className="mono" aria-hidden>{spaceOf(p.space_id).trim().charAt(0).toUpperCase()}</span>
                    <span className="plate-text">
                      <span className="plate-title">{p.title || 'Untitled'}</span>
                      <span className="plate-meta">{WHY[p.why]}{p.due_at ? `, ${p.why === 'soon' ? shortDay.format(new Date(p.due_at)) + ' ' : ''}${hm.format(new Date(p.due_at))}` : ''} in {spaceOf(p.space_id)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="ledger" aria-label="At a glance">
          <div className="ledger-row">
            <h3>Focus today</h3>
            <p className="ledger-big">{myFocus ? minutes(myFocus.measured_seconds) : '0 min'}</p>
            <p className="ledger-sub">{theirFocus ? `${partnerName}: ${minutes(theirFocus.measured_seconds)}${theirFocus.running ? ', focusing now' : ''}` : `${partnerName} has not focused yet today.`}</p>
            <button className={timer ? '' : 'primary'} onClick={onFocus}>{timer ? 'Show the timer' : 'Start focusing'}</button>
          </div>
          <div className="ledger-row">
            <h3>Owed to you</h3>
            {money === null ? <p className="ledger-sub">Connect to see balances.</p> : money.length === 0 ? <p className="ledger-big">All paid</p> : money.map((m) => (
              <div key={m.currency}>
                <p className="ledger-big">{formatMoney(m.outstanding, m.currency)}</p>
                {m.overdue > 0 && <p className="ledger-sub late">{formatMoney(m.overdue, m.currency)} of it overdue</p>}
              </div>
            ))}
          </div>
          <div className="ledger-row">
            <h3>With {partnerName}</h3>
            <p className="ledger-big">{waitingOnThem}</p>
            <p className="ledger-sub">open task{waitingOnThem === 1 ? '' : 's'} on their side{unclaimed ? `, ${unclaimed} unclaimed` : ''}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
