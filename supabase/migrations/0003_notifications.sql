-- In-app inbox + push queue (spec §11). The inbox row is the authoritative record; push is best effort.
-- Rows are created by triggers in the database, so a change from any device produces each logical
-- notification exactly once (unique dedupe_key), even if a client replays its outbox.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  kind text not null check (kind in ('task_created', 'task_assigned', 'task_done', 'deadline_changed',
                                     'deletion_requested', 'deletion_decided')),
  item_id uuid references public.items (id) on delete set null,
  actor uuid references public.profiles (id),
  title text not null,
  body text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  push_state text not null default 'pending' check (push_state in ('pending', 'sending', 'sent', 'failed', 'no_device')),
  push_attempts int not null default 0,
  push_error text,
  push_claimed_at timestamptz,
  dedupe_key text not null unique
);
create index notifications_user_recent on public.notifications (user_id, created_at desc);
create index notifications_push_queue on public.notifications (push_state) where push_state in ('pending', 'sending');

create table public.device_tokens (
  token text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('android', 'web')),
  updated_at timestamptz not null default now()
);

create function public.display_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(display_name, split_part(email, '@', 1), 'Someone') from profiles where id = p_user
$$;

-- Only shared items notify. Private items never create rows for the other person (spec §11).
-- The actor gets no row for their own change (proposed default: no redundant self-notification).
create function public.notify_item_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  who text := display_name(auth.uid());
  label text := coalesce(nullif(new.title, ''), 'Untitled');
  p record;
begin
  if actor is null or space_visibility(new.space_id) <> 'shared' or new.kind <> 'task' then
    return null;
  end if;
  for p in select id from profiles where id <> actor loop
    if tg_op = 'INSERT' then
      insert into notifications (user_id, kind, item_id, actor, title, body, dedupe_key)
      values (p.id, case when new.assignee = p.id then 'task_assigned' else 'task_created' end, new.id, actor,
              case when new.assignee = p.id then who || ' assigned you a task' else who || ' added a task' end,
              label, new.id || ':' || new.version || ':created:' || p.id)
      on conflict (dedupe_key) do nothing;
    else
      if new.assignee is distinct from old.assignee and new.assignee = p.id then
        insert into notifications (user_id, kind, item_id, actor, title, body, dedupe_key)
        values (p.id, 'task_assigned', new.id, actor, who || ' assigned you a task', label,
                new.id || ':' || new.version || ':assigned:' || p.id)
        on conflict (dedupe_key) do nothing;
      end if;
      if new.status = 'done' and old.status is distinct from 'done' then
        insert into notifications (user_id, kind, item_id, actor, title, body, dedupe_key)
        values (p.id, 'task_done', new.id, actor, who || ' completed a task', label,
                new.id || ':' || new.version || ':done:' || p.id)
        on conflict (dedupe_key) do nothing;
      end if;
      if new.due_at is distinct from old.due_at then
        insert into notifications (user_id, kind, item_id, actor, title, body, dedupe_key)
        values (p.id, 'deadline_changed', new.id, actor, who || ' changed a deadline', label,
                new.id || ':' || new.version || ':due:' || p.id)
        on conflict (dedupe_key) do nothing;
      end if;
    end if;
  end loop;
  return null;
end $$;
create trigger items_notify after insert or update on public.items
  for each row execute function public.notify_item_change();

create function public.notify_deletion_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare label text := coalesce((select nullif(title, '') from items where id = new.item_id), 'Untitled');
begin
  if tg_op = 'INSERT' then
    insert into notifications (user_id, kind, item_id, actor, title, body, dedupe_key)
    select o.id, 'deletion_requested', new.item_id, new.requested_by,
           display_name(new.requested_by) || ' asked to delete an item', label || ' — ' || new.reason,
           'delreq:' || new.id || ':' || o.id
    from profiles o where o.role = 'owner' and o.id <> new.requested_by
    on conflict (dedupe_key) do nothing;
  elsif new.status <> old.status and new.requested_by <> coalesce(new.decided_by, new.requested_by) then
    insert into notifications (user_id, kind, item_id, actor, title, body, dedupe_key)
    values (new.requested_by, 'deletion_decided', new.item_id, new.decided_by,
            'Deletion request ' || new.status, label, 'deldec:' || new.id || ':' || new.status)
    on conflict (dedupe_key) do nothing;
  end if;
  return null;
end $$;
create trigger deletion_requests_notify after insert or update on public.deletion_requests
  for each row execute function public.notify_deletion_request();

-- A device token belongs to whoever signed in on it last; signing out removes it (no pushes for a past account).
create function public.register_device(p_token text, p_platform text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  insert into device_tokens (token, user_id, platform) values (p_token, auth.uid(), p_platform)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end $$;

create function public.unregister_device(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from device_tokens where token = p_token and user_id = auth.uid()
$$;

-- Used only by the send-push function (service role): claims a batch so two workers never send the same row.
create function public.claim_pushes(p_limit int default 50)
returns table (id uuid, user_id uuid, title text, body text, item_id uuid)
language sql security definer set search_path = public as $$
  update notifications n set push_state = 'sending', push_claimed_at = now(), push_attempts = n.push_attempts + 1
  where n.id in (
    select x.id from notifications x
    where (x.push_state = 'pending' or (x.push_state = 'sending' and x.push_claimed_at < now() - interval '5 minutes'))
      and x.push_attempts < 5
    order by x.created_at limit p_limit
    for update skip locked)
  returning n.id, n.user_id, n.title, n.body, n.item_id
$$;

alter table public.notifications enable row level security;
alter table public.device_tokens enable row level security;
create policy notifications_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy device_tokens_own on public.device_tokens for select to authenticated using (user_id = auth.uid());

grant select on public.notifications, public.device_tokens to authenticated;
grant update (read_at) on public.notifications to authenticated; -- users can mark read, nothing else
revoke execute on function public.claim_pushes(int) from public, anon, authenticated;
grant execute on function public.claim_pushes(int) to service_role;
grant execute on function public.register_device(text, text), public.unregister_device(text), public.display_name(uuid)
  to authenticated;
grant all on public.notifications, public.device_tokens to service_role;
