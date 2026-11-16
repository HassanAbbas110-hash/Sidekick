-- Calendar (spec §9) and focus sessions (spec §10).
-- Events are items of kind 'event'. All-day events use dates; timed events use instants. A repeating event
-- stores its rule; single occurrences can be skipped without touching the series. A work block can point at
-- a task (task_id) — moving the block never changes the task's own due date.

alter table public.items
  add column all_day boolean not null default false,
  add column recur jsonb,
  add column task_id uuid references public.items (id) on delete set null,
  add constraint items_event_range check (ends_at is null or starts_at is null or ends_at >= starts_at),
  add constraint items_recur_shape check (recur is null or (
    recur->>'freq' in ('daily', 'weekly', 'monthly')
    and coalesce((recur->>'interval')::int, 1) between 1 and 52
    and (recur->>'until' is null or (recur->>'until') ~ '^\d{4}-\d{2}-\d{2}$')));

create table public.event_exceptions (
  item_id uuid not null references public.items (id) on delete cascade,
  occurrence_start timestamptz not null, -- the original start of the skipped occurrence
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (item_id, occurrence_start)
);
alter table public.event_exceptions enable row level security;
create policy event_exceptions_read on public.event_exceptions for select to authenticated
  using (exists (select 1 from items i where i.id = item_id));
create policy event_exceptions_add on public.event_exceptions for insert to authenticated
  with check (created_by = auth.uid() and exists (select 1 from items i where i.id = item_id and i.recur is not null));
create policy event_exceptions_undo on public.event_exceptions for delete to authenticated
  using (exists (select 1 from items i where i.id = item_id));
grant select, insert, delete on public.event_exceptions to authenticated;

-- apply_op learns the new event fields (same conflict rules as before).
create or replace function public.apply_op(op jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_op uuid := (op->>'op_id')::uuid;
  v_id uuid := (op->>'id')::uuid;
  f jsonb := coalesce(op->'fields', '{}'::jsonb);
  prior jsonb;
  cur items;
  base jsonb;
  wanted jsonb;
  k text;
  applied text[] := '{}'::text[];
  conflicted text[] := '{}'::text[];
  v_result jsonb;
begin
  if v_op is null or v_id is null then
    raise exception 'op_id_and_id_required' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(f) key
             where key not in ('title', 'body', 'starts_at', 'ends_at', 'assignee', 'status', 'due_at', 'all_day', 'recur', 'task_id')) then
    raise exception 'unsupported_field' using errcode = '22023';
  end if;

  insert into applied_ops (op_id) values (v_op) on conflict do nothing;
  if not found then
    select a.result into prior from applied_ops a where a.user_id = auth.uid() and a.op_id = v_op;
    return prior || '{"replayed": true}';
  end if;

  if op->>'type' = 'create' then
    insert into items (id, space_id, kind, title, body, starts_at, ends_at, assignee, status, due_at, all_day, recur, task_id)
    values (v_id, (op->>'space_id')::uuid, op->>'kind', f->>'title', f->>'body',
            (f->>'starts_at')::timestamptz, (f->>'ends_at')::timestamptz,
            (f->>'assignee')::uuid, f->>'status', (f->>'due_at')::timestamptz,
            coalesce((f->>'all_day')::boolean, false), nullif(f->'recur', 'null'::jsonb), (f->>'task_id')::uuid);
    v_result := jsonb_build_object('status', 'applied', 'version', 1, 'conflicts', '[]'::jsonb);
  elsif op->>'type' = 'update' then
    select * into cur from items where id = v_id for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    select snapshot into base from item_versions where item_id = v_id and version = (op->>'base_version')::int;
    if base is null then
      raise exception 'unknown_base_version' using errcode = '22023';
    end if;
    wanted := to_jsonb(jsonb_populate_record(cur, f));
    for k in select jsonb_object_keys(f) loop
      if (to_jsonb(cur)->k) is distinct from (base->k) and (to_jsonb(cur)->k) is distinct from (wanted->k) then
        conflicted := conflicted || k;
        insert into conflicts (item_id, field, server_value, client_value, op_id)
        values (v_id, k, to_jsonb(cur)->>k, f->>k, v_op);
      else
        applied := applied || k;
      end if;
    end loop;
    if cardinality(applied) > 0 then
      update items set
        title     = case when 'title' = any(applied) then f->>'title' else title end,
        body      = case when 'body' = any(applied) then f->>'body' else body end,
        starts_at = case when 'starts_at' = any(applied) then (f->>'starts_at')::timestamptz else starts_at end,
        ends_at   = case when 'ends_at' = any(applied) then (f->>'ends_at')::timestamptz else ends_at end,
        assignee  = case when 'assignee' = any(applied) then (f->>'assignee')::uuid else assignee end,
        status    = case when 'status' = any(applied) then f->>'status' else status end,
        due_at    = case when 'due_at' = any(applied) then (f->>'due_at')::timestamptz else due_at end,
        all_day   = case when 'all_day' = any(applied) then coalesce((f->>'all_day')::boolean, false) else all_day end,
        recur     = case when 'recur' = any(applied) then nullif(f->'recur', 'null'::jsonb) else recur end,
        task_id   = case when 'task_id' = any(applied) then (f->>'task_id')::uuid else task_id end
      where id = v_id
      returning * into cur;
      if not found then
        raise exception 'not_found' using errcode = 'P0002';
      end if;
    end if;
    v_result := jsonb_build_object(
      'status', case when cardinality(conflicted) = 0 then 'applied' when cardinality(applied) = 0 then 'conflict' else 'partial' end,
      'version', cur.version, 'conflicts', to_jsonb(conflicted));
  else
    raise exception 'unknown_op_type' using errcode = '22023';
  end if;

  update applied_ops set result = v_result where user_id = auth.uid() and op_id = v_op;
  return v_result;
