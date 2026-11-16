-- Search across shared work (spec §6, §14). Runs as the caller (security invoker), so row level security
-- decides what can be found: a search can never return anything the person could not already open.
-- Private items are excluded here on purpose: they are ciphertext on the server and are searched on the
-- device after decryption instead. Trash is only included when asked for.
-- shortcut: substring matching (ILIKE) — fine for thousands of records; add a trigram or full-text index
-- if searches slow down at the spec's profiling scale (5,000 tasks / 2,000 notes).

create function public.search_all(p_q text, p_include_trash boolean default false, p_limit int default 60)
returns table (kind text, id uuid, space_id uuid, title text, snippet text, extra text, updated_at timestamptz, trashed boolean, rank int)
language sql stable security invoker set search_path = public as $$
  with q as (
    -- escape LIKE wildcards so "%" or "_" in a search are matched literally
    select '%' || replace(replace(replace(trim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  ), hits as (
    select i.kind, i.id, i.space_id, i.title, left(coalesce(nullif(i.body, ''), i.url, ''), 200) as snippet, i.url as extra,
           i.updated_at, i.deleted_at is not null as trashed,
           case when i.title ilike q.pat then 0 else 1 end as rank
    from items i, q
    where i.kind in ('task', 'note', 'link', 'event') and space_visibility(i.space_id) = 'shared'
      and (p_include_trash or i.deleted_at is null)
      and (i.title ilike q.pat or i.body ilike q.pat or i.url ilike q.pat)
    union all
    select 'file', f.id, f.space_id, coalesce(f.title, f.original_name), f.original_name, f.mime,
           f.uploaded_at, f.deleted_at is not null,
           case when coalesce(f.title, '') ilike q.pat or f.original_name ilike q.pat then 0 else 1 end
    from files_current f, q
    where (p_include_trash or f.deleted_at is null)
      and (f.title ilike q.pat or f.original_name ilike q.pat or f.body ilike q.pat)
    union all
    select 'client', c.id, c.space_id, c.name,
           concat_ws(', ', nullif(c.contact_name, ''), nullif(c.email, ''), left(nullif(c.notes, ''), 120)), c.stage,
           c.updated_at, c.stage = 'archived',
           case when c.name ilike q.pat then 0 else 1 end
    from clients c, q
    where (p_include_trash or c.stage <> 'archived')
      and (c.name ilike q.pat or c.contact_name ilike q.pat or c.email ilike q.pat or c.phone ilike q.pat or c.notes ilike q.pat)
  )
  select * from hits
  where length(trim(p_q)) >= 2
  order by rank, updated_at desc
  limit least(greatest(p_limit, 1), 200)
$$;

revoke execute on function public.search_all(text, boolean, int) from public, anon;
grant execute on function public.search_all(text, boolean, int) to authenticated;
