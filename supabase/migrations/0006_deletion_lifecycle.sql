-- Shared deletion lifecycle (spec §12): active → deletion requested → approved into trash (or rejected)
-- → restored, or permanently deleted by Hassan with explicit confirmation.
-- The marketer asks; only Hassan decides. Every decision is checked against the item's current version.

alter table public.deletion_requests
  add column action text not null default 'delete' check (action in ('delete', 'restore'));

-- One open request per item at a time.
create unique index deletion_requests_one_pending on public.deletion_requests (item_id) where status = 'pending';

drop policy deletion_requests_create on public.deletion_requests;
create policy deletion_requests_create on public.deletion_requests for insert to authenticated
  with check (requested_by = auth.uid() and status = 'pending' and decided_by is null
    and exists (select 1 from items i where i.id = item_id and space_visibility(i.space_id) = 'shared'
                and (case when action = 'restore' then i.deleted_at is not null else i.deleted_at is null end)));

create or replace function public.decide_deletion(p_request uuid, p_approve boolean) returns text
language plpgsql security definer set search_path = public as $$
declare req deletion_requests; cur items; outcome text;
begin
  if not is_owner() then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  select * into req from deletion_requests where id = p_request and status = 'pending' for update;
  if not found then
    raise exception 'request_not_pending' using errcode = 'P0002';
  end if;
  select * into cur from items where id = req.item_id for update;
  if cur.version <> req.item_version then
    outcome := 'stale'; -- changed since the request: the requester must look again and re-ask
  elsif not p_approve then
    outcome := 'rejected';
  elsif req.action = 'delete' then
    update items set deleted_at = now() where id = req.item_id;
    outcome := 'approved';
  else
    update items set deleted_at = null where id = req.item_id;
    outcome := 'approved';
  end if;
  update deletion_requests set status = outcome, decided_by = auth.uid(), decided_at = now() where id = p_request;
  return outcome;
end $$;

-- Minimal, content-free record that something was permanently removed (no title, no body).
create table public.purge_log (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  kind text not null,
  space_id uuid not null,
  purged_by uuid not null references public.profiles (id),
  purged_at timestamptz not null default now()
);
alter table public.purge_log enable row level security;
create policy purge_log_read on public.purge_log for select to authenticated using (is_member());
grant select on public.purge_log to authenticated;

-- Permanent deletion: Hassan only, only from the trash, only with the typed confirmation.
-- Removes the item, its revision history and requests; inbox rows keep their event but lose the item text.
create function public.purge_item(p_item uuid, p_confirm text) returns void
language plpgsql security definer set search_path = public as $$
declare cur items;
begin
  if not is_owner() then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  if p_confirm is distinct from 'DELETE' then
    raise exception 'confirmation_required' using errcode = '22023';
  end if;
  select * into cur from items where id = p_item for update;
  if not found or space_visibility(cur.space_id) <> 'shared' then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if cur.deleted_at is null then
    raise exception 'move_to_trash_first' using errcode = '22023';
  end if;
  insert into purge_log (item_id, kind, space_id, purged_by) values (cur.id, cur.kind, cur.space_id, auth.uid());
  update notifications set body = 'Permanently deleted', item_id = null where item_id = cur.id;
  delete from deletion_requests where item_id = cur.id;
  delete from conflicts where item_id = cur.id;
  delete from items where id = cur.id; -- item_versions cascade
end $$;

-- Hassan may move shared items to the trash directly (the items_guard already limits this to the owner).
create function public.trash_item(p_item uuid) returns void
language plpgsql set search_path = public as $$
begin
  update items set deleted_at = now() where id = p_item and deleted_at is null;
  if not found then
    raise exception 'not_found_or_already_in_trash' using errcode = 'P0002';
  end if;
end $$;

-- Inbox wording for restore requests.
create or replace function public.notify_deletion_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare label text := coalesce((select nullif(title, '') from items where id = new.item_id), 'Untitled');
begin
  if tg_op = 'INSERT' then
    insert into notifications (user_id, kind, item_id, actor, title, body, dedupe_key)
    select o.id, 'deletion_requested', new.item_id, new.requested_by,
           display_name(new.requested_by) || case when new.action = 'restore' then ' asked to restore an item' else ' asked to delete an item' end,
           label || ' — ' || new.reason,
           'delreq:' || new.id || ':' || o.id
    from profiles o where o.role = 'owner' and o.id <> new.requested_by
    on conflict (dedupe_key) do nothing;
  elsif new.status <> old.status and new.requested_by <> coalesce(new.decided_by, new.requested_by) then
    insert into notifications (user_id, kind, item_id, actor, title, body, dedupe_key)
    values (new.requested_by, 'deletion_decided', new.item_id, new.decided_by,
            case new.action when 'restore' then 'Restore request ' else 'Deletion request ' end || new.status, label,
            'deldec:' || new.id || ':' || new.status)
    on conflict (dedupe_key) do nothing;
  end if;
  return null;
end $$;

grant execute on function public.purge_item(uuid, text), public.trash_item(uuid) to authenticated;
