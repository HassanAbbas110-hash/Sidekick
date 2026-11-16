-- Reminders. Two kinds, both delivered through the existing inbox + push queue (so they arrive with the app closed):
--  1. "Remind me" at a chosen time on a task, set by one person for themself only.
--  2. Automatic: an hour before a task is due, its assignee is told once per due time.
-- A minute job turns due reminders into inbox rows. Private items never put their content in a reminder.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('task_created', 'task_assigned', 'task_done',
  'deadline_changed', 'deletion_requested', 'deletion_decided', 'reminder', 'due_soon'));

create table public.reminders (
  id uuid primary key,
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  remind_at timestamptz not null,
  note text check (note is null or length(note) <= 200),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index reminders_waiting on public.reminders (remind_at) where sent_at is null;

alter table public.reminders enable row level security;
-- Your reminders are yours alone; your partner never sees when you plan to be reminded.
create policy reminders_own on public.reminders for select to authenticated using (owner = auth.uid());
grant select on public.reminders to authenticated;
grant all on public.reminders to service_role;

-- Set or move a reminder (same id = move it). Runs as the caller, so the item must be one they can read.
create function public.set_reminder(p_op_id uuid, p_id uuid, p_item uuid, p_at timestamptz, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare it record;
begin
  if auth.uid() is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  select i.id, i.space_id, i.deleted_at into it from items i where i.id = p_item
    and (space_visibility(i.space_id) = 'shared' or exists (select 1 from spaces s where s.id = i.space_id and s.owner_id = auth.uid()));
  if not found or it.deleted_at is not null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_note is not null and space_visibility(it.space_id) = 'private' then
    raise exception 'private_note_not_allowed' using errcode = '22023', hint = 'Notes on private reminders would be readable on the server.';
  end if;
  if exists (select 1 from reminders where id = p_id and owner <> auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  insert into reminders (id, owner, item_id, remind_at, note) values (p_id, auth.uid(), p_item, p_at, nullif(trim(p_note), ''))
  on conflict (id) do update set remind_at = excluded.remind_at, note = excluded.note, sent_at = null;
  return 'set';
end $$;

create function public.cancel_reminder(p_op_id uuid, p_id uuid) returns text
language sql security definer set search_path = public as $$
  delete from reminders where id = p_id and owner = auth.uid() returning 'cancelled'
$$;

-- Run every minute by pg_cron (service role only). Safe to run twice: each reminder and each due time notifies once.
create function public.fire_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; c int;
begin
  with due as (
    update reminders r set sent_at = now() where r.sent_at is null and r.remind_at <= now() returning r.*
  ), live as (
    select d.*, i.title, i.space_id, space_visibility(i.space_id) = 'private' as priv
    from due d join items i on i.id = d.item_id
    where i.deleted_at is null and coalesce(i.status, '') <> 'done'
  )
  insert into notifications (user_id, kind, item_id, title, body, dedupe_key)
  select owner, 'reminder', item_id,
         case when priv then 'Reminder: something in your private area' else 'Reminder: ' || coalesce(nullif(title, ''), 'Untitled') end,
         case when priv then null else note end,
         'rem:' || id || ':' || extract(epoch from remind_at)::bigint
  from live
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; n := n + c;

  insert into notifications (user_id, kind, item_id, title, body, dedupe_key)
  select coalesce(i.assignee, i.created_by), 'due_soon', i.id,
         case when space_visibility(i.space_id) = 'private' then 'A private task is due within the hour' else 'Due within the hour' end,
         case when space_visibility(i.space_id) = 'private' then null else coalesce(nullif(i.title, ''), 'Untitled') end,
         'due:' || i.id || ':' || extract(epoch from i.due_at)::bigint
  from items i
  where i.kind = 'task' and i.deleted_at is null and coalesce(i.status, '') <> 'done'
    and i.due_at > now() and i.due_at <= now() + interval '1 hour'
    and (i.assignee is not null or space_visibility(i.space_id) = 'private')
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;

revoke execute on function public.fire_reminders() from public, anon, authenticated;
grant execute on function public.fire_reminders() to service_role;
revoke execute on function public.set_reminder(uuid, uuid, uuid, timestamptz, text), public.cancel_reminder(uuid, uuid) from public, anon;
grant execute on function public.set_reminder(uuid, uuid, uuid, timestamptz, text), public.cancel_reminder(uuid, uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'sidekick-reminders';
    perform cron.schedule('sidekick-reminders', '* * * * *', 'select public.fire_reminders()');
  end if;
end $$;
