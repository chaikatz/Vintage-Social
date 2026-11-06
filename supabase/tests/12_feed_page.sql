-- The home feed asked for in one piece (0025): feed_page gives each member
-- exactly the posts, in exactly the order, that the app's old two-step
-- read gave them - their own and those of everyone they follow, under
-- every policy on posts and follows - page by page, and nobody else
-- anything.
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

create temp table feed_cases as
select v.uid, o.off
from (values
  ('f0000000-0000-4000-8000-000000000001'::uuid),
  ('f0000000-0000-4000-8000-000000000002'::uuid),
  ('f0000000-0000-4000-8000-000000000005'::uuid),
  ('f0000000-0000-4000-8000-000000000006'::uuid),
  ('f0000000-0000-4000-8000-000000000007'::uuid),
  ('f0000000-0000-4000-8000-000000000008'::uuid)) v(uid)
cross join generate_series(0, 150, 15) o(off);

insert into tests.results (name, expected, actual)
select 'feed page at ' || c.off || ' for ' || right(c.uid::text, 2) || ' is the old read''s page',
       tests.feed_as(c.uid, tests.old_feed_sql(c.uid, 5, c.off)),
       tests.feed_as(c.uid, format('select id from public.feed_page(5, %s)', c.off))
from feed_cases c;

insert into tests.results (name, expected, actual) values
  ('the follower''s whole feed is the old read''s, from four members', 'true,4',
   (tests.feed_as('f0000000-0000-4000-8000-000000000001', 'select id from public.feed_page(100, 0)')
    = tests.feed_as('f0000000-0000-4000-8000-000000000001', tests.old_feed_sql('f0000000-0000-4000-8000-000000000001', 100, 0)))::text
   || ',' ||
   (select count(*) from regexp_split_to_table(
      tests.feed_as('f0000000-0000-4000-8000-000000000001', 'select distinct author_id as id from public.feed_page(100, 0)'), ','))::text),
  ('nothing from the private member they only asked to follow', '-',
   tests.feed_as('f0000000-0000-4000-8000-000000000001',
     'select id from public.feed_page(100, 0) where author_id = ''f0000000-0000-4000-8000-000000000004''')
   ),
  ('nothing from the member who blocked them', '-',
   tests.feed_as('f0000000-0000-4000-8000-000000000001',
     'select id from public.feed_page(100, 0) where author_id = ''f0000000-0000-4000-8000-000000000005''')),
  ('a signed-out visitor cannot ask', 'DENIED',
   tests.feed_as(null, 'select id from public.feed_page(5, 0)')),
  ('a page is at least one post and at most a hundred', '1,100',
   (select count(*) from regexp_split_to_table(tests.feed_as('f0000000-0000-4000-8000-000000000001', 'select id from public.feed_page(0, 0)'), ','))
   || ',' ||
   (select least(count(*), 100) from regexp_split_to_table(tests.feed_as('f0000000-0000-4000-8000-000000000001', 'select id from public.feed_page(1000, 0)'), ','))),
  ('a negative offset is the first page', 'true',
   (tests.feed_as('f0000000-0000-4000-8000-000000000001', 'select id from public.feed_page(5, -10)')
    = tests.feed_as('f0000000-0000-4000-8000-000000000001', 'select id from public.feed_page(5, 0)'))::text),
  ('it runs as the caller, not as its owner', 'false',
   (select prosecdef::text from pg_proc where oid = 'public.feed_page(integer, integer)'::regprocedure)),
  ('members may call it, signed-out visitors may not', 'true,false',
   has_function_privilege('authenticated', 'public.feed_page(integer, integer)', 'execute')::text || ',' ||
   has_function_privilege('anon', 'public.feed_page(integer, integer)', 'execute')::text);

\pset border 2
select r.seq, r.name, r.expected, r.actual,
       case when r.expected = r.actual then 'pass' else 'FAIL' end as status
from tests.results r, feed_start s
where r.seq > s.seq and (r.expected <> r.actual or r.name not like 'feed page at %')
order by r.seq;

select 'feed pages compared: ' || count(*) as note
from tests.results r, feed_start s where r.seq > s.seq and r.name like 'feed page at %';

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
