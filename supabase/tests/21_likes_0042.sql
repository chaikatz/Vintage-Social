-- 0042 (supabase/migrations/0042_likes_read_by_the_liker_and_the_author.sql):
-- a like is read by the member who made it and the photograph's author,
-- nobody else.
--
-- Asked as the members it is about, through the same policies, grants and
-- triggers the app and PostgREST go through. Ana posts two photographs
-- (one the admins have since removed); Pia is private and posts one; Ben
-- follows Pia and likes everything; Cara likes Ana's and, from before she
-- could not see it, Pia's; Eve liked Ana's and Ana then blocked her; Dan
-- likes nothing yet; an admin, an applicant and a signed-out visitor
-- complete the club. First the file's policy is taken away, to show the
-- gap it closes; then the file itself is applied, and each caller reads
-- every like of the club; then the app's own reads and writes are made:
-- the likers list, "did I like these", a like, a like asked back, an
-- unlike, and the count each time. Then the file is applied again over
-- itself, and its rollback is tried. Runs in one transaction and rolls
-- back.

begin;

create temp table l42_start as select coalesce(max(seq), 0) as seq from tests.results;

-- A statement as a member (or, with null, a signed-out visitor): OK and
-- how many rows it touched, DENIED, or the error's own words.
create or replace function tests.l42_as(p_uid uuid, p_sql text)
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

-- What a caller reads (null: a signed-out visitor): the values a query
-- returns, in its order, joined by commas; '-' for none, DENIED if refused.
create or replace function tests.l42_read(p_uid uuid, p_sql text)
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
  begin
    execute 'select coalesce(string_agg(x::text, '',''), ''-'') from (' || p_sql || ') q(x)' into v;
  exception when insufficient_privilege then
    v := 'DENIED';
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end
$fn$;

-- As the project's owner, past row-level security.
create or replace function tests.l42_now(p_sql text)
returns text
language plpgsql
as $fn$
declare
  v text;
begin
  execute 'select coalesce(string_agg(x::text, '',''), ''-'') from (' || p_sql || ') q(x)' into v;
  return v;
end
$fn$;

\set ana   '0a420000-0000-4000-8000-0000000000a1'
\set pia   '0a420000-0000-4000-8000-0000000000a2'
\set ben   '0a420000-0000-4000-8000-0000000000a3'
\set cara  '0a420000-0000-4000-8000-0000000000a4'
\set dan   '0a420000-0000-4000-8000-0000000000a5'
\set eve   '0a420000-0000-4000-8000-0000000000a6'
\set appl  '0a420000-0000-4000-8000-0000000000a7'
\set admin '11111111-1111-1111-1111-111111111111'
\set p_ana     '0a421000-0000-4000-8000-000000000001'
\set p_removed '0a421000-0000-4000-8000-000000000002'
\set p_pia     '0a421000-0000-4000-8000-000000000003'
\set p_ben     '0a421000-0000-4000-8000-000000000004'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'ana',  'ana@likes42.test',  '{"username":"l42.ana"}'),
  (:'pia',  'pia@likes42.test',  '{"username":"l42.pia"}'),
  (:'ben',  'ben@likes42.test',  '{"username":"l42.ben"}'),
  (:'cara', 'cara@likes42.test', '{"username":"l42.cara"}'),
  (:'dan',  'dan@likes42.test',  '{"username":"l42.dan"}'),
  (:'eve',  'eve@likes42.test',  '{"username":"l42.eve"}'),
  (:'appl', 'appl@likes42.test', '{"username":"l42.applicant"}');
update public.profiles set status = 'approved', approved_at = now()
 where id::text like '0a420000-0000-4000-8000-0000000000a_' and id <> :'appl';
update public.profiles set is_private = true where id = :'pia';

insert into public.follows (follower_id, followee_id, status) values
  (:'ben', :'pia', 'accepted');

insert into public.posts (id, author_id, media_type, media_path, filter_id, caption) values
  (:'p_ana',     :'ana', 'photo', :'ana' || '/1.jpg', 'kodachrome', 'ana'),
  (:'p_removed', :'ana', 'photo', :'ana' || '/2.jpg', 'kodachrome', 'ana, removed'),
  (:'p_pia',     :'pia', 'photo', :'pia' || '/1.jpg', 'kodachrome', 'pia, private'),
  (:'p_ben',     :'ben', 'photo', :'ben' || '/1.jpg', 'kodachrome', 'ben');

