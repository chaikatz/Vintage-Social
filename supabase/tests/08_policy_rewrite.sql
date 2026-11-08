-- 0023 rewrote 73 policies so they read the caller once a statement
-- instead of once a row. This proves the rewrite changed nothing anyone
-- may do.
--
-- A small club with something of every kind in every table: a public
-- member and a private one, an accepted follower and one still asking,
-- a block each way, a removed photograph and a removed comment, tags
-- pending, accepted and declined, threads across a block and not, an
-- applicant, a suspended member, an admin, files in four folders. Then
-- eleven callers (those, the admin, a second member and a signed-out
-- visitor) each try, against every table under row-level security:
--
--   * to read it: how many rows they see, and which, to the byte;
--   * to update every row: changing nothing, changing who it belongs to
--     (to themselves, to someone else), and the columns a policy guards
--     (status, role, removal, counts, read marks);
--   * to delete every row;
--   * to insert a copy of every row, as it is and as their own.
--
-- Every attempt is undone after it is made, so each one meets the same
-- club. The answers are kept: OK and how many rows, DENIED, or the error.
-- Then the policies are put back exactly as they were before 0023 (the
-- runner kept them, supabase/tests/snapshot_before_0023.sql), along with
-- any function a later migration has changed, and every attempt is made
-- again. The two sets of answers must be identical, attempt for attempt.
--
-- Also here: no policy 0023 rewrote still reads the caller per row, and
-- no index that existed before 0023 is gone.
--
-- Runs in one transaction and rolls back.

begin;

set local search_path = public, extensions;

create temp table rewrite_start as select coalesce(max(seq), 0) as seq from tests.results;

-- ---------------------------------------------------------------------------
-- the club
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('b0000000-0000-4000-8000-000000000001', 'pub@rewrite.test',       '{"username":"rw.public"}'),
  ('b0000000-0000-4000-8000-000000000002', 'priv@rewrite.test',      '{"username":"rw.private"}'),
  ('b0000000-0000-4000-8000-000000000003', 'fol@rewrite.test',       '{"username":"rw.follower"}'),
  ('b0000000-0000-4000-8000-000000000004', 'ask@rewrite.test',       '{"username":"rw.asking"}'),
  ('b0000000-0000-4000-8000-000000000005', 'blocker@rewrite.test',   '{"username":"rw.blocker"}'),
  ('b0000000-0000-4000-8000-000000000006', 'blocked@rewrite.test',   '{"username":"rw.blocked"}'),
  ('b0000000-0000-4000-8000-000000000007', 'applicant@rewrite.test', '{"username":"rw.applicant"}');
update public.profiles set status = 'approved', approved_at = now()
 where id::text like 'b0000000-0000-4000-8000-00000000000_' and id <> 'b0000000-0000-4000-8000-000000000007';
update public.profiles set is_private = true where id = 'b0000000-0000-4000-8000-000000000002';

insert into public.follows (follower_id, followee_id, status) values
  ('b0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002', 'accepted'),
  ('b0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000002', 'pending'),
  ('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'accepted'),
  ('b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'accepted'),
  ('b0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000003', 'accepted'),
  ('b0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000001', 'accepted');

insert into public.posts (id, author_id, media_type, media_path, filter_id, caption, taken_at) values
  ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'photo', 'b0000000-0000-4000-8000-000000000001/1.jpg', 'kodachrome', 'public', now() - interval '2 years'),
  ('b1000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'photo', 'b0000000-0000-4000-8000-000000000002/1.jpg', 'kodachrome', 'private', null),
  ('b1000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000005', 'video', 'b0000000-0000-4000-8000-000000000005/1.mp4', 'kodachrome', 'blocker', null),
  ('b1000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000006', 'photo', 'b0000000-0000-4000-8000-000000000006/1.jpg', 'kodachrome', 'blocked', null),
  ('b1000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001', 'photo', 'b0000000-0000-4000-8000-000000000001/2.jpg', 'kodachrome', 'removed', null),
  ('b1000000-0000-4000-8000-000000000006', '11111111-1111-1111-1111-111111111111', 'photo', '11111111-1111-1111-1111-111111111111/rw.jpg', 'kodachrome', 'admin', null);
update public.posts set removed_at = now(), removed_by = '11111111-1111-1111-1111-111111111111'
 where id = 'b1000000-0000-4000-8000-000000000005';

insert into public.likes (post_id, user_id) values
  ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002'),
  ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000005'),
  ('b1000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003'),
  ('b1000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000004'),
  ('b1000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001');

insert into public.comments (id, post_id, author_id, body) values
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'from the private member'),
  ('b2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000005', 'from the blocker'),
  ('b2000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003', 'from the follower'),
  ('b2000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', 'on the blocked one');
update public.comments set removed_at = now(), removed_by = '11111111-1111-1111-1111-111111111111'
 where id = 'b2000000-0000-4000-8000-000000000003';

insert into public.post_tags (post_id, user_id, tagged_by, status) values
  ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'pending'),
  ('b1000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002', 'accepted'),
  ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', 'declined'),
  ('b1000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000006', 'accepted');

