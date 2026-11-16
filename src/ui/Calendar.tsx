import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { loadCalendar, loadItems, skipOccurrence, type BusySlot, type CalEvent, type DueTask, type Space } from '../lib/data.ts';
import { withCache } from '../lib/cache.ts';
import { addDays, dayKey, expand, fromWall, startOfDay, wall, type Recur } from '../lib/recur.ts';
import type { Fields, Op } from '../sync/outbox.ts';

type View = 'day' | 'week' | 'month';
type Entry =
  | { kind: 'event'; key: string; start: Date; end: Date; ev: CalEvent; original: string }
  | { kind: 'due'; key: string; start: Date; task: DueTask }
  | { kind: 'busy'; key: string; start: Date; end: Date; who: string; allDay: boolean };

const TZ = 'Africa/Johannesburg';
const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-ZA', { timeZone: TZ, ...o });
const hm = fmt({ hour: '2-digit', minute: '2-digit' });
const dayName = fmt({ weekday: 'short' });
const longDay = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const monthTitle = fmt({ month: 'long', year: 'numeric' });
const shortDay = fmt({ day: 'numeric', month: 'short' });
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type Prefill = { space_id: string; task_id: string | null; title: string } | null;

type Props = {
  userId: string; spaces: Space[]; nameOf: (id: string | null) => string; partnerName: string;
  queue: (op: Op) => Promise<void>; pendingCount: number; online: boolean;
  prefill: Prefill; onPrefillUsed: () => void;
};

function range(view: View, anchor: Date) {
  const w = wall(anchor);
  if (view === 'day') { const s = startOfDay(anchor); return { from: s, to: addDays(s, 1) }; }
  if (view === 'week') { const s = fromWall(w.y, w.m, w.d - ((w.dow + 6) % 7)); return { from: s, to: addDays(s, 7) }; } // Monday start
  const first = fromWall(w.y, w.m, 1), lead = (wall(first).dow + 6) % 7;
  const s = fromWall(w.y, w.m, 1 - lead);
  return { from: s, to: addDays(s, 42) };
}

