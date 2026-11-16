import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';
import { Mark } from './Mark.tsx';

export function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setError(!navigator.onLine ? 'Signing in needs an internet connection. Connect and try again.'
        : error.message === 'Invalid login credentials' ? 'That email and password do not match an invited account.' : error.message);
    }
  }

  return (
    <main className="signin">
      <div className="signin-seam" aria-hidden />
      <form className="signin-card" onSubmit={submit}>
        <Mark size={64} animate />
        <h1>Sidekick</h1>
        <p className="signin-lede">The shared desk for two. Sign in with your invited account.</p>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="field-error" role="alert">{error}</p>}
        <button className="primary wide" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
