-- 0038: follows that respect private accounts.
--
-- Asked as the members it is about, through the same policies, grants
-- and triggers the app and PostgREST go through: Ada keeps a private
-- account; Ben, Cleo and Dev ask to follow her; Eli is a member with
-- nothing to do with it; Pia's account is public. Runs in one
-- transaction and rolls back.

begin;

create temp table f_start as select coalesce(max(seq), 0) as seq from tests.results;

-- A statement as a member (or, with null, a signed-out visitor): OK and
-- how many rows it touched, DENIED, or the error's own words.
create or replace function tests.f_as(p_uid uuid, p_sql text)
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
create or replace function tests.f_read(p_uid uuid, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'select coalesce(string_agg(x::text, '',''), ''-'') from (' || p_sql || ') q(x)' into v;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end
$fn$;

-- Where a follow stands, read as the owner: its status, or 'none'.
create or replace function tests.f_status(p_follower uuid, p_followee uuid)
returns text
language sql
as $fn$
  select coalesce((select status from public.follows where follower_id = p_follower and followee_id = p_followee), 'none')
$fn$;

-- The notices a member was sent by another, oldest first, or '-'. (A
-- function, so that it reads what the statement it is asked in has done
-- so far; a plain subquery reads the table as the statement began.)
create or replace function tests.f_notices(p_recipient uuid, p_actor uuid)
returns text
language sql
as $fn$
  select coalesce(string_agg(type, ',' order by created_at, id), '-')
  from public.activity where recipient_id = p_recipient and actor_id = p_actor
$fn$;

-- A member's two counts, follower and following, as their profile holds them.
create or replace function tests.f_counts(p_id uuid)
returns text
language sql
as $fn$
  select follower_count || '/' || following_count from public.profiles where id = p_id
$fn$;

\set ada '0a380000-0000-4000-8000-000000000001'
\set ben '0a380000-0000-4000-8000-000000000002'
\set cleo '0a380000-0000-4000-8000-000000000003'
\set dev '0a380000-0000-4000-8000-000000000004'
\set eli '0a380000-0000-4000-8000-000000000005'
\set pia '0a380000-0000-4000-8000-000000000006'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'ada',  'ada@follows.test',  '{"username":"f38.ada"}'),
  (:'ben',  'ben@follows.test',  '{"username":"f38.ben"}'),
  (:'cleo', 'cleo@follows.test', '{"username":"f38.cleo"}'),
  (:'dev',  'dev@follows.test',  '{"username":"f38.dev"}'),
  (:'eli',  'eli@follows.test',  '{"username":"f38.eli"}'),
  (:'pia',  'pia@follows.test',  '{"username":"f38.pia"}');
update public.profiles set status = 'approved', approved_at = now()
 where id::text like '0a380000-0000-4000-8000-00000000000_';
update public.profiles set is_private = true where id = :'ada';

-- Ada's two photographs and her eras.
insert into public.posts (author_id, media_type, media_path, filter_id, caption) values
  (:'ada', 'photo', :'ada' || '/1.jpg', 'kodachrome', 'one'),
  (:'ada', 'photo', :'ada' || '/2.jpg', 'kodachrome', 'two');
insert into public.era_edits (author_id, titles) values (:'ada', '{"Winter 2024":"Snowed in"}');

