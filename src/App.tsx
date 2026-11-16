import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase.ts';
import { SignIn } from './ui/SignIn.tsx';
import { Workspace } from './ui/Workspace.tsx';

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <p className="boot" role="status">Opening Sidekick…</p>;
  if (!session) return <SignIn />;
  // key: a different account gets a fresh workspace (and its own outbox), never the previous one's state.
  return <Workspace key={session.user.id} userId={session.user.id} email={session.user.email ?? ''} />;
}