end $$;

-- Busy projection now also covers all-day and repeating private events: the shape stays owner + times only.
drop function public.busy_slots(timestamptz, timestamptz);
create function public.busy_slots(p_from timestamptz, p_to timestamptz)
returns table (user_id uuid, starts_at timestamptz, ends_at timestamptz, all_day boolean, recur jsonb)
language sql stable security definer set search_path = public as $$
  select s.owner_id, i.starts_at, i.ends_at, i.all_day, i.recur
  from items i join spaces s on s.id = i.space_id
  where is_member() and s.visibility = 'private' and i.kind = 'event' and i.deleted_at is null
    and i.starts_at < p_to and (i.recur is not null or i.ends_at > p_from)
  order by i.starts_at
$$;

-- ---------- focus sessions ----------
-- Times only. What the session was about stays on the owner's device until private encryption exists.
create table public.focus_sessions (
  id uuid primary key,
  owner uuid not null default auth.uid() references public.profiles (id),
  mode text not null check (mode in ('stopwatch', 'countdown', 'cycle')),
  planned_seconds int check (planned_seconds is null or planned_seconds > 0),
  started_at timestamptz not null,
  ended_at timestamptz,
  paused_seconds int not null default 0 check (paused_seconds >= 0),
  completed boolean,                       -- confirmed by the person, never inferred from the timer
  adjust_seconds int not null default 0,   -- manual correction, kept separate from measured time
  adjust_reason text,
  task_id uuid references public.items (id) on delete set null, -- optional link to a shared task
  op_id uuid unique,
  check (ended_at is null or ended_at >= started_at),
  check (adjust_seconds = 0 or adjust_reason is not null)
);
-- One running timer per person (spec §10). A second device starting offline is reconciled on sync.
create unique index focus_one_running on public.focus_sessions (owner) where ended_at is null;

alter table public.focus_sessions enable row level security;
create policy focus_own on public.focus_sessions for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
grant select, insert, update on public.focus_sessions to authenticated;

-- Start: idempotent by op_id. If another session is still running for this person (another device, or a
-- forgotten timer), that one is closed at this start time instead of running on in parallel.
create function public.start_focus(p_op_id uuid, p_id uuid, p_mode text, p_planned int, p_started_at timestamptz, p_task uuid default null)
returns jsonb language plpgsql set search_path = public as $$
declare prev focus_sessions;
begin
  if exists (select 1 from focus_sessions where op_id = p_op_id) then
    return jsonb_build_object('id', p_id, 'replayed', true);
  end if;
  select * into prev from focus_sessions where owner = auth.uid() and ended_at is null for update;
  if found then
    update focus_sessions set ended_at = greatest(prev.started_at, least(p_started_at, now())) where id = prev.id;
  end if;
  insert into focus_sessions (id, mode, planned_seconds, started_at, task_id, op_id)
  values (p_id, p_mode, p_planned, least(p_started_at, now()), p_task, p_op_id);
  return jsonb_build_object('id', p_id, 'replayed', false, 'closed_previous', prev.id);
end $$;

create function public.end_focus(p_op_id uuid, p_id uuid, p_ended_at timestamptz, p_paused_seconds int, p_completed boolean)
returns text language plpgsql set search_path = public as $$
begin
  update focus_sessions
     set ended_at = coalesce(ended_at, greatest(started_at, least(p_ended_at, now()))),
         paused_seconds = greatest(0, p_paused_seconds), completed = p_completed
   where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return 'ended';
end $$;

create function public.adjust_focus(p_op_id uuid, p_id uuid, p_adjust_seconds int, p_reason text)
returns text language plpgsql set search_path = public as $$
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  update focus_sessions set adjust_seconds = p_adjust_seconds, adjust_reason = p_reason where id = p_id and ended_at is not null;
  if not found then raise exception 'not_found_or_still_running' using errcode = 'P0002'; end if;
  return 'adjusted';
end $$;

-- What the other person may see (spec §10): per person per day, measured time with overlaps merged so two
-- devices never double-count, manual adjustments separately, and completion counts. No ids, labels or tasks.
create function public.focus_summaries(p_from date, p_to date)
returns table (user_id uuid, day date, measured_seconds int, adjusted_seconds int, sessions int, completed int, running boolean)
language sql stable security definer set search_path = public as $$
  with s as (
    select owner, started_at, coalesce(ended_at, now()) as ended_at, paused_seconds, adjust_seconds, completed, ended_at is null as running,
           (started_at at time zone 'Africa/Johannesburg')::date as day
    from focus_sessions
    where is_member() and (started_at at time zone 'Africa/Johannesburg')::date between p_from and p_to
  ), ordered as (
    select *, max(ended_at) over (partition by owner order by started_at rows between unbounded preceding and 1 preceding) as prev_end
    from s
  ), clipped as (
    -- Count each session only from where the previous one for the same person ended (no double counting).
    select owner, day, adjust_seconds, completed, running,
           greatest(0, extract(epoch from ended_at - greatest(started_at, coalesce(prev_end, started_at)))::int - paused_seconds) as secs
    from ordered
  )
  select owner, day, sum(secs)::int, sum(adjust_seconds)::int, count(*)::int, count(*) filter (where completed)::int, bool_or(running)
  from clipped group by owner, day order by day, owner
$$;

revoke execute on function public.busy_slots(timestamptz, timestamptz) from public, anon;
grant execute on function public.busy_slots(timestamptz, timestamptz), public.start_focus(uuid, uuid, text, int, timestamptz, uuid), public.end_focus(uuid, uuid, timestamptz, int, boolean),
  public.adjust_focus(uuid, uuid, int, text), public.focus_summaries(date, date) to authenticated;