-- ---------------------------------------------------------------------------
-- a request stays a request, whatever the client sends
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  ('before: Ben reads none of Ada''s photographs', '0',
   tests.f_read(:'ben', format('select count(*) from public.posts where author_id = %L', :'ada'))),
  ('Ben files follows(Ben, Ada) as accepted', 'OK:1',
   tests.f_as(:'ben', format('insert into public.follows (follower_id, followee_id, status) values (%L, %L, ''accepted'')', :'ben', :'ada'))),
  ('it is stored as a request', 'pending', tests.f_status(:'ben', :'ada')),
  ('and Ben still reads none of her photographs', '0',
   tests.f_read(:'ben', format('select count(*) from public.posts where author_id = %L', :'ada'))),
  ('nor her eras', '0',
   tests.f_read(:'ben', format('select count(*) from public.era_edits where author_id = %L', :'ada'))),
  ('Ada is told "asked to follow you", not "started following you"', 'follow_request',
   tests.f_notices(:'ada', :'ben')),
  ('a request counts nothing: Ada 0 followers, Ben 0 following', '0/0,0/0',
   tests.f_counts(:'ada') || ',' || tests.f_counts(:'ben')),
  -- The column's default is 'accepted': leaving status out is no way round.
  ('Cleo files a follow of Ada with no status', 'OK:1',
   tests.f_as(:'cleo', format('insert into public.follows (follower_id, followee_id) values (%L, %L)', :'cleo', :'ada'))),
  ('it is a request too', 'pending', tests.f_status(:'cleo', :'ada')),
  -- Nor is the upsert PostgREST makes of a POST with on_conflict.
  ('Ben cannot accept his own request with an upsert', 'DENIED',
   tests.f_as(:'ben', format('insert into public.follows (follower_id, followee_id, status) values (%L, %L, ''accepted'')
      on conflict (follower_id, followee_id) do update set status = ''accepted''', :'ben', :'ada'))),
  ('nor by updating it', 'OK:0',
   tests.f_as(:'ben', format('update public.follows set status = ''accepted'' where follower_id = %L and followee_id = %L', :'ben', :'ada'))),
  ('nor by moving it to someone else (only status may be updated)', 'DENIED',
   tests.f_as(:'ben', format('update public.follows set followee_id = %L where follower_id = %L', :'pia', :'ben'))),
  ('still a request after all of that', 'pending', tests.f_status(:'ben', :'ada'));

-- ---------------------------------------------------------------------------
-- nobody but Ada decides
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  ('Eli cannot accept Ada''s request', 'OK:0',
   tests.f_as(:'eli', format('update public.follows set status = ''accepted'' where followee_id = %L', :'ada'))),
  ('nor decline it', 'OK:0',
   tests.f_as(:'eli', format('delete from public.follows where followee_id = %L', :'ada'))),
  ('a signed-out visitor may update no follow at all', 'DENIED',
   tests.f_as(null, format('update public.follows set status = ''accepted'' where followee_id = %L', :'ada'))),
  -- Refused outright: a delete must first read the row, and follows'
  -- read policies are members' only.
  ('nor delete one', 'DENIED',
   tests.f_as(null, format('delete from public.follows where followee_id = %L', :'ada'))),
  ('the requests are untouched', 'pending,pending',
   tests.f_status(:'ben', :'ada') || ',' || tests.f_status(:'cleo', :'ada'));

-- ---------------------------------------------------------------------------
-- Ada accepts Ben
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  -- What decideFollowRequest sends: an update that returns the row it changed.
  ('Ada accepts Ben', 'OK:1',
   tests.f_as(:'ada', format('update public.follows set status = ''accepted'' where follower_id = %L and followee_id = %L returning follower_id', :'ben', :'ada'))),
  ('Ben''s follow is accepted', 'accepted', tests.f_status(:'ben', :'ada')),
  ('Ben now reads both her photographs', '2',
   tests.f_read(:'ben', format('select count(*) from public.posts where author_id = %L', :'ada'))),
  ('and her eras', '1',
   tests.f_read(:'ben', format('select count(*) from public.era_edits where author_id = %L', :'ada'))),
  ('the counts move with the accept: Ada 1 follower, Ben 1 following', '1/0,0/1',
   tests.f_counts(:'ada') || ',' || tests.f_counts(:'ben')),
  ('accepting files no notice for anyone (Ada has only the request; Ben nothing from her)', 'follow_request|-',
   tests.f_notices(:'ada', :'ben') || '|' || tests.f_notices(:'ben', :'ada')),
  ('Ada cannot turn an accepted follow back into a request', 'OK:0',
   tests.f_as(:'ada', format('update public.follows set status = ''pending'' where follower_id = %L and followee_id = %L', :'ben', :'ada'))),
  ('nor accept Cleo as someone else (only status may be updated)', 'DENIED',
   tests.f_as(:'ada', format('update public.follows set status = ''accepted'', follower_id = %L where follower_id = %L and followee_id = %L', :'eli', :'cleo', :'ada'))),
  ('nor accept a request made of someone else', 'OK:0',
   tests.f_as(:'ada', format('update public.follows set status = ''accepted'' where followee_id <> %L', :'ada'))),
  ('Cleo is still asking', 'pending', tests.f_status(:'cleo', :'ada'));

-- ---------------------------------------------------------------------------
-- Ada declines Cleo, Dev withdraws, Ada removes Ben
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  ('Ada declines Cleo', 'OK:1',
   tests.f_as(:'ada', format('delete from public.follows where follower_id = %L and followee_id = %L and status = ''pending'' returning follower_id', :'cleo', :'ada'))),
  ('Cleo''s request is gone', 'none', tests.f_status(:'cleo', :'ada')),
  ('Cleo reads none of Ada''s photographs', '0',
   tests.f_read(:'cleo', format('select count(*) from public.posts where author_id = %L', :'ada'))),
  ('a declined request takes nothing from the counts: Ada 1, Cleo 0', '1/0,0/0',
   tests.f_counts(:'ada') || ',' || tests.f_counts(:'cleo')),
  ('Dev asks', 'OK:1',
   tests.f_as(:'dev', format('insert into public.follows (follower_id, followee_id, status) values (%L, %L, ''accepted'')', :'dev', :'ada'))),
  ('and withdraws his request himself (unfollow as self, as before)', 'OK:1',
   tests.f_as(:'dev', format('delete from public.follows where follower_id = %L and followee_id = %L', :'dev', :'ada'))),
  ('the counts did not move: Ada 1, Dev 0', '1/0,0/0',
   tests.f_counts(:'ada') || ',' || tests.f_counts(:'dev')),
  ('Ada removes Ben, a follower', 'OK:1',
   tests.f_as(:'ada', format('delete from public.follows where follower_id = %L and followee_id = %L', :'ben', :'ada'))),
  ('Ben reads none of her photographs again', '0',
   tests.f_read(:'ben', format('select count(*) from public.posts where author_id = %L', :'ada'))),
  ('the counts go back: Ada 0 followers, Ben 0 following', '0/0,0/0',
   tests.f_counts(:'ada') || ',' || tests.f_counts(:'ben')),
  ('Ada removes only follows of her: not Ben''s follow of Pia', 'OK:0',
   tests.f_as(:'ada', format('delete from public.follows where follower_id = %L', :'ben')));

-- ---------------------------------------------------------------------------
-- a public account's follow is accepted at once
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  ('Ben files a follow of Pia (public) as a request', 'OK:1',
   tests.f_as(:'ben', format('insert into public.follows (follower_id, followee_id, status) values (%L, %L, ''pending'')', :'ben', :'pia'))),
  ('it is accepted at once', 'accepted', tests.f_status(:'ben', :'pia')),
  ('and counted at once: Pia 1 follower, Ben 1 following', '1/0,0/1',
   tests.f_counts(:'pia') || ',' || tests.f_counts(:'ben')),
  ('Pia is told "started following you"', 'follow',
   tests.f_notices(:'pia', :'ben'));

-- What follow() reads back: the row the insert stored, as PostgREST
-- answers an insert with return=representation (a RETURNING).
create or replace function tests.f_insert_returning(p_uid uuid, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute p_sql into v;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end
$fn$;
insert into tests.results (name, expected, actual) values
  ('what a member reads back from the insert is the stored status (the app labels its button with it)', 'pending',
   tests.f_insert_returning(:'eli', format('insert into public.follows (follower_id, followee_id, status) values (%L, %L, ''accepted'') returning status', :'eli', :'ada')));

-- ---------------------------------------------------------------------------
-- the owner's own SQL, and the function itself
-- ---------------------------------------------------------------------------
-- The house seed files house accounts' follows of the private house
-- accounts as accepted, in the SQL editor, with no member signed in.
insert into public.follows (follower_id, followee_id, status) values (:'dev', :'ada', 'accepted');
insert into tests.results (name, expected, actual) values
  ('the owner''s SQL, with no member signed in, files what it says', 'accepted', tests.f_status(:'dev', :'ada')),
  ('and it is counted: Ada 1 follower', '1/0', tests.f_counts(:'ada')),
  ('the trigger''s function runs as its owner, with an empty search path, in private', 'private,true,true',
   (select n.nspname || ',' || p.prosecdef || ',' || (p.proconfig @> array['search_path=""'])
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'follow_status_from_followee')),
  ('nobody may call it: members, signed-out visitors, PUBLIC', 'false,false,false',
   (select has_function_privilege('authenticated', p.oid, 'execute') || ',' || has_function_privilege('anon', p.oid, 'execute')
           || ',' || exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)
      from pg_proc p where p.proname = 'follow_status_from_followee')),
  ('members may update the status of a follow and nothing else; visitors nothing', 'false,true,false,false,false',
   has_table_privilege('authenticated', 'public.follows', 'update') || ',' ||
   has_column_privilege('authenticated', 'public.follows', 'status', 'update') || ',' ||
   has_column_privilege('authenticated', 'public.follows', 'follower_id', 'update') || ',' ||
   has_column_privilege('authenticated', 'public.follows', 'followee_id', 'update') || ',' ||
   has_column_privilege('anon', 'public.follows', 'status', 'update'));

-- ---------------------------------------------------------------------------
-- the recount, and the file run again
-- ---------------------------------------------------------------------------
-- A count that drifted, and a request counted as a follower, as 0001's
-- trigger counted it: the file applied again puts both right.
update public.profiles set follower_count = 7 where id = :'pia';
insert into public.follows (follower_id, followee_id, status) values (:'eli', :'pia', 'pending');
update public.profiles set following_count = following_count + 1 where id = :'eli';
\o /dev/null
\ir ../migrations/0038_follows_respect_private_accounts.sql
\ir ../migrations/0038_follows_respect_private_accounts.sql
\o
insert into tests.results (name, expected, actual) values
  ('applied again, it recounts from accepted follows: Pia 1 follower, Eli 0 following', '1/0,0/0',
   tests.f_counts(:'pia') || ',' || tests.f_counts(:'eli')),
  ('every profile''s counts are its accepted follows', '0',
   (select count(*)::text from public.profiles p
     where p.follower_count <> (select count(*) from public.follows f where f.followee_id = p.id and f.status = 'accepted')
        or p.following_count <> (select count(*) from public.follows f where f.follower_id = p.id and f.status = 'accepted'))),
  ('run twice, it leaves one of each trigger and policy it makes', '1,1,1,1',
   (select count(*)::text from pg_trigger where tgrelid = 'public.follows'::regclass and tgname = 'follows_status_from_followee') || ',' ||
   (select count(*)::text from pg_trigger where tgrelid = 'public.follows'::regclass and tgname = 'follows_count_trigger') || ',' ||
   (select count(*)::text from pg_policies where tablename = 'follows' and policyname = 'follows: followee accepts') || ',' ||
   (select count(*)::text from pg_policies where tablename = 'follows' and policyname = 'follows: followee removes'));

\pset border 2
select r.seq, r.name, r.expected, r.actual,
       case when r.expected = r.actual then 'pass' else 'FAIL' end as status
from tests.results r, f_start s
where r.seq > s.seq
order by r.seq;

do $verdict$
declare v_failed int;
begin
  select count(*) into v_failed from tests.results r, f_start s
   where r.seq > s.seq and r.expected is distinct from r.actual;
  if v_failed > 0 then
    raise exception '% follow checks FAILED', v_failed;
  end if;
  raise notice 'follow checks passed';
end
$verdict$;

rollback;
