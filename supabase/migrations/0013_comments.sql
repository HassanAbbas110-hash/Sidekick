-- Comments on shared tasks and notes: a short thread inside the item, so the conversation lives with the work.
-- Append-only (like the money ledger): what was said stays said. Private items take no comments, because the
-- text would sit in plain form on the server.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('task_created', 'task_assigned', 'task_done',
  'deadline_changed', 'deletion_requested', 'deletion_decided', 'reminder', 'due_soon', 'comment'));

create table public.comments (
  id uuid primary key,
  item_id uuid not null references public.items (id) on delete cascade,
  space_id uuid not null references public.spaces (id),
  author uuid not null references public.profiles (id),
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index comments_item on public.comments (item_id, created_at);
create index comments_space on public.comments (space_id);

alter table public.comments enable row level security;
-- Readable by whoever can read the item (shared spaces: both of you).
create policy comments_read on public.comments for select to authenticated
  using (space_visibility(space_id) = 'shared' and exists (select 1 from items i where i.id = item_id));
grant select on public.comments to authenticated;
grant all on public.comments to service_role;

create function public.add_comment(p_op_id uuid, p_id uuid, p_item uuid, p_body text) returns text
language plpgsql security definer set search_path = public as $$
declare it record;
begin
  if auth.uid() is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  select i.id, i.space_id, i.kind, i.deleted_at into it from items i where i.id = p_item;
  if not found or it.deleted_at is not null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if space_visibility(it.space_id) <> 'shared' then
    raise exception 'comments_shared_only' using errcode = '22023', hint = 'Comments on private items would be readable on the server.';
  end if;
  if it.kind not in ('task', 'note') then raise exception 'comments_not_supported' using errcode = '22023'; end if;
  if exists (select 1 from comments where id = p_id) then return 'replayed'; end if; -- lost-ack replay from the outbox
  insert into comments (id, item_id, space_id, author, body) values (p_id, p_item, it.space_id, auth.uid(), trim(p_body));
  return 'added';
end $$;
revoke execute on function public.add_comment(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.add_comment(uuid, uuid, uuid, text) to authenticated;

-- Everyone else who can see the item hears about a new comment once.
create function public.notify_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare label text := coalesce((select nullif(title, '') from items where id = new.item_id), 'Untitled');
begin
  insert into notifications (user_id, kind, item_id, actor, title, body, dedupe_key)
  select p.id, 'comment', new.item_id, new.author, display_name(new.author) || ' commented on ' || label,
         left(new.body, 160), 'cmt:' || new.id || ':' || p.id
  from profiles p where p.id <> new.author
  on conflict (dedupe_key) do nothing;
  return null;
end $$;
create trigger comments_notify after insert on public.comments for each row execute function public.notify_comment();
