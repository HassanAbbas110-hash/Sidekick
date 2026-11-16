-- Repeating tasks. A task can carry the same repeat rule events use (items.recur). When it is marked done, the
-- server adds the next one with the next due date, so it never depends on a phone being online at the right time.
-- Shared spaces only: private titles are encrypted to their own item id and cannot be copied by the server.

alter table public.items add column series_id uuid;
-- one copy per series per due time, so un-ticking and re-ticking a task never makes two "next" tasks
create unique index items_series_due on public.items (series_id, due_at) where series_id is not null;

-- The next due time after p_from, following the rule from p_due, in Johannesburg wall time.
create function public.next_due(p_due timestamptz, p_recur jsonb, p_from timestamptz) returns timestamptz
language plpgsql immutable set search_path = public as $$
declare
  freq text := p_recur->>'freq';
  step int := greatest(1, coalesce((p_recur->>'interval')::int, 1));
  days int[] := array(select jsonb_array_elements_text(coalesce(p_recur->'byweekday', '[]'::jsonb))::int);
  local timestamp := p_due at time zone 'Africa/Johannesburg';
  guard int := 0;
begin
  if freq not in ('daily', 'weekly', 'monthly') then return null; end if;
  loop
    guard := guard + 1;
    if guard > 2000 then return null; end if;
    if freq = 'daily' then local := local + make_interval(days => step);
    elsif freq = 'weekly' and cardinality(days) > 0 then
      local := local + interval '1 day';
      continue when not (extract(dow from local)::int = any(days));
    elsif freq = 'weekly' then local := local + make_interval(days => 7 * step);
    else local := local + make_interval(months => step);
    end if;
    exit when (local at time zone 'Africa/Johannesburg') > p_from;
  end loop;
  if p_recur ? 'until' and (local at time zone 'Africa/Johannesburg') > (p_recur->>'until')::timestamptz then return null; end if;
  return local at time zone 'Africa/Johannesburg';
end $$;

create function public.repeat_task() returns trigger
language plpgsql security definer set search_path = public as $$
declare nxt timestamptz;
begin
  if new.kind <> 'task' or new.recur is null or new.deleted_at is not null
     or new.status is distinct from 'done' or old.status is not distinct from 'done'
     or space_visibility(new.space_id) <> 'shared' then
    return null;
  end if;
  nxt := next_due(coalesce(new.due_at, now()), new.recur, greatest(coalesce(new.due_at, now()), now()));
  if nxt is null then return null; end if;
  perform set_config('sidekick.repeating', 'on', true);
  insert into items (space_id, kind, title, body, assignee, status, due_at, recur, created_by, series_id)
  values (new.space_id, 'task', new.title, new.body, new.assignee, 'open', nxt, new.recur, new.created_by, coalesce(new.series_id, new.id))
  on conflict (series_id, due_at) where series_id is not null do nothing;
  perform set_config('sidekick.repeating', 'off', true);
  return null;
end $$;
create trigger items_repeat after update on public.items for each row execute function public.repeat_task();

create or replace function public.notify_item_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  who text := display_name(auth.uid());
  label text := coalesce(nullif(new.title, ''), 'Untitled');
  p record;
begin
  -- the next copy of a repeating task is made by the server, not by a person: no "added a task" ping
  if current_setting('sidekick.repeating', true) = 'on' then
    return null;
  end if;
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
