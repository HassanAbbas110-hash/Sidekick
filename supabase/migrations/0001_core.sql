-- Sidekick core schema: invite-only identity, shared/private spaces, items with revision history,
-- owner-approved shared deletion, redacted private-deletion notices, Busy projection and idempotent sync.
-- Private titles/bodies arrive as client-side ciphertext (docs/architecture.md §3); the database never sees keys.

-- ---------- identity ----------
create table public.invites (
  email text primary key,
  role text not null check (role in ('owner', 'member'))
);

create table public.profiles (
  id uuid primary key,
  email text not null unique,
  role text not null check (role in ('owner', 'member')),
  display_name text
);

-- Sign-up is rejected unless the email is on the invite allowlist (spec §3: no public self-registration).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  select role into r from invites where lower(email) = lower(new.email);
  if r is null then
    raise exception 'not_invited' using errcode = '42501';
  end if;
  insert into profiles (id, email, role) values (new.id, new.email, r);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid())
$$;

create function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'owner')
$$;

-- ---------- spaces ----------
create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  visibility text not null check (visibility in ('shared', 'private')),
  owner_id uuid references public.profiles (id),
  created_by uuid not null default auth.uid() references public.profiles (id),
  check ((visibility = 'private') = (owner_id is not null))
);

-- Visibility and ownership are fixed at creation; widening/narrowing is a separate, approved flow.
create function public.spaces_guard() returns trigger language plpgsql as $$
begin
  if new.visibility is distinct from old.visibility or new.owner_id is distinct from old.owner_id then
    raise exception 'space_visibility_immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger spaces_guard before update on public.spaces for each row execute function public.spaces_guard();

-- ---------- items ----------
create table public.items (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id),
  kind text not null check (kind in ('note', 'task', 'file', 'event', 'client', 'project', 'link', 'evidence', 'tracker')),
  title text,
  body text,
  starts_at timestamptz,
  ends_at timestamptz,
  version int not null default 1,
  created_by uuid not null default auth.uid() references public.profiles (id),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Append-only snapshots: every insert/update keeps the full row, so clearing a field is recoverable (spec §12).
create table public.item_versions (
  item_id uuid not null references public.items (id) on delete cascade,
  version int not null,
  snapshot jsonb not null,
  actor uuid,
  recorded_at timestamptz not null default now(),
  primary key (item_id, version)
);

create function public.space_visibility(p_space uuid) returns text
language sql stable security definer set search_path = public as $$
  select visibility from spaces where id = p_space
$$;

create function public.items_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare old_vis text := space_visibility(old.space_id);
        new_vis text := space_visibility(new.space_id);
begin
  -- Moving shared content somewhere private removes the other user's access: owner only (spec §5).
  if new.space_id <> old.space_id and old_vis = 'shared' and new_vis = 'private' and not is_owner() then
    raise exception 'shared_to_private_requires_owner' using errcode = '42501';
  end if;
  -- Trashing/restoring shared content goes through deletion_requests (spec §12).
  if new.deleted_at is distinct from old.deleted_at and old_vis = 'shared' and not is_owner() then
    raise exception 'shared_deletion_requires_owner' using errcode = '42501';
  end if;
  new.id := old.id;
  new.created_by := old.created_by;
  new.version := old.version + 1;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
create trigger items_guard before update on public.items for each row execute function public.items_guard();

create function public.items_snapshot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into item_versions (item_id, version, snapshot, actor) values (new.id, new.version, to_jsonb(new), auth.uid());
  return new;
end $$;
create trigger items_snapshot after insert or update on public.items for each row execute function public.items_snapshot();

-- ---------- private deletion notices (spec §4, A6) ----------
create table public.private_deletion_notices (
  id uuid primary key default gen_random_uuid(),
  actor uuid not null,
  category text not null check (category in ('private_note', 'private_task', 'private_file', 'private_event', 'private_item')),
  action text not null check (action in ('trashed', 'deleted')),
  at timestamptz not null default now()
);

