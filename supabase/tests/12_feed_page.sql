-- The home feed asked for in one piece (0025): feed_page gives each member
-- exactly the posts, in exactly the order, that the app's old two-step
-- read gave them - their own and those of everyone they follow, under
-- every policy on posts and follows - page by page, and nobody else
-- anything. Pages are asked for after the last post held (a cursor), so
-- a post deleted or added between two pages neither skips nor repeats
-- one, as an offset did.
--
-- Runs in one transaction and rolls back.

begin;

create temp table feed_start as select coalesce(max(seq), 0) as seq from tests.results;

-- Eight members: f1 follows f2 (public), f3 (private, accepted), asks to
-- follow f4 (private, pending), follows f5 who has since blocked f1, and
-- f6 who is suspended. f7 has only applied. f8 nobody follows.
insert into auth.users (id, email, raw_user_meta_data)
select ('f0000000-0000-4000-8000-00000000000' || n)::uuid, 'feed' || n || '@feed.test',
       jsonb_build_object('username', 'feed.member' || n)
from generate_series(1, 8) n;
update public.profiles set status = 'approved', approved_at = now()
 where id::text like 'f0000000-0000-4000-8000-00000000000_' and id::text !~ '[67]$';
update public.profiles set status = 'suspended' where id = 'f0000000-0000-4000-8000-000000000006';
update public.profiles set is_private = true
 where id in ('f0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000004');

