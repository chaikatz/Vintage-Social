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

-- A member the whole club follows, for the push function's pages.
select id as popular from public.profiles where id::text like '5ca1e000-%' and not is_private
order by id offset 3 limit 1 \gset
insert into public.follows (follower_id, followee_id, status)
select id, :'popular', 'accepted' from public.profiles where id::text like '5ca1e000-%' and id <> :'popular'
on conflict (follower_id, followee_id) do update set status = 'accepted';
analyze public.follows;
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
     'select 1 from public.activity where recipient_id = %L and read_at is null', :'author'))),
  -- The push function (service role, no policies): the next page of a
  -- photograph's followers after the last one told (0026), for a member
  -- the whole club follows, and whether a like was pushed to this member
  -- in the last half hour.
  ('the next page of followers to tell', tests.plan_owner(format(
     'select follower_id from public.follows where followee_id = %L and status = ''accepted''
        and follower_id > %L order by follower_id limit 100', :'popular', '5ca1e000-0000-4000-8000-000000000100'))),
  ('a like pushed in the last half hour', tests.plan_owner(format(
     'select id from public.activity where recipient_id = %L and created_at >= now() - interval ''1 hour''
        and type = ''like'' and id <> %L and pushed_at >= now() - interval ''30 minutes'' limit 1',
     :'author', gen_random_uuid())));

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
  -- Few followers each here, so either index of an author's followers will do;
  -- for a member with thousands, the newest-first one saves the sort.
  ('their followers', 'follows_followers_idx or follows_followers_by_id_idx'),
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
    ('unread Activity', 'activity_unread_idx'),
    ('the next page of followers to tell', 'follows_followers_by_id_idx'),
    ('a like pushed in the last half hour', 'activity_recipient_idx')
  ) v(label, want) on v.label = k.label
) l;

-- Keyset, not offset: the followers come out of the index in order, so the
-- page stops at its thousand rather than sorting all of them first.
insert into tests.results (name, expected, actual) values
  ('scale: the next page of followers needs no sort', 'false',
   ((select plan::text from lookups where label = 'the next page of followers to tell') ~ '"Node Type": "Sort"')::text),
  ('scale: the like check reads only the last hour of the member''s Activity', 'true',
   ((select plan::text from lookups where label = 'a like pushed in the last half hour')
     ~ '"Index Cond": "\(\(recipient_id = [^"]*AND \(created_at >= ')::text);

-- ---------------------------------------------------------------------------
-- the home feed (0025): about the photographs it could show, never the club's
-- ---------------------------------------------------------------------------
-- feed_page plans its query inside the function, so EXPLAIN of the call
-- shows only "Function Scan". What it read is counted instead: the rows
-- fetched from posts and its indexes in this transaction, before and
-- after the call, as the member.
insert into auth.users (id, email, raw_user_meta_data) values
  ('feed5ca1-0000-4000-8000-000000000001', 'new@scale.test', '{"username":"scale.newcomer"}'),
  ('feed5ca1-0000-4000-8000-000000000002', 'all@scale.test', '{"username":"scale.follows_all"}');
update public.profiles set status = 'approved', approved_at = now() where id::text like 'feed5ca1-%';
insert into public.follows (follower_id, followee_id, status)
select 'feed5ca1-0000-4000-8000-000000000002', id, 'accepted' from public.profiles where id::text like '5ca1e000-%';
analyze public.follows;
analyze public.profiles;

create or replace function tests.posts_read(p_uid uuid, p_sql text)
returns table (rows_read bigint, ids text, ms numeric)
language plpgsql
as $fn$
declare
  v_before bigint;
  v_t0 timestamptz;
begin
  select sum(pg_stat_get_xact_tuples_fetched(o)) + pg_stat_get_xact_tuples_returned('public.posts'::regclass)
    into v_before
  from (select 'public.posts'::regclass::oid as o union all
        select indexrelid from pg_index where indrelid = 'public.posts'::regclass) r;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  v_t0 := clock_timestamp();
  execute 'select coalesce(string_agg(id::text, '','' order by ord), ''-'')
             from (select id, row_number() over () as ord from (' || p_sql || ') q) r' into ids;
  ms := round((extract(epoch from clock_timestamp() - v_t0) * 1000)::numeric, 2);
  execute 'reset role';
  select sum(pg_stat_get_xact_tuples_fetched(o)) + pg_stat_get_xact_tuples_returned('public.posts'::regclass) - v_before
    into rows_read
  from (select 'public.posts'::regclass::oid as o union all
        select indexrelid from pg_index where indrelid = 'public.posts'::regclass) r;
  return next;
end
$fn$;

-- The read the app made before 0025, for comparison (old_feed_sql in 12):
-- a page by offset. feed_page is asked for the page after a post instead
-- (its cursor), so each case names how many posts the reader holds; the
-- cursor is the last of them, found by the old read, as the member.
create or replace function tests.old_feed_sql_at(p_uid uuid, p_limit int, p_offset int)
returns text language sql as $fn$
  select format(
    'select p.id from public.posts p
      where p.author_id = any (array[%L::uuid] || array(select f.followee_id from public.follows f
                                                         where f.follower_id = %L and f.status = ''accepted''))
        and p.removed_at is null
      order by p.created_at desc, p.id desc
      limit %s offset %s', p_uid, p_uid, p_limit, p_offset)
$fn$;

create temp table feed_cases (label text primary key, uid uuid, held int);
insert into feed_cases values
  ('a member who follows nobody', 'feed5ca1-0000-4000-8000-000000000001', 0),
  ('a typical member, first page', :'me', 0),
  ('a typical member, second page', :'me', 12),
  ('a member who follows the whole club', 'feed5ca1-0000-4000-8000-000000000002', 0),
  ('the whole club, twenty pages in', 'feed5ca1-0000-4000-8000-000000000002', 240);
-- Past the end: the reader holds every post of their feed.
insert into feed_cases
select 'past the end of a typical feed', :'me', count(*)
from tests.posts_read(:'me', tests.old_feed_sql_at(:'me', 100000, 0)) r
cross join lateral regexp_split_to_table(r.ids, ',');

-- Each case's cursor: the last post the reader holds, as the old read gives it.
create temp table feed_cursors as
select c.label, p.created_at as at, p.id
from feed_cases c
cross join lateral tests.posts_read(c.uid, tests.old_feed_sql_at(c.uid, 1, c.held - 1)) r
join public.posts p on p.id = r.ids::uuid
where c.held > 0;

create temp table feed_reads (label text primary key, rows_read bigint, ids text, ms numeric, old_ids text);
insert into feed_reads
select c.label, f.rows_read, f.ids, f.ms, o.ids
from feed_cases c
left join feed_cursors k on k.label = c.label
cross join lateral tests.posts_read(c.uid,
  case when k.id is null then 'select id from public.feed_page(12)'
       else format('select id from public.feed_page(12, %L, %L)', k.at, k.id) end) f
cross join lateral tests.posts_read(c.uid, tests.old_feed_sql_at(c.uid, 12, c.held)) o;

insert into tests.results (name, expected, actual)
select 'scale: feed_page, ' || label || ', is the page the old read gave', 'true', (ids = old_ids)::text
from feed_reads;

insert into tests.results (name, expected, actual) values
  ('scale: every case past the first page has its cursor', '3',
   (select count(*)::text from feed_cursors)),
  ('scale: past the end of a typical feed is no page at all', '-',
   (select ids from feed_reads where label = 'past the end of a typical feed')),
  ('scale: feed_page for a member who follows nobody reads their own photographs, not the club''s', 'true',
   ((select rows_read from feed_reads where label = 'a member who follows nobody') <= 12)::text),
  ('scale: feed_page for a typical member reads only its authors'' photographs', 'true',
   ((select rows_read from feed_reads where label = 'a typical member, first page')
     <= (select count(*) from public.posts
          where author_id = :'me' or author_id in (select followee_id from public.follows
                                                    where follower_id = :'me' and status = 'accepted')))::text),
  ('scale: and that is a small part of the club', 'true',
   ((select rows_read from feed_reads where label = 'a typical member, first page')
     < (select count(*) / 10 from public.posts))::text),
  -- From the cursor down: each page reads less than the one before it,
  -- and past the end, where the offset read every post of the feed's
  -- authors to find none, it reads none.
  ('scale: feed_page, the second page reads no more than the first', 'true',
   ((select rows_read from feed_reads where label = 'a typical member, second page')
     <= (select rows_read from feed_reads where label = 'a typical member, first page'))::text),
  ('scale: feed_page past the end of a feed reads nothing', 'true',
   ((select rows_read from feed_reads where label = 'past the end of a typical feed') <= 2)::text),
  ('scale: feed_page for a member who follows everyone walks newest first and stops at the page', 'true',
   ((select rows_read from feed_reads where label = 'a member who follows the whole club') <= 60)::text),
  -- Twenty pages in, by offset, it walked past the 240 posts before the
  -- page (259 read); from a cursor it starts there.
  ('scale: feed_page twenty pages in reads about a page, not the twenty before it', 'true',
   ((select rows_read from feed_reads where label = 'the whole club, twenty pages in') <= 60)::text);

-- ---------------------------------------------------------------------------
-- a member's followers and following, a page at a time (src/api/profiles.ts)
-- ---------------------------------------------------------------------------
-- Fifty at a time, the newest follow first, each page after the last
-- follow held, as PostgREST asks it: ten pages into the followers of the
-- member the whole club follows, and into the following of the member
-- who follows the whole club. Their follows were all made above in one
-- statement, at one instant; spread over a thousand minutes here, as a
-- real list's are.
update public.follows f set created_at = now() - s.n * interval '1 minute'
from (select follower_id, followee_id, row_number() over (order by follower_id, followee_id) as n
        from public.follows
       where followee_id = :'popular' or follower_id = 'feed5ca1-0000-4000-8000-000000000002') s
where f.follower_id = s.follower_id and f.followee_id = s.followee_id;
analyze public.follows;

select f.created_at as fat, f.follower_id as fid from public.follows f
where f.followee_id = :'popular' and f.status = 'accepted'
order by f.created_at desc, f.follower_id desc offset 499 limit 1 \gset
select f.created_at as gat, f.followee_id as gid from public.follows f
where f.follower_id = 'feed5ca1-0000-4000-8000-000000000002' and f.status = 'accepted'
order by f.created_at desc, f.followee_id desc offset 499 limit 1 \gset

create or replace function tests.follow_page_sql(p_side text, p_member uuid, p_at timestamptz, p_id uuid)
returns text language sql as $fn$
  select format(
    'select f.created_at, f.%1$s,
            (select row_to_json(m) from (select id, username, full_name, avatar_url, city
               from public.profiles where id = f.%1$s) m) as member
     from public.follows f
     where f.%2$s = %3$L and f.status = ''accepted''
       and f.created_at <= %4$L and (f.created_at < %4$L or (f.created_at = %4$L and f.%1$s < %5$L))
     order by f.created_at desc, f.%1$s desc limit 50',
    case p_side when 'followers' then 'follower_id' else 'followee_id' end,
    case p_side when 'followers' then 'followee_id' else 'follower_id' end,
    p_member, p_at, p_id)
$fn$;

create temp table follow_pages (label text primary key, plan json);
insert into follow_pages values
  ('their followers, ten pages in',
   tests.plan_as(:'me', tests.follow_page_sql('followers', :'popular', :'fat', :'fid'))),
  ('whom they follow, ten pages in',
   tests.plan_as(:'me', tests.follow_page_sql('following', 'feed5ca1-0000-4000-8000-000000000002', :'gat', :'gid')));
-- And what the index allows, whatever the size of the tables: on a list
-- this short, reading all of it is often the cheaper plan and no fault;
-- on one of tens of thousands it is not.
set local enable_seqscan = off;
set local enable_bitmapscan = off;
insert into follow_pages values
  ('their followers, ten pages in, by the index',
   tests.plan_as(:'me', tests.follow_page_sql('followers', :'popular', :'fat', :'fid')));
reset enable_seqscan;
reset enable_bitmapscan;

insert into tests.results (name, expected, actual)
select 'scale: ' || label || ' is a page of fifty', '50', (plan -> 0 -> 'Plan' ->> 'Actual Rows')
from follow_pages;

insert into tests.results (name, expected, actual) values
  ('scale: their followers, ten pages in, read no whole table of follows', 'false',
   exists (select 1 from follow_pages p, tests.plan_nodes(p.plan) n where n.node = 'Seq Scan' and n.relation = 'follows')::text),
  ('scale: their followers can start at the cursor (follows_followers_idx from created_at <=)', 'true',
   ((select plan::text from follow_pages where label = 'their followers, ten pages in, by the index')
     ~ '"Index Name": "follows_followers_idx"[^}]*"Index Cond": "\(\(followee_id = [^"]*AND \(created_at <= ')::text),
  ('scale: and from there read about a page, not the five hundred above it', 'true',
   ((select max(actual_rows * loops) from tests.plan_nodes((select plan from follow_pages where label = 'their followers, ten pages in, by the index'))
      where index_name = 'follows_followers_idx') <= 120)::text);

select 'time: ' || label || ' ' || round((plan -> 0 ->> 'Execution Time')::numeric, 2) || ' ms, '
       || (select max(actual_rows * loops) from tests.plan_nodes(plan) where relation = 'follows' or index_name like 'follows%')
       || ' follows read' as note
from follow_pages order by label;

select 'time: feed_page, ' || label || ' ' || ms || ' ms, ' || rows_read || ' photographs read' as note
from feed_reads order by label;

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