-- Fixed category allowlist: never a title, space name or id that could leak content.
create function public.private_category(p_kind text) returns text language sql immutable as $$
  select case p_kind when 'note' then 'private_note' when 'task' then 'private_task'
    when 'file' then 'private_file' when 'event' then 'private_event' else 'private_item' end
$$;

create function public.notify_private_deletion() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := case when tg_op = 'DELETE' then old else new end;
begin
  if space_visibility(r.space_id) <> 'private'
     or not exists (select 1 from profiles where id = auth.uid() and role = 'member') then
    return null;
  end if;
  if tg_op = 'DELETE' then
    insert into private_deletion_notices (actor, category, action) values (auth.uid(), private_category(old.kind), 'deleted');
  elsif old.deleted_at is null and new.deleted_at is not null then
    insert into private_deletion_notices (actor, category, action) values (auth.uid(), private_category(new.kind), 'trashed');
  end if;
  return null;
end $$;
create trigger items_private_deletion after update or delete on public.items
  for each row execute function public.notify_private_deletion();

-- ---------- shared deletion approval (spec §12, A5) ----------
create table public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  item_version int not null,
  reason text not null check (length(trim(reason)) > 0),
  requested_by uuid not null default auth.uid() references public.profiles (id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'stale')),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

-- Approval is revalidated against the item's current version: an edit after the request makes it stale.
create function public.decide_deletion(p_request uuid, p_approve boolean) returns text
language plpgsql security definer set search_path = public as $$
declare req deletion_requests; cur_version int; outcome text;
begin
  if not is_owner() then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  select * into req from deletion_requests where id = p_request and status = 'pending' for update;
  if not found then
    raise exception 'request_not_pending' using errcode = 'P0002';
  end if;
  select version into cur_version from items where id = req.item_id for update;
  if cur_version <> req.item_version then
    outcome := 'stale';
  elsif p_approve then
    update items set deleted_at = now() where id = req.item_id; -- soft delete into trash, recoverable
    outcome := 'approved';
  else
    outcome := 'rejected';
  end if;
  update deletion_requests set status = outcome, decided_by = auth.uid(), decided_at = now() where id = p_request;
  return outcome;
end $$;

-- ---------- Busy projection (spec §9, A4) ----------
-- Returns only owner and times. No item id, title or kind, so it cannot be used to fetch hidden content.
create function public.busy_slots(p_from timestamptz, p_to timestamptz)
returns table (user_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.owner_id, i.starts_at, i.ends_at
  from items i join spaces s on s.id = i.space_id
  where is_member() and s.visibility = 'private' and i.kind = 'event' and i.deleted_at is null
    and i.starts_at < p_to and i.ends_at > p_from
  order by i.starts_at
$$;

-- ---------- idempotent sync (spec §13, A9) ----------
create table public.applied_ops (
  user_id uuid not null default auth.uid(),
  op_id uuid not null,
  result jsonb,
  applied_at timestamptz not null default now(),
  primary key (user_id, op_id)
);

create table public.conflicts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  field text not null,
  server_value text,
  client_value text,
  op_id uuid not null,
  raised_by uuid not null default auth.uid(),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- op: {op_id, type: create|update, id, space_id?, kind?, base_version?, fields: {title, body, starts_at, ends_at}}
-- Runs as the caller, so RLS decides what may be written. Replaying an op_id returns the first result unchanged.
create function public.apply_op(op jsonb) returns jsonb
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
  applied text[] := '{}';
  conflicted text[] := '{}';
  v_result jsonb;
begin
  if v_op is null or v_id is null then
    raise exception 'op_id_and_id_required' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(f) key where key not in ('title', 'body', 'starts_at', 'ends_at')) then
    raise exception 'unsupported_field' using errcode = '22023';
  end if;

  insert into applied_ops (op_id) values (v_op) on conflict do nothing;
  if not found then
    select a.result into prior from applied_ops a where a.user_id = auth.uid() and a.op_id = v_op;
    return prior || '{"replayed": true}';
  end if;

  if op->>'type' = 'create' then
    insert into items (id, space_id, kind, title, body, starts_at, ends_at)
    values (v_id, (op->>'space_id')::uuid, op->>'kind', f->>'title', f->>'body',
            (f->>'starts_at')::timestamptz, (f->>'ends_at')::timestamptz);
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
    -- Typed copy of the client's values, so '…Z' and '…+00:00' timestamps compare as equal.
    wanted := to_jsonb(jsonb_populate_record(cur, f));
    for k in select jsonb_object_keys(f) loop
      -- Another device changed this field since our base and we disagree: keep both, apply neither.
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
        ends_at   = case when 'ends_at' = any(applied) then (f->>'ends_at')::timestamptz else ends_at end
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

