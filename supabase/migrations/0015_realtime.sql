-- Instant sync: the app listens for changes instead of only checking every 30 seconds.
-- Supabase Realtime applies each table's row level security to every listener, so a change is only delivered
-- to someone who could read that row anyway (private items never reach the other person).
-- Skipped where the publication does not exist (the local PGlite test database).
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication missing: realtime not enabled';
    return;
  end if;
  foreach t in array array['items', 'comments', 'notifications', 'deletion_requests', 'clients', 'charges', 'payments', 'reminders'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
