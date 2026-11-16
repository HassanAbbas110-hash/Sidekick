import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { loadFocusSummaries, loadMySessions, type FocusSession, type FocusSummary } from '../lib/data.ts';
import { clock, clockDown, cyclePhase, elapsedMs, looksForgotten, minutes, pause, remainingMs, resume, saveTimer, stopPoint, type Timer } from '../lib/focus.ts';
import { clearTimerAlarms, scheduleTimerAlarms } from '../lib/alarms.ts';
import { dayKey, startOfDay } from '../lib/recur.ts';
import type { Op } from '../sync/outbox.ts';

/** Re-render on every real second change. A plain 1 s interval drifts and skips seconds; this checks 4x a second
 * and also catches up the moment the app comes back to the foreground. */
function useTick(active: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    let last = -1;
    const check = () => { const s = Math.floor(Date.now() / 1000); if (s !== last) { last = s; set(s); } };
    const t = setInterval(check, 250);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); };
  }, [active]);
}

/** A soft two-note chime, made on the spot (no sound file, works offline). */
function chime() {
  try {
    const ac = new AudioContext();
    [659.25, 987.77].forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * 0.18;
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 1.3);
    });
    setTimeout(() => ac.close(), 2000);
  } catch { /* no audio available */ }
}

/** Which stage the timer is in; a change means a countdown finished or a cycle switched. */
const stageOf = (t: Timer | null) => !t || t.paused_at || t.mode === 'stopwatch' ? null
  : t.mode === 'countdown' ? (remainingMs(t) === 0 ? 'done' : 'run') : `${cyclePhase(t).phase}-${cyclePhase(t).blocksDone}`;

/** The running timer lives in the top bar so it is visible from every screen. */
export function FocusPill({ timer, onOpen }: { timer: Timer | null; onOpen: () => void }) {
  useTick(Boolean(timer));
  const stage = stageOf(timer);
  const prev = useRef<{ id?: string; stage: string | null }>({ stage: null });
  useEffect(() => {
    if (prev.current.id === timer?.id && prev.current.stage && stage && stage !== prev.current.stage) chime();
    prev.current = { id: timer?.id, stage };
  }, [stage, timer?.id]);
  if (!timer) return <button className="ghost focus-btn" onClick={onOpen} aria-label="Focus timer"><span className="focus-ring" aria-hidden />Focus</button>;
  const text = timer.mode === 'countdown' ? clockDown(remainingMs(timer)) : timer.mode === 'cycle' ? `${cyclePhase(timer).phase === 'focus' ? 'Focus' : 'Break'} ${clockDown(cyclePhase(timer).leftMs)}` : clock(elapsedMs(timer));
  return (
    <button className={`focus-pill${timer.paused_at ? ' paused' : ''}`} onClick={onOpen} aria-label={`Focus timer ${timer.paused_at ? 'paused' : 'running'}, ${text}`}>
      <span className="focus-dot" aria-hidden />{text}
    </button>
  );
}

type Props = {
  userId: string; timer: Timer | null; setTimer: (t: Timer | null) => void; queue: (op: Op) => Promise<void>;
  nameOf: (id: string | null) => string; tasks: { id: string; title: string | null }[]; onClose: () => void; online: boolean;
};

