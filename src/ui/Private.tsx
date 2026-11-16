import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPrivateSpace, reveal, vaultRemote } from '../lib/data.ts';
import { recover, setUp, unlockWithPassphrase } from '../lib/keystore.ts';
import { Mark } from './Mark.tsx';

const MIN = 12;

/** First-time setup: explains exactly what stays private and what the other person can see. */
export function PrivateSetup({ userId, isOwner, ownerName, partnerName, onDone }: {
  userId: string; isOwner: boolean; ownerName: string; partnerName: string; onDone: (key: CryptoKey) => void;
}) {
  const [step, setStep] = useState<'explain' | 'passphrase' | 'recovery' | 'confirm'>('explain');
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [check, setCheck] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create(e: FormEvent) {
    e.preventDefault();
    if (pass.length < MIN || pass !== again) return;
    setBusy(true); setError('');
    try {
      setRecoveryKey(await setUp(userId, pass, vaultRemote(userId)));
      setStep('recovery');
    } catch (err) {
      setError(navigator.onLine ? String(err).replace(/^Error: /, '') : 'Setting up needs a connection once.');
    } finally { setBusy(false); }
  }

  async function finish(e: FormEvent) {
    e.preventDefault();
    if (check.trim().toUpperCase() !== recoveryKey.slice(-8)) return;
    setBusy(true);
    try {
      const { storedKey } = await import('../lib/keystore.ts');
      const key = (await storedKey(userId))!;
      await createPrivateSpace(userId, key, 'Private');
      onDone(key);
    } catch (err) { setError(String(err)); } finally { setBusy(false); }
  }

  return (
    <section className="private-setup" aria-label="Set up your private area">
      <Mark size={44} />
      {step === 'explain' && (
        <>
          <h1>Your private area</h1>
          <p className="lede">A place for your own notes, tasks, study plans and appointments. What you write here is locked on this device before it is saved, so nobody else can read it: not {isOwner ? partnerName : ownerName}, not the person who runs the server, and not Supabase.</p>
          <div className="privacy-grid">
            <div><h3>Stays private</h3><ul><li>Titles and text of your private notes, tasks and events</li><li>The names of your private spaces</li><li>What your focus sessions were about</li></ul></div>
            <div><h3>{isOwner ? partnerName : ownerName} can see</h3><ul>
              <li>“Busy” at the times of your private events, with no titles</li>
              <li>How long you focused each day and how many sessions you marked complete</li>
              {!isOwner && <li>A notice when you delete something private, saying only the kind of thing (for example “a private note”) and when. Never its name or content.</li>}
            </ul></div>
          </div>
          <p className="hint">The server can also tell that private items exist, when your events are, and whether tasks are done. This keeps Busy times and syncing working.</p>
          <button className="primary" onClick={() => setStep('passphrase')}>Continue</button>
        </>
      )}
      {step === 'passphrase' && (
        <form className="panel-form narrow" onSubmit={create}>
          <h2>Choose a passphrase</h2>
          <p className="quiet">At least {MIN} characters. A few unrelated words are easiest to remember, like “river lamp seven toast”. Use one you do not use anywhere else.</p>
          <label>Passphrase<input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus /></label>
          <label>Type it again<input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></label>
          {pass.length > 0 && pass.length < MIN && <p className="field-error">{MIN - pass.length} more characters needed.</p>}
          {again.length > 0 && pass !== again && <p className="field-error">The two do not match yet.</p>}
          {error && <p className="field-error" role="alert">{error}</p>}
          <button className="primary" disabled={busy || pass.length < MIN || pass !== again}>{busy ? 'Locking…' : 'Create my private area'}</button>
        </form>
      )}
      {step === 'recovery' && (
        <div className="panel-form narrow">
          <h2>Your recovery key</h2>
          <p>If you forget your passphrase, this is the only way back in. Write it down on paper or save it in a password manager. <b>It will not be shown again</b>, and nobody, including {isOwner ? 'Supabase' : ownerName}, can reset it for you.</p>
          <p className="recovery-key" aria-label="Recovery key">{recoveryKey}</p>
          <button onClick={() => navigator.clipboard?.writeText(recoveryKey)}>Copy</button>
          <button className="primary" onClick={() => setStep('confirm')}>I have saved it</button>
        </div>
      )}
      {step === 'confirm' && (
        <form className="panel-form narrow" onSubmit={finish}>
          <h2>Check you saved it</h2>
          <label>Type the last 8 characters of your recovery key<input value={check} onChange={(e) => setCheck(e.target.value)} autoFocus autoComplete="off" maxLength={8} /></label>
          {check.length === 8 && check.trim().toUpperCase() !== recoveryKey.slice(-8) && <p className="field-error">That does not match. Look at what you saved.</p>}
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="row-end">
            <button type="button" className="ghost" onClick={() => setStep('recovery')}>Show it again</button>
            <button className="primary" disabled={busy || check.trim().toUpperCase() !== recoveryKey.slice(-8)}>Open my private area</button>
          </div>
        </form>
      )}
    </section>
  );
}