insert into public.conversations (id, user_a, user_b) values
  ('b3000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002'),
  ('b3000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000005'),
  ('b3000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003');
insert into public.messages (conversation_id, sender_id, body, post_id, read_at) values
  ('b3000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'hello', null, now()),
  ('b3000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', '', 'b1000000-0000-4000-8000-000000000002', null),
  ('b3000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000005', 'before the block', null, null),
  ('b3000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003', 'see you', null, null);

-- The blocks come after the rows they now hide.
insert into public.blocks (blocker_id, blocked_id) values
  ('b0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000006');

insert into public.activity (recipient_id, actor_id, type, message) values
  ('b0000000-0000-4000-8000-000000000001', null, 'moderation', 'A note from the admins.'),
  ('b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000006', 'message', null);

insert into public.applications (user_id, full_name, desired_username, reason) values
  ('b0000000-0000-4000-8000-000000000007', 'An Applicant', 'rw.applicant', 'I take photographs.');

insert into public.reports (reporter_id, target_type, post_id, reason) values
  ('b0000000-0000-4000-8000-000000000001', 'post', 'b1000000-0000-4000-8000-000000000003', 'Spam or scam');
insert into public.reports (reporter_id, target_type, profile_id, reason, status, resolved_by, resolved_at) values
  ('b0000000-0000-4000-8000-000000000003', 'profile', 'b0000000-0000-4000-8000-000000000006', 'Harassment or abuse',
   'resolved', '11111111-1111-1111-1111-111111111111', now());

insert into public.moderation_actions (admin_id, target_profile_id, action, note) values
  ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-4000-8000-000000000001', 'warning', 'Be kind.');

insert into public.invites (code, created_by, used_by, used_at) values
  ('RWAB-CD23', 'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', now());
insert into public.invite_links (owner_id, slug) values
  ('b0000000-0000-4000-8000-000000000001', 'rw-public');

insert into public.push_tokens (token, user_id, platform) values
  ('ExponentPushToken[rw-public]', 'b0000000-0000-4000-8000-000000000001', 'ios'),
  ('ExponentPushToken[rw-private]', 'b0000000-0000-4000-8000-000000000002', 'ios');
insert into public.notification_prefs (user_id, likes) values
  ('b0000000-0000-4000-8000-000000000001', false);

insert into public.post_shares (token, post_id, owner_id, format, theme) values
  ('b4000000000040008000000000000001', 'b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'print', 'paper');
insert into public.share_events (kind, actor_id, post_id) values
  ('share_started', 'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001');
insert into public.share_events (kind, post_id, token) values
  ('page_opened', 'b1000000-0000-4000-8000-000000000001', 'b4000000000040008000000000000001');

insert into public.era_edits (author_id, titles) values
  ('b0000000-0000-4000-8000-000000000001', '{"Lisbon 2023":"The long weekend"}'),
  ('b0000000-0000-4000-8000-000000000002', '{"Winter 2024":"Snowed in"}');

insert into storage.objects (bucket_id, name, owner_id) values
  ('avatars',    'b0000000-0000-4000-8000-000000000001/avatar.jpg', 'b0000000-0000-4000-8000-000000000001'),
  ('avatars',    'b0000000-0000-4000-8000-000000000007/avatar.jpg', 'b0000000-0000-4000-8000-000000000007'),
  ('media',      'b0000000-0000-4000-8000-000000000001/1.jpg',      'b0000000-0000-4000-8000-000000000001'),
  ('thumbnails', 'b0000000-0000-4000-8000-000000000002/1.jpg',      'b0000000-0000-4000-8000-000000000002'),
  ('media',      'b0000000-0000-4000-8000-000000000006/1.jpg',      'b0000000-0000-4000-8000-000000000006');

-- ---------------------------------------------------------------------------
-- who asks
-- ---------------------------------------------------------------------------
create temp table rw_viewers (label text primary key, uid uuid);
insert into rw_viewers values
  ('admin',     '11111111-1111-1111-1111-111111111111'),
  ('second',    '22222222-2222-2222-2222-222222222222'),
  ('suspended', '55555555-5555-5555-5555-555555555555'),
  ('public',    'b0000000-0000-4000-8000-000000000001'),
  ('private',   'b0000000-0000-4000-8000-000000000002'),
  ('follower',  'b0000000-0000-4000-8000-000000000003'),
  ('asking',    'b0000000-0000-4000-8000-000000000004'),
  ('blocker',   'b0000000-0000-4000-8000-000000000005'),
  ('blocked',   'b0000000-0000-4000-8000-000000000006'),
  ('applicant', 'b0000000-0000-4000-8000-000000000007'),
  ('signed out', null);

-- Every table a policy governs, and the rows to try (at most 24 a table,
-- this club's first, so the matrix stays a few seconds).
create temp table rw_tables as
select c.oid::regclass as tbl
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r' and c.relrowsecurity and n.nspname in ('public', 'storage');

create temp table rw_rows (tbl regclass, row_ctid tid, row_json jsonb);
do $rows$
declare t record;
begin
  for t in select tbl from rw_tables loop
    execute format(
      'insert into rw_rows select %L::regclass, r.ctid, to_jsonb(r) from %s r
        order by (to_jsonb(r)::text ~ %L) desc, r.ctid limit 24',
      t.tbl, t.tbl, '(b[0-4]000000-0000-4000-8000|rw[.-]|RWAB)');
  end loop;
end
$rows$;

-- What each attempt is: a statement, with :caller: where the caller's id goes.
create temp table rw_attempts (id serial primary key, op text, tbl regclass, row_ctid tid, variant text, sql text);

do $attempts$
declare
  r record;
  c record;
  v_cols text[];
  v_noop text;
  v_json jsonb;
  v_where text;
begin
  for r in select * from rw_rows loop
    v_where := format(' where ctid = %L', r.row_ctid);

    -- Changing nothing: the read mark where a table has one (the one
    -- column members may update on messages), else the first column.
    select array_agg(attname::text order by attnum) into v_cols
    from pg_attribute where attrelid = r.tbl and attnum > 0 and not attisdropped;
    v_noop := case when 'read_at' = any (v_cols) then 'read_at' else v_cols[1] end;
    insert into rw_attempts (op, tbl, row_ctid, variant, sql)
    values ('update', r.tbl, r.row_ctid, 'nothing', format('update %s set %I = %I', r.tbl, v_noop, v_noop) || v_where);

    insert into rw_attempts (op, tbl, row_ctid, variant, sql)
    values ('delete', r.tbl, r.row_ctid, 'delete', format('delete from %s', r.tbl) || v_where);

    -- A copy of the row, as it is; with a fresh id where it has one.
    v_json := r.row_json;
    if v_json ? 'id' and r.tbl <> 'public.profiles'::regclass then
      v_json := v_json || jsonb_build_object('id', gen_random_uuid());
    end if;
    if r.tbl = 'storage.objects'::regclass then
      v_json := v_json || jsonb_build_object('name', (v_json->>'name') || '.copy');
    end if;
    insert into rw_attempts (op, tbl, row_ctid, variant, sql)
    values ('insert', r.tbl, r.row_ctid, 'copy',
            format('insert into %s select * from jsonb_populate_record(null::%s, %L::jsonb)', r.tbl, r.tbl, v_json));

    -- Every column that names a member: given to the caller, given to
    -- someone else, on the row and on a copy.
    for c in
      select a.attname::text as col
      from pg_constraint k
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
      where k.conrelid = r.tbl and k.contype = 'f' and k.confrelid = 'public.profiles'::regclass
        and array_length(k.conkey, 1) = 1
    loop
      insert into rw_attempts (op, tbl, row_ctid, variant, sql) values
        ('update', r.tbl, r.row_ctid, c.col || ' = caller',
         format('update %s set %I = :caller:::uuid', r.tbl, c.col) || v_where),
        ('update', r.tbl, r.row_ctid, c.col || ' = second',
         format('update %s set %I = %L::uuid', r.tbl, c.col, '22222222-2222-2222-2222-222222222222') || v_where),
        ('insert', r.tbl, r.row_ctid, 'copy, ' || c.col || ' = caller',
         format('insert into %s select * from jsonb_populate_record(null::%s, %L::jsonb || jsonb_build_object(%L, :caller:::uuid))',
                r.tbl, r.tbl, v_json, c.col));
    end loop;

    -- A file in the caller's own folder.
    if r.tbl = 'storage.objects'::regclass then
      insert into rw_attempts (op, tbl, row_ctid, variant, sql) values
        ('insert', r.tbl, r.row_ctid, 'copy into own folder',
         format('insert into storage.objects (bucket_id, name, owner_id) values (%L, :caller: || %L, :caller:)',
                v_json->>'bucket_id', '/rw-own.jpg')),
        ('update', r.tbl, r.row_ctid, 'move into own folder',
         format('update storage.objects set name = :caller: || %L', '/moved.jpg') || v_where);
    end if;
  end loop;
end
$attempts$;

-- The columns a policy guards, on the tables that have them.
insert into rw_attempts (op, tbl, row_ctid, variant, sql)
select 'update', r.tbl, r.row_ctid, v.variant, format('update %s set %s where ctid = %L', r.tbl, v.assignment, r.row_ctid)
from rw_rows r
join (values
  ('public.profiles', 'role = admin', 'role = ''admin'''),
  ('public.profiles', 'status = approved', 'status = ''approved'''),
  ('public.profiles', 'status = suspended', 'status = ''suspended'''),
  ('public.profiles', 'more invitations', 'invite_quota = invite_quota + 1'),
  ('public.profiles', 'a house account', 'is_house = true'),
  ('public.profiles', 'a membership number', 'member_no = 99999'),
  ('public.profiles', 'a new bio', 'bio = ''changed'''),
  ('public.profiles', 'private or not', 'is_private = not is_private'),
  ('public.posts', 'removed', 'removed_at = now()'),
  ('public.posts', 'a like', 'like_count = like_count + 1'),
  ('public.posts', 'a new caption', 'caption = ''changed'''),
  ('public.follows', 'accepted', 'status = ''accepted'''),
  ('public.follows', 'pending', 'status = ''pending'''),
  ('public.post_tags', 'accepted', 'status = ''accepted'''),
  ('public.post_tags', 'declined', 'status = ''declined'''),
  ('public.post_tags', 'pending', 'status = ''pending'''),
  ('public.activity', 'read', 'read_at = now()'),
  ('public.messages', 'read', 'read_at = now()'),
  ('public.messages', 'new words', 'body = ''changed'''),
  ('public.conversations', 'touched', 'last_message_at = now()'),
  ('public.era_edits', 'no names', 'titles = ''{}'''),
  ('public.notification_prefs', 'likes toggled', 'likes = not likes'),
  ('public.reports', 'resolved', 'status = ''resolved'''),
  ('public.comments', 'removed', 'removed_at = now()')
) v(tbl, variant, assignment) on v.tbl::regclass = r.tbl;

-- ---------------------------------------------------------------------------
-- asking
-- ---------------------------------------------------------------------------
-- A write, undone however it went: OK and the rows it touched, DENIED
-- when a policy or a grant refused it, otherwise the SQLSTATE.
create or replace function tests.rw_try(p_sql text)
returns text
language plpgsql
as $fn$
declare
  v_rows bigint;
begin
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
    raise exception using errcode = 'VT001', message = v_rows::text;
  exception
    when sqlstate 'VT001' then return 'OK:' || sqlerrm;
    when insufficient_privilege then return 'DENIED';
    when others then return 'ERROR:' || sqlstate;
  end;
end
$fn$;

-- A read: how many rows, and a digest of exactly which.
create or replace function tests.rw_read(p_tbl regclass)
returns text
language plpgsql
as $fn$
declare
  v_out text;
begin
  execute format(
    'select count(*) || '':'' || coalesce(md5(string_agg(t::text, ''|'' order by t::text)), ''-'') from %s t', p_tbl)
    into v_out;
  return v_out;
exception
  when insufficient_privilege then return 'DENIED';
  when others then return 'ERROR:' || sqlstate;
end
$fn$;

create temp table rw_answers (run text, viewer text, attempt text, answer text, primary key (run, viewer, attempt));
grant all on rw_answers, rw_attempts, rw_viewers, rw_tables to anon, authenticated;
grant execute on function tests.rw_try(text), tests.rw_read(regclass) to anon, authenticated;

create or replace function tests.rw_ask_everything(p_run text)
returns bigint
language plpgsql
as $fn$
declare
  v record;
  a record;
  t record;
  v_answer text;
  v_count bigint := 0;
begin
  for v in select * from rw_viewers order by label loop
    for t in select tbl from rw_tables order by tbl::text loop
      if v.uid is null then
        execute 'set local role anon';
        perform set_config('request.jwt.claims', '', true);
      else
        execute 'set local role authenticated';
        perform set_config('request.jwt.claims',
          json_build_object('sub', v.uid, 'role', 'authenticated')::text, true);
      end if;
      v_answer := tests.rw_read(t.tbl);
      execute 'reset role';
      insert into rw_answers values (p_run, v.label, 'read ' || t.tbl::text, v_answer);
      v_count := v_count + 1;
    end loop;

    for a in select * from rw_attempts order by id loop
      if v.uid is null then
        execute 'set local role anon';
        perform set_config('request.jwt.claims', '', true);
      else
        execute 'set local role authenticated';
        perform set_config('request.jwt.claims',
          json_build_object('sub', v.uid, 'role', 'authenticated')::text, true);
      end if;
      v_answer := tests.rw_try(replace(a.sql, ':caller:', quote_literal(coalesce(v.uid::text, '00000000-0000-0000-0000-000000000000'))));
      execute 'reset role';
      insert into rw_answers values (p_run, v.label, a.op || ' ' || a.tbl::text || ' ' || a.row_ctid::text || ' ' || a.variant, v_answer);
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end
$fn$;

create temp table rw_counts (run text primary key, asked bigint);

-- Under 0023's policies (and whatever came after).
insert into rw_counts select 'now', tests.rw_ask_everything('now');

-- What 0023 promises about its own policies, checked before they are put
-- back: no policy it rewrote reads the caller, or asks about a block, a
-- row at a time.
insert into tests.results (name, expected, actual) values
  ('no policy reads auth.uid() a row at a time', '0',
   (select count(*)::text from pg_policies
     where schemaname in ('public', 'storage')
       and regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                          '\( SELECT auth\.uid\(\) AS uid\)', '', 'g') ~ 'auth\.uid\(\)')),
  ('no policy asks is_admin or is_active_member a row at a time', '0',
   (select count(*)::text from pg_policies
     where schemaname in ('public', 'storage')
       and regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                          'SELECT (is_admin|is_active_member)\(', '', 'g') ~ '(is_admin|is_active_member)\(')),
  ('only the five pair checks still call blocked_between, and none blocked_by', '5',
   (select count(*)::text from pg_policies
     where schemaname = 'public'
       and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ 'blocked_(between|by)\(')),
  ('those five read two columns of the row, never the caller', '0',
   (select count(*)::text from pg_policies
     where schemaname = 'public'
       and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ 'blocked_(between|by)\('
       and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ 'auth\.uid')),
  ('every policy that was there before 0023 is there now, by name and kind', '0',
   (select count(*)::text from before_0023.policies b
     where not exists (select 1 from pg_policies p
                        where p.schemaname = b.schemaname and p.tablename = b.tablename
                          and p.policyname = b.policyname and p.permissive = b.permissive
                          and p.cmd = b.cmd and p.roles = b.roles))),
  -- Bar those later migrations made, each named here (0028 on; a test in
  -- tests/policies-read-once.test.ts keeps this list and them the same).
  ('and no policy was added', '0',
   (select count(*)::text from pg_policies p
     where p.schemaname in ('public', 'storage')
       and not exists (select 1 from before_0023.policies b
                        where b.schemaname = p.schemaname and b.tablename = p.tablename
                          and b.policyname = p.policyname)
       and (p.tablename, p.policyname) not in (values
         ('comments', 'comments: only with their photograph'),
         ('likes', 'likes: only with their photograph'),
         ('post_tags', 'post_tags: only with their photograph'),
         ('posts', 'posts: not what I reported'),
         ('follows', 'follows: followee accepts'),
         ('follows', 'follows: followee removes'),
         ('follows', 'follows: a request seen by its two members'),
         ('comments', 'comments: none across a block'),
         ('likes', 'likes: none across a block')))),
  ('every index that was there before 0023 is there, unchanged', '0',
   (select count(*)::text from before_0023.indexes b
     where not exists (select 1 from pg_indexes i
                        where i.schemaname = b.schemaname and i.indexname = b.indexname
                          and i.indexdef = b.indexdef))),
  ('the indexes 0023 makes are there', '30',
   (select count(*)::text from pg_indexes where schemaname = 'public' and indexname in (
     'activity_post_idx', 'activity_comment_idx', 'activity_actor_idx', 'comments_author_idx',
     'likes_user_idx', 'messages_sender_idx', 'messages_post_idx', 'post_tags_tagged_by_idx',
     'post_shares_owner_idx', 'share_events_post_idx', 'share_events_actor_idx',
     'reports_reporter_idx', 'reports_post_idx', 'reports_comment_idx', 'reports_profile_idx',
     'moderation_actions_post_idx', 'moderation_actions_comment_idx', 'moderation_actions_admin_idx',
     'posts_removed_by_idx', 'comments_removed_by_idx', 'applications_decided_by_idx',
     'reports_resolved_by_idx', 'invites_used_by_idx', 'app_settings_updated_by_idx',
     'profiles_invited_by_idx', 'profiles_private_idx', 'follows_followers_idx',
     'likes_post_recent_idx', 'activity_unread_idx', 'posts_taken_idx'))),
  ('every foreign key to a member, a post or a comment has an index that starts with it', '<none>',
   coalesce((
     select string_agg(k.conrelid::regclass::text || '.' || a.attname, ', ' order by 1)
     from pg_constraint k
     join pg_namespace n on n.oid = (select relnamespace from pg_class where oid = k.conrelid)
     join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
     where k.contype = 'f' and n.nspname = 'public' and array_length(k.conkey, 1) = 1
       and not exists (select 1 from pg_index i
                        where i.indrelid = k.conrelid and i.indkey[0] = k.conkey[1])), '<none>')),
  ('the block lists answer only to members', 'false,false,true,true',
   (select string_agg(x::text, ',') from (values
     (has_function_privilege('anon', 'private.my_block_partners()', 'execute')),
     (has_function_privilege('anon', 'private.my_blockers()', 'execute')),
     (has_function_privilege('authenticated', 'private.my_block_partners()', 'execute')),
     (has_function_privilege('authenticated', 'private.my_blockers()', 'execute'))) v(x))),
  -- PostgREST publishes every function in public a role may execute, as
  -- /rest/v1/rpc/<name>. A SECURITY DEFINER function there that a member
  -- may call answers past row-level security: my_blockers() in public
  -- would hand a member the ids of everyone who blocked them.
  -- (A trigger function a later migration adds, which nobody may call,
  -- is not published: on_report_push, 0032.)
  -- Bar the one a later migration publishes on purpose, named here:
  -- claim_push_token (0036), which moves a phone's token to the member
  -- calling it and answers nothing (16_launch_data_0035_0037.sql).
  ('0023 puts no SECURITY DEFINER function in public, where the API publishes it', '<none>',
   coalesce((select string_agg(p.oid::regprocedure::text, ', ' order by 1)
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.prosecdef
               and p.oid::regprocedure::text not in (select signature from before_0023.functions)
               and p.oid::regprocedure::text not in ('claim_push_token(text,text,text)')
               and (has_function_privilege('authenticated', p.oid, 'execute')
                    or has_function_privilege('anon', p.oid, 'execute'))), '<none>')),
  ('its three helpers live in private, run as their owner, members only', '3',
   (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.prosecdef
       and p.proname in ('my_block_partners', 'my_blockers', 'own_profile_unchanged')
       and has_function_privilege('authenticated', p.oid, 'execute')
       and not has_function_privilege('anon', p.oid, 'execute')
       and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))),
  ('signed-out visitors cannot reach into private at all', 'false,false',
   has_schema_privilege('anon', 'private', 'usage')::text || ',' ||
   coalesce((select bool_or(a.grantee = 0) from pg_namespace n, aclexplode(n.nspacl) a
             where n.nspname = 'private'), false)::text);

