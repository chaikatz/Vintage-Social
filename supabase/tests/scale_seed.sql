-- A club many times today's size, for reading query plans against.
--
-- Production, November 2026: 161 profiles, 1,139 posts, 1,836 follows,
-- 11,244 likes, 4,246 comments, 17,406 activity rows. This makes the same
-- shape at :members members (psql -v members=N; default 4000, about 25
-- times today): about seven photographs each, fifteen follows, seventy
-- likes and twenty-six comments given, an Activity row for every like,
-- comment and follow, one private account in ten, and a few threads of
-- messages. Deterministic (setseed), so a plan read twice is the same plan.
--
-- Used by 08_scale_plans.sql, inside its transaction, which rolls back:
-- nothing made here outlives the file that made it.

\if :{?members}
\else
  \set members 4000
\endif

select setseed(0.23);

-- Members. The auth trigger makes each profile; status is set after, as
-- the fixtures do, so none of them draws a membership number.
insert into auth.users (id, email, raw_user_meta_data)
select ('5ca1e000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       'scale' || g || '@scale.test',
       jsonb_build_object('username', 'scale_' || g)
from generate_series(1, :members) g;

update public.profiles
   set status = 'approved', approved_at = now(), is_private = (random() < 0.1)
 where id::text like '5ca1e000-%';

create temp table scale_members as
select id, row_number() over (order by id) as n
from public.profiles where id::text like '5ca1e000-%';
create index on scale_members (n);
analyze scale_members;

-- Photographs: about seven each, over the last three years.
insert into public.posts (author_id, media_type, media_path, thumb_path, filter_id, created_at, taken_at, location)
select m.id, 'photo', m.id || '/' || g || '.jpg', m.id || '/' || g || '.jpg', 'kodachrome',
       now() - (random() * interval '1095 days'),
       now() - (random() * interval '3650 days'),
       case when random() < 0.3 then 'Lisbon' end
from scale_members m, generate_series(1, 7) g
where random() < 0.95;

-- A few removed by the admins, as happens.
update public.posts set removed_at = now()
 where author_id::text like '5ca1e000-%' and random() < 0.01;

-- Follows: fifteen each, a third of them to the fifty most followed
-- members, the rest spread across the club; one in twenty still asking.
insert into public.follows (follower_id, followee_id, status, created_at)
select a.id, b.id,
       case when random() < 0.05 then 'pending' else 'accepted' end,
       now() - (random() * interval '700 days')
from scale_members a
cross join generate_series(1, 15) g
join scale_members b on b.n = case
  when g <= 5 then 1 + ((a.n + g) % 50)
  else 1 + ((a.n * 31 + g * 997) % :members)
end
where a.id <> b.id
on conflict do nothing;

-- Likes: seventy each, on photographs anywhere in the club.
create temp table scale_posts as
select id, row_number() over (order by id) as n from public.posts where author_id::text like '5ca1e000-%';
create index on scale_posts (n);
analyze scale_posts;
select count(*) as scale_post_count from scale_posts \gset

insert into public.likes (post_id, user_id, created_at)
select p.id, m.id, now() - (random() * interval '700 days')
from scale_members m
cross join generate_series(1, 70) g
join scale_posts p on p.n = 1 + ((m.n * 7919 + g * 104729) % :scale_post_count)
on conflict do nothing;

-- Comments: twenty-six each.
insert into public.comments (post_id, author_id, body, created_at)
select p.id, m.id, 'Beautiful light.', now() - (random() * interval '700 days')
from scale_members m
cross join generate_series(1, 26) g
join scale_posts p on p.n = 1 + ((m.n * 6151 + g * 15485863) % :scale_post_count);

-- Threads: one in three members writes to two others, ten messages each.
insert into public.conversations (user_a, user_b, created_at, last_message_at)
select least(a.id, b.id), greatest(a.id, b.id), now() - interval '30 days', now() - interval '30 days'
from scale_members a
join scale_members b on b.n = 1 + ((a.n * 13 + 1) % :members)
where a.n % 3 = 0 and a.id <> b.id
on conflict do nothing;

insert into public.messages (conversation_id, sender_id, body, created_at, read_at)
select c.id, case when g % 2 = 0 then c.user_a else c.user_b end, 'See you there.',
       now() - ((10 - g) * interval '1 day'),
       case when g < 9 then now() end
from public.conversations c
cross join generate_series(1, 10) g
where c.user_a::text like '5ca1e000-%';

-- A handful of blocks, so the restrictive policies have something to find.
insert into public.blocks (blocker_id, blocked_id)
select a.id, b.id from scale_members a
join scale_members b on b.n = 1 + ((a.n * 101) % :members)
where a.n % 50 = 0 and a.id <> b.id
on conflict do nothing;

analyze;