-- ---------- row level security ----------
alter table public.invites enable row level security;
alter table public.profiles enable row level security;
alter table public.spaces enable row level security;
alter table public.items enable row level security;
alter table public.item_versions enable row level security;
alter table public.private_deletion_notices enable row level security;
alter table public.deletion_requests enable row level security;
alter table public.applied_ops enable row level security;
alter table public.conflicts enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (is_member());

create policy spaces_read on public.spaces for select to authenticated
  using ((visibility = 'shared' and is_member()) or owner_id = auth.uid());
create policy spaces_create on public.spaces for insert to authenticated
  with check (created_by = auth.uid() and ((visibility = 'shared' and is_member()) or owner_id = auth.uid()));
create policy spaces_rename on public.spaces for update to authenticated
  using ((visibility = 'shared' and is_member()) or owner_id = auth.uid());
-- No delete policy on spaces: removal is an owner workflow, never a cascade shortcut.

create function public.can_access_space(p_space uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from spaces s where s.id = p_space
    and ((s.visibility = 'shared' and is_member()) or s.owner_id = auth.uid()))
$$;

create policy items_read on public.items for select to authenticated using (can_access_space(space_id));
create policy items_create on public.items for insert to authenticated
  with check (created_by = auth.uid() and can_access_space(space_id));
create policy items_edit on public.items for update to authenticated
  using (can_access_space(space_id)) with check (can_access_space(space_id));
-- Hard delete only of your own private items; shared items are never hard-deleted by a normal client.
create policy items_delete_private on public.items for delete to authenticated
  using (space_visibility(space_id) = 'private' and can_access_space(space_id));

create policy item_versions_read on public.item_versions for select to authenticated
  using (exists (select 1 from items i where i.id = item_id));

create policy notices_owner_read on public.private_deletion_notices for select to authenticated using (is_owner());

create policy deletion_requests_read on public.deletion_requests for select to authenticated using (is_member());
create policy deletion_requests_create on public.deletion_requests for insert to authenticated
  with check (requested_by = auth.uid() and status = 'pending' and decided_by is null
    and exists (select 1 from items i where i.id = item_id and space_visibility(i.space_id) = 'shared'));

create policy applied_ops_own on public.applied_ops for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy conflicts_read on public.conflicts for select to authenticated
  using (exists (select 1 from items i where i.id = item_id));
create policy conflicts_create on public.conflicts for insert to authenticated
  with check (raised_by = auth.uid() and exists (select 1 from items i where i.id = item_id));

grant select on public.profiles, public.item_versions, public.private_deletion_notices to authenticated;
grant select, insert, update on public.spaces, public.deletion_requests, public.conflicts to authenticated;
grant select, insert, update, delete on public.items, public.applied_ops to authenticated;
revoke all on public.invites from authenticated, anon;
revoke execute on function public.decide_deletion(uuid, boolean), public.busy_slots(timestamptz, timestamptz),
  public.apply_op(jsonb) from public, anon;
grant execute on function public.decide_deletion(uuid, boolean), public.busy_slots(timestamptz, timestamptz),
  public.apply_op(jsonb) to authenticated;