-- Put back the policies 0023 replaced, as they were, and any function a
-- later migration has changed since; then ask everything again. A policy
-- a later migration added (0028 on) is not one 0023 replaced: it stays,
-- in both runs alike.
do $restore$
declare
  p record;
  f record;
begin
  for p in
    select c.* from pg_policies c
    where c.schemaname in ('public', 'storage')
      and exists (select 1 from before_0023.policies b
                   where b.schemaname = c.schemaname and b.tablename = c.tablename and b.policyname = c.policyname)
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
  for p in select * from before_0023.policies loop
    execute format('create policy %I on %I.%I as %s for %s to %s %s %s',
      p.policyname, p.schemaname, p.tablename, p.permissive, p.cmd,
      (select string_agg(quote_ident(r), ', ') from unnest(p.roles) r),
      case when p.qual is not null then 'using (' || p.qual || ')' else '' end,
      case when p.with_check is not null then 'with check (' || p.with_check || ')' else '' end);
  end loop;
  for f in
    select b.definition from before_0023.functions b
    where b.definition is distinct from (
      select pg_get_functiondef(fp.oid) from pg_proc fp
      where fp.oid::regprocedure::text = b.signature)
  loop
    execute f.definition;
  end loop;
end
$restore$;

insert into rw_counts select 'before 0023', tests.rw_ask_everything('before 0023');

