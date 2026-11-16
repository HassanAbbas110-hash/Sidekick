-- Links (kind 'link'): a web address saved in any space, shown as a card.
-- Only http(s) addresses are accepted, so a saved link can never run code when clicked.
-- In private spaces the address is encrypted on the device (stored as enc1:…), like titles.

alter table public.items
  add column url text,
  add constraint items_url_safe check (
    url is null
    or (url like 'enc1:%')
    or (url ~* '^https?://[^\s<>"]+$' and length(url) <= 2048));

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
             where key not in ('title', 'body', 'starts_at', 'ends_at', 'assignee', 'status', 'due_at', 'all_day', 'recur', 'task_id', 'url')) then
    raise exception 'unsupported_field' using errcode = '22023';
  end if;

  insert into applied_ops (op_id) values (v_op) on conflict do nothing;
  if not found then
    select a.result into prior from applied_ops a where a.user_id = auth.uid() and a.op_id = v_op;
    return prior || '{"replayed": true}';
  end if;

  if op->>'type' = 'create' then
    insert into items (id, space_id, kind, title, body, starts_at, ends_at, assignee, status, due_at, all_day, recur, task_id, url)
    values (v_id, (op->>'space_id')::uuid, op->>'kind', f->>'title', f->>'body',
            (f->>'starts_at')::timestamptz, (f->>'ends_at')::timestamptz,
            (f->>'assignee')::uuid, f->>'status', (f->>'due_at')::timestamptz,
            coalesce((f->>'all_day')::boolean, false), nullif(f->'recur', 'null'::jsonb), (f->>'task_id')::uuid, f->>'url');
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
        task_id   = case when 'task_id' = any(applied) then (f->>'task_id')::uuid else task_id end,
        url       = case when 'url' = any(applied) then f->>'url' else url end
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
