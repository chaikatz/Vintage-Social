-- 0038: follows that respect private accounts.
--
-- Asked as the members it is about, through the same policies, grants
-- and triggers the app and PostgREST go through: Ada keeps a private
-- account; Ben, Cleo and Dev ask to follow her; Eli is a member with
-- nothing to do with it; Pia's account is public; Ivy's is private until
-- she makes it public; Gus and Hal leave the club with a request
-- waiting. Then the rollback (0038_rollback.sql), applied for real, and
-- 0038 again over it. Runs in one transaction and rolls back.

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
\set ivy '0a380000-0000-4000-8000-000000000007'
\set gus '0a380000-0000-4000-8000-000000000008'
\set hal '0a380000-0000-4000-8000-000000000009'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'ada',  'ada@follows.test',  '{"username":"f38.ada"}'),
  (:'ben',  'ben@follows.test',  '{"username":"f38.ben"}'),
  (:'cleo', 'cleo@follows.test', '{"username":"f38.cleo"}'),
  (:'dev',  'dev@follows.test',  '{"username":"f38.dev"}'),
  (:'eli',  'eli@follows.test',  '{"username":"f38.eli"}'),
  (:'pia',  'pia@follows.test',  '{"username":"f38.pia"}'),
  (:'ivy',  'ivy@follows.test',  '{"username":"f38.ivy"}'),
  (:'gus',  'gus@follows.test',  '{"username":"f38.gus"}'),
  (:'hal',  'hal@follows.test',  '{"username":"f38.hal"}');
update public.profiles set status = 'approved', approved_at = now()
 where id::text like '0a380000-0000-4000-8000-00000000000_';
update public.profiles set is_private = true where id in (:'ada', :'ivy', :'hal');

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
-- a request is seen by its two members only
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  ('Eli cannot list who asked to follow Ada', '0',
   tests.f_read(:'eli', format('select count(*) from public.follows where followee_id = %L', :'ada'))),
  ('Ben sees his own request, and not Cleo''s', 'f38.ben',
   tests.f_read(:'ben', format('select p.username from public.follows f join public.profiles p on p.id = f.follower_id where f.followee_id = %L', :'ada'))),
  ('Ada sees both, as Requests lists them', '2',
   tests.f_read(:'ada', format('select count(*) from public.follows where followee_id = %L and status = ''pending''', :'ada')));

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
  ('accepting files no notice for anyone, and takes the request''s notice out of Ada''s Activity', '-|-',
   tests.f_notices(:'ada', :'ben') || '|' || tests.f_notices(:'ben', :'ada')),
  ('an accepted follow is seen by every member, as before', '1',
   tests.f_read(:'eli', format('select count(*) from public.follows where followee_id = %L', :'ada'))),
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
  ('Cleo''s request waits in Ada''s Activity', 'follow_request', tests.f_notices(:'ada', :'cleo')),
  ('Ada declines Cleo', 'OK:1',
   tests.f_as(:'ada', format('delete from public.follows where follower_id = %L and followee_id = %L and status = ''pending'' returning follower_id', :'cleo', :'ada'))),
  ('Cleo''s request is gone', 'none', tests.f_status(:'cleo', :'ada')),
  ('and so is its notice', '-', tests.f_notices(:'ada', :'cleo')),
  ('Cleo reads none of Ada''s photographs', '0',
   tests.f_read(:'cleo', format('select count(*) from public.posts where author_id = %L', :'ada'))),
  ('a declined request takes nothing from the counts: Ada 1, Cleo 0', '1/0,0/0',
   tests.f_counts(:'ada') || ',' || tests.f_counts(:'cleo')),
  ('Dev asks', 'OK:1',
   tests.f_as(:'dev', format('insert into public.follows (follower_id, followee_id, status) values (%L, %L, ''accepted'')', :'dev', :'ada'))),
  ('Ada is told', 'follow_request', tests.f_notices(:'ada', :'dev')),
  ('and withdraws his request himself (unfollow as self, as before)', 'OK:1',
   tests.f_as(:'dev', format('delete from public.follows where follower_id = %L and followee_id = %L', :'dev', :'ada'))),
  ('his request''s notice goes with it', '-', tests.f_notices(:'ada', :'dev')),
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
  ('the triggers'' three functions run as their owner, with an empty search path, in private',
   'accept_requests_when_public:private,true,true;follow_status_from_followee:private,true,true;forget_follow_request:private,true,true',
   (select string_agg(p.proname || ':' || n.nspname || ',' || p.prosecdef || ',' || (p.proconfig @> array['search_path=""']), ';' order by p.proname)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.proname in ('follow_status_from_followee', 'forget_follow_request', 'accept_requests_when_public'))),
  ('nobody may call them: members, signed-out visitors, PUBLIC', 'false,false,false;false,false,false;false,false,false',
   (select string_agg(has_function_privilege('authenticated', p.oid, 'execute') || ',' || has_function_privilege('anon', p.oid, 'execute')
           || ',' || exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0), ';' order by p.proname)
      from pg_proc p where p.proname in ('follow_status_from_followee', 'forget_follow_request', 'accept_requests_when_public'))),
  ('members may update the status of a follow and nothing else; visitors nothing', 'false,true,false,false,false',
   has_table_privilege('authenticated', 'public.follows', 'update') || ',' ||
   has_column_privilege('authenticated', 'public.follows', 'status', 'update') || ',' ||
   has_column_privilege('authenticated', 'public.follows', 'follower_id', 'update') || ',' ||
   has_column_privilege('authenticated', 'public.follows', 'followee_id', 'update') || ',' ||
   has_column_privilege('anon', 'public.follows', 'status', 'update'));