insert into tests.results (name, expected, actual) values
  ('every caller was asked the same questions both times', 'true',
   ((select asked from rw_counts where run = 'now') = (select asked from rw_counts where run = 'before 0023')
    and (select asked from rw_counts where run = 'now') > 5000)::text),
  ('and gave the same answer to every one', '<none>',
   coalesce((
     select string_agg(n.viewer || ' / ' || n.attempt || ': ' || n.answer || ' now, ' || coalesce(b.answer, 'nothing') || ' before', E'\n')
     from rw_answers n
     left join rw_answers b on b.run = 'before 0023' and b.viewer = n.viewer and b.attempt = n.attempt
     where n.run = 'now' and n.answer is distinct from b.answer), '<none>')),
  ('the questions had answers of every kind', 'true',
   ((select count(distinct split_part(answer, ':', 1)) from rw_answers where run = 'now') >= 3
    and exists (select 1 from rw_answers where run = 'now' and answer = 'DENIED')
    and exists (select 1 from rw_answers where run = 'now' and answer = 'OK:1')
    and exists (select 1 from rw_answers where run = 'now' and answer = 'OK:0'))::text),
  ('reads differed between callers (the club was not all-or-nothing)', 'true',
   ((select count(distinct answer) from rw_answers where run = 'now' and attempt = 'read ' || 'public.posts'::regclass::text) >= 4)::text);

select 'asked ' || asked || ' questions ' || run as note from rw_counts order by run;

\pset border 2
select r.seq, r.name, r.expected, r.actual,
       case when r.expected = r.actual then 'pass' else 'FAIL' end as status
from tests.results r, rewrite_start s
where r.seq > s.seq
order by r.seq;

do $verdict$
declare v_failed int;
begin
  select count(*) into v_failed from tests.results r, rewrite_start s
   where r.seq > s.seq and r.expected <> r.actual;
  if v_failed > 0 then
    raise exception '% policy rewrite checks FAILED', v_failed;
  end if;
  raise notice 'policy rewrite checks passed';
end
$verdict$;

rollback;
