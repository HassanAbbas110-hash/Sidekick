-- Live check of the privacy/deletion/sync rules on the hosted Supabase project.
-- Everything runs in one DO block that always ends by raising an exception, so every fixture
-- (fictional users, spaces, items) is rolled back. Results come back inside that final message.
-- Run: npm run test:live
do $$
declare
  h uuid := gen_random_uuid();
  m uuid := gen_random_uuid();
  shared_space uuid;
  h_priv uuid;
  m_priv uuid;
  task uuid;
  m_note uuid;
  h_note uuid;
  req uuid;
  n int;
  t text;
  op jsonb;
  r1 jsonb;
  r2 jsonb;
  res jsonb := '{}';
begin
  -- ---------- setup as the privileged role ----------
  insert into invites values ('live-owner@example.test', 'owner'), ('live-member@example.test', 'member');
  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'not-invited@example.test');
    res := res || '{"A1 uninvited sign-up rejected": false}';
  exception when others then
    res := res || jsonb_build_object('A1 uninvited sign-up rejected', sqlerrm like '%not_invited%');
  end;
  insert into auth.users (id, email) values (h, 'live-owner@example.test'), (m, 'live-member@example.test');
  select count(*) into n from profiles where id in (h, m);
  res := res || jsonb_build_object('A1 invited users get profiles', n = 2);

  insert into spaces (name, visibility, owner_id, created_by) values ('Live shared', 'shared', null, h) returning id into shared_space;
  insert into spaces (name, visibility, owner_id, created_by) values ('enc:h', 'private', h, h) returning id into h_priv;
  insert into spaces (name, visibility, owner_id, created_by) values ('enc:m', 'private', m, m) returning id into m_priv;

  -- ---------- as the marketer ----------
  perform set_config('request.jwt.claims', jsonb_build_object('sub', m, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into items (space_id, kind, title) values (shared_space, 'task', 'Live task') returning id into task;
  insert into items (space_id, kind, title) values (m_priv, 'note', 'enc:secret') returning id into m_note;
  insert into items (space_id, kind, title, starts_at, ends_at)
    values (m_priv, 'event', 'enc:busy', '2026-11-17T08:00:00Z', '2026-11-17T10:00:00Z');

  begin
    update items set deleted_at = now() where id = task;
    res := res || '{"A5 member cannot trash shared": false}';
  exception when others then
    res := res || jsonb_build_object('A5 member cannot trash shared', sqlerrm like '%shared_deletion_requires_owner%');
  end;
  begin
    update items set space_id = m_priv where id = task;
    res := res || '{"A5 member cannot privatise shared": false}';
  exception when others then
    res := res || jsonb_build_object('A5 member cannot privatise shared', sqlerrm like '%shared_to_private_requires_owner%');
  end;
  begin
    update spaces set visibility = 'private', owner_id = m where id = shared_space;
    res := res || '{"A5 space visibility immutable": false}';
  exception when others then
    res := res || jsonb_build_object('A5 space visibility immutable', sqlerrm like '%space_visibility_immutable%');
  end;
  delete from items where id = task;
  get diagnostics n = row_count;
  res := res || jsonb_build_object('A5 member cannot hard-delete shared', n = 0);

  insert into deletion_requests (item_id, item_version, reason)
    select id, version, 'live check' from items where id = task returning id into req;
  begin
    perform decide_deletion(req, true);
    res := res || '{"A5 member cannot approve deletion": false}';
  exception when others then
    res := res || jsonb_build_object('A5 member cannot approve deletion', sqlerrm like '%owner_only%');
  end;

  op := jsonb_build_object('op_id', gen_random_uuid(), 'type', 'create', 'id', gen_random_uuid(),
    'space_id', shared_space, 'kind', 'note', 'fields', jsonb_build_object('title', 'Synced once'));
  r1 := apply_op(op);
  r2 := apply_op(op);
  select count(*) into n from items where id = (op->>'id')::uuid;
  res := res || jsonb_build_object('A9 replayed op applied once', n = 1 and (r2->>'replayed')::boolean);

  update items set deleted_at = now() where id = m_note;

  -- ---------- as Hassan (owner) ----------
  perform set_config('request.jwt.claims', jsonb_build_object('sub', h, 'role', 'authenticated')::text, true);
  insert into items (space_id, kind, title) values (h_priv, 'note', 'enc:his') returning id into h_note;
  select count(*) into n from items where id = m_note;
  res := res || jsonb_build_object('A3 owner cannot read member private item', n = 0);
  update items set title = 'x' where id = m_note;
  get diagnostics n = row_count;
  res := res || jsonb_build_object('A3 owner cannot edit member private item', n = 0);
  select count(*) into n from item_versions where item_id = m_note;
  res := res || jsonb_build_object('A3 owner cannot read member private history', n = 0);
  select created_by::text into t from items where id = task;
  res := res || jsonb_build_object('A2 owner sees shared task with actor', t = m::text);

  select string_agg(k, ',' order by k) into t
    from (select jsonb_object_keys(to_jsonb(b)) as k from busy_slots('2026-11-17', '2026-11-18') b) x;
  res := res || jsonb_build_object('A4 busy slots carry only owner and times', t = 'ends_at,starts_at,user_id');
  select count(*) into n from private_deletion_notices where actor = m and category = 'private_note' and action = 'trashed';
  res := res || jsonb_build_object('A6 owner gets redacted notice', n = 1);

  update items set body = 'edited after request' where id = task;
  res := res || jsonb_build_object('A5 approval after edit is stale', decide_deletion(req, true) = 'stale');

  -- ---------- as the marketer again ----------
  perform set_config('request.jwt.claims', jsonb_build_object('sub', m, 'role', 'authenticated')::text, true);
  select count(*) into n from items where id = h_note;
  res := res || jsonb_build_object('A3 member cannot read owner private item', n = 0);
  select count(*) into n from private_deletion_notices;
  res := res || jsonb_build_object('A6 member cannot read notices', n = 0);

  -- ---------- signed out ----------
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
  begin
    select count(*) into n from items;
    res := res || jsonb_build_object('anon sees no items', n = 0);
  exception when insufficient_privilege then
    res := res || '{"anon sees no items": true}';
  end;

  perform set_config('role', 'none', true);
  raise exception 'LIVE_RESULTS %', res; -- always roll back
end $$;
