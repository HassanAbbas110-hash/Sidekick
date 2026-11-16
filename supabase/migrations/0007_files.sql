-- Files and photos (spec §6). A file is an item of kind 'file' (so trash, deletion approval, notifications and
-- revisions all apply). Each upload is a new, immutable version; nothing is overwritten. A version only becomes
-- available after the server confirms the stored object exists with the declared size.
-- Shared spaces only until private files are encrypted on the device (docs/architecture.md §3).

create table public.file_versions (
  item_id uuid not null references public.items (id) on delete cascade,
  version int not null,
  storage_path text not null unique,
  original_name text not null,
  mime text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800), -- 50 MB: Supabase free plan per-file limit
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  state text not null default 'pending' check (state in ('pending', 'verified', 'missing')),
  review text check (review in ('received', 'reviewing', 'approved', 'used')), -- a label, not automatic verification
  uploaded_by uuid not null default auth.uid() references public.profiles (id),
  uploaded_at timestamptz not null default now(),
  verified_at timestamptz,
  op_id uuid not null unique,
  primary key (item_id, version)
);

-- One file can be referenced from several tasks/notes/clients without copying it.
create table public.file_links (
  file_id uuid not null references public.items (id) on delete cascade,
  target_item uuid references public.items (id) on delete cascade,
  target_client uuid references public.clients (id) on delete cascade,
  linked_by uuid not null default auth.uid() references public.profiles (id),
  linked_at timestamptz not null default now(),
  check ((target_item is null) <> (target_client is null))
);
create unique index file_links_item on public.file_links (file_id, target_item) where target_item is not null;
create unique index file_links_client on public.file_links (file_id, target_client) where target_client is not null;

-- Latest verified version per file, for lists.
create view public.files_current with (security_invoker = true) as
select distinct on (i.id)
       i.id, i.space_id, i.title, i.body, i.created_by, i.updated_at, i.deleted_at, i.version as item_version,
       v.version, v.storage_path, v.original_name, v.mime, v.size_bytes, v.sha256, v.review, v.uploaded_by, v.uploaded_at
from items i join file_versions v on v.item_id = i.id and v.state = 'verified'
where i.kind = 'file'
order by i.id, v.version desc;

create function public.safe_name(p text) returns text language sql immutable as $$
  select left(regexp_replace(coalesce(nullif(trim(p), ''), 'file'), '[^A-Za-z0-9._-]+', '-', 'g'), 80)
$$;

-- Step 1: reserve a version and get the storage path to upload to. Idempotent by op_id (offline retries).
-- p_item null = a new file in p_space; otherwise a new version of that file.
create function public.begin_file_upload(p_op_id uuid, p_space uuid, p_item uuid, p_name text, p_mime text,
                                         p_size bigint, p_sha256 text) returns jsonb
language plpgsql set search_path = public as $$
declare v file_versions; it items; next_v int;
begin
  select * into v from file_versions where op_id = p_op_id;
  if found then
    return jsonb_build_object('item_id', v.item_id, 'version', v.version, 'path', v.storage_path, 'state', v.state, 'replayed', true);
  end if;
  if p_item is null then
    if space_visibility(p_space) <> 'shared' then
      raise exception 'private_files_need_encryption' using errcode = '0A000';
    end if;
    insert into items (space_id, kind, title) values (p_space, 'file', p_name) returning * into it;
    next_v := 1;
  else
    select * into it from items where id = p_item and kind = 'file';
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    if it.deleted_at is not null then raise exception 'file_in_trash' using errcode = '22023'; end if;
    select coalesce(max(version), 0) + 1 into next_v from file_versions where item_id = it.id;
  end if;
  insert into file_versions (item_id, version, storage_path, original_name, mime, size_bytes, sha256, op_id)
  values (it.id, next_v, it.space_id || '/' || it.id || '/v' || next_v || '-' || safe_name(p_name),
          p_name, coalesce(nullif(p_mime, ''), 'application/octet-stream'), p_size, lower(p_sha256), p_op_id)
  returning * into v;
  return jsonb_build_object('item_id', v.item_id, 'version', v.version, 'path', v.storage_path, 'state', v.state, 'replayed', false);
end $$;