export function Unlock({ userId, onUnlocked }: { userId: string; onUnlocked: (key: CryptoKey) => void }) {
  const [mode, setMode] = useState<'pass' | 'recover'>('pass');
  const [pass, setPass] = useState('');
  const [rk, setRk] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<CryptoKey>) => {
    setBusy(true); setError('');
    try { onUnlocked(await fn()); }
    catch (e) {
      const m = String(e);
      setError(m.includes('wrong_secret') ? (mode === 'pass' ? 'That passphrase does not open your private area.' : 'That recovery key does not match.') : navigator.onLine ? m.replace(/^Error: /, '') : 'Unlocking on a new device needs a connection once.');
    } finally { setBusy(false); }
  };
  return (
    <section className="private-setup" aria-label="Unlock your private area">
      <Mark size={44} />
      {mode === 'pass' ? (
        <form className="panel-form narrow" onSubmit={(e) => { e.preventDefault(); run(() => unlockWithPassphrase(userId, pass, vaultRemote(userId))); }}>
          <h1>Private area is locked</h1>
          <label>Passphrase<input type="password" autoComplete="current-password" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} /></label>
          {error && <p className="field-error" role="alert">{error}</p>}
          <button className="primary" disabled={busy || !pass}>{busy ? 'Unlocking…' : 'Unlock'}</button>
          <button type="button" className="ghost" onClick={() => { setMode('recover'); setError(''); }}>Forgot it? Use your recovery key</button>
          <p className="hint">Unlocking takes a moment on purpose: it makes guessing passphrases slow.</p>
        </form>
      ) : (
        <form className="panel-form narrow" onSubmit={(e) => { e.preventDefault(); if (next.length >= MIN) run(() => recover(userId, rk.trim(), next, vaultRemote(userId))); }}>
          <h1>Use your recovery key</h1>
          <label>Recovery key<input value={rk} onChange={(e) => setRk(e.target.value)} autoFocus autoComplete="off" placeholder="XXXXXXXX-XXXXXXXX-…" /></label>
          <label>New passphrase (at least {MIN} characters)<input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
          {error && <p className="field-error" role="alert">{error}</p>}
          <button className="primary" disabled={busy || !rk || next.length < MIN}>{busy ? 'Checking…' : 'Set new passphrase and unlock'}</button>
          <button type="button" className="ghost" onClick={() => setMode('pass')}>Back</button>
        </form>
      )}
    </section>
  );
}

type Shown = { id: string; kind: string; title: string | null; body: string | null; status: string | null; version: number; starts_at?: string | null };

/** Decrypt rows for display; anything that cannot be opened with this key says so plainly. */
export function useRevealed(rows: { id: string; kind: string; title: string | null; body: string | null; status?: string | null; version?: number; starts_at?: string | null }[], key: CryptoKey | null) {
  const [shown, setShown] = useState<Shown[]>([]);
  // Re-decrypt only when the rows' content changes. Callers pass freshly built arrays on every render, so
  // depending on the array itself re-ran this on every render: decrypt → setState → render → decrypt (a freeze).
  const signature = rows.map((r) => `${r.id}:${r.version ?? 0}:${r.status ?? ''}:${r.title ?? ''}:${r.body ?? ''}`).join('|');
  const latest = useRef(rows);
  latest.current = rows;
  useEffect(() => {
    let alive = true;
    Promise.all(latest.current.map(async (r) => ({
      id: r.id, kind: r.kind, status: r.status ?? null, version: r.version ?? 0, starts_at: r.starts_at,
      title: await reveal(key, r.title, r.id, 'title'), body: await reveal(key, r.body, r.id, 'body'),
    }))).then((s) => alive && setShown(s));
    return () => { alive = false; };
  }, [signature, key]);
  return shown;
}
