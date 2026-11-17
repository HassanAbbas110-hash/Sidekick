-- Deleting a client. Owner only, like other permanent deletions (spec §12). A client with any money history
-- (agreements, charges, payments) cannot be deleted, because the ledger is append-only: archive it instead.
-- Its files stay in the space; they are simply no longer filed under the client. Its edit history goes with it.
create function public.delete_client(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not is_owner() then raise exception 'owner_only' using errcode = '42501', hint = 'Only Hassan can delete clients. Archive it instead.'; end if;
  select id, space_id into c from clients where id = p_id;
  if not found or not can_access_space(c.space_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if exists (select 1 from agreements where client_id = p_id) or exists (select 1 from charges where client_id = p_id)
     or exists (select 1 from payments where client_id = p_id) then
    raise exception 'has_money_records' using errcode = '23503', hint = 'This client has money records. Archive it instead.';
  end if;
  delete from clients where id = p_id;
  return 'deleted';
end $$;
revoke execute on function public.delete_client(uuid) from public, anon;
grant execute on function public.delete_client(uuid) to authenticated;