-- ---------------------------------------------------------------------------
-- an account made public lets its requests in
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  ('Cleo asks to follow Ivy (private)', 'OK:1',
   tests.f_as(:'cleo', format('insert into public.follows (follower_id, followee_id) values (%L, %L)', :'cleo', :'ivy'))),
  ('and so does Dev', 'OK:1',
   tests.f_as(:'dev', format('insert into public.follows (follower_id, followee_id) values (%L, %L)', :'dev', :'ivy'))),
  ('two requests, two notices, no followers', 'pending,pending|follow_request,follow_request|0/0',
   tests.f_status(:'cleo', :'ivy') || ',' || tests.f_status(:'dev', :'ivy') || '|'
   || tests.f_notices(:'ivy', :'cleo') || ',' || tests.f_notices(:'ivy', :'dev') || '|' || tests.f_counts(:'ivy')),
  ('Eli cannot make Ivy''s account public', 'OK:0',
   tests.f_as(:'eli', format('update public.profiles set is_private = false where id = %L', :'ivy'))),
  ('Ivy makes her account public, as Settings does', 'OK:1',
   tests.f_as(:'ivy', format('update public.profiles set is_private = false where id = %L', :'ivy'))),
  ('both requests are accepted follows', 'accepted,accepted',
   tests.f_status(:'cleo', :'ivy') || ',' || tests.f_status(:'dev', :'ivy')),
  ('and counted: Ivy 2 followers, Cleo 1 following, Dev 2 (Ada, by the owner''s SQL, and Ivy)', '2/0,0/1,0/2',
   tests.f_counts(:'ivy') || ',' || tests.f_counts(:'cleo') || ',' || tests.f_counts(:'dev')),
  ('their notices are gone from Ivy''s Activity, and nobody was sent another', '-,-|-,-',
   tests.f_notices(:'ivy', :'cleo') || ',' || tests.f_notices(:'ivy', :'dev') || '|'
   || tests.f_notices(:'cleo', :'ivy') || ',' || tests.f_notices(:'dev', :'ivy')),
  ('Ivy makes it private again: her followers stay followers', 'OK:1',
   tests.f_as(:'ivy', format('update public.profiles set is_private = true where id = %L', :'ivy'))),
  ('still accepted, still counted', 'accepted,accepted|2/0',
   tests.f_status(:'cleo', :'ivy') || ',' || tests.f_status(:'dev', :'ivy') || '|' || tests.f_counts(:'ivy')),
  ('and a new follow of her is a request again', 'OK:1',
   tests.f_as(:'ben', format('insert into public.follows (follower_id, followee_id) values (%L, %L)', :'ben', :'ivy'))),
  ('Ben''s is pending', 'pending', tests.f_status(:'ben', :'ivy')),
  ('a change to her bio leaves the request alone', 'OK:1',
   tests.f_as(:'ivy', format('update public.profiles set bio = ''film'' where id = %L', :'ivy'))),
  ('still pending', 'pending', tests.f_status(:'ben', :'ivy'));

-- ---------------------------------------------------------------------------
-- a member who leaves with a request waiting, either side of it
-- ---------------------------------------------------------------------------
-- Delete my account, or Delete user: the follows go with the profile
-- (on delete cascade), and the trigger of 6 with them, without an error.
insert into tests.results (name, expected, actual) values
  ('Gus asks to follow Ada', 'OK:1',
   tests.f_as(:'gus', format('insert into public.follows (follower_id, followee_id) values (%L, %L)', :'gus', :'ada'))),
  ('Ben asks to follow Hal (private)', 'OK:1',
   tests.f_as(:'ben', format('insert into public.follows (follower_id, followee_id) values (%L, %L)', :'ben', :'hal'))),
  ('both are requests, each with its notice', 'pending,pending|follow_request,follow_request',
   tests.f_status(:'gus', :'ada') || ',' || tests.f_status(:'ben', :'hal') || '|'
   || tests.f_notices(:'ada', :'gus') || ',' || tests.f_notices(:'hal', :'ben'));
