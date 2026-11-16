-- Every minute, ask the send-push function to drain the queue. This is what makes pushes go out
-- without the laptop or any phone being awake (spec §3). The function URL and a shared secret are
-- read from Supabase Vault (names below), set once per project outside git.
-- Skipped where pg_cron/pg_net do not exist (the local PGlite test database).
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron/pg_net unavailable: push schedule not installed';
    return;
  end if;
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
  perform cron.unschedule(jobid) from cron.job where jobname = 'sidekick-send-push';
  perform cron.schedule('sidekick-send-push', '* * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'sidekick_functions_url') || '/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sidekick_cron_secret')),
      body := '{}'::jsonb)
    where exists (select 1 from public.notifications where push_state = 'pending'
                  or (push_state = 'sending' and push_claimed_at < now() - interval '5 minutes'))
  $job$);
end $$;