export function FocusPanel({ userId, timer, setTimer, queue, nameOf, tasks, onClose, online }: Props) {
  useTick(Boolean(timer));
  const [summaries, setSummaries] = useState<FocusSummary[]>([]);
  const [mine, setMine] = useState<FocusSession[]>([]);
  const [ending, setEnding] = useState(false);

  const reload = useCallback(async () => {
    if (!navigator.onLine) return;
    const today = dayKey(new Date());
    setSummaries(await loadFocusSummaries(today, today).catch(() => []));
    setMine(await loadMySessions(startOfDay(new Date()).toISOString()).catch(() => []));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const update = (t: Timer | null) => { setTimer(t); saveTimer(userId, t); if (t) scheduleTimerAlarms(t); else clearTimerAlarms(); };

  async function start(mode: Timer['mode'], planned: number | null, brk: number | null, label: string, task: string | null) {
    const t: Timer = { id: crypto.randomUUID(), mode, started_at: Date.now(), paused_at: null, paused_ms: 0, planned_seconds: planned, break_seconds: brk, label, task_id: task };
    update(t);
    await queue({ op_id: crypto.randomUUID(), type: 'call', fn: 'start_focus', label: 'Focus session started',
      args: { p_id: t.id, p_mode: mode, p_planned: planned, p_started_at: new Date(t.started_at).toISOString(), p_task: task } });
  }

  async function stop(completed: boolean) {
    if (!timer) return;
    const end = stopPoint(timer);
    update(null);
    setEnding(false);
    await queue({ op_id: crypto.randomUUID(), type: 'call', fn: 'end_focus', label: 'Focus session ended',
      args: { p_id: timer.id, p_ended_at: new Date(end.ended_at).toISOString(), p_paused_seconds: end.paused_seconds, p_completed: completed } });
    await reload();
  }

  const me = summaries.find((s) => s.user_id === userId);
  const others = summaries.filter((s) => s.user_id !== userId);

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <aside className="drawer focus-drawer" aria-label="Focus timer">
        <div className="drawer-head"><h2>Focus</h2><button className="ghost close" aria-label="Close" onClick={onClose}>✕</button></div>

        {timer ? <Running timer={timer} ending={ending} setEnding={setEnding}
          onPause={() => update(pause(timer))} onResume={() => update(resume(timer))} onStop={stop} /> : <StartForm tasks={tasks} onStart={start} />}

        <section className="focus-today" aria-label="Today">
          <h3 className="drawer-sub">Today</h3>
          <p>{me ? <>You: <b>{minutes(me.measured_seconds)}</b> measured, {me.sessions} session{me.sessions === 1 ? '' : 's'}, {me.completed} marked complete{me.adjusted_seconds ? `, plus ${minutes(me.adjusted_seconds)} added by hand` : ''}.</> : 'You have no sessions yet today.'}</p>
          {others.map((o) => (
            <p key={o.user_id}>{nameOf(o.user_id)}: <b>{minutes(o.measured_seconds)}</b>, {o.sessions} session{o.sessions === 1 ? '' : 's'}, {o.completed} complete{o.running ? ', focusing now' : ''}.</p>
          ))}
          <p className="hint">Your partner sees only these totals and whether sessions were marked complete. What you were working on stays on this device. A running timer is not proof of work; it is a tool for you.</p>
          {!online && <p className="hint">Offline: totals update after you reconnect. The timer itself keeps running.</p>}
        </section>

        {mine.filter((s) => s.ended_at).length > 0 && (
          <section aria-label="Your sessions today">
            <h3 className="drawer-sub">Your sessions</h3>
            <ul className="versions">{mine.filter((s) => s.ended_at).map((s) => <SessionRow key={s.id} s={s} onAdjust={async (secs, reason) => {
              await queue({ op_id: crypto.randomUUID(), type: 'call', fn: 'adjust_focus', label: 'Focus time corrected', args: { p_id: s.id, p_adjust_seconds: secs, p_reason: reason } });
              await reload();
            }} />)}</ul>
          </section>
        )}
      </aside>
    </>
  );
}

function Running({ timer, ending, setEnding, onPause, onResume, onStop }: {
  timer: Timer; ending: boolean; setEnding: (b: boolean) => void; onPause: () => void; onResume: () => void; onStop: (completed: boolean) => Promise<void>;
}) {
  const phase = timer.mode === 'cycle' ? cyclePhase(timer) : null;
  const total = timer.mode === 'countdown' ? (timer.planned_seconds ?? 1) * 1000 : phase ? ((phase.phase === 'focus' ? timer.planned_seconds : timer.break_seconds) ?? 1) * 1000 : 0;
  const left = timer.mode === 'countdown' ? remainingMs(timer) : phase?.leftMs ?? 0;
  const progress = total ? 1 - left / total : (elapsedMs(timer) % 3600_000) / 3600_000;
  const big = timer.mode === 'stopwatch' ? clock(elapsedMs(timer)) : clockDown(left);
  const done = timer.mode === 'countdown' && left === 0;
  const R = 92, C = 2 * Math.PI * R;
  return (
    <div className="running">
      {/* the ring: gold fills as the block runs; it turns ivory on breaks */}
      <svg className={`dial${phase?.phase === 'break' ? ' on-break' : ''}`} viewBox="0 0 220 220" aria-hidden>
        <circle cx="110" cy="110" r={R} className="dial-track" />
        <circle cx="110" cy="110" r={R} className="dial-fill" strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, Math.max(0, progress)))} />
      </svg>
      <div className="dial-text" role="timer" aria-live="off">
        <span className="dial-big">{done ? 'Done' : big}</span>
        <span className="dial-sub">{timer.paused_at ? 'Paused' : phase ? `${phase.phase === 'focus' ? 'Focus' : 'Break'}, ${phase.blocksDone} block${phase.blocksDone === 1 ? '' : 's'} done` : timer.mode === 'countdown' ? `of ${minutes(timer.planned_seconds ?? 0)}` : 'Stopwatch'}</span>
        {timer.label && <span className="dial-label">{timer.label}</span>}
      </div>
      {looksForgotten(timer) && <p className="field-error">This has been running for over 12 hours. If you forgot to stop it, stop it now and correct the time afterwards.</p>}
      {timer.mode !== 'stopwatch' && !timer.paused_at && !done && <p className="hint">{timer.mode === 'cycle' ? 'Alarms are set on this phone for each switch between focus and break' : 'An alarm is set on this phone for the end'}, even if Sidekick is closed (Android app only).</p>}
      {ending ? (
        <div className="ending">
          <p><b>Did you finish what you set out to do?</b> This is your own answer; the timer cannot know.</p>
          <div className="row-start"><button className="primary" onClick={() => onStop(true)}>Yes, mark complete</button><button onClick={() => onStop(false)}>Not this time</button><button className="ghost" onClick={() => setEnding(false)}>Keep going</button></div>
        </div>
      ) : (
        <div className="row-start center">
          {timer.paused_at ? <button className="primary" onClick={onResume}>Resume</button> : <button onClick={onPause}>Pause</button>}
          <button className={done ? 'primary' : ''} onClick={() => setEnding(true)}>Stop</button>
        </div>
      )}
    </div>
  );
}