delete from auth.users where id in (:'gus', :'hal');
insert into tests.results (name, expected, actual) values
  ('Gus and Hal leave: their requests and notices go with them', 'none,none|-,-',
   tests.f_status(:'gus', :'ada') || ',' || tests.f_status(:'ben', :'hal') || '|'
   || tests.f_notices(:'ada', :'gus') || ',' || tests.f_notices(:'hal', :'ben'));

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
  ('run twice, it leaves one of each trigger and policy it makes', '1,1,1,1,1,1,1',
   (select count(*)::text from pg_trigger where tgrelid = 'public.follows'::regclass and tgname = 'follows_status_from_followee') || ',' ||
   (select count(*)::text from pg_trigger where tgrelid = 'public.follows'::regclass and tgname = 'follows_count_trigger') || ',' ||
   (select count(*)::text from pg_trigger where tgrelid = 'public.follows'::regclass and tgname = 'follows_request_notice_gone') || ',' ||
   (select count(*)::text from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_public_accepts_requests') || ',' ||
   (select count(*)::text from pg_policies where tablename = 'follows' and policyname = 'follows: followee accepts') || ',' ||
   (select count(*)::text from pg_policies where tablename = 'follows' and policyname = 'follows: followee removes') || ',' ||
   (select count(*)::text from pg_policies where tablename = 'follows' and policyname = 'follows: a request seen by its two members'));

-- ---------------------------------------------------------------------------
-- the way back (0038_rollback.sql), applied for real, and 0038 again
-- ---------------------------------------------------------------------------
-- A request waiting when the rollback runs (Ben's of Ivy): 0001's trigger
-- will take one away for it when it goes, so the rollback counts it.
\o /dev/null
\ir 0038_rollback.sql
\o
insert into tests.results (name, expected, actual) values
  ('after the rollback: none of 0038''s triggers, functions or policies is left', '0,0,0',
   (select count(*)::text from pg_trigger
     where tgname in ('follows_status_from_followee', 'follows_request_notice_gone', 'profiles_public_accepts_requests')) || ',' ||
   (select count(*)::text from pg_proc
     where proname in ('follow_status_from_followee', 'forget_follow_request', 'accept_requests_when_public')) || ',' ||
   (select count(*)::text from pg_policies where tablename = 'follows'
     and policyname in ('follows: followee accepts', 'follows: followee removes', 'follows: a request seen by its two members'))),
  ('members and visitors may change every column of follows again, as 0037 left them', 'true,true,true',
   has_table_privilege('authenticated', 'public.follows', 'update') || ',' ||
   has_table_privilege('anon', 'public.follows', 'update') || ',' ||
   has_column_privilege('authenticated', 'public.follows', 'follower_id', 'update')),
  ('the count trigger and both functions are 0001''s again, nobody''s to call', '13,true,true,false,false',
   (select tgtype::text from pg_trigger where tgrelid = 'public.follows'::regclass and tgname = 'follows_count_trigger') || ',' ||
   (pg_get_functiondef('public.bump_follow_counts()'::regprocedure)
      = (select definition from before_0023.functions where signature = 'bump_follow_counts()'))::text || ',' ||
   (pg_get_functiondef('public.notify_follow()'::regprocedure)
      = (select definition from before_0023.functions where signature = 'notify_follow()'))::text || ',' ||
   has_function_privilege('authenticated', 'public.bump_follow_counts()', 'execute') || ',' ||
   has_function_privilege('authenticated', 'public.notify_follow()', 'execute')),
  ('every profile is counted as 0001''s trigger counts: every follow, requests included', '0',
   (select count(*)::text from public.profiles p
     where p.follower_count <> (select count(*) from public.follows f where f.followee_id = p.id)
        or p.following_count <> (select count(*) from public.follows f where f.follower_id = p.id))),
  ('Ivy counts Ben''s request (2 followers and 1 request), Ben counts it too (Pia and Ivy)', '3/0,0/2',
   tests.f_counts(:'ivy') || ',' || tests.f_counts(:'ben'));
delete from public.follows where follower_id = :'ben' and followee_id = :'ivy';
insert into tests.results (name, expected, actual) values
  ('so the request withdrawn after the rollback leaves her count right, not one low', '2/0,0/1',
   tests.f_counts(:'ivy') || ',' || tests.f_counts(:'ben'));

\o /dev/null
\ir ../migrations/0038_follows_respect_private_accounts.sql
\o
insert into tests.results (name, expected, actual) values
  ('0038 applied again over its rollback: every trigger, function and policy it makes', '3,3,3',
   (select count(*)::text from pg_trigger
     where tgname in ('follows_status_from_followee', 'follows_request_notice_gone', 'profiles_public_accepts_requests')) || ',' ||
   (select count(*)::text from pg_proc
     where proname in ('follow_status_from_followee', 'forget_follow_request', 'accept_requests_when_public')) || ',' ||
   (select count(*)::text from pg_policies where tablename = 'follows'
     and policyname in ('follows: followee accepts', 'follows: followee removes', 'follows: a request seen by its two members'))),
  ('and members may again change the status of a follow and nothing else', 'false,true,false',
   has_table_privilege('authenticated', 'public.follows', 'update') || ',' ||
   has_column_privilege('authenticated', 'public.follows', 'status', 'update') || ',' ||
   has_column_privilege('authenticated', 'public.follows', 'follower_id', 'update')),
  ('and every profile''s counts are its accepted follows again', '0',
   (select count(*)::text from public.profiles p
     where p.follower_count <> (select count(*) from public.follows f where f.followee_id = p.id and f.status = 'accepted')
        or p.following_count <> (select count(*) from public.follows f where f.follower_id = p.id and f.status = 'accepted')));

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
