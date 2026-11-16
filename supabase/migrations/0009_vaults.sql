-- Private-area keys (docs/architecture.md §3). Each person's random data key is stored here only in wrapped
-- (locked) form: once by their passphrase and once by their one-time recovery key. The server never sees the
-- passphrase, the recovery key or the unwrapped data key, so neither the project owner nor Supabase can read
-- private content. Losing both secrets means the private data cannot be recovered.

create table public.vaults (
  user_id uuid primary key default auth.uid() references public.profiles (id),
  by_passphrase jsonb not null,
  by_recovery jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (by_passphrase ? 'wrapped' and by_passphrase ? 'salt' and by_recovery ? 'wrapped' and by_recovery ? 'salt')
);

alter table public.vaults enable row level security;
create policy vaults_own on public.vaults for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.vaults to authenticated;
-- No delete: removing a vault would orphan all private data. A deliberate reset is a separate, explicit flow.

-- Only the passphrase wrapper may change (passphrase change / recovery); the recovery wrapper is fixed.
create function public.vaults_guard() returns trigger language plpgsql as $$
begin
  if new.by_recovery is distinct from old.by_recovery or new.user_id is distinct from old.user_id then
    raise exception 'recovery_wrapper_fixed' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger vaults_guard before update on public.vaults for each row execute function public.vaults_guard();