-- The likes, as the club made them (Cara's on Pia's private photograph
-- from when the API never asked whether she could see it), then a removal
-- and a block after them.
insert into public.likes (post_id, user_id) values
  (:'p_ana', :'ben'), (:'p_ana', :'cara'), (:'p_ana', :'eve'),
  (:'p_removed', :'ben'),
  (:'p_pia', :'ben'), (:'p_pia', :'cara'),
  (:'p_ben', :'ana');
update public.posts set removed_at = now(), removed_by = :'admin' where id = :'p_removed';
insert into public.blocks (blocker_id, blocked_id) values (:'ana', :'eve');

create temp table l42_viewers (label text primary key, uid uuid, o int);
insert into l42_viewers values
  ('ana', :'ana', 1), ('pia', :'pia', 2), ('ben', :'ben', 3), ('cara', :'cara', 4),
  ('dan', :'dan', 5), ('eve', :'eve', 6), ('admin', :'admin', 7), ('applicant', :'appl', 8),
  ('signed out', null, 9);
grant all on l42_viewers to anon, authenticated;

-- Every like of this club a caller reads, as photograph@liker by name.
create or replace function tests.l42_every_like(p_uid uuid)
returns text
language sql
as $fn$
  select tests.l42_read(p_uid,
    'select p.caption || ''@'' || replace(u.username, ''l42.'', '''')
       from public.likes l
       join (values (''0a421000-0000-4000-8000-000000000001''::uuid, ''ana''),
                    (''0a421000-0000-4000-8000-000000000002''::uuid, ''removed''),
                    (''0a421000-0000-4000-8000-000000000003''::uuid, ''pia''),
                    (''0a421000-0000-4000-8000-000000000004''::uuid, ''ben'')) p(id, caption) on p.id = l.post_id
       join (values (''0a420000-0000-4000-8000-0000000000a1''::uuid, ''ana''), (''0a420000-0000-4000-8000-0000000000a2''::uuid, ''pia''),
                    (''0a420000-0000-4000-8000-0000000000a3''::uuid, ''ben''), (''0a420000-0000-4000-8000-0000000000a4''::uuid, ''cara''),
                    (''0a420000-0000-4000-8000-0000000000a5''::uuid, ''dan''), (''0a420000-0000-4000-8000-0000000000a6''::uuid, ''eve'')) u(id, username) on u.id = l.user_id
      order by 1')
$fn$;
grant execute on function tests.l42_every_like(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- the gap: without the file, and with it
-- ---------------------------------------------------------------------------
create temp table l42_reads (run text, viewer text, likes text, primary key (run, viewer));
grant all on l42_reads to anon, authenticated;

drop policy "likes: the liker's and the author's" on public.likes;
insert into l42_reads select 'before', label, tests.l42_every_like(uid) from l42_viewers;

\o /dev/null
\ir ../migrations/0042_likes_read_by_the_liker_and_the_author.sql
\o
insert into l42_reads select 'after', label, tests.l42_every_like(uid) from l42_viewers;

-- Before, every member read every like on a photograph they could see
-- (bar a block's); after, only their own and those on their own
-- photographs. Each is before less what is neither.
create temp table l42_expected (viewer text primary key, before text, after text);
insert into l42_expected values
  ('ana',        'ana@ben,ana@cara,ben@ana,removed@ben',                  'ana@ben,ana@cara,ben@ana,removed@ben'),
  ('pia',        'ana@ben,ana@cara,ana@eve,ben@ana,pia@ben,pia@cara',     'pia@ben,pia@cara'),
  ('ben',        'ana@ben,ana@cara,ana@eve,ben@ana,pia@ben,pia@cara,removed@ben', 'ana@ben,ben@ana,pia@ben,removed@ben'),
  ('cara',       'ana@ben,ana@cara,ana@eve,ben@ana,pia@cara',             'ana@cara,pia@cara'),
  ('dan',        'ana@ben,ana@cara,ana@eve,ben@ana',                      '-'),
  ('eve',        'ana@eve',                                               'ana@eve'),
  ('admin',      'ana@ben,ana@cara,ana@eve,ben@ana,pia@ben,pia@cara,removed@ben', '-'),
  ('applicant',  '-',                                                     '-'),
  -- Signed out, a read of likes is refused outright, with it and without it: the
  -- block rule asks a function only members may run (private.my_block_partners, 0023).
  ('signed out', 'DENIED',                                                'DENIED');

insert into tests.results (name, expected, actual)
select '0042: without it, ' || e.viewer || ' read these likes', e.before, b.likes
from l42_expected e join l42_reads b on b.viewer = e.viewer and b.run = 'before' join l42_viewers v on v.label = e.viewer
order by v.o;
insert into tests.results (name, expected, actual)
select '0042: with it, ' || e.viewer || ' reads only their own and those on their own photographs', e.after, a.likes
from l42_expected e join l42_reads a on a.viewer = e.viewer and a.run = 'after' join l42_viewers v on v.label = e.viewer
order by v.o;

-- With it is never more than without it, for anyone: it only narrows.
insert into tests.results (name, expected, actual) values
  ('0042: nobody reads a like they could not read before', '<none>',
   coalesce((select string_agg(a.viewer || ':' || k, ', ')
             from l42_reads a, unnest(string_to_array(a.likes, ',')) k
             where a.run = 'after' and k <> '-'
               and not k = any (string_to_array((select b.likes from l42_reads b where b.run = 'before' and b.viewer = a.viewer), ','))),
            '<none>'));

-- ---------------------------------------------------------------------------
-- the app's reads, as the app asks them
-- ---------------------------------------------------------------------------
-- The likers list (src/api/posts.ts fetchLikersPage): a photograph's likes,
-- newest first, ties by member, a page of fifty, each with its member's
-- profile as PostgREST embeds it (a left join, read as the caller).
create or replace function tests.l42_likers(p_uid uuid, p_post uuid)
returns text
language sql
as $fn$
  select tests.l42_read(p_uid, format(
    'select coalesce(u.username, ''(hidden)'') from public.likes l
       left join public.profiles u on u.id = l.user_id
      where l.post_id = %L
      order by l.created_at desc, l.user_id desc limit 50', p_post))
$fn$;
grant execute on function tests.l42_likers(uuid, uuid) to anon, authenticated;

insert into tests.results (name, expected, actual) values
  ('the author reads who liked her photograph, newest first, and not the member she blocked', 'l42.cara,l42.ben',
   tests.l42_likers(:'ana', :'p_ana')),
  ('a private member reads who liked hers, a like from before it was hidden from its liker included', 'l42.cara,l42.ben',
   tests.l42_likers(:'pia', :'p_pia')),
  ('the author reads who liked a photograph of hers the admins removed', 'l42.ben',
   tests.l42_likers(:'ana', :'p_removed')),
  ('a liker reads their own like on it, and no one else''s', 'l42.ben',
   tests.l42_likers(:'ben', :'p_ana')),
  ('another member reads none of its likes', '-',
   tests.l42_likers(:'dan', :'p_ana')),
  ('nor does an admin', '-',
   tests.l42_likers(:'admin', :'p_ana')),
  ('nor an applicant, and a signed-out visitor is refused', '-,DENIED',
   tests.l42_likers(:'appl', :'p_ana') || ',' || tests.l42_likers(null, :'p_ana')),
  ('the member blocked reads their own like, and no one else''s', 'l42.eve',
   tests.l42_likers(:'eve', :'p_ana')),
  -- usePostActions' "did I like these" (fetchMyLikes): the member's own likes, by user_id.
  ('"did I like these" answers the member''s own likes, as before', '2',
   tests.l42_read(:'ben', format(
     'select count(*) from public.likes where user_id = %L and post_id in (%L, %L, %L)',
     :'ben', :'p_ana', :'p_pia', :'p_ben'))),
  ('and for a member who liked none of them, none', '0',
   tests.l42_read(:'dan', format(
     'select count(*) from public.likes where user_id = %L and post_id in (%L, %L, %L)',
     :'dan', :'p_ana', :'p_pia', :'p_ben'))),
  ('the count is a column of the photograph, read as before by anyone who sees it', '3,3',
   tests.l42_read(:'dan', format('select like_count from public.posts where id = %L', :'p_ana')) || ',' ||
   tests.l42_read(:'ana', format('select like_count from public.posts where id = %L', :'p_ana')));

-- ---------------------------------------------------------------------------
-- the app's writes: a like, a like asked back, an unlike, and the count
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  ('Dan likes Ana''s photograph (likePost: an insert asking nothing back)', 'OK:1',
   tests.l42_as(:'dan', format('insert into public.likes (post_id, user_id) values (%L, %L)', :'p_ana', :'dan'))),
  ('the count follows it, and Ana reads his like first', '4,l42.dan,l42.cara,l42.ben',
   tests.l42_now(format('select like_count from public.posts where id = %L', :'p_ana')) || ',' ||
   tests.l42_likers(:'ana', :'p_ana')),
  ('Ben does not read it', 'l42.ben',
   tests.l42_likers(:'ben', :'p_ana')),
  ('a like asked back as PostgREST asks it (returning the row) is the liker''s to read', 'OK:1',
   tests.l42_as(:'dan', format('insert into public.likes (post_id, user_id) values (%L, %L) returning post_id, user_id, created_at', :'p_ben', :'dan'))),
  ('Dan unlikes Ana''s photograph (unlikePost: a delete naming his like)', 'OK:1',
   tests.l42_as(:'dan', format('delete from public.likes where post_id = %L and user_id = %L', :'p_ana', :'dan'))),
  ('the count goes back, and his like leaves her list', '3,l42.cara,l42.ben',
   tests.l42_now(format('select like_count from public.posts where id = %L', :'p_ana')) || ',' ||
   tests.l42_likers(:'ana', :'p_ana')),
  ('nobody takes back a like that is not theirs, not even the photograph''s author', 'OK:0,OK:0',
   tests.l42_as(:'ana', format('delete from public.likes where post_id = %L and user_id = %L', :'p_ana', :'ben')) || ',' ||
   tests.l42_as(:'dan', format('delete from public.likes where post_id = %L and user_id = %L', :'p_ana', :'ben'))),
  ('the member blocked takes back their like on the photograph they can no longer see', 'OK:1',
   tests.l42_as(:'eve', format('delete from public.likes where post_id = %L and user_id = %L', :'p_ana', :'eve'))),
  ('and cannot like it again across the block (0040)', 'DENIED',
   tests.l42_as(:'eve', format('insert into public.likes (post_id, user_id) values (%L, %L)', :'p_ana', :'eve'))),
  ('Cara takes back her like on the private photograph she cannot see (0028)', 'OK:1',
   tests.l42_as(:'cara', format('delete from public.likes where post_id = %L and user_id = %L', :'p_pia', :'cara'))),
  ('Ben unlikes Ana''s photograph and likes it again', 'OK:1,OK:1',
   tests.l42_as(:'ben', format('delete from public.likes where post_id = %L and user_id = %L', :'p_ana', :'ben')) || ',' ||
   tests.l42_as(:'ben', format('insert into public.likes (post_id, user_id) values (%L, %L)', :'p_ana', :'ben'))),
  ('Ana likes her own photograph, and reads it with the rest', 'OK:1,l42.cara,l42.ben,l42.ana',
   tests.l42_as(:'ana', format('insert into public.likes (post_id, user_id) values (%L, %L)', :'p_ana', :'ana')) || ',' ||
   tests.l42_likers(:'ana', :'p_ana')),
  ('every count is still its photograph''s likes, all of them', 'true',
   (select bool_and(p.like_count = (select count(*) from public.likes l where l.post_id = p.id))::text
      from public.posts p where p.id::text like '0a421000-%')),
  ('the counts as they now stand: Ana''s 3, the removed 1, Pia''s 1, Ben''s 2', '3,1,1,2',
   tests.l42_now(format('select like_count from public.posts where id in (%L, %L, %L, %L) order by id',
     :'p_ana', :'p_removed', :'p_pia', :'p_ben'))),
  ('a like still files its notice for the author', 'like',
   tests.l42_now(format('select distinct type from public.activity where recipient_id = %L and actor_id = %L and post_id = %L',
     :'ben', :'dan', :'p_ben')));

-- ---------------------------------------------------------------------------
-- the policy, as a policy
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  ('one restrictive read policy, for every role, the caller read once a statement', 'RESTRICTIVE:SELECT:{public}:true',
   (select permissive || ':' || cmd || ':' || roles::text || ':' ||
           (qual ~ '^\(\(user_id = \( SELECT auth\.uid\(\) AS uid\)\) OR \(EXISTS')::text
      from pg_policies where schemaname = 'public' and tablename = 'likes'
       and policyname = 'likes: the liker''s and the author''s')),
  ('the other policies on likes are as they were', 'likes: like as self:PERMISSIVE:INSERT,likes: members read:PERMISSIVE:SELECT,likes: none across a block:RESTRICTIVE:INSERT,likes: not between blocked:RESTRICTIVE:SELECT,likes: only with their photograph:RESTRICTIVE:SELECT,likes: the liker''s and the author''s:RESTRICTIVE:SELECT,likes: unlike as self:PERMISSIVE:DELETE',
   (select string_agg(policyname || ':' || permissive || ':' || cmd, ',' order by policyname)
      from pg_policies where schemaname = 'public' and tablename = 'likes')),
  ('row-level security is on for likes, and nothing more is granted', 'true,false,false',
   (select relrowsecurity::text from pg_class where oid = 'public.likes'::regclass) || ',' ||
   has_table_privilege('anon', 'public.likes', 'insert')::text || ',' ||
   has_table_privilege('authenticated', 'public.likes', 'update')::text);

-- ---------------------------------------------------------------------------
-- again over itself, and its way back
-- ---------------------------------------------------------------------------
create temp table l42_policy as
  select qual from pg_policies where tablename = 'likes' and policyname = 'likes: the liker''s and the author''s';
delete from l42_reads where run = 'after';
insert into l42_reads select 'after', label, tests.l42_every_like(uid) from l42_viewers;
\o /dev/null
\ir ../migrations/0042_likes_read_by_the_liker_and_the_author.sql
\o
insert into l42_reads select 'again', label, tests.l42_every_like(uid) from l42_viewers;
insert into tests.results (name, expected, actual) values
  ('applied again over itself: the same policy, and every caller reads the same', '1,true,<none>',
   (select count(*)::text from pg_policies where tablename = 'likes' and policyname = 'likes: the liker''s and the author''s') || ',' ||
   ((select qual from pg_policies where tablename = 'likes' and policyname = 'likes: the liker''s and the author''s')
      = (select qual from l42_policy))::text || ',' ||
   coalesce((select string_agg(a.viewer, ',') from l42_reads a join l42_reads g on g.viewer = a.viewer and g.run = 'again'
              where a.run = 'after' and a.likes is distinct from g.likes), '<none>'));

-- The header's rollback, then the file once more.
drop policy if exists "likes: the liker's and the author's" on public.likes;
insert into tests.results (name, expected, actual) values
  ('its rollback opens the gap again (Dan reads the likes on Ana''s photograph)', 'l42.cara,l42.ben,l42.ana',
   tests.l42_likers(:'dan', :'p_ana'));
\o /dev/null
\ir ../migrations/0042_likes_read_by_the_liker_and_the_author.sql
\o
insert into tests.results (name, expected, actual) values
  ('and the file closes it again', '-',
   tests.l42_likers(:'dan', :'p_ana'));

\pset border 2
select r.seq, r.name, r.expected, r.actual,
       case when r.expected = r.actual then 'pass' else 'FAIL' end as status
from tests.results r, l42_start s
where r.seq > s.seq
order by r.seq;

do $verdict$
declare v_failed int;
begin
  select count(*) into v_failed from tests.results r, l42_start s
   where r.seq > s.seq and r.expected is distinct from r.actual;
  if v_failed > 0 then
    raise exception '% 0042 like checks FAILED', v_failed;
  end if;
  raise notice '0042 like checks passed';
end
$verdict$;

rollback;