export function CalendarView({ userId, spaces, nameOf, partnerName, queue, pendingCount, online, prefill, onPrefillUsed }: Props) {
  const [view, setView] = useState<View>(() => (window.matchMedia?.('(max-width: 820px)').matches ? 'week' : 'week'));
  const [anchor, setAnchor] = useState(() => new Date());
  const [data, setData] = useState<Awaited<ReturnType<typeof loadCalendar>> | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState<{ ev?: CalEvent; day?: Date } | null>(null);
  const [open, setOpen] = useState<Extract<Entry, { kind: 'event' }> | null>(null);
  const { from, to } = range(view, anchor);

  const reload = useCallback(async () => {
    try {
      setData((await withCache(userId, `cal:${from.toISOString()}:${to.toISOString()}`, () => loadCalendar(from, to))).value);
      setError('');
    } catch {
      setError(online ? 'Could not load the calendar.' : 'This range has not been opened on this device before, so there is no offline copy yet.');
    }
  }, [userId, from.getTime(), to.getTime(), online]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload, pendingCount]);
  useEffect(() => { if (prefill) setForm({}); }, [prefill]);

  const shared = spaces.filter((s) => s.visibility === 'shared');
  const spaceName = (id: string) => shared.find((s) => s.id === id)?.name ?? '';

  const entries = useMemo<Entry[]>(() => {
    if (!data) return [];
    const skips = new Map<string, Set<number>>();
    for (const s of data.skips) { const set = skips.get(s.item_id) ?? new Set(); set.add(new Date(s.occurrence_start).getTime()); skips.set(s.item_id, set); }
    const out: Entry[] = [];
    for (const ev of data.events) for (const o of expand(ev, from, to, skips.get(ev.id))) out.push({ kind: 'event', key: `${ev.id}:${o.original}`, start: o.start, end: o.end, ev, original: o.original });
    for (const t of data.due) out.push({ kind: 'due', key: `due:${t.id}`, start: new Date(t.due_at), task: t });
    for (const b of data.busy as BusySlot[]) {
      for (const o of expand({ id: b.user_id, starts_at: b.starts_at, ends_at: b.ends_at, all_day: b.all_day, recur: b.recur }, from, to)) {
        if (b.user_id !== userId) out.push({ kind: 'busy', key: `busy:${o.original}:${b.user_id}`, start: o.start, end: o.end, who: nameOf(b.user_id), allDay: b.all_day });
      }
    }
    return out.sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [data, from.getTime(), to.getTime(), userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const byDay = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of entries) {
      // multi-day events appear on each day they cover
      const last = e.kind === 'due' ? e.start : new Date(Math.max(e.start.getTime(), e.end.getTime() - 1));
      for (let d = startOfDay(e.start); d <= last; d = addDays(d, 1)) { const k = dayKey(d); m.set(k, [...(m.get(k) ?? []), e]); }
    }
    return m;
  }, [entries]);

  const step = (n: number) => setAnchor((a) => (view === 'day' ? addDays(a, n) : view === 'week' ? addDays(a, 7 * n) : fromWall(wall(a).y, wall(a).m + n, 1)));
  const title = view === 'month' ? monthTitle.format(anchor) : view === 'week' ? `${shortDay.format(from)} to ${shortDay.format(addDays(to, -1))}` : longDay.format(anchor);
  const days = Array.from({ length: Math.round((to.getTime() - from.getTime()) / 86_400_000) }, (_, i) => addDays(from, i));
  const today = dayKey(new Date());

  return (
    <section className="calendar" aria-label="Calendar">
      <div className="cal-head">
        <h1 className="cal-title">{title}</h1>
        <div className="cal-nav">
          <button className="ghost" aria-label="Previous" onClick={() => step(-1)}>‹</button>
          <button className="ghost" onClick={() => setAnchor(new Date())}>Today</button>
          <button className="ghost" aria-label="Next" onClick={() => step(1)}>›</button>
        </div>
        <div className="kind-toggle" role="radiogroup" aria-label="View">
          {(['day', 'week', 'month'] as View[]).map((v) => <button key={v} role="radio" aria-checked={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}
        </div>
        <button className="primary" onClick={() => setForm({ day: view === 'day' ? anchor : new Date() })}>New event</button>
      </div>
      <p className="cal-legend">
        <span className="lg lg-event">Events</span><span className="lg lg-due">Deadlines</span><span className="lg lg-busy">{partnerName} busy (private, times only)</span>
      </p>
      {error && <p className="field-error" role="alert">{error}</p>}

      {view === 'month' ? (
        <div className="month" role="grid" aria-label={title}>
          {WEEKDAYS.slice(1).concat('Sun').map((d) => <div key={d} className="month-dow" role="columnheader">{d}</div>)}
          {days.map((d) => {
            const k = dayKey(d), list = byDay.get(k) ?? [], inMonth = wall(d).m === wall(anchor).m;
            return (
              <button key={k} role="gridcell" className={`month-cell${inMonth ? '' : ' out'}${k === today ? ' today' : ''}`}
                aria-label={`${longDay.format(d)}, ${list.length} items`} onClick={() => { setAnchor(d); setView('day'); }}>
                <span className="month-num">{wall(d).d}</span>
                {list.slice(0, 3).map((e) => <span key={e.key} className={`chip-${e.kind}`}>{label(e)}</span>)}
                {list.length > 3 && <span className="more">{list.length - 3} more</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className={view === 'week' ? 'week' : 'dayview'}>
          {days.map((d) => {
            const k = dayKey(d), list = byDay.get(k) ?? [];
            return (
              <section key={k} className={`week-day${k === today ? ' today' : ''}`} aria-label={longDay.format(d)}>
                {view === 'week' && <button className="week-head" onClick={() => { setAnchor(d); setView('day'); }}><span>{dayName.format(d)}</span><b>{wall(d).d}</b></button>}
                {list.length === 0 ? <p className="quiet empty-day">{view === 'day' ? 'Nothing planned.' : ''}</p> : (
                  <ul className="agenda">
                    {list.map((e) => (
                      <li key={e.key} className={`ag ag-${e.kind}`}>
                        {e.kind === 'event' ? (
                          <button className="ag-btn" onClick={() => setOpen(e)}>
                            <span className="ag-time">{e.ev.all_day ? 'All day' : `${hm.format(e.start)} to ${hm.format(e.end)}`}</span>
                            <span className="ag-title">{e.ev.title || 'Untitled'}{e.ev.recur ? <span className="ag-rep" title="Repeats"> ↻</span> : null}</span>
                            <span className="ag-sub">{spaceName(e.ev.space_id)}{e.ev.task_id ? ', work time for a task' : ''}</span>
                          </button>
                        ) : e.kind === 'due' ? (
                          <div className="ag-static">
                            <span className="ag-time">Due {hm.format(e.start)}</span>
                            <span className="ag-title">{e.task.title || 'Untitled task'}</span>
                            <span className="ag-sub">{nameOf(e.task.assignee)}{e.task.status === 'done' ? ', done' : ''}</span>
                          </div>
                        ) : (
                          <div className="ag-static">
                            <span className="ag-time">{e.allDay ? 'All day' : `${hm.format(e.start)} to ${hm.format(e.end)}`}</span>
                            <span className="ag-title">{e.who} is busy</span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {open && (
        <EventPanel entry={open} spaceName={spaceName} nameOf={nameOf} onClose={() => setOpen(null)}
          onEdit={() => { setForm({ ev: open.ev }); setOpen(null); }}
          onSkip={async () => { await skipOccurrence(open.ev.id, open.original, userId); setOpen(null); await reload(); }} />
      )}
      {form && (
        <EventForm spaces={shared} userId={userId} existing={form.ev} day={form.day} prefill={prefill}
          onClose={() => { setForm(null); onPrefillUsed(); }}
          onSave={async (op) => { await queue(op); setForm(null); onPrefillUsed(); await reload(); }} />
      )}
    </section>
  );
}

function label(e: Entry) {
  if (e.kind === 'event') return `${e.ev.all_day ? '' : `${hm.format(e.start)} `}${e.ev.title || 'Untitled'}`;
  if (e.kind === 'due') return `Due: ${e.task.title || 'task'}`;
  return `${e.who} busy`;
}

function describe(r: Recur) {
  const every = (r.interval ?? 1) > 1 ? `every ${r.interval} ` : 'every ';
  const unit = r.freq === 'daily' ? 'day' : r.freq === 'weekly' ? 'week' : 'month';
  const days = r.freq === 'weekly' && r.byweekday?.length ? ` on ${r.byweekday.map((d) => WEEKDAYS[d]).join(', ')}` : '';
  return `Repeats ${every}${unit}${(r.interval ?? 1) > 1 ? 's' : ''}${days}${r.until ? `, until ${r.until}` : ''}`;
}

function EventPanel({ entry, spaceName, nameOf, onClose, onEdit, onSkip }: {
  entry: Extract<Entry, { kind: 'event' }>; spaceName: (id: string) => string; nameOf: (id: string | null) => string;
  onClose: () => void; onEdit: () => void; onSkip: () => Promise<void>;
}) {
  const ev = entry.ev;
  const [error, setError] = useState('');
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <aside className="drawer" aria-label={ev.title || 'Event'}>
        <div className="drawer-head"><h2>{ev.title || 'Untitled'}</h2><button className="ghost close" aria-label="Close" onClick={onClose}>✕</button></div>
        <p className="ev-when">{longDay.format(entry.start)}{ev.all_day ? ', all day' : `, ${hm.format(entry.start)} to ${hm.format(entry.end)}`}</p>
        {ev.recur && <p className="quiet">{describe(ev.recur)}</p>}
        <p className="quiet">{spaceName(ev.space_id)}. Added by {nameOf(ev.created_by)}.</p>
        {ev.task_id && <p className="hint">This is work time for a task. Moving it does not change the task's deadline.</p>}
        {ev.body && <p className="instructions">{ev.body}</p>}
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="row-start">
          <button className="primary" onClick={onEdit}>{ev.recur ? 'Edit the whole series' : 'Edit'}</button>
          {ev.recur && <button onClick={() => onSkip().catch((e) => setError(navigator.onLine ? String(e) : 'Skipping needs a connection.'))}>Skip this one</button>}
        </div>
      </aside>
    </>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateInput = (d: Date) => dayKey(d);
const timeInput = (d: Date) => { const w = wall(d); return `${pad(w.h)}:${pad(w.mi)}`; };
const toInstant = (date: string, time: string) => fromWall(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +time.slice(0, 2), +time.slice(3, 5));

function EventForm({ spaces, existing, day, prefill, onSave, onClose }: {
  spaces: Space[]; userId: string; existing?: CalEvent; day?: Date; prefill: Prefill; onSave: (op: Op) => Promise<void>; onClose: () => void;
}) {
  const s0 = existing ? new Date(existing.starts_at) : (() => { const d = day ?? new Date(); const w = wall(d); return fromWall(w.y, w.m, w.d, Math.min(w.h + 1, 22), 0); })();
  const e0 = existing ? new Date(existing.ends_at) : new Date(s0.getTime() + 3600_000);
  const [title, setTitle] = useState(existing?.title ?? prefill?.title ?? '');
  const [spaceId, setSpaceId] = useState(existing?.space_id ?? prefill?.space_id ?? spaces[0]?.id ?? '');
  const [allDay, setAllDay] = useState(existing?.all_day ?? false);
  const [date, setDate] = useState(dateInput(s0));
  const [endDate, setEndDate] = useState(dateInput(existing?.all_day ? addDays(e0, -1) : e0));
  const [start, setStart] = useState(timeInput(s0));
  const [end, setEnd] = useState(timeInput(e0));
  const [freq, setFreq] = useState<'' | Recur['freq']>(existing?.recur?.freq ?? '');
  const [days, setDays] = useState<number[]>(existing?.recur?.byweekday ?? []);
  const [until, setUntil] = useState(existing?.recur?.until ?? '');
  const [taskId, setTaskId] = useState<string>(existing?.task_id ?? prefill?.task_id ?? '');
  const [tasks, setTasks] = useState<{ id: string; title: string | null }[]>([]);
  const [error, setError] = useState('');

  useEffect(() => { if (spaceId) loadItems(spaceId).then((r) => setTasks(r.filter((i) => i.kind === 'task'))).catch(() => setTasks([])); }, [spaceId]);

  const s = allDay ? toInstant(date, '00:00') : toInstant(date, start);
  const e = allDay ? addDays(toInstant(endDate || date, '00:00'), 1) : toInstant(date, end);
  const invalid = e <= s;

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (invalid) return;
    const recur: Recur | null = freq ? { freq, ...(freq === 'weekly' && days.length ? { byweekday: [...days].sort() } : {}), ...(until ? { until } : {}) } : null;
    const fields: Fields = { title: title.trim(), starts_at: s.toISOString(), ends_at: e.toISOString(), all_day: allDay, recur, task_id: taskId || null };
    try {
      await onSave(existing
        ? { op_id: crypto.randomUUID(), type: 'update', id: existing.id, base_version: existing.version, fields }
        : { op_id: crypto.randomUUID(), type: 'create', id: crypto.randomUUID(), space_id: spaceId, kind: 'event', fields });
    } catch (err) { setError(String(err)); }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <aside className="drawer" aria-label={existing ? 'Edit event' : 'New event'}>
        <div className="drawer-head"><h2>{existing ? 'Edit event' : prefill?.task_id ? 'Schedule work time' : 'New event'}</h2><button className="ghost close" aria-label="Close" onClick={onClose}>✕</button></div>
        <form className="panel-form" onSubmit={submit}>
          <label>What<input autoFocus required value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder="Client call, site visit, study block" /></label>
          {!existing && (
            <label>Space<select value={spaceId} onChange={(ev) => setSpaceId(ev.target.value)}>{spaces.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}</select></label>
          )}
          <label className="check"><input type="checkbox" checked={allDay} onChange={(ev) => setAllDay(ev.target.checked)} /> All day</label>
          <div className="grid-2">
            <label>{allDay ? 'From' : 'Date'}<input type="date" required value={date} onChange={(ev) => setDate(ev.target.value)} /></label>
            {allDay ? <label>To<input type="date" value={endDate} min={date} onChange={(ev) => setEndDate(ev.target.value)} /></label> : (
              <div className="grid-2 tight">
                <label>Starts<input type="time" required value={start} onChange={(ev) => setStart(ev.target.value)} /></label>
                <label>Ends<input type="time" required value={end} onChange={(ev) => setEnd(ev.target.value)} /></label>
              </div>
            )}
          </div>
          {invalid && <p className="field-error">The end has to be after the start.</p>}
          <label>Repeats<select value={freq} onChange={(ev) => setFreq(ev.target.value as typeof freq)}>
            <option value="">Does not repeat</option><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month (same date; month-end when shorter)</option>
          </select></label>
          {freq === 'weekly' && (
            <div className="who" role="group" aria-label="On these days">
              {WEEKDAYS.map((d, i) => <button type="button" key={d} aria-pressed={days.includes(i)} className={days.includes(i) ? 'on any' : ''} onClick={() => setDays((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i]))}>{d}</button>)}
            </div>
          )}
          {freq && <label>Until (optional)<input type="date" value={until} min={date} onChange={(ev) => setUntil(ev.target.value)} /></label>}
          <label>Work time for a task (optional)<select value={taskId} onChange={(ev) => setTaskId(ev.target.value)}>
            <option value="">Not linked</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.title || 'Untitled'}</option>)}
          </select></label>
          {taskId && <p className="hint">The task keeps its own deadline. This only blocks out time to work on it.</p>}
          <p className="hint">Times are Johannesburg time.{existing?.recur ? ' Changes apply to the whole series; past occurrences stay as they were shown.' : ''}</p>
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="row-end"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary" disabled={invalid}>Save</button></div>
        </form>
      </aside>
    </>
  );
}
