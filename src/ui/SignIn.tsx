import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';

export function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError(navigator.onLine ? error.message : 'You are offline. Signing in needs an internet connection.');
  }

  return (
    <main className="signin">
      <form className="card signin-card" onSubmit={submit}>
        <img src="./icon.svg" alt="" width={56} height={56} />
        <h1>Sidekick</h1>
        <p className="muted">Invited members only.</p>
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