-- Step 2: after the bytes are uploaded, confirm the stored object exists with the declared size.
-- Where the storage schema is absent (local test database) the check is skipped and reported as such.
create function public.finish_file_upload(p_item uuid, p_version int) returns text
language plpgsql security definer set search_path = public as $$
declare v file_versions; stored bigint; has_storage boolean := to_regclass('storage.objects') is not null;
begin
  select * into v from file_versions where item_id = p_item and version = p_version for update;
  if not found or not can_access_space((select space_id from items where id = p_item)) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v.state = 'verified' then return 'verified'; end if;
  if has_storage then
    execute 'select (metadata->>''size'')::bigint from storage.objects where bucket_id = ''sidekick-files'' and name = $1'
      into stored using v.storage_path;
    if stored is null then return 'not_uploaded'; end if;
    if stored <> v.size_bytes then
      update file_versions set state = 'missing' where item_id = p_item and version = p_version;
      return 'size_mismatch';
    end if;
  end if;
  update file_versions set state = 'verified', verified_at = now() where item_id = p_item and version = p_version;
  update items set body = body where id = p_item; -- bumps the item version so both devices see the change
  return case when has_storage then 'verified' else 'verified_without_storage_check' end;
end $$;

-- Permanent deletion of a trashed file: returns the storage paths so the app can remove the bytes
-- (Supabase blocks deleting stored objects from SQL). Metadata goes first: an orphaned object is
-- recoverable clutter, a record pointing at missing bytes is not.
create function public.purge_file(p_item uuid, p_confirm text) returns text[]
language plpgsql security definer set search_path = public as $$
declare paths text[];
begin
  select array_agg(storage_path) into paths from file_versions where item_id = p_item;
  perform purge_item(p_item, p_confirm); -- owner, trash and confirmation checks live there
  return coalesce(paths, '{}');
end $$;

alter table public.file_versions enable row level security;
alter table public.file_links enable row level security;
create policy file_versions_read on public.file_versions for select to authenticated
  using (exists (select 1 from items i where i.id = item_id));
create policy file_versions_create on public.file_versions for insert to authenticated
  with check (uploaded_by = auth.uid() and exists (select 1 from items i where i.id = item_id and i.kind = 'file'));
create policy file_versions_review on public.file_versions for update to authenticated
  using (exists (select 1 from items i where i.id = item_id));
create policy file_links_read on public.file_links for select to authenticated
  using (exists (select 1 from items i where i.id = file_id));
create policy file_links_create on public.file_links for insert to authenticated
  with check (linked_by = auth.uid() and exists (select 1 from items i where i.id = file_id)
    and (target_item is null or exists (select 1 from items t where t.id = target_item))
    and (target_client is null or can_access_client(target_client)));
create policy file_links_remove on public.file_links for delete to authenticated
  using (exists (select 1 from items i where i.id = file_id)); -- removing a reference never deletes the file

grant select, insert on public.file_versions to authenticated;
grant update (review) on public.file_versions to authenticated; -- only the review label can change
grant select, insert, delete on public.file_links to authenticated;
grant select on public.files_current to authenticated;
grant execute on function public.begin_file_upload(uuid, uuid, uuid, text, text, bigint, text),
  public.finish_file_upload(uuid, int), public.purge_file(uuid, text), public.safe_name(text) to authenticated;

-- ---------- hosted storage: private bucket and access rules (skipped where storage is absent) ----------
create function public.storage_path_space(p_name text) returns uuid
language sql immutable as $$
  select case when p_name ~ '^[0-9a-f-]{36}/' then split_part(p_name, '/', 1)::uuid end
$$;

create function public.upload_slot_open(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from file_versions v where v.storage_path = p_name and v.state = 'pending' and v.uploaded_by = auth.uid())
$$;

create function public.orphaned_path(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from file_versions v where v.storage_path = p_name)
$$;
grant execute on function public.storage_path_space(text), public.upload_slot_open(text), public.orphaned_path(text) to authenticated;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema absent: bucket and storage policies not installed';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit)
  values ('sidekick-files', 'sidekick-files', false, 52428800)
  on conflict (id) do update set public = false, file_size_limit = 52428800;

  -- Read: anyone who can see the space. Download links are short-lived signed URLs, never public links.
  execute $p$create policy sidekick_files_read on storage.objects for select to authenticated
    using (bucket_id = 'sidekick-files' and public.can_access_space(public.storage_path_space(name)))$p$;
  -- Upload: only into a path reserved by begin_file_upload for this user, still pending.
  execute $p$create policy sidekick_files_upload on storage.objects for insert to authenticated
    with check (bucket_id = 'sidekick-files' and public.upload_slot_open(name))$p$;
  -- Remove bytes: Hassan only, and only once nothing in the database points at them any more.
  execute $p$create policy sidekick_files_remove on storage.objects for delete to authenticated
    using (bucket_id = 'sidekick-files' and public.is_owner() and public.orphaned_path(name))$p$;
  -- No update policy: stored versions are never overwritten.
end $$;
