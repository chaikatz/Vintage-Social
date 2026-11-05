-- The plans the app's hottest reads get, at many times today's size.
--
-- scale_seed.sql makes a club of 1,000 members (about six times
-- production in November 2026): some 6,600 photographs, 15,000 follows,
-- 70,000 likes, 26,000 comments and the Activity rows they make. Then,
-- as one of those members, each read the app makes on a screen people
-- open all day is planned and run, and these must hold:
--
--   * the caller, their membership and their blocks are read once per
--     statement (InitPlans), never once per row;
--   * Explore and the feed walk an index in time order and stop at the
--     page, and the "does the caller follow this author" check reads only
--     the caller's own follows, not the club's;
--   * every read by member, post, conversation or recipient uses its
--     index, and so does every lookup a deletion makes;
--   * nothing here reads a whole table of photographs, follows, likes,
--     comments or Activity.
--
-- The milliseconds are printed for the record ("time:" lines) and not
-- asserted: this machine is not the database server, and a test that
-- depends on its speed is a test that fails on a busy day.
--
-- Runs in one transaction and rolls back.

begin;

set local search_path = public, extensions;

create temp table plans_start as select coalesce(max(seq), 0) as seq from tests.results;

\set members 1000
\o /dev/null
\ir scale_seed.sql
\o

select id as me from public.profiles where id::text like '5ca1e000-%' and not is_private
order by id offset 99 limit 1 \gset
select id as author from public.profiles p where id::text like '5ca1e000-%' and not is_private
  and exists (select 1 from public.follows f where f.followee_id = p.id and f.status = 'accepted')
order by id offset 7 limit 1 \gset
select id as post from public.posts where author_id = :'author' and removed_at is null limit 1 \gset
select id as thread from public.conversations where :'me' in (user_a, user_b) limit 1 \gset
select coalesce(:'thread', null) as thread \gset

-- The plan of a statement run as a member, as JSON, with what it did.
create or replace function tests.plan_as(p_uid uuid, p_sql text)
returns json
language plpgsql
as $fn$
declare
  v_plan json;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'explain (analyze, timing off, format json) ' || p_sql into v_plan;
  execute 'reset role';
  return v_plan;
end
$fn$;

-- Every node of a plan, flattened: type, relation, index, rows.
create or replace function tests.plan_nodes(p_plan json)
returns table (node text, relation text, index_name text, actual_rows numeric, loops numeric, subplan text)
language sql
as $fn$
  with recursive n(j) as (
    select p_plan -> 0 -> 'Plan'
    union all
    select c from n, json_array_elements(coalesce(n.j -> 'Plans', '[]'::json)) c
  )
  select j ->> 'Node Type', j ->> 'Relation Name', j ->> 'Index Name',
         (j ->> 'Actual Rows')::numeric, (j ->> 'Actual Loops')::numeric, j ->> 'Subplan Name'
  from n
$fn$;

create temp table plans (label text primary key, plan json);

