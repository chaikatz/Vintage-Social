-- 0039: members write only what the app writes.
--
-- Asked as the members it is about, through the same grants, policies and
-- functions the app and PostgREST go through. Every hole the final review
-- found is tried again and must be refused; every write the app makes
-- (src/api/*.ts, with the columns it sends) is tried the same way and must
-- go through; and the functions that write as their owner (admin removal
-- and suspension, approval, invitations, account deletion, blocks, push
-- tokens) must still work for the members who call them. Then two
-- create_invite calls at once, from two sessions; then the rollback
-- (0039_rollback.sql), applied for real, and 0039 again over it.
--
-- Ana, Ben, Cara and Dan are members; Sam is a member an admin suspends;
-- Abe, Rex, Una and Kim are at the door (applied); Ivy invites; Del deletes
-- their account. Runs in one transaction and rolls back (the membership
-- numbers the approvals draw are given back to the sequence at the end,
-- which a rollback does not do).

begin;

create temp table w_start as select coalesce(max(seq), 0) as seq from tests.results;
create temp table w_seq as select last_value, is_called from public.member_no_seq;

-- A statement as a member (or, with null, a signed-out visitor): OK and how
-- many rows it touched; NO PRIVILEGE when a column or table is not theirs
-- to write; REFUSED BY POLICY when row-level security refuses the new row;
-- otherwise the error's own words.
create or replace function tests.w_as(p_uid uuid, p_sql text)
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
    when insufficient_privilege then
      v := case
        when sqlerrm like 'permission denied%' then 'NO PRIVILEGE'
        when sqlerrm like 'new row violates row-level security policy%' then 'REFUSED BY POLICY'
        else 'DENIED:' || sqlerrm
      end;
    when others then v := 'ERROR:' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end
$fn$;

-- What a member is answered: the first column of the first row, or '-'
-- (nothing, or a function that returns nothing), or the error's own words.
create or replace function tests.w_val(p_uid uuid, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  begin
    execute p_sql into v;
    v := coalesce(nullif(v, ''), '-');
  exception when others then v := 'ERROR:' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end
$fn$;

-- What is stored, read as the owner at the moment it is asked (a function,
-- so it sees what the statement it is asked in has done so far).
create or replace function tests.w_now(p_sql text)
returns text
language plpgsql
as $fn$
declare
  v text;
begin
  execute p_sql into v;
  return coalesce(v, '-');
end
$fn$;

\set ana '0a390000-0000-4000-8000-000000000001'
\set ben '0a390000-0000-4000-8000-000000000002'
\set cara '0a390000-0000-4000-8000-000000000003'
\set dan '0a390000-0000-4000-8000-000000000004'
\set sam '0a390000-0000-4000-8000-000000000005'
\set abe '0a390000-0000-4000-8000-000000000006'
\set ivy '0a390000-0000-4000-8000-000000000007'
\set rex '0a390000-0000-4000-8000-000000000008'
\set una '0a390000-0000-4000-8000-000000000009'
\set del '0a390000-0000-4000-8000-00000000000a'
\set kim '0a390000-0000-4000-8000-00000000000b'
\set admin '11111111-1111-1111-1111-111111111111'
\set p1 '0b390000-0000-4000-8000-000000000001'
\set p2 '0b390000-0000-4000-8000-000000000002'
\set p3 '0b390000-0000-4000-8000-000000000003'
\set p4 '0b390000-0000-4000-8000-000000000004'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'ana',  'ana@writes.test',  '{"username":"w39.ana"}'),
  (:'ben',  'ben@writes.test',  '{"username":"w39.ben"}'),
  (:'cara', 'cara@writes.test', '{"username":"w39.cara"}'),
  (:'dan',  'dan@writes.test',  '{"username":"w39.dan"}'),
  (:'sam',  'sam@writes.test',  '{"username":"w39.sam"}'),
  (:'abe',  'abe@writes.test',  '{"username":"w39.abe"}'),
  (:'ivy',  'ivy@writes.test',  '{"username":"w39.ivy"}'),
  (:'rex',  'rex@writes.test',  '{"username":"w39.rex"}'),
  (:'una',  'una@writes.test',  '{"username":"w39.una"}'),
  (:'del',  'del@writes.test',  '{"username":"w39.del"}'),
  (:'kim',  'kim@writes.test',  '{"username":"w39.kim"}');
update public.profiles set status = 'approved', approved_at = now()
 where id in (:'ana', :'ben', :'cara', :'dan', :'sam', :'ivy', :'del');
update public.profiles set status = 'applied' where id in (:'abe', :'rex', :'una', :'kim');

-- Ana's three photographs and Sam's, as the outbox files them.
insert into public.posts (id, author_id, media_type, media_path, thumb_path, filter_id, caption) values
  (:'p1', :'ana', 'photo', :'ana' || '/' || :'p1' || '.jpg', :'ana' || '/' || :'p1' || '.jpg', 'kodachrome', 'one'),
  (:'p2', :'ana', 'photo', :'ana' || '/' || :'p2' || '.jpg', :'ana' || '/' || :'p2' || '.jpg', 'kodachrome', 'two'),
  (:'p3', :'sam', 'photo', :'sam' || '/' || :'p3' || '.jpg', null, 'kodachrome', 'three'),
  (:'p4', :'ana', 'photo', :'ana' || '/' || :'p4' || '.jpg', null, 'kodachrome', 'four');

-- ---------------------------------------------------------------------------
-- a photograph: the author changes its caption and nothing else
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  ('the admins remove Ana''s second photograph (admin_remove_post, as before)', '-',
   tests.w_val(:'admin', format('select public.admin_remove_post(%L, ''objectionable'')::text', :'p2')));
insert into tests.results (name, expected, actual) values
  ('it is removed, and out of Ana''s count', 'true,2',
   tests.w_now(format('select (removed_at is not null)::text from public.posts where id = %L', :'p2'))
   || ',' || tests.w_now(format('select post_count::text from public.profiles where id = %L', :'ana')));
insert into tests.results (name, expected, actual) values
  ('Ana cannot undo the removal', 'NO PRIVILEGE',
   tests.w_as(:'ana', format('update public.posts set removed_at = null, removed_by = null where id = %L', :'p2'))),
  ('nor clear removed_at alone', 'NO PRIVILEGE',
   tests.w_as(:'ana', format('update public.posts set removed_at = null where id = %L', :'p2'))),
  ('nor date a photograph 2099, set its likes or comments, point it at another file, or have it announced again',
   'NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE',
   tests.w_as(:'ana', format('update public.posts set created_at = ''2099-01-01'' where id = %L', :'p1')) || ',' ||
   tests.w_as(:'ana', format('update public.posts set like_count = 99999 where id = %L', :'p1')) || ',' ||
   tests.w_as(:'ana', format('update public.posts set comment_count = 777 where id = %L', :'p1')) || ',' ||
   tests.w_as(:'ana', format('update public.posts set media_path = %L where id = %L', :'dan' || '/x.jpg', :'p1')) || ',' ||
   tests.w_as(:'ana', format('update public.posts set thumb_path = ''https://attacker.example/t.jpg'' where id = %L', :'p1')) || ',' ||
   tests.w_as(:'ana', format('update public.posts set notified_at = null where id = %L', :'p1')) || ',' ||
   tests.w_as(:'ana', format('update public.posts set author_id = %L where id = %L', :'ben', :'p1'))),
  ('the removed photograph''s words stay as the admins left them', 'OK:0',
   tests.w_as(:'ana', format('update public.posts set caption = ''back again'' where id = %L returning id', :'p2')));
insert into tests.results (name, expected, actual) values
  ('so it is still removed, unseen by Ben, out of Ana''s count, with its words', 'true,0,2,two',
   tests.w_now(format('select (removed_at is not null)::text from public.posts where id = %L', :'p2'))
   || ',' || tests.w_val(:'ben', format('select count(*)::text from public.posts where id = %L', :'p2'))
   || ',' || tests.w_now(format('select post_count::text from public.profiles where id = %L', :'ana'))
   || ',' || tests.w_now(format('select caption from public.posts where id = %L', :'p2')));
insert into tests.results (name, expected, actual) values
  -- What updateCaption sends: the caption, asking for the row back.
  ('Ana changes the caption of her live photograph (Edit caption)', 'OK:1',
   tests.w_as(:'ana', format('update public.posts set caption = ''one, again'' where id = %L returning id', :'p1'))),
  ('Ben cannot change Ana''s caption', 'OK:0',
   tests.w_as(:'ben', format('update public.posts set caption = ''mine now'' where id = %L returning id', :'p1')));
insert into tests.results (name, expected, actual) values
  ('the caption is Ana''s, the date, counts and files as they were', 'one, again,0,0,true',
   tests.w_now(format('select caption from public.posts where id = %L', :'p1'))
   || ',' || tests.w_now(format('select like_count::text from public.posts where id = %L', :'p1'))
   || ',' || tests.w_now(format('select comment_count::text from public.posts where id = %L', :'p1'))
   || ',' || tests.w_now(format('select (created_at <= now() and media_path = %L)::text from public.posts where id = %L', :'ana' || '/' || :'p1' || '.jpg', :'p1')));

-- Sam suspended (admin_set_suspension, as before): he changes nothing of his photograph.
insert into tests.results (name, expected, actual) values
  ('the admins suspend Sam', '-',
   tests.w_val(:'admin', format('select public.admin_set_suspension(%L, true, ''spam'')::text', :'sam')));
insert into tests.results (name, expected, actual) values
  ('a suspended author cannot change a caption', 'OK:0',
   tests.w_as(:'sam', format('update public.posts set caption = ''still here'' where id = %L returning id', :'p3'))),
  ('nor anything else of the photograph', 'NO PRIVILEGE',
   tests.w_as(:'sam', format('update public.posts set removed_at = null, created_at = ''2099-01-01'' where id = %L', :'p3'))),
  ('Ana still deletes her own photograph', 'OK:1',
   tests.w_as(:'ana', format('delete from public.posts where id = %L returning id', :'p4')));

-- ---------------------------------------------------------------------------
-- a new photograph: the columns the outbox sends, its files in the author's folder
-- ---------------------------------------------------------------------------
-- What newPostFor (src/uploads/outbox.ts) sends, every column of NewPost.
create temp table w_post (n int, sql text);
insert into w_post values (1, 'insert into public.posts (id, author_id, media_type, media_path, thumb_path, width, height,
  duration_seconds, filter_id, filter_baked, show_date_stamp, caption, taken_at, location, lat, lng, place_id)
  values (%L, %L, %L, %L, %L, 1080, 1350, %s, ''kodachrome'', true, false, ''new'', now() - interval ''1 year'',
  ''Lisbon'', 38.7, -9.1, null)');
grant select on w_post to authenticated;

insert into tests.results (name, expected, actual) values
  ('Ana files a photograph as the outbox does: {her id}/{post id}.jpg, its thumbnail the same', 'OK:1',
   tests.w_as(:'ana', format((select sql from w_post), '0b390000-0000-4000-8000-000000000011', :'ana', 'photo',
     :'ana' || '/0b390000-0000-4000-8000-000000000011.jpg', :'ana' || '/0b390000-0000-4000-8000-000000000011.jpg', 'null'))),
  ('and a film: {post id}.mp4, its poster {post id}.jpg', 'OK:1',
   tests.w_as(:'ana', format((select sql from w_post), '0b390000-0000-4000-8000-000000000012', :'ana', 'video',
     :'ana' || '/0B390000-0000-4000-8000-000000000012.mov', :'ana' || '/0B390000-0000-4000-8000-000000000012.jpg', '12'))),
  ('and one with no thumbnail', 'OK:1',
   tests.w_as(:'ana', format((select sql from w_post), '0b390000-0000-4000-8000-000000000013', :'ana', 'photo',
     :'ana' || '/0b390000-0000-4000-8000-000000000013.jpg', null, 'null'))),
  ('and as 06_verify_publish.sql files one', 'OK:1',
   tests.w_as(:'ana', format('insert into public.posts (author_id, media_type, media_path, thumb_path, filter_id) values (%L, ''photo'', %L, %L, ''kodachrome'')',
     :'ana', :'ana' || '/verify.jpg', :'ana' || '/verify.jpg')));
insert into tests.results (name, expected, actual) values
  ('each dated now, never announced yet, counted (Ana: 1 + 4)', 'true,5',
   tests.w_now(format('select bool_and(created_at > now() - interval ''1 minute'' and created_at <= now() and notified_at is null)::text from public.posts where author_id = %L', :'ana'))
   || ',' || tests.w_now(format('select post_count::text from public.profiles where id = %L', :'ana')));
insert into tests.results (name, expected, actual) values
  ('a photograph that is a URL on the internet is refused', 'REFUSED BY POLICY',
   tests.w_as(:'ana', format((select sql from w_post), gen_random_uuid(), :'ana', 'photo',
     'https://attacker.example/x.jpg', 'https://attacker.example/t.jpg', 'null'))),
  ('so is a thumbnail that is one, beside a photograph of her own', 'REFUSED BY POLICY',
   tests.w_as(:'ana', format((select sql from w_post), gen_random_uuid(), :'ana', 'photo',
     :'ana' || '/a.jpg', 'https://attacker.example/t.jpg', 'null'))),
  ('so is another member''s file', 'REFUSED BY POLICY',
   tests.w_as(:'ana', format((select sql from w_post), gen_random_uuid(), :'ana', 'photo',
     :'dan' || '/x.jpg', null, 'null'))),
  ('and their thumbnail', 'REFUSED BY POLICY',
   tests.w_as(:'ana', format((select sql from w_post), gen_random_uuid(), :'ana', 'photo',
     :'ana' || '/a.jpg', :'dan' || '/x.jpg', 'null'))),
  ('and a path that climbs out of her folder, or sits in a folder below it, or at the top of the bucket',
   'REFUSED BY POLICY,REFUSED BY POLICY,REFUSED BY POLICY,REFUSED BY POLICY',
   tests.w_as(:'ana', format((select sql from w_post), gen_random_uuid(), :'ana', 'photo', :'ana' || '/../' || :'dan' || '/x.jpg', null, 'null')) || ',' ||
   tests.w_as(:'ana', format((select sql from w_post), gen_random_uuid(), :'ana', 'photo', :'ana' || '/..', null, 'null')) || ',' ||
   tests.w_as(:'ana', format((select sql from w_post), gen_random_uuid(), :'ana', 'photo', :'ana' || '/sub/x.jpg', null, 'null')) || ',' ||
   tests.w_as(:'ana', format((select sql from w_post), gen_random_uuid(), :'ana', 'photo', 'x.jpg', null, 'null'))),
  ('a photograph dated by its member, or already announced, or with likes, or removed: not hers to write',
   'NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE',
   tests.w_as(:'ana', format('insert into public.posts (author_id, media_type, media_path, filter_id, created_at) values (%L, ''photo'', %L, ''kodachrome'', ''2099-01-01'')', :'ana', :'ana' || '/b.jpg')) || ',' ||
   tests.w_as(:'ana', format('insert into public.posts (author_id, media_type, media_path, filter_id, notified_at) values (%L, ''photo'', %L, ''kodachrome'', now())', :'ana', :'ana' || '/b.jpg')) || ',' ||
   tests.w_as(:'ana', format('insert into public.posts (author_id, media_type, media_path, filter_id, like_count) values (%L, ''photo'', %L, ''kodachrome'', 0)', :'ana', :'ana' || '/b.jpg')) || ',' ||
   tests.w_as(:'ana', format('insert into public.posts (author_id, media_type, media_path, filter_id, removed_at) values (%L, ''photo'', %L, ''kodachrome'', null)', :'ana', :'ana' || '/b.jpg'))),
  ('a signed-out visitor files nothing', 'NO PRIVILEGE',
   tests.w_as(null, format('insert into public.posts (author_id, media_type, media_path, filter_id) values (%L, ''photo'', %L, ''kodachrome'')', :'ana', :'ana' || '/c.jpg'))),
  ('nor does a suspended member, in his own folder', 'REFUSED BY POLICY',
   tests.w_as(:'sam', format('insert into public.posts (author_id, media_type, media_path, filter_id) values (%L, ''photo'', %L, ''kodachrome'')', :'sam', :'sam' || '/d.jpg')));
-- The house seed and the review account are written as the owner: URLs stay theirs.
insert into public.posts (author_id, media_type, media_path, thumb_path, filter_id)
values (:'dan', 'photo', 'https://upload.wikimedia.org/x.jpg', 'https://upload.wikimedia.org/960px-x.jpg', 'none');
insert into tests.results (name, expected, actual) values
  ('the owner''s own SQL (the house seed) still files a photograph by URL', '1',
   tests.w_now(format('select count(*)::text from public.posts where author_id = %L and media_path ~ ''^https:''', :'dan')));

-- ---------------------------------------------------------------------------
-- a profile: name, bio, city, portrait and privacy, and nothing else
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  ('Ben cannot set his counts, approval date, name in the club, handle, date, number, role, status, allowance, house or inviter',
   'NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE',
   tests.w_as(:'ben', format('update public.profiles set follower_count = 1000000 where id = %L', :'ben')) || ',' ||
   tests.w_as(:'ben', format('update public.profiles set following_count = 5 where id = %L', :'ben')) || ',' ||
   tests.w_as(:'ben', format('update public.profiles set post_count = 777 where id = %L', :'ben')) || ',' ||
   tests.w_as(:'ben', format('update public.profiles set approved_at = ''2020-01-01'' where id = %L', :'ben')) || ',' ||
   tests.w_as(:'ben', format('update public.profiles set username = ''vintage.admins'' where id = %L', :'ben')) || ',' ||
   tests.w_as(:'ben', format('update public.profiles set social_handle = ''@vintage'' where id = %L', :'ben')) || ',' ||
   tests.w_as(:'ben', format('update public.profiles set created_at = ''2020-01-01'' where id = %L', :'ben')) || ',' ||
   tests.w_as(:'ben', format('update public.profiles set member_no = 1 where id = %L', :'ben')) || ',' ||
   tests.w_as(:'ben', format('update public.profiles set role = ''admin'' where id = %L', :'ben')) || ',' ||
   tests.w_as(:'ben', format('update public.profiles set status = ''approved'' where id = %L', :'ben')) || ',' ||
   tests.w_as(:'ben', format('update public.profiles set invite_quota = 99 where id = %L', :'ben')) || ',' ||
   tests.w_as(:'ben', format('update public.profiles set is_house = true where id = %L', :'ben')) || ',' ||
   tests.w_as(:'ben', format('update public.profiles set invited_by = %L where id = %L', :'ana', :'ben'))),
  -- What Settings sends on Save, and with a new portrait (avatar-<time>.jpg).
  ('Ben saves Settings: name, bio, city', 'OK:1',
   tests.w_as(:'ben', format('update public.profiles set full_name = ''Ben B'', bio = ''photographs'', city = ''Leeds'' where id = %L', :'ben'))),
  ('and with a new portrait from his own folder', 'OK:1',
   tests.w_as(:'ben', format('update public.profiles set full_name = ''Ben B'', bio = ''photographs'', city = ''Leeds'', avatar_url = %L where id = %L',
     :'ben' || '/avatar-1762600000000.jpg', :'ben'))),
  ('and makes his account private, and public again', 'OK:1,OK:1',
   tests.w_as(:'ben', format('update public.profiles set is_private = true where id = %L', :'ben')) || ',' ||
   tests.w_as(:'ben', format('update public.profiles set is_private = false where id = %L', :'ben'))),
  ('a portrait that is a URL on the internet is refused', 'REFUSED BY POLICY',
   tests.w_as(:'ben', format('update public.profiles set avatar_url = ''https://attacker.example/me.jpg'' where id = %L', :'ben'))),
  ('so is another member''s, or one that climbs out of his folder', 'REFUSED BY POLICY,REFUSED BY POLICY',
   tests.w_as(:'ben', format('update public.profiles set avatar_url = %L where id = %L', :'cara' || '/avatar.jpg', :'ben')) || ',' ||
   tests.w_as(:'ben', format('update public.profiles set avatar_url = %L where id = %L', :'ben' || '/../' || :'cara' || '/avatar.jpg', :'ben'))),
  ('and he may take his portrait away', 'OK:1',
   tests.w_as(:'ben', format('update public.profiles set avatar_url = null where id = %L', :'ben'))),
  -- What submitApplication does at sign-up: {uid}/avatar.jpg onto the profile.
  ('Abe, at the door, puts his portrait on his profile as sign-up does', 'OK:1',
   tests.w_as(:'abe', format('update public.profiles set avatar_url = %L where id = %L', :'abe' || '/avatar.jpg', :'abe'))),
  ('a suspended member changes nothing of his profile', 'OK:0,OK:0',
   tests.w_as(:'sam', format('update public.profiles set bio = ''a new bio'' where id = %L', :'sam')) || ',' ||
   tests.w_as(:'sam', format('update public.profiles set is_private = true where id = %L', :'sam'))),
  ('nobody changes another member''s profile', 'OK:0',
   tests.w_as(:'ben', format('update public.profiles set bio = ''x'' where id = %L', :'cara'))),
  ('a signed-out visitor changes no profile, nor files one', 'NO PRIVILEGE,NO PRIVILEGE',
   tests.w_as(null, format('update public.profiles set bio = ''x'' where id = %L', :'cara')) || ',' ||
   tests.w_as(null, 'insert into public.profiles (id, username) values (gen_random_uuid(), ''w39.anon'')'));
insert into tests.results (name, expected, actual) values
  ('Ben''s profile is as Settings left it, his counts and name untouched', 'Ben B,photographs,Leeds,-,f,0,0,0,w39.ben',
   tests.w_now(format('select concat_ws('','', full_name, bio, city, coalesce(avatar_url, ''-''), is_private, follower_count, following_count, post_count, username) from public.profiles where id = %L', :'ben')));

-- ---------------------------------------------------------------------------
-- an application: the Apply form's columns, its portrait from the applicant's folder
-- ---------------------------------------------------------------------------
create temp table w_app (sql text);
insert into w_app values ('insert into public.applications (user_id, full_name, desired_username, avatar_url, social_handle, city, inviter, reason)
  values (%L, ''Rex R'', ''w39.rex'', %L, ''@rex'', ''York'', ''Ana'', ''I take photographs.'')');
grant select on w_app to authenticated;
insert into tests.results (name, expected, actual) values
  ('an application whose portrait is a URL on the internet is refused', 'REFUSED BY POLICY',
   tests.w_as(:'rex', format((select sql from w_app), :'rex', 'https://attacker.example/rex.jpg'))),
  ('so is one with another member''s portrait', 'REFUSED BY POLICY',
   tests.w_as(:'rex', format((select sql from w_app), :'rex', :'ben' || '/avatar.jpg'))),
  ('an application filed already decided is not the applicant''s to write', 'NO PRIVILEGE',
   tests.w_as(:'rex', format('insert into public.applications (user_id, full_name, desired_username, reason, status) values (%L, ''Rex'', ''w39.rex'', ''x'', ''approved'')', :'rex'))),
  ('Rex applies as the Apply form does, his portrait his own', 'OK:1',
   tests.w_as(:'rex', format((select sql from w_app), :'rex', :'rex' || '/avatar.jpg'))),
  ('Una applies with no portrait', 'OK:1',
   tests.w_as(:'una', format((select sql from w_app), :'una', null)));
insert into tests.results (name, expected, actual) values
  ('an admin approves Rex (decide_application, as before)', '-',
   tests.w_val(:'admin', format('select public.decide_application(id, ''approved'')::text from public.applications where user_id = %L', :'rex')));
insert into tests.results (name, expected, actual) values
  ('Rex is a member, numbered', 'approved,true',
   tests.w_now(format('select status || '','' || (member_no is not null)::text from public.profiles where id = %L', :'rex')));

-- ---------------------------------------------------------------------------
-- a conversation: opened, never moved
-- ---------------------------------------------------------------------------
create temp table w_conv (id uuid);
grant all on w_conv to authenticated;
insert into tests.results (name, expected, actual) values
  -- What openConversation sends, asking for the id back.
  ('Ben opens a conversation with Dan', 'OK:1',
   tests.w_as(:'ben', format('insert into public.conversations (user_a, user_b) values (%L, %L) returning id', least(:'ben'::uuid, :'dan'::uuid), greatest(:'ben'::uuid, :'dan'::uuid))));
insert into w_conv select id from public.conversations where user_a = least(:'ben'::uuid, :'dan'::uuid) and user_b = greatest(:'ben'::uuid, :'dan'::uuid);
insert into tests.results (name, expected, actual) values
  ('Dan writes to Ben, as sendMessage does', 'OK:1',
   tests.w_as(:'dan', format('insert into public.messages (conversation_id, sender_id, body, post_id) values (%L, %L, ''dan''''s private words'', null)', (select id from w_conv), :'dan'))),
  ('and sends him Ana''s photograph', 'OK:1',
   tests.w_as(:'dan', format('insert into public.messages (conversation_id, sender_id, body, post_id) values (%L, %L, '''', %L)', (select id from w_conv), :'dan', :'p1')));
insert into tests.results (name, expected, actual) values
  ('the thread is touched by its trigger, as its owner', 'true',
   tests.w_now(format('select (last_message_at >= created_at)::text from public.conversations where id = %L', (select id from w_conv))));
insert into tests.results (name, expected, actual) values
  ('Ben cannot move the conversation to Ana', 'NO PRIVILEGE',
   tests.w_as(:'ben', format('update public.conversations set user_a = %L, user_b = %L where id = %L', least(:'ana'::uuid, :'ben'::uuid), greatest(:'ana'::uuid, :'ben'::uuid), (select id from w_conv)))),
  ('nor touch it', 'NO PRIVILEGE',
   tests.w_as(:'ben', format('update public.conversations set last_message_at = ''2099-01-01'' where id = %L', (select id from w_conv)))),
  ('nor open one dated as he likes', 'NO PRIVILEGE',
   tests.w_as(:'ben', format('insert into public.conversations (user_a, user_b, last_message_at) values (%L, %L, ''2099-01-01'')', least(:'ben'::uuid, :'cara'::uuid), greatest(:'ben'::uuid, :'cara'::uuid))));
insert into tests.results (name, expected, actual) values
  ('so Ana reads none of Dan''s words, and Dan still has his thread', '0,2',
   tests.w_val(:'ana', 'select count(*)::text from public.messages')
   || ',' || tests.w_val(:'dan', format('select count(*)::text from public.messages where conversation_id = %L', (select id from w_conv))));
insert into tests.results (name, expected, actual) values
  ('a message dated, or already read, by its sender: not his to write', 'NO PRIVILEGE,NO PRIVILEGE',
   tests.w_as(:'dan', format('insert into public.messages (conversation_id, sender_id, body, created_at) values (%L, %L, ''x'', ''2099-01-01'')', (select id from w_conv), :'dan')) || ',' ||
   tests.w_as(:'dan', format('insert into public.messages (conversation_id, sender_id, body, read_at) values (%L, %L, ''x'', now())', (select id from w_conv), :'dan'))),
  ('Dan cannot mark his own messages read for Ben', 'OK:0',
   tests.w_as(:'dan', format('update public.messages set read_at = now() where conversation_id = %L and read_at is null', (select id from w_conv)))),
  -- What markConversationRead sends.
  ('Ben marks the thread read', 'OK:2',
   tests.w_as(:'ben', format('update public.messages set read_at = now() where conversation_id = %L and sender_id <> %L and read_at is null', (select id from w_conv), :'ben'))),
  ('and his unread count is 0 (unread_message_counts)', '-',
   tests.w_val(:'ben', 'select conversation_id::text from public.unread_message_counts()'));

-- ---------------------------------------------------------------------------
-- a tag: filed by the photograph's author, decided by the member tagged, never moved
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  ('Ana tags Dan in her photograph, as tagMembers does', 'OK:1',
   tests.w_as(:'ana', format('insert into public.post_tags (post_id, user_id, tagged_by) values (%L, %L, %L)', :'p1', :'dan', :'ana'))),
  ('a tag filed already accepted is not the author''s to write', 'NO PRIVILEGE',
   tests.w_as(:'ana', format('insert into public.post_tags (post_id, user_id, tagged_by, status) values (%L, %L, %L, ''accepted'')', :'p1', :'cara', :'ana'))),
  ('Dan cannot move his tag onto another photograph, attributed to its author', 'NO PRIVILEGE',
   tests.w_as(:'dan', format('update public.post_tags set post_id = %L, tagged_by = %L, status = ''accepted'' where user_id = %L',
     '0b390000-0000-4000-8000-000000000011', :'ana', :'dan'))),
  ('nor date it', 'NO PRIVILEGE',
   tests.w_as(:'dan', format('update public.post_tags set created_at = ''2020-01-01'' where user_id = %L', :'dan'))),
  -- What decideTag sends.
  ('Dan accepts it', 'OK:1',
   tests.w_as(:'dan', format('update public.post_tags set status = ''accepted'', decided_at = now() where post_id = %L and user_id = %L', :'p1', :'dan'))),
  ('and declines it after', 'OK:1',
   tests.w_as(:'dan', format('update public.post_tags set status = ''declined'', decided_at = now() where post_id = %L and user_id = %L', :'p1', :'dan')));
insert into tests.results (name, expected, actual) values
  ('the tag is where Ana put it', 'declined on p1 by Ana',
   tests.w_now(format('select status || '' on '' || case when post_id = %L then ''p1'' else post_id::text end || '' by '' || case when tagged_by = %L then ''Ana'' else tagged_by::text end from public.post_tags where user_id = %L', :'p1', :'ana', :'dan')));
insert into tests.results (name, expected, actual) values
  ('Ana takes the tag back (removeTag)', 'OK:1',
   tests.w_as(:'ana', format('delete from public.post_tags where post_id = %L and user_id = %L', :'p1', :'dan')));

-- ---------------------------------------------------------------------------
-- comments, likes, follows, reports, share records, notices, blocks: as the app sends them
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  ('Ben comments, as addComment does', 'OK:1',
   tests.w_as(:'ben', format('insert into public.comments (post_id, author_id, body) values (%L, %L, ''lovely'')', :'p1', :'ben'))),
  ('Ben likes it, as likePost does', 'OK:1',
   tests.w_as(:'ben', format('insert into public.likes (post_id, user_id) values (%L, %L)', :'p1', :'ben'))),
  ('Cara follows Ana, as follow does', 'OK:1',
   tests.w_as(:'cara', format('insert into public.follows (follower_id, followee_id, status) values (%L, %L, ''accepted'') returning status', :'cara', :'ana'))),
  ('Cara reports Ana''s photograph, as submitReport does', 'OK:1',
   tests.w_as(:'cara', format('insert into public.reports (reporter_id, target_type, post_id, comment_id, profile_id, reason, details) values (%L, ''post'', %L, null, null, ''Something else'', null)', :'cara', :'p1'))),
  ('Ben records a share, as recordShareEvent does', 'OK:1',
   tests.w_as(:'ben', format('insert into public.share_events (kind, actor_id, post_id, token, format, theme) values (''share_started'', %L, %L, null, ''print'', ''paper'')', :'ben', :'p1'))),
  ('Ana marks her notices read, as markActivityRead does', 'OK:4',
   tests.w_as(:'ana', format('update public.activity set read_at = now() where recipient_id = %L and read_at is null', :'ana')));
insert into tests.results (name, expected, actual) values
  ('the like and the comment are counted by their triggers, as their owner', '1,1',
   tests.w_now(format('select like_count || '','' || comment_count from public.posts where id = %L', :'p1')));
insert into tests.results (name, expected, actual) values
  ('a comment, like or follow dated by its member: not theirs to write', 'NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE',
   tests.w_as(:'ben', format('insert into public.comments (post_id, author_id, body, created_at) values (%L, %L, ''first!'', ''2000-01-01'')', :'p1', :'ben')) || ',' ||
   tests.w_as(:'cara', format('insert into public.likes (post_id, user_id, created_at) values (%L, %L, ''2099-01-01'')', :'p1', :'cara')) || ',' ||
   tests.w_as(:'dan', format('insert into public.follows (follower_id, followee_id, created_at) values (%L, %L, ''2000-01-01'')', :'dan', :'ana'))),
  ('a report filed as already sent to the admins, or decided, or dated: not the reporter''s to write', 'NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE',
   tests.w_as(:'cara', format('insert into public.reports (reporter_id, target_type, post_id, reason, pushed_at) values (%L, ''post'', %L, ''Spam or scam'', now())', :'cara', :'p1')) || ',' ||
   tests.w_as(:'cara', format('insert into public.reports (reporter_id, target_type, post_id, reason, status) values (%L, ''post'', %L, ''Spam or scam'', ''open'')', :'cara', :'p1')) || ',' ||
   tests.w_as(:'cara', format('insert into public.reports (reporter_id, target_type, post_id, reason, created_at) values (%L, ''post'', %L, ''Spam or scam'', ''2000-01-01'')', :'cara', :'p1'))),
  ('a notice''s words, kind or sender: not its member''s to change', 'NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE',
   tests.w_as(:'ana', format('update public.activity set message = ''You are banned'' where recipient_id = %L', :'ana')) || ',' ||
   tests.w_as(:'ana', format('update public.activity set type = ''moderation'' where recipient_id = %L', :'ana')) || ',' ||
   tests.w_as(:'ana', format('update public.activity set pushed_at = null where recipient_id = %L', :'ana'))),
  ('nor may a member file a notice, a share link, an invitation, a setting or an admin''s record',
   'NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE',
   tests.w_as(:'ana', format('insert into public.activity (recipient_id, type, message) values (%L, ''moderation'', ''x'')', :'ben')) || ',' ||
   tests.w_as(:'ana', format('insert into public.post_shares (token, post_id, owner_id, format, theme) values (''0123456789abcdef0123456789abcdef'', %L, %L, ''print'', ''paper'')', :'p1', :'ana')) || ',' ||
   tests.w_as(:'ana', format('insert into public.invites (code, created_by) values (''W39A-AAAA'', %L)', :'ana')) || ',' ||
   tests.w_as(:'ana', format('insert into public.invite_links (owner_id, slug) values (%L, ''w39-ana'')', :'ana')) || ',' ||
   tests.w_as(:'ana', 'insert into public.app_settings (key, value) values (''w39'', ''1'')') || ',' ||
   tests.w_as(:'ana', format('insert into public.moderation_actions (admin_id, target_profile_id, action) values (%L, %L, ''warning'')', :'ana', :'ben'))),
  ('nor write a block directly, or move one: Block and Unblock are functions', 'NO PRIVILEGE,NO PRIVILEGE',
   tests.w_as(:'ana', format('insert into public.blocks (blocker_id, blocked_id) values (%L, %L)', :'ana', :'ben')) || ',' ||
   tests.w_as(:'ana', format('update public.blocks set blocked_id = %L where blocker_id = %L', :'cara', :'ana')));
insert into tests.results (name, expected, actual) values
  ('Ana blocks Ben and unblocks him (block_member, unblock_member, as before)', '-,-',
   tests.w_val(:'ana', format('select public.block_member(%L)::text', :'ben')) || ',' ||
   tests.w_val(:'ana', format('select public.unblock_member(%L)::text', :'ben')));
insert into tests.results (name, expected, actual) values
  ('Ana shares her photograph by link (create_post_share, as before)', 'true',
   tests.w_val(:'ana', format('select (public.create_post_share(%L, ''print'', ''paper'') is not null)::text', :'p1')));

-- A member's own eras, notification settings and phones: the app's upserts.
insert into tests.results (name, expected, actual) values
  ('Ana saves her eras (saveEraEdits'' upsert), twice', 'OK:1,OK:1',
   tests.w_as(:'ana', format('insert into public.era_edits (author_id, titles, moves, time_zone) values (%L, ''{"Winter 2024":"Snowed in"}'', ''{}'', ''Europe/Lisbon'')
      on conflict (author_id) do update set author_id = excluded.author_id, titles = excluded.titles, moves = excluded.moves, time_zone = excluded.time_zone', :'ana')) || ',' ||
   tests.w_as(:'ana', format('insert into public.era_edits (author_id, titles, moves, time_zone) values (%L, ''{"Winter 2024":"Snowed in again"}'', ''{}'', ''Europe/Lisbon'')
      on conflict (author_id) do update set author_id = excluded.author_id, titles = excluded.titles, moves = excluded.moves, time_zone = excluded.time_zone', :'ana'))),
  ('her notification settings (updateNotificationPrefs'' upsert)', 'OK:1',
   tests.w_as(:'ana', format('insert into public.notification_prefs (user_id, likes, comments, follows, tags, messages, posts, memories, updated_at)
      values (%L, false, true, true, true, true, true, true, now())
      on conflict (user_id) do update set user_id = excluded.user_id, likes = excluded.likes, comments = excluded.comments, follows = excluded.follows,
        tags = excluded.tags, messages = excluded.messages, posts = excluded.posts, memories = excluded.memories, updated_at = excluded.updated_at', :'ana'))),
  ('her phone (claim_push_token), and the upsert a build without it sends', '-,OK:1',
   tests.w_val(:'ana', 'select public.claim_push_token(''ExponentPushToken[w39-ana]'', ''ios'', ''iPhone'')::text') || ',' ||
   tests.w_as(:'ana', format('insert into public.push_tokens (token, user_id, platform, device, updated_at, invalid_at)
      values (''ExponentPushToken[w39-ana-2]'', %L, ''ios'', ''iPhone'', now(), null)
      on conflict (token) do update set token = excluded.token, user_id = excluded.user_id, platform = excluded.platform,
        device = excluded.device, updated_at = excluded.updated_at, invalid_at = excluded.invalid_at', :'ana'))),
  ('a signed-out visitor writes none of these, nor any comment, like, follow, message or report',
   'NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE,NO PRIVILEGE',
   tests.w_as(null, format('insert into public.era_edits (author_id) values (%L)', :'ben')) || ',' ||
   tests.w_as(null, format('insert into public.notification_prefs (user_id) values (%L)', :'ben')) || ',' ||
   tests.w_as(null, format('insert into public.push_tokens (token, user_id, platform) values (''ExponentPushToken[w39-anon]'', %L, ''ios'')', :'ben')) || ',' ||
   tests.w_as(null, format('insert into public.comments (post_id, author_id, body) values (%L, %L, ''x'')', :'p1', :'ben')) || ',' ||
   tests.w_as(null, format('insert into public.likes (post_id, user_id) values (%L, %L)', :'p1', :'ben')) || ',' ||
   tests.w_as(null, format('insert into public.follows (follower_id, followee_id) values (%L, %L)', :'ben', :'ana')) || ',' ||
   tests.w_as(null, format('insert into public.messages (conversation_id, sender_id, body) values (%L, %L, ''x'')', (select id from w_conv), :'ben')) || ',' ||
   tests.w_as(null, format('insert into public.reports (reporter_id, target_type, post_id, reason) values (%L, ''post'', %L, ''x'')', :'ben', :'p1')));

-- The admins' other functions, as before.
insert into tests.results (name, expected, actual) values
  ('the admins remove Ben''s comment, warn him, change his allowance, and dismiss Cara''s report', '-,-,2,-',
   tests.w_val(:'admin', format('select public.admin_remove_comment(id, ''rude'')::text from public.comments where author_id = %L', :'ben')) || ',' ||
   tests.w_val(:'admin', format('select public.admin_warn_member(%L, ''Be kind.'')::text', :'ben')) || ',' ||
   tests.w_val(:'admin', format('select public.admin_set_invite_quota(%L, 2)::text', :'ben')) || ',' ||
   tests.w_val(:'admin', format('select public.resolve_report(id, ''dismissed'', ''No action needed'')::text from public.reports where reporter_id = %L', :'cara')));
insert into tests.results (name, expected, actual) values
  ('and each took', 'true,2,dismissed',
   tests.w_now(format('select (removed_at is not null)::text from public.comments where author_id = %L', :'ben'))
   || ',' || tests.w_now(format('select invite_quota::text from public.profiles where id = %L', :'ben'))
   || ',' || tests.w_now(format('select status from public.reports where reporter_id = %L', :'cara')));

-- Del deletes their account, with a photograph, a comment and a like (delete_my_account, as before).
insert into public.posts (id, author_id, media_type, media_path, filter_id)
values ('0b390000-0000-4000-8000-0000000000de', :'del', 'photo', :'del' || '/x.jpg', 'kodachrome');
insert into tests.results (name, expected, actual) values
  ('Del comments and likes', 'OK:1,OK:1',
   tests.w_as(:'del', format('insert into public.comments (post_id, author_id, body) values (%L, %L, ''bye'')', :'p1', :'del')) || ',' ||
   tests.w_as(:'del', format('insert into public.likes (post_id, user_id) values (%L, %L)', :'p1', :'del')));
insert into tests.results (name, expected, actual) values
  ('Del deletes their account', '-',
   tests.w_val(:'del', 'select public.delete_my_account()::text'));
insert into tests.results (name, expected, actual) values
  ('and it is gone, with their photograph', '0,0',
   tests.w_now(format('select count(*)::text from public.profiles where id = %L', :'del'))
   || ',' || tests.w_now(format('select count(*)::text from public.posts where author_id = %L', :'del')));

-- ---------------------------------------------------------------------------
-- invitations: a suspension stays, and one allowance for links and codes
-- ---------------------------------------------------------------------------
update public.profiles set invite_quota = 1 where id = :'ivy';
insert into tests.results (name, expected, actual) values
  ('Ivy has her link (ensure_invite_link, as before)', 'true',
   tests.w_val(:'ivy', 'select (slug is not null)::text from public.ensure_invite_link()'));
create temp table w_link as select slug from public.invite_links where owner_id = :'ivy';
grant select on w_link to authenticated;
-- An unused code of Ivy's, made before the allowance was counted as one.
insert into public.invites (code, created_by) values ('W39C-ODE1', :'ivy');

insert into tests.results (name, expected, actual) values
  ('suspended Sam cannot lift his suspension with Ivy''s open link (join_with_invite)', 'ERROR:This account is suspended',
   tests.w_val(:'sam', format('select public.join_with_invite(%L)::text', (select slug from w_link)))),
  ('nor with her unused code (redeem_invite)', 'ERROR:This account is suspended',
   tests.w_val(:'sam', 'select public.redeem_invite(''W39C-ODE1'')::text')),
  ('nor with the link the app uses (redeem_invite_link, as before)', 'ERROR:This account is suspended',
   tests.w_val(:'sam', format('select public.redeem_invite_link(%L)', (select slug from w_link))));
insert into tests.results (name, expected, actual) values
  ('so Sam is still suspended, uninvited, and Ivy''s code unused', 'suspended,-,unused',
   tests.w_now(format('select status || '','' || coalesce(invited_by::text, ''-'') from public.profiles where id = %L', :'sam'))
   || ',' || tests.w_now('select case when used_by is null and used_at is null then ''unused'' else ''used'' end from public.invites where code = ''W39C-ODE1'''));
insert into tests.results (name, expected, actual) values
  ('a member already in takes up no invitation: Ben on Ivy''s link, and with her code', 'false,false',
   tests.w_val(:'ben', format('select public.join_with_invite(%L)::text', (select slug from w_link))) || ',' ||
   tests.w_val(:'ben', 'select public.redeem_invite(''W39C-ODE1'')::text'));
insert into tests.results (name, expected, actual) values
  ('and spends nothing and tells Ivy nothing', '-,0,unused',
   tests.w_now(format('select coalesce(invited_by::text, ''-'') from public.profiles where id = %L', :'ben'))
   || ',' || tests.w_now(format('select count(*)::text from public.activity where recipient_id = %L and actor_id = %L', :'ivy', :'ben'))
   || ',' || tests.w_now('select case when used_by is null and used_at is null then ''unused'' else ''used'' end from public.invites where code = ''W39C-ODE1'''));

-- Abe joins on the link: Ivy's one place is taken.
insert into tests.results (name, expected, actual) values
  ('Abe, at the door, joins on Ivy''s link', 'true',
   tests.w_val(:'abe', format('select public.join_with_invite(%L)::text', (select slug from w_link))));
insert into tests.results (name, expected, actual) values
  ('so Ivy may make no code (one allowance, link and codes alike)', 'ERROR:You have used all of your invitations',
   tests.w_val(:'ivy', 'select public.create_invite()')),
  ('and her old code lets nobody else in', 'false',
   tests.w_val(:'una', 'select public.redeem_invite(''W39C-ODE1'')::text'));
insert into tests.results (name, expected, actual) values
  ('Una is still at the door, and the code unused', 'applied,unused',
   tests.w_now(format('select status from public.profiles where id = %L', :'una'))
   || ',' || tests.w_now('select case when used_by is null and used_at is null then ''unused'' else ''used'' end from public.invites where code = ''W39C-ODE1'''));

-- With room again (an allowance of 3), the code admits Una once, and Ivy may make one more.
update public.profiles set invite_quota = 3 where id = :'ivy';
insert into tests.results (name, expected, actual) values
  ('with room again, Una joins with the code', 'true',
   tests.w_val(:'una', 'select public.redeem_invite(''W39C-ODE1'')::text'));
insert into tests.results (name, expected, actual) values
  ('a member, invited by Ivy, the code spent', 'approved,yes,used',
   tests.w_now(format('select status || '','' || case when invited_by = %L then ''yes'' else ''no'' end from public.profiles where id = %L', :'ivy', :'una'))
   || ',' || tests.w_now('select case when used_by is null and used_at is null then ''unused'' else ''used'' end from public.invites where code = ''W39C-ODE1'''));
-- A code spent stays spent, even when the account that spent it has gone.
update public.invites set used_by = null where code = 'W39C-ODE1';
insert into public.invites (code, created_by) values ('W39C-ODE2', :'ivy');
insert into tests.results (name, expected, actual) values
  ('a code once used admits nobody again', 'false',
   tests.w_val(:'kim', 'select public.redeem_invite(''W39C-ODE1'')::text')),
  -- Ivy: 3 places; Abe and Una in, and W39C-ODE2 not used yet: all three counted.
  ('Ivy, with two in and a code out, may make no other', 'ERROR:You have used all of your invitations',
   tests.w_val(:'ivy', 'select public.create_invite()'));
delete from public.invites where code = 'W39C-ODE2';
insert into tests.results (name, expected, actual) values
  ('with that code gone, she may make one', 'true',
   tests.w_val(:'ivy', 'select (public.create_invite() ~ ''^[A-Z0-9]{4}-[A-Z0-9]{4}$'')::text'));
insert into tests.results (name, expected, actual) values
  ('and then no more', 'ERROR:You have used all of your invitations',
   tests.w_val(:'ivy', 'select public.create_invite()'));

-- ---------------------------------------------------------------------------
-- the catalogue: exactly these columns, for members; nothing for visitors
-- ---------------------------------------------------------------------------
create temp table w_written as
select c.relname::text as tbl, x.privilege_type as priv, a.attname::text as col
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
cross join lateral (values ('INSERT'), ('UPDATE')) x(privilege_type)
where n.nspname = 'public' and c.relkind = 'r'
  and has_column_privilege('authenticated', c.oid, a.attnum, x.privilege_type);
insert into tests.results (name, expected, actual) values
  ('what members may file and change, table by table, is what the app writes',
   'activity UPDATE read_at; applications INSERT avatar_url,city,desired_username,full_name,inviter,reason,social_handle,user_id; '
   || 'comments INSERT author_id,body,post_id; conversations INSERT user_a,user_b; '
   || 'era_edits INSERT author_id,moves,time_zone,titles,updated_at; era_edits UPDATE author_id,moves,time_zone,titles,updated_at; '
   || 'follows INSERT followee_id,follower_id,status; follows UPDATE status; likes INSERT post_id,user_id; '
   || 'messages INSERT body,conversation_id,post_id,sender_id; messages UPDATE read_at; '
   || 'notification_prefs INSERT comments,follows,likes,memories,messages,posts,tags,updated_at,user_id; '
   || 'notification_prefs UPDATE comments,follows,likes,memories,messages,posts,tags,updated_at,user_id; '
   || 'post_tags INSERT post_id,tagged_by,user_id; post_tags UPDATE decided_at,status; '
   || 'posts INSERT author_id,caption,duration_seconds,filter_baked,filter_id,height,id,lat,lng,location,media_path,media_type,place_id,show_date_stamp,taken_at,thumb_path,width; '
   || 'posts UPDATE caption; profiles UPDATE avatar_url,bio,city,full_name,is_private; '
   || 'push_tokens INSERT created_at,device,invalid_at,platform,token,updated_at,user_id; '
   || 'push_tokens UPDATE created_at,device,invalid_at,platform,token,updated_at,user_id; '
   || 'reports INSERT comment_id,details,post_id,profile_id,reason,reporter_id,target_type; '
   || 'share_events INSERT actor_id,format,kind,post_id,theme,token',
   coalesce((select string_agg(tbl || ' ' || priv || ' ' || cols, '; ' order by tbl collate "C", priv)
      from (select tbl, priv, string_agg(col, ',' order by col collate "C") as cols from w_written group by tbl, priv) g), '<none>')),
  ('signed-out visitors may file or change nothing, in any table', '0',
   (select count(*)::text
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      cross join lateral (values ('INSERT'), ('UPDATE')) x(p)
     where n.nspname = 'public' and c.relkind = 'r'
       and has_column_privilege('anon', c.oid, a.attnum, x.p))),
  ('the five policies, restrictive', 'applications|INSERT,messages|UPDATE,posts|INSERT,posts|UPDATE,profiles|UPDATE',
   coalesce((select string_agg(tablename || '|' || cmd, ',' order by tablename, cmd) from pg_policies
     where schemaname = 'public' and permissive = 'RESTRICTIVE' and policyname in (
       'posts: files from the author''s own folder', 'posts: a caption while live, by a member',
       'applications: a portrait from the applicant''s own folder',
       'profiles: own-folder portrait, nothing while suspended',
       'messages: read marks by the member they were sent to')), '<none>'));

-- As it stands now, to compare with after the rollback and 0039 again.
create temp table w_acl as
select c.oid::regclass::text as tbl, c.relacl::text as acl,
       (select string_agg(a.attname || '=' || a.attacl::text, ' ' order by a.attnum)
          from pg_attribute a where a.attrelid = c.oid and a.attacl is not null) as cols
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';
create temp table w_pol as
select tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname = 'public';
create temp table w_fn as
select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def, p.proacl::text as acl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('join_with_invite', 'redeem_invite', 'create_invite');

-- ---------------------------------------------------------------------------
-- two create_invite calls at once, from two sessions
-- ---------------------------------------------------------------------------
-- What a session can see is only what is committed, so the member these
-- two sessions are is made, and taken away again, by a third that commits
-- (no membership number is drawn: none is given by a plain change of status).
create extension if not exists dblink;
select format('host=%s dbname=%s user=%s', split_part(current_setting('unix_socket_directories'), ',', 1),
              current_database(), current_user) as w_cs \gset
\set kit '0a390000-0000-4000-8000-0000000000c1'
select dblink_connect('w0', :'w_cs');
-- (Anything left from a run that stopped half way is taken away first.)
select dblink_exec('w0', format('delete from public.invites where created_by = %L', :'kit'));
select dblink_exec('w0', format('delete from auth.users where id = %L', :'kit'));
select dblink_exec('w0', format($s$insert into auth.users (id, email, raw_user_meta_data) values (%L, 'kit@writes.test', '{"username":"w39.kit"}')$s$, :'kit'));
select dblink_exec('w0', format($s$update public.profiles set status = 'approved', approved_at = now(), invite_quota = 1 where id = %L$s$, :'kit'));
select dblink_connect('w1', :'w_cs');
select dblink_connect('w2', :'w_cs');
select dblink_exec(c, 'set role authenticated'),
       dblink_exec(c, format('set request.jwt.claims = %L',
                             json_build_object('sub', :'kit', 'role', 'authenticated')::text))
from (values ('w1'), ('w2')) v(c);
select dblink_exec('w2', $s$set lock_timeout = '1s'$s$);
-- The first holds her row (its code made, not yet committed); the second
-- must wait for it, and here gives up waiting after a second.
select dblink_exec('w1', 'begin');
select x as w_first from dblink('w1', 'select public.create_invite()') as t(x text) \gset
select count(*) from dblink('w2', 'select public.create_invite()', false) as t(x text);
select dblink_error_message('w2') as w_waited \gset
select dblink_exec('w1', 'commit');
-- Once the first is committed, the second counts its code.
select count(*) from dblink('w2', 'select public.create_invite()', false) as t(x text);
select dblink_error_message('w2') as w_counted \gset
insert into tests.results (name, expected, actual) values
  ('two calls at once, an allowance of one: the first makes a code', 'true', (:'w_first' ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$')::text),
  ('the second waits for the first (it held her row)', 'true', (:'w_waited' ~ 'lock timeout')::text),
  ('and, once it may go on, counts the first''s code and makes none', 'true', (:'w_counted' ~ 'You have used all of your invitations')::text),
  ('one code made against an allowance of one', '1',
   (select x from dblink('w0', format('select count(*)::text from public.invites where created_by = %L', :'kit')) as t(x text)));
select dblink_exec('w0', format('delete from public.invites where created_by = %L', :'kit'));
select dblink_exec('w0', format('delete from auth.users where id = %L', :'kit'));
select dblink_disconnect(c) from (values ('w0'), ('w1'), ('w2')) v(c);

-- ---------------------------------------------------------------------------
-- the way back (0039_rollback.sql), applied for real, and 0039 again
-- ---------------------------------------------------------------------------
\o /dev/null
\ir 0039_rollback.sql
\o
insert into tests.results (name, expected, actual) values
  ('after the rollback: none of 0039''s policies is left', '0',
   (select count(*)::text from pg_policies where schemaname = 'public' and policyname in (
       'posts: files from the author''s own folder', 'posts: a caption while live, by a member',
       'applications: a portrait from the applicant''s own folder',
       'profiles: own-folder portrait, nothing while suspended',
       'messages: read marks by the member they were sent to'))),
  ('members and visitors may again file and change every column of the tables 0039 narrowed', '0',
   (select count(*)::text
      from (values ('posts'), ('profiles'), ('applications'), ('conversations'), ('post_tags'), ('comments'),
                   ('likes'), ('reports'), ('share_events'), ('activity'), ('app_settings'), ('blocks'),
                   ('invite_links'), ('invites'), ('moderation_actions'), ('post_shares')) t(name)
      cross join (values ('anon'), ('authenticated')) r(role)
      cross join (values ('insert'), ('update')) p(priv)
     where not has_table_privilege(r.role, 'public.' || t.name, p.priv))),
  ('with no column grant of 0039''s left on them, as 0038 left them', '-',
   coalesce((select string_agg(c.relname, ',') from pg_class c
              where c.relnamespace = 'public'::regnamespace and c.relname in (
                'posts', 'profiles', 'applications', 'conversations', 'post_tags', 'comments', 'likes', 'reports',
                'share_events', 'activity', 'app_settings', 'blocks', 'invite_links', 'invites', 'moderation_actions', 'post_shares')
                and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attacl is not null)), '-')),
  ('follows and messages: every member and visitor may file again; their updates are 0038''s and 0021''s, untouched',
   'true,true,true,true,status=authenticated,read_at=authenticated',
   has_table_privilege('anon', 'public.follows', 'insert') || ',' || has_table_privilege('authenticated', 'public.follows', 'insert') || ',' ||
   has_table_privilege('anon', 'public.messages', 'insert') || ',' || has_table_privilege('authenticated', 'public.messages', 'insert') || ',' ||
   (select string_agg(a.attname || '=' || x.grantee::regrole::text, ' ') from pg_attribute a, aclexplode(a.attacl) x
     where a.attrelid = 'public.follows'::regclass and x.privilege_type = 'UPDATE') || ',' ||
   (select string_agg(a.attname || '=' || x.grantee::regrole::text, ' ') from pg_attribute a, aclexplode(a.attacl) x
     where a.attrelid = 'public.messages'::regclass and x.privilege_type = 'UPDATE')),
  ('visitors may again write notification settings and phones', 'true,true,true,true',
   has_table_privilege('anon', 'public.notification_prefs', 'insert') || ',' || has_table_privilege('anon', 'public.notification_prefs', 'update') || ',' ||
   has_table_privilege('anon', 'public.push_tokens', 'insert') || ',' || has_table_privilege('anon', 'public.push_tokens', 'update')),
  ('the three invitation functions are as they were before 0023 (0010, 0011, 0012), with their grants', '3',
   (select count(*)::text from before_0023.functions b
     join pg_proc p on p.oid::regprocedure::text = b.signature
      and p.pronamespace = 'public'::regnamespace and p.proname in ('join_with_invite', 'redeem_invite', 'create_invite')
    where b.signature in ('join_with_invite(text)', 'redeem_invite(text)', 'create_invite()')
      and pg_get_functiondef(p.oid) = b.definition
      and p.proacl::text = (select acl from w_fn where sig = b.signature)));

\o /dev/null
\ir ../migrations/0039_writes_only_what_the_app_writes.sql
\o
insert into tests.results (name, expected, actual) values
  ('0039 applied again over its rollback: every table''s and column''s privileges as the first time', '0',
   (select count(*)::text from (
      (select * from w_acl
       except
       select c.oid::regclass::text, c.relacl::text,
              (select string_agg(a.attname || '=' || a.attacl::text, ' ' order by a.attnum)
                 from pg_attribute a where a.attrelid = c.oid and a.attacl is not null)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r')
      union all
      (select c.oid::regclass::text, c.relacl::text,
              (select string_agg(a.attname || '=' || a.attacl::text, ' ' order by a.attnum)
                 from pg_attribute a where a.attrelid = c.oid and a.attacl is not null)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
       except
       select * from w_acl)) d)),
  ('and every policy', '0',
   (select count(*)::text from (
      (select * from w_pol except
       select tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname = 'public')
      union all
      (select tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname = 'public'
       except select * from w_pol)) d)),
  ('and the three functions, with their grants', '3',
   (select count(*)::text from w_fn f join pg_proc p on p.oid::regprocedure::text = f.sig
      and p.pronamespace = 'public'::regnamespace and p.proname in ('join_with_invite', 'redeem_invite', 'create_invite')
     where pg_get_functiondef(p.oid) = f.def and p.proacl::text = f.acl));

-- And once more on top of itself: nothing changes.
\o /dev/null
\ir ../migrations/0039_writes_only_what_the_app_writes.sql
\o
insert into tests.results (name, expected, actual) values
  ('0039 applied a third time changes nothing', '0,0',
   (select count(*)::text from (
      select c.oid::regclass::text, c.relacl::text,
             (select string_agg(a.attname || '=' || a.attacl::text, ' ' order by a.attnum)
                from pg_attribute a where a.attrelid = c.oid and a.attacl is not null)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      except select * from w_acl) d)
   || ',' ||
   (select count(*)::text from (
      select tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname = 'public'
      except select * from w_pol) d));

-- The numbers the approvals drew, given back (a rollback does not).
select setval('public.member_no_seq', last_value, is_called) from w_seq;

\pset border 2
select r.seq, r.name, r.expected, r.actual,
       case when r.expected = r.actual then 'pass' else 'FAIL' end as status
from tests.results r, w_start s
where r.seq > s.seq
order by r.seq;

do $verdict$
declare v_failed int;
begin
  select count(*) into v_failed from tests.results r, w_start s
   where r.seq > s.seq and r.expected is distinct from r.actual;
  if v_failed > 0 then
    raise exception '% write checks FAILED', v_failed;
  end if;
  raise notice 'write checks passed';
end
$verdict$;

rollback;