function StartForm({ tasks, onStart }: { tasks: { id: string; title: string | null }[]; onStart: (m: Timer['mode'], planned: number | null, brk: number | null, label: string, task: string | null) => Promise<void> }) {
  const [mode, setMode] = useState<Timer['mode']>('countdown');
  const [mins, setMins] = useState(25);
  const [brk, setBrk] = useState(5);
  const [label, setLabel] = useState('');
  const [task, setTask] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); onStart(mode, mode === 'stopwatch' ? null : mins * 60, mode === 'cycle' ? brk * 60 : null, label.trim(), task || null); };
  return (
    <form className="panel-form" onSubmit={submit}>
      <div className="kind-toggle" role="radiogroup" aria-label="Timer type">
        {([['countdown', 'Countdown'], ['cycle', 'Focus and breaks'], ['stopwatch', 'Stopwatch']] as const).map(([m, l]) => (
          <button type="button" key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{l}</button>
        ))}
      </div>
      {mode !== 'stopwatch' && (
        <div className="presets" role="group" aria-label="Length">
          {[15, 25, 50, 90].map((m) => <button type="button" key={m} aria-pressed={mins === m} className={mins === m ? 'on' : ''} onClick={() => setMins(m)}>{m} min</button>)}
          <label className="mins"><span className="sr-only">Minutes</span><input type="number" min={1} max={600} value={mins} onChange={(e) => setMins(Math.max(1, +e.target.value || 1))} /> min</label>
        </div>
      )}
      {mode === 'cycle' && <label>Break length<select value={brk} onChange={(e) => setBrk(+e.target.value)}>{[5, 10, 15].map((b) => <option key={b} value={b}>{b} minutes</option>)}</select></label>}
      <label>What is this for? (optional)<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Chapter 4 revision, proposal draft" maxLength={80} /></label>
      <p className="hint">This label stays on this device. It is never sent to the server or shown to your partner.</p>
      {tasks.length > 0 && <label>Link to a shared task (optional)<select value={task} onChange={(e) => setTask(e.target.value)}><option value="">Not linked</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.title || 'Untitled'}</option>)}</select></label>}
      <button className="primary wide">Start</button>
    </form>
  );
}

function SessionRow({ s, onAdjust }: { s: FocusSession; onAdjust: (secs: number, reason: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [mins, setMins] = useState(Math.round(s.adjust_seconds / 60));
  const [reason, setReason] = useState(s.adjust_reason ?? '');
  const t = new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' });
  const measured = Math.max(0, (new Date(s.ended_at!).getTime() - new Date(s.started_at).getTime()) / 1000 - s.paused_seconds);
  return (
    <li>
      <div className="version-top"><b>{t.format(new Date(s.started_at))} to {t.format(new Date(s.ended_at!))}</b><span className="quiet">{minutes(measured)} measured</span></div>
      <p className="byline"><span>{s.completed ? 'Marked complete' : 'Not marked complete'}</span>{s.adjust_seconds !== 0 && <span>Corrected by hand: {s.adjust_seconds > 0 ? '+' : ''}{minutes(Math.abs(s.adjust_seconds))}{s.adjust_seconds < 0 ? ' removed' : ''} ({s.adjust_reason})</span>}</p>
      {open ? (
        <form className="ask-delete" onSubmit={(e) => { e.preventDefault(); onAdjust(mins * 60, reason.trim()).then(() => setOpen(false)); }}>
          <label>Minutes to add (use a minus sign to remove)<input type="number" value={mins} onChange={(e) => setMins(+e.target.value || 0)} /></label>
          <label>Why?<input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Forgot to start the timer" /></label>
          <p className="hint">Corrections are shown separately from measured time, never mixed into it.</p>
          <div className="row-end"><button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button><button className="primary">Save correction</button></div>
        </form>
      ) : <button className="ghost small-btn" onClick={() => setOpen(true)}>Correct the time</button>}
    </li>
  );
}
