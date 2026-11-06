-- 0035-0037: a member's own files whatever their membership, a phone's
-- push token under whoever signed in on it last, and unread messages
-- counted in the database.
--
-- Each is asked as the members it is about, through the same policies
-- and functions the app and the Storage API go through. Runs in one
-- transaction and rolls back.

begin;

create temp table d_start as select coalesce(max(seq), 0) as seq from tests.results;

-- A statement as a member (or, with null, a signed-out visitor): OK and
-- how many rows it touched, DENIED, or the error's own words.
create or replace function tests.d_as(p_uid uuid, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v text;
  n bigint;
begin
  if p_uid is null then
    execute 'set local role anon';
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  end if;
  begin
    execute p_sql;
    get diagnostics n = row_count;
    v := 'OK:' || n;
  exception
    when insufficient_privilege then v := 'DENIED';
    when others then v := 'ERROR:' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end
$fn$;

-- What a member reads: the values a query returns, in order, or '-'.
create or replace function tests.d_read(p_uid uuid, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v text;
begin
  if p_uid is null then
    execute 'set local role anon';
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  end if;
  execute 'select coalesce(string_agg(x::text, '',''), ''-'') from (' || p_sql || ') q(x)' into v;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end
$fn$;

\set founder   '11111111-1111-1111-1111-111111111111'
\set second    '22222222-2222-2222-2222-222222222222'
\set suspended '55555555-5555-5555-5555-555555555555'
-- An applicant of this file's own: the fixtures' one is let in by an
-- invitation link earlier in the run (04_invite_links.sql).
\set pending   'd0000000-0000-4000-8000-000000000001'
insert into auth.users (id, email, raw_user_meta_data)
values (:'pending', 'applicant@launch-data.test', '{"username":"ld.applicant"}');
update public.profiles set status = 'applied' where id = :'pending';

-- ---------------------------------------------------------------------------
-- 0035: a suspended member finds, and so removes, their own files
-- ---------------------------------------------------------------------------
-- The suspended member published while a member: a photograph and its
-- thumbnail, and an avatar. The second member has a photograph too.
insert into storage.objects (bucket_id, name, owner_id) values
  ('media',      '55555555-5555-5555-5555-555555555555/p1.jpg',    '55555555-5555-5555-5555-555555555555'),
  ('thumbnails', '55555555-5555-5555-5555-555555555555/p1.jpg',    '55555555-5555-5555-5555-555555555555'),
  ('avatars',    '55555555-5555-5555-5555-555555555555/avatar.jpg', '55555555-5555-5555-5555-555555555555'),
  ('media',      '22222222-2222-2222-2222-222222222222/p2.jpg',    '22222222-2222-2222-2222-222222222222');

insert into tests.results (name, expected, actual) values
  -- What storage.list() reads: the rows of the member's own folder.
  ('0035: a suspended member lists their own media, thumbnails and avatar', 'avatars,media,thumbnails',
   tests.d_read(:'suspended', 'select bucket_id from storage.objects order by bucket_id')),
  ('0035: and nobody else''s', '-',
   tests.d_read(:'suspended', 'select name from storage.objects where name like ''2222%''')),
  ('0035: nor does anyone else see theirs (a member)', '-',
   tests.d_read(:'second', 'select name from storage.objects where name like ''5555%''')),
  ('0035: nor a signed-out visitor', '-',
   tests.d_read(null, 'select name from storage.objects')),
  -- Putting or changing a file still needs an active member.
  ('0035: a suspended member still cannot put a photograph in their folder', 'DENIED',
   tests.d_as(:'suspended', 'insert into storage.objects (bucket_id, name, owner_id) values
      (''media'', ''55555555-5555-5555-5555-555555555555/new.jpg'', ''55555555-5555-5555-5555-555555555555'')')),
  ('0035: nor overwrite one (an upsert onto their own file)', 'DENIED',
   tests.d_as(:'suspended', 'insert into storage.objects (bucket_id, name, owner_id) values
      (''media'', ''55555555-5555-5555-5555-555555555555/p1.jpg'', ''55555555-5555-5555-5555-555555555555'')
      on conflict (bucket_id, name) do update set owner_id = excluded.owner_id')),
  ('0035: nor change one in place', 'OK:0',
   tests.d_as(:'suspended', 'update storage.objects set metadata = ''{}''::jsonb
      where name = ''55555555-5555-5555-5555-555555555555/p1.jpg''')),
  ('0035: a member cannot remove another''s file', 'OK:0',
   tests.d_as(:'second', 'delete from storage.objects where name like ''55555555-5555-5555-5555-555555555555/%''')),
  -- What storage.remove() does: a delete that returns the rows it removed.
  ('0035: the suspended member removes their photograph and its thumbnail', 'OK:2',
   tests.d_as(:'suspended', 'delete from storage.objects
      where bucket_id in (''media'', ''thumbnails'') and name = ''55555555-5555-5555-5555-555555555555/p1.jpg''
      returning name')),
  ('0035: and their folders then list empty', '-',
   tests.d_read(:'suspended', 'select name from storage.objects where bucket_id in (''media'', ''thumbnails'')')),
  -- (Asked through a function: a plain subquery here would read the
  -- table as it was when this statement began, before the removal.)
  ('0035: the other member''s file is still there, and the suspended member''s avatar', '22222222-2222-2222-2222-222222222222/p2.jpg|55555555-5555-5555-5555-555555555555/avatar.jpg',
   tests.d_read(:'second', 'select name from storage.objects where bucket_id = ''media''')
   || '|' || tests.d_read(:'suspended', 'select name from storage.objects where bucket_id = ''avatars''')),
  ('0035: an applicant reads their own folder too (nothing to find, nothing put there)', 'DENIED,-',
   tests.d_as(:'pending', 'insert into storage.objects (bucket_id, name, owner_id) values
      (''media'', ''d0000000-0000-4000-8000-000000000001/a.jpg'', ''d0000000-0000-4000-8000-000000000001'')')
   || ',' || tests.d_read(:'pending', 'select name from storage.objects where bucket_id = ''media''')),
  ('0035: the policy asks for the folder only, the caller read once, for members signed in', '1',
   (select count(*)::text from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname = 'media: read own folder'
       and cmd = 'SELECT' and roles = '{authenticated}'
       and qual ~ 'foldername' and qual ~ '\( SELECT auth\.uid\(\) AS uid\)'
       and qual !~ 'is_active_member'));

-- ---------------------------------------------------------------------------
-- 0036: a phone's push token, under whoever signed in on it last
-- ---------------------------------------------------------------------------
-- The founder filed this phone's token, and the push function once found
-- it gone (invalid_at), before the phone came back. Each step in a
-- statement of its own (a statement reads the tables as they were when it
-- began), then what it left.
insert into public.push_tokens (token, user_id, platform, device, invalid_at)
values ('ExponentPushToken[phone-1]', :'founder', 'ios', 'Apple iPhone', now() - interval '1 day');

create temp table d_did (step text primary key, answer text);
-- As the app filed it before: an upsert onto the founder's row.
insert into d_did values ('upsert', tests.d_as(:'second', 'insert into public.push_tokens (token, user_id, platform, device)
  values (''ExponentPushToken[phone-1]'', ''22222222-2222-2222-2222-222222222222'', ''ios'', ''Apple iPhone'')
  on conflict (token) do update set user_id = excluded.user_id'));
insert into d_did values ('delete before', tests.d_as(:'second', 'delete from public.push_tokens where token = ''ExponentPushToken[phone-1]'''));
insert into d_did values ('claim', tests.d_as(:'second', 'select public.claim_push_token(''ExponentPushToken[phone-1]'', ''ios'', ''Apple iPhone 15'')'));
insert into d_did values ('after claim', (select user_id || ',' || device || ',' || case when invalid_at is null then 'live' else 'gone' end
  || ',' || count(*) over () from public.push_tokens where token = 'ExponentPushToken[phone-1]'));
insert into d_did values ('founder sees', tests.d_read(:'founder', 'select token from public.push_tokens'));
insert into d_did values ('second sees', tests.d_read(:'second', 'select token from public.push_tokens'));
insert into d_did values ('new token', tests.d_as(:'founder', 'select public.claim_push_token(''ExponentPushToken[phone-2]'', ''android'', null)'));
insert into d_did values ('again', tests.d_as(:'founder', format('select public.claim_push_token(''ExponentPushToken[phone-2]'', ''android'', %L)', repeat('x', 500))));
insert into d_did values ('after again', (select user_id || ',' || platform || ',' || length(device) || ',' || count(*) over ()
  from public.push_tokens where token = 'ExponentPushToken[phone-2]'));
insert into d_did values ('delete after', tests.d_as(:'second', 'delete from public.push_tokens where token = ''ExponentPushToken[phone-1]'''));

-- Signing out everywhere (src/api/notifications.ts unregisterAllPushTokens):
-- one delete of every row of the member's, returning the tokens that went,
-- as PostgREST runs it (a data-modifying WITH, then a select of it).
create or replace function tests.d_took(p_uid uuid, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'with gone as (' || p_sql || ') select coalesce(string_agg(token, '','' order by token), ''-'') from gone' into v;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end
$fn$;
insert into d_did values ('second phone', tests.d_as(:'second', 'select public.claim_push_token(''ExponentPushToken[phone-4]'', ''ios'', null)'));
insert into d_did values ('everywhere, the founder''s', tests.d_took(:'second',
  'delete from public.push_tokens where user_id = ''11111111-1111-1111-1111-111111111111'' returning token'));
insert into d_did values ('everywhere, their own', tests.d_took(:'second',
  'delete from public.push_tokens where user_id = ''22222222-2222-2222-2222-222222222222'' returning token'));
insert into d_did values ('after everywhere', (select coalesce(string_agg(token || ':' || (user_id = :'founder')::text, ',' order by token), '-')
  from public.push_tokens where token in ('ExponentPushToken[phone-2]', 'ExponentPushToken[phone-4]')));

-- Signed in as a role, with no member: auth.uid() is null.
create or replace function tests.d_nobody(p_sql text)
returns text
language plpgsql
as $fn$
declare
  v text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  begin
    execute p_sql;
    v := 'OK';
  exception
    when insufficient_privilege then v := 'DENIED:' || sqlerrm;
    when others then v := 'ERROR:' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end
$fn$;

insert into tests.results (name, expected, actual) values
  ('0036: the second member''s upsert of a token the founder holds is refused (what the app did)', 'DENIED',
   (select answer from d_did where step = 'upsert')),
  ('0036: and their delete of it removes nothing', 'OK:0',
   (select answer from d_did where step = 'delete before')),
  ('0036: claimed, it moves to the second member', 'OK:1',
   (select answer from d_did where step = 'claim')),
  ('0036: the row is theirs, from this phone, live again, and the only one', '22222222-2222-2222-2222-222222222222,Apple iPhone 15,live,1',
   (select answer from d_did where step = 'after claim')),
  ('0036: the founder no longer sees it', '-',
   (select answer from d_did where step = 'founder sees')),
  ('0036: the second member does', 'ExponentPushToken[phone-1]',
   (select answer from d_did where step = 'second sees')),
  ('0036: a new token is filed, and claimed again it is the same one row, a long device name cut',
   'OK:1|OK:1|11111111-1111-1111-1111-111111111111,android,200,1',
   (select string_agg(answer, '|' order by o) from d_did
     join (values ('new token', 1), ('again', 2), ('after again', 3)) v(step, o) using (step))),
  ('0036: and the second member''s sign-out removes the row they now hold', 'OK:1',
   (select answer from d_did where step = 'delete after')),
  ('0036: signing out everywhere, one delete returns the tokens that went: the member''s own, none of another''s',
   'OK:1|-|ExponentPushToken[phone-4]|ExponentPushToken[phone-2]:true',
   (select string_agg(answer, '|' order by o) from d_did
     join (values ('second phone', 1), ('everywhere, the founder''s', 2), ('everywhere, their own', 3), ('after everywhere', 4)) v(step, o) using (step))),
  ('0036: no token, no platform, a made-up platform: refused', 'ERROR:Not a push token|ERROR:Not a platform|ERROR:Not a platform',
   tests.d_as(:'second', 'select public.claim_push_token('''', ''ios'', null)') || '|' ||
   tests.d_as(:'second', 'select public.claim_push_token(''t'', null, null)') || '|' ||
   tests.d_as(:'second', 'select public.claim_push_token(''t'', ''desktop'', null)')),
  ('0036: a signed-out visitor may not call it', 'DENIED',
   tests.d_as(null, 'select public.claim_push_token(''ExponentPushToken[phone-3]'', ''ios'', null)')),
  ('0036: signed in as a role with no member, refused', 'DENIED:Not signed in',
   tests.d_nobody('select public.claim_push_token(''ExponentPushToken[phone-3]'', ''ios'', null)')),
  ('0036: nothing was filed by those', '0',
   (select count(*)::text from public.push_tokens where token in ('', 't', 'ExponentPushToken[phone-3]'))),
  ('0036: SECURITY DEFINER, an empty search path, members only', 'true,true,true,false',
   (select p.prosecdef::text || ',' || (p.proconfig @> array['search_path=""'])::text || ','
           || has_function_privilege('authenticated', p.oid, 'execute')::text || ','
           || has_function_privilege('anon', p.oid, 'execute')::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'claim_push_token'));

-- ---------------------------------------------------------------------------
-- 0037: unread messages, counted in the database
-- ---------------------------------------------------------------------------
-- Three threads: founder and second (the second has written four, two
-- read; the founder three, none read), second and suspended (the
-- suspended member has written two, unread), and founder and suspended
-- with nothing unread.
insert into public.conversations (id, user_a, user_b, last_message_at) values
  ('d7000000-0000-4000-8000-000000000001', :'founder', :'second', now() - interval '1 hour'),
  ('d7000000-0000-4000-8000-000000000002', :'second', :'suspended', now() - interval '2 hours'),
  ('d7000000-0000-4000-8000-000000000003', :'founder', :'suspended', now() - interval '3 hours');
insert into public.messages (conversation_id, sender_id, body, read_at)
select 'd7000000-0000-4000-8000-000000000001'::uuid, :'second'::uuid, 'from second ' || g, case when g <= 2 then now() end
from generate_series(1, 4) g
union all
select 'd7000000-0000-4000-8000-000000000001'::uuid, :'founder'::uuid, 'from founder ' || g, null
from generate_series(1, 3) g
union all
select 'd7000000-0000-4000-8000-000000000002'::uuid, :'suspended'::uuid, 'from suspended ' || g, null
from generate_series(1, 2) g
union all
select 'd7000000-0000-4000-8000-000000000003'::uuid, :'founder'::uuid, 'read', now();

insert into tests.results (name, expected, actual) values
  ('0037: the founder: two unread from the second, in their one thread with any', 'd7000000-0000-4000-8000-000000000001:2',
   tests.d_read(:'founder', 'select conversation_id || '':'' || unread from public.unread_message_counts()')),
  ('0037: the second: three from the founder, two from the suspended member, newest thread first',
   'd7000000-0000-4000-8000-000000000001:3,d7000000-0000-4000-8000-000000000002:2',
   tests.d_read(:'second', 'select conversation_id || '':'' || unread from public.unread_message_counts()')),
  ('0037: the same as counting the rows the member can read', 'true,true,true',
   (select string_agg((
      tests.d_read(m, 'select coalesce(sum(unread), 0) from public.unread_message_counts()')
      = tests.d_read(m, format('select count(*) from public.messages x join public.conversations c on c.id = x.conversation_id
          where %L in (c.user_a, c.user_b) and x.read_at is null and x.sender_id <> %L', m, m)))::text, ',' order by m)
    from unnest(array[:'founder', :'second', :'suspended']::uuid[]) m)),
  ('0037: a member in none of the threads counts nothing', '-',
   tests.d_read(:'pending', 'select conversation_id from public.unread_message_counts()')),
  ('0037: a signed-out visitor may not call it', 'DENIED',
   tests.d_as(null, 'select * from public.unread_message_counts()'));

-- A block between the founder and the second: their thread's messages
-- leave each other's view ("messages: not between blocked"), and so
-- leave the count, as they leave the inbox.
insert into public.blocks (blocker_id, blocked_id) values (:'founder', :'second');
insert into tests.results (name, expected, actual) values
  ('0037: after a block, the blocked member''s messages are not counted', '-',
   tests.d_read(:'founder', 'select conversation_id from public.unread_message_counts()')),
  ('0037: nor the blocker''s, on the other side', 'd7000000-0000-4000-8000-000000000002:2',
   tests.d_read(:'second', 'select conversation_id || '':'' || unread from public.unread_message_counts()')),
  ('0037: runs as the caller, read only, members only', 'false,s,true,false',
   (select p.prosecdef::text || ',' || p.provolatile::text || ','
           || has_function_privilege('authenticated', p.oid, 'execute')::text || ','
           || has_function_privilege('anon', p.oid, 'execute')::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'unread_message_counts'));

-- Applied again, each changes nothing.
\o /dev/null
\ir ../migrations/0035_own_files_whatever_the_membership.sql
\ir ../migrations/0036_push_token_follows_the_member.sql
\ir ../migrations/0037_unread_counts_in_the_database.sql
\o
insert into tests.results (name, expected, actual) values
  ('0035-0037: each runs twice without error, and leaves one policy and two functions', '1,2',
   (select count(*)::text from pg_policies where schemaname = 'storage' and policyname = 'media: read own folder')
   || ',' || (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname in ('claim_push_token', 'unread_message_counts')));

\pset border 2
select r.seq, r.name, r.expected, r.actual,
       case when r.expected = r.actual then 'pass' else 'FAIL' end as status
from tests.results r, d_start s
where r.seq > s.seq
order by r.seq;

do $verdict$
declare v_failed int;
begin
  select count(*) into v_failed from tests.results r, d_start s
   where r.seq > s.seq and r.expected is distinct from r.actual;
  if v_failed > 0 then
    raise exception '% launch data checks FAILED', v_failed;
  end if;
  raise notice 'launch data checks passed';
end
$verdict$;

rollback;