insert into plans values
  ('explore', tests.plan_as(:'me', format(
     'select p.* from public.posts p where p.removed_at is null and p.author_id <> %L
      order by p.created_at desc limit 60', :'me'))),
  ('explore, fifth page', tests.plan_as(:'me', format(
     'select p.* from public.posts p where p.removed_at is null and p.author_id <> %L
      order by p.created_at desc limit 60 offset 240', :'me'))),
  ('feed', tests.plan_as(:'me', format(
     'select p.*, (select row_to_json(a) from (select id, username, full_name, avatar_url
                     from public.profiles where id = p.author_id) a) as author
      from public.posts p
      where p.author_id = any (array(select %L::uuid union all
              select followee_id from public.follows where follower_id = %L and status = ''accepted''))
        and p.removed_at is null
      order by p.created_at desc limit 12', :'me', :'me'))),
  ('a member''s photographs', tests.plan_as(:'me', format(
     'select * from public.posts where author_id = %L and removed_at is null order by created_at desc', :'author'))),
  ('Activity', tests.plan_as(:'me', format(
     'select a.*, (select row_to_json(x) from (select id, username, avatar_url from public.profiles where id = a.actor_id) x),
             (select row_to_json(y) from (select id, media_path, thumb_path, media_type from public.posts where id = a.post_id) y)
      from public.activity a where a.recipient_id = %L order by a.created_at desc limit 60', :'author'))),
  ('comments on a photograph', tests.plan_as(:'me', format(
     'select * from public.comments where post_id = %L and removed_at is null order by created_at', :'post'))),
  ('did I like these', tests.plan_as(:'me', format(
     'select post_id from public.likes where user_id = %L
        and post_id = any (array(select id from public.posts where author_id = %L limit 12))', :'me', :'author'))),
  ('who liked it', tests.plan_as(:'me', format(
     'select l.created_at, p.id, p.username from public.likes l join public.profiles p on p.id = l.user_id
      where l.post_id = %L order by l.created_at desc limit 500', :'post'))),
  ('who I follow', tests.plan_as(:'me', format(
     'select followee_id from public.follows where follower_id = %L and status = ''accepted''', :'me'))),
  ('their followers', tests.plan_as(:'me', format(
     'select f.created_at, p.* from public.follows f join public.profiles p on p.id = f.follower_id
      where f.followee_id = %L and f.status = ''accepted'' order by f.created_at desc limit 1000', :'author'))),
  ('a thread', tests.plan_as(:'me', format(
     'select * from public.messages where conversation_id = %L order by created_at desc limit 200', :'thread'))),
  ('a profile by name', tests.plan_as(:'me',
     'select * from public.profiles where username = ''scale_77''')),
  ('searching names', tests.plan_as(:'me',
     'select * from public.profiles where status = ''approved''
        and (username ilike ''%cale_12%'' or full_name ilike ''%cale_12%'') order by username limit 30'));

-- What deleting a photograph and a member look up, as the database runs
-- them (no policies on these: the foreign keys' own queries).
create temp table lookups (label text primary key, plan json);
create or replace function tests.plan_owner(p_sql text) returns json language plpgsql as $fn$
declare v json;
begin
  execute 'explain (format json) ' || p_sql into v;
  return v;
end
$fn$;
insert into lookups values
  ('activity of a deleted photograph', tests.plan_owner(format('select 1 from public.activity where post_id = %L', :'post'))),
  ('messages carrying it', tests.plan_owner(format('select 1 from public.messages where post_id = %L', :'post'))),
  ('activity by a deleted member', tests.plan_owner(format('select 1 from public.activity where actor_id = %L', :'author'))),
  ('likes by a deleted member', tests.plan_owner(format('select 1 from public.likes where user_id = %L', :'author'))),
  ('comments by a deleted member', tests.plan_owner(format('select 1 from public.comments where author_id = %L', :'author'))),
  ('messages by a deleted member', tests.plan_owner(format('select 1 from public.messages where sender_id = %L', :'author'))),
  ('members they invited', tests.plan_owner(format('select count(*) from public.profiles where invited_by = %L', :'author'))),
  ('photographs taken on a day', tests.plan_owner(
     'select id, author_id from public.posts where removed_at is null and taken_at is not null
        and taken_at >= ''2021-11-05'' and taken_at < ''2021-11-06''')),
  ('unread Activity', tests.plan_owner(format(
     'select 1 from public.activity where recipient_id = %L and read_at is null', :'author')));

-- ---------------------------------------------------------------------------
-- what must hold
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual)
select 'scale: ' || label || ' reads the caller once (InitPlan, no per-row auth.uid)', 'true',
       (plan::text ~ 'InitPlan' and plan::text !~ 'COALESCE\(NULLIF\(current_setting')::text
from plans where label not in ('a profile by name');

insert into tests.results (name, expected, actual)
select 'scale: ' || p.label || ' reads no whole table of ' || t, 'false',
       exists (select 1 from tests.plan_nodes(p.plan) n where n.node = 'Seq Scan' and n.relation = t)::text
from plans p
cross join (values ('posts'), ('follows'), ('likes'), ('comments'), ('activity'), ('messages')) v(t)
where p.label <> 'searching names';

insert into tests.results (name, expected, actual) values
  ('scale: Explore walks photographs newest first and stops at the page', 'posts_feed_idx',
   (select coalesce(string_agg(distinct index_name, ','), '<none>') from tests.plan_nodes((select plan from plans where label = 'explore'))
     where relation = 'posts')),
  ('scale: Explore checks the caller''s own follows, not the club''s (rows read from follows)', 'true',
   ((select coalesce(max(actual_rows * loops), 0) from tests.plan_nodes((select plan from plans where label = 'explore'))
      where relation = 'follows') <= 100)::text),
  ('scale: Explore looks at about a page of photographs, not all of them', 'true',
   ((select coalesce(max(actual_rows), 0) from tests.plan_nodes((select plan from plans where label = 'explore'))
      where relation = 'posts') <= 120)::text);

-- Each read finds its rows through the index made for it. (A bitmap index
-- scan names the index but not the table, so this asks for the index.)
insert into tests.results (name, expected, actual)
select 'scale: ' || v.label || ' uses ' || v.want, 'true',
       exists (select 1 from tests.plan_nodes((select plan from plans where label = v.label)) n
                where n.index_name = any (string_to_array(v.want, ' or ')))::text
from (values
  ('feed', 'posts_author_idx or posts_feed_idx'),
  ('a member''s photographs', 'posts_author_idx'),
  ('Activity', 'activity_recipient_idx'),
  ('comments on a photograph', 'comments_post_idx'),
  ('who liked it', 'likes_post_recent_idx'),
  ('their followers', 'follows_followers_idx'),
  ('a thread', 'messages_conversation_idx'),
  ('who I follow', 'follows_pkey'),
  ('did I like these', 'likes_pkey or likes_user_idx')
) v(label, want);

insert into tests.results (name, expected, actual)
select 'scale: ' || l.label || ' uses ' || l.want, 'true',
       (l.plan::text ~ ('"Index Name": "' || l.want || '"'))::text
from (
  select k.label, k.plan, v.want
  from lookups k
  join (values
    ('activity of a deleted photograph', 'activity_post_idx'),
    ('messages carrying it', 'messages_post_idx'),
    ('activity by a deleted member', 'activity_actor_idx'),
    ('likes by a deleted member', 'likes_user_idx'),
    ('comments by a deleted member', 'comments_author_idx'),
    ('messages by a deleted member', 'messages_sender_idx'),
    ('members they invited', 'profiles_invited_by_idx'),
    ('photographs taken on a day', 'posts_taken_idx'),
    ('unread Activity', 'activity_unread_idx')
  ) v(label, want) on v.label = k.label
) l;

-- For the record.
select 'time: ' || label || ' ' || round((plan -> 0 ->> 'Execution Time')::numeric, 2) || ' ms' as note
from plans order by label;
select 'time: club of ' || count(*) || ' members, ' ||
       (select count(*) from public.posts) || ' photographs, ' ||
       (select count(*) from public.follows) || ' follows, ' ||
       (select count(*) from public.likes) || ' likes, ' ||
       (select count(*) from public.activity) || ' Activity rows' as note
from public.profiles;

\pset border 2
select r.seq, r.name, r.expected, r.actual,
       case when r.expected = r.actual then 'pass' else 'FAIL' end as status
from tests.results r, plans_start s
where r.seq > s.seq
order by r.seq;

do $verdict$
declare v_failed int;
begin
  select count(*) into v_failed from tests.results r, plans_start s
   where r.seq > s.seq and r.expected <> r.actual;
  if v_failed > 0 then
    raise exception '% scale plan checks FAILED', v_failed;
  end if;
  raise notice 'scale plan checks passed';
end
$verdict$;

rollback;