insert into public.follows (follower_id, followee_id, status) values
  ('f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', 'accepted'),
  ('f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000003', 'accepted'),
  ('f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000004', 'pending'),
  ('f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000005', 'accepted'),
  ('f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000006', 'accepted'),
  ('f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'accepted');

-- Six posts each over a week, two of them in the same instant, one removed.
insert into public.posts (author_id, media_type, media_path, filter_id, created_at)
select a.id, 'photo', a.id || '/' || k || '.jpg', 'kodachrome',
       timestamptz '2026-10-01' + ((k * 7 + n) * interval '1 hour')
from (select id, right(id::text, 1)::int as n from public.profiles where id::text like 'f0000000-%') a
cross join generate_series(1, 6) k;
insert into public.posts (author_id, media_type, media_path, filter_id, created_at)
select id, 'photo', id || '/same.jpg', 'kodachrome', timestamptz '2026-10-05 12:00'
from public.profiles where id in ('f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000003');
update public.posts set removed_at = now()
 where id = (select id from public.posts where author_id = 'f0000000-0000-4000-8000-000000000002' order by created_at limit 1);
-- And a prolific month for f1, so a feed runs past the hundred-a-page cap.
insert into public.posts (author_id, media_type, media_path, filter_id, created_at)
select 'f0000000-0000-4000-8000-000000000001', 'photo', 'f0000000-0000-4000-8000-000000000001/m' || k || '.jpg',
       'kodachrome', timestamptz '2026-09-01' + k * interval '5 hours'
from generate_series(1, 120) k;

insert into public.blocks (blocker_id, blocked_id) values
  ('f0000000-0000-4000-8000-000000000005', 'f0000000-0000-4000-8000-000000000001');

-- A page as the member sees it, both ways, as one comparable string.
create or replace function tests.feed_as(p_uid uuid, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v text;
begin
  if p_uid is null then
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '', true);
  else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  end if;
  begin
    execute 'select coalesce(string_agg(id::text, '','' order by ord), ''-'') from (select id, row_number() over () as ord from ('
      || p_sql || ') q) r' into v;
  exception when insufficient_privilege then
    v := 'DENIED';
  end;
  execute 'reset role';
  return v;
end
$fn$;

-- The app's old read: who I follow, then posts by me or them.
create or replace function tests.old_feed_sql(p_uid uuid, p_limit int, p_offset int)
returns text language sql as $fn$
  select format(
    'select p.id from public.posts p
      where p.author_id = any (array[%L::uuid] || array(select f.followee_id from public.follows f
                                                         where f.follower_id = %L and f.status = ''accepted''))
        and p.removed_at is null
      order by p.created_at desc, p.id desc
      limit %s offset %s', p_uid, p_uid, p_limit, p_offset)
$fn$;

-- Every page of a member's feed, read the way the app reads it: the first
-- with no cursor, each next one after the last post of the one before,
-- until a page comes back short. One string per page.
create or replace function tests.feed_walk(p_uid uuid, p_size int)
returns text[]
language plpgsql
as $fn$
declare
  v_pages text[] := '{}';
  v_at    timestamptz;
  v_id    uuid;
  v_ids   uuid[];
  v_ats   timestamptz[];
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  loop
    select coalesce(array_agg(f.id order by f.ord), '{}'), coalesce(array_agg(f.created_at order by f.ord), '{}')
      into v_ids, v_ats
    from (select q.id, q.created_at, row_number() over () as ord
            from public.feed_page(p_size, v_at, v_id) q) f;
    v_pages := v_pages || coalesce(array_to_string(v_ids, ','), '');
    exit when cardinality(v_ids) < p_size or cardinality(v_pages) > 500;
    v_at := v_ats[cardinality(v_ats)];
    v_id := v_ids[cardinality(v_ids)];
  end loop;
  execute 'reset role';
  return v_pages;
end
$fn$;

create temp table feed_cases as
select v.uid, s.size
from (values
  ('f0000000-0000-4000-8000-000000000001'::uuid),
  ('f0000000-0000-4000-8000-000000000002'::uuid),
  ('f0000000-0000-4000-8000-000000000005'::uuid),
  ('f0000000-0000-4000-8000-000000000006'::uuid),
  ('f0000000-0000-4000-8000-000000000007'::uuid),
  ('f0000000-0000-4000-8000-000000000008'::uuid)) v(uid)
cross join (values (1), (5), (12)) s(size);

create temp table feed_walks as
select c.uid, c.size, w.page, w.ids
from feed_cases c
cross join lateral unnest(tests.feed_walk(c.uid, c.size)) with ordinality w(ids, page);

-- Page by page, the old read's page at the same place (a page of one
-- walks every boundary, the two posts of the same instant included).
insert into tests.results (name, expected, actual)
select 'feed page ' || w.page || ' of ' || w.size || ' for ' || right(w.uid::text, 2) || ' is the old read''s page',
       tests.feed_as(w.uid, tests.old_feed_sql(w.uid, w.size, ((w.page - 1) * w.size)::int)),
       coalesce(nullif(w.ids, ''), '-')
from feed_walks w;

insert into tests.results (name, expected, actual)
select 'the whole walk for ' || right(c.uid::text, 2) || ' in pages of ' || c.size || ' is the old read, each post once',
       tests.feed_as(c.uid, tests.old_feed_sql(c.uid, 100000, 0)),
       coalesce(nullif((select string_agg(nullif(w.ids, ''), ',' order by w.page) from feed_walks w
                         where w.uid = c.uid and w.size = c.size), ''), '-')
from feed_cases c;

insert into tests.results (name, expected, actual) values
  ('the follower''s whole feed is the old read''s, from four members', 'true,4',
   (tests.feed_as('f0000000-0000-4000-8000-000000000001', 'select id from public.feed_page(100)')
    = tests.feed_as('f0000000-0000-4000-8000-000000000001', tests.old_feed_sql('f0000000-0000-4000-8000-000000000001', 100, 0)))::text
   || ',' ||
   (select count(*) from regexp_split_to_table(
      tests.feed_as('f0000000-0000-4000-8000-000000000001', 'select distinct author_id as id from public.feed_page(100)'), ','))::text),
  ('nothing from the private member they only asked to follow', '-',
   tests.feed_as('f0000000-0000-4000-8000-000000000001',
     'select id from public.feed_page(100) where author_id = ''f0000000-0000-4000-8000-000000000004''')
   ),
  ('nothing from the member who blocked them', '-',
   tests.feed_as('f0000000-0000-4000-8000-000000000001',
     'select id from public.feed_page(100) where author_id = ''f0000000-0000-4000-8000-000000000005''')),
  ('a signed-out visitor cannot ask', 'DENIED',
   tests.feed_as(null, 'select id from public.feed_page(5)')),
  ('a page is at least one post and at most a hundred', '1,100',
   (select count(*) from regexp_split_to_table(tests.feed_as('f0000000-0000-4000-8000-000000000001', 'select id from public.feed_page(0)'), ','))
   || ',' ||
   (select least(count(*), 100) from regexp_split_to_table(tests.feed_as('f0000000-0000-4000-8000-000000000001', 'select id from public.feed_page(1000)'), ','))),
  ('no cursor is the first page', 'true',
   (tests.feed_as('f0000000-0000-4000-8000-000000000001', 'select id from public.feed_page(5, null, null)')
    = tests.feed_as('f0000000-0000-4000-8000-000000000001', tests.old_feed_sql('f0000000-0000-4000-8000-000000000001', 5, 0)))::text),
  ('a cursor with a time and no id is the posts before that time', 'true',
   (tests.feed_as('f0000000-0000-4000-8000-000000000001', 'select id from public.feed_page(100, ''2026-10-05 12:00+00'', null)')
    = tests.feed_as('f0000000-0000-4000-8000-000000000001', replace(tests.old_feed_sql('f0000000-0000-4000-8000-000000000001', 100, 0),
        'and p.removed_at is null', 'and p.removed_at is null and p.created_at < ''2026-10-05 12:00+00''')))::text),
  ('it runs as the caller, not as its owner', 'false',
   (select prosecdef::text from pg_proc where oid = 'public.feed_page(integer, timestamptz, uuid)'::regprocedure)),
  ('members may call it, signed-out visitors may not', 'true,false',
   has_function_privilege('authenticated', 'public.feed_page(integer, timestamptz, uuid)', 'execute')::text || ',' ||
   has_function_privilege('anon', 'public.feed_page(integer, timestamptz, uuid)', 'execute')::text),
  ('it takes a cursor, and no offset: one feed_page',
   'p_limit integer DEFAULT 12, p_before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid',
   (select string_agg(pg_get_function_arguments(oid), ' | ') from pg_proc
     where proname = 'feed_page' and pronamespace = 'public'::regnamespace));

-- Between two pages, the club moves on. f1 holds the first page of five;
-- then posts on it are taken away, and new ones arrive above it. The
-- next page starts right after the post f1 holds last: it is the page f1
-- would have read had nothing changed, no post skipped and none
-- repeated. By offset, the first skipped two posts, the second showed
-- one again.
create temp table feed_before as
select tests.feed_walk('f0000000-0000-4000-8000-000000000001', 100) as whole,
       string_to_array(tests.feed_as('f0000000-0000-4000-8000-000000000001',
          tests.old_feed_sql('f0000000-0000-4000-8000-000000000001', 5, 0)), ',') as first_page;
create temp table feed_cursor as
select p.created_at as at, p.id
from public.posts p, feed_before b
where p.id = b.first_page[5]::uuid;

-- Two posts of the page f1 holds are taken away: one deleted by its
-- author, one removed by the admins.
delete from public.posts where id = (select first_page[2]::uuid from feed_before);
update public.posts set removed_at = now() where id = (select first_page[4]::uuid from feed_before);

insert into tests.results (name, expected, actual)
select 'after two posts above it are taken away, the next page is the one that followed the post held',
       array_to_string((string_to_array(b.whole[1], ','))[6:10], ','),
       tests.feed_as('f0000000-0000-4000-8000-000000000001',
         format('select id from public.feed_page(5, %L, %L)', k.at, k.id))
from feed_before b, feed_cursor k;

insert into tests.results (name, expected, actual)
select 'by offset, the next page would have skipped two', array_to_string((string_to_array(b.whole[1], ','))[8:12], ','),
       tests.feed_as('f0000000-0000-4000-8000-000000000001', tests.old_feed_sql('f0000000-0000-4000-8000-000000000001', 5, 5))
from feed_before b;

-- Then three new ones arrive above it.
insert into public.posts (author_id, media_type, media_path, filter_id, created_at)
select a, 'photo', a || '/new' || k || '.jpg', 'kodachrome', now() + k * interval '1 second'
from (values ('f0000000-0000-4000-8000-000000000001'::uuid), ('f0000000-0000-4000-8000-000000000002'::uuid)) v(a),
     generate_series(1, 2) k
limit 3;

insert into tests.results (name, expected, actual)
select 'after three new posts arrive above it, the next page is still the one that followed the post held',
       array_to_string((string_to_array(b.whole[1], ','))[6:10], ','),
       tests.feed_as('f0000000-0000-4000-8000-000000000001',
         format('select id from public.feed_page(5, %L, %L)', k.at, k.id))
from feed_before b, feed_cursor k;

insert into tests.results (name, expected, actual)
select 'by offset, the next page would have shown the post held again', 'true',
       (k.id::text = any (string_to_array(tests.feed_as('f0000000-0000-4000-8000-000000000001',
          tests.old_feed_sql('f0000000-0000-4000-8000-000000000001', 5, 5)), ',')))::text
from feed_cursor k;

\pset border 2
select r.seq, r.name, r.expected, r.actual,
       case when r.expected = r.actual then 'pass' else 'FAIL' end as status
from tests.results r, feed_start s
where r.seq > s.seq and (r.expected <> r.actual or r.name not like 'feed page %')
order by r.seq;

select 'feed pages compared: ' || count(*) as note
from tests.results r, feed_start s where r.seq > s.seq and r.name like 'feed page %';

do $verdict$
declare v_failed int;
begin
  select count(*) into v_failed from tests.results r, feed_start s
   where r.seq > s.seq and r.expected <> r.actual;
  if v_failed > 0 then
    raise exception '% feed page checks FAILED', v_failed;
  end if;
  raise notice 'feed page checks passed';
end
$verdict$;

rollback;
