-- Tasks get an accountable assignee, a status and a due date (spec §9).
-- Also: explicit-only grants (Supabase's defaults give anon/authenticated broad table rights;
-- RLS already blocked them, now the grants do too), and typed empty arrays in apply_op (db lint).

alter table public.items
  add column assignee uuid references public.profiles (id),
  add column status text check (status in ('open', 'in_progress', 'waiting', 'done')),
  add column due_at timestamptz;

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
             where key not in ('title', 'body', 'starts_at', 'ends_at', 'assignee', 'status', 'due_at')) then
    raise exception 'unsupported_field' using errcode = '22023';
  end if;

  insert into applied_ops (op_id) values (v_op) on conflict do nothing;
  if not found then
    select a.result into prior from applied_ops a where a.user_id = auth.uid() and a.op_id = v_op;
    return prior || '{"replayed": true}';
  end if;

  if op->>'type' = 'create' then
    insert into items (id, space_id, kind, title, body, starts_at, ends_at, assignee, status, due_at)
    values (v_id, (op->>'space_id')::uuid, op->>'kind', f->>'title', f->>'body',
            (f->>'starts_at')::timestamptz, (f->>'ends_at')::timestamptz,
            (f->>'assignee')::uuid, f->>'status', (f->>'due_at')::timestamptz);
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
        ends_at   = case when 'ends_at' = any(applied) then (f->>'ends_at')::timestamptz else ends_at end,
        assignee  = case when 'assignee' = any(applied) then (f->>'assignee')::uuid else assignee end,
        status    = case when 'status' = any(applied) then f->>'status' else status end,
        due_at    = case when 'due_at' = any(applied) then (f->>'due_at')::timestamptz else due_at end
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

-- ---------- explicit grants only ----------
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;

grant select on public.profiles, public.item_versions, public.private_deletion_notices to authenticated;
grant select, insert, update on public.spaces, public.deletion_requests, public.conflicts to authenticated;
grant select, insert, update, delete on public.items, public.applied_ops to authenticated;
-- Policies call helper functions, which needs EXECUTE for the signed-in role.
grant execute on all functions in schema public to authenticated, service_role;
