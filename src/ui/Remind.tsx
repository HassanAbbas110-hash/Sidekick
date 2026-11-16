import { useState } from 'react';
import { presets, localInput, fromLocalInput } from '../lib/reminders.ts';
import type { Reminder } from '../lib/data.ts';

const at = new Intl.DateTimeFormat('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' });
export const reminderTime = (iso: string) => at.format(new Date(iso));

/** "Remind me" on a task: quick picks, or an exact time, plus an optional note. Reminders are only for you. */
export function RemindControl({ due, current, allowNote = true, onSet, onCancel }: {
  due: string | null; current?: Reminder; allowNote?: boolean;
  onSet: (at: Date, note: string | null) => Promise<void>; onCancel: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(() => localInput(new Date(Date.now() + 3600_000)));
  const [note, setNote] = useState(current?.note ?? '');
  const [error, setError] = useState('');
  const choose = async (d: Date | null) => {
    if (!d || d.getTime() < Date.now() + 30_000) return setError('Pick a time in the future.');
    setError('');
    await onSet(d, allowNote && note.trim() ? note.trim() : null);
    setOpen(false);
  };

  if (!open) return (
    <div className="remind-line">
      {current ? <>
        <span className="remind-set"><BellSmall />Reminder {reminderTime(current.remind_at)}{current.pending ? ' (saving)' : ''}</span>
        <button className="ghost small-btn" onClick={() => setOpen(true)}>Change</button>
        <button className="ghost small-btn" onClick={() => onCancel()}>Cancel reminder</button>
      </> : <button className="ghost small-btn remind-btn" onClick={() => setOpen(true)}><BellSmall />Remind me</button>}
    </div>
  );
  return (
    <div className="remind-pop" role="group" aria-label="Remind me">
      <div className="remind-chips">
        {presets(new Date(), due ? new Date(due) : null).map((p) => <button key={p.label} type="button" onClick={() => choose(p.at)}>{p.label}</button>)}
      </div>
      <div className="remind-custom">
        <label>Or pick a time<input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} /></label>
        <button type="button" className="primary" onClick={() => choose(fromLocalInput(custom))}>Set</button>
      </div>
      {allowNote && <label>Note to yourself (optional)<input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Ask about the deposit" /></label>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <p className="hint">Only you get this reminder, on your phone and in your inbox. Tasks with a due date also remind whoever owns them an hour before.</p>
      <div className="row-end"><button type="button" className="ghost" onClick={() => setOpen(false)}>Close</button></div>
    </div>
  );
}

export function BellSmall() {
  return <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden className="icon"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></svg>;
}
