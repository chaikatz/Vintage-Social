-- supabase/production/13_restore_unsplash_house_photos.sql
--
-- NOT A STEP. Never run this in order after 13_remove_unsplash_house_photos.sql.
-- It exists only to undo that script, which was run on production
-- (scfwowqsqrnzpknzurmm) on 8 November 2026. Run it only if you decide you
-- want the Unsplash house photographs back. It has not been run on
-- production; it was proven on a local copy of production to put
-- everything back exactly. Below this header the file is that script,
-- unchanged.
--
-- From the schema removed_20261108 it puts back the 679 photographs with
-- their 8,346 likes, 3,131 comments, 11,478 activity rows and their like
-- and comment counts, points the reports that named them at them again,
-- and gives the 112 house accounts their profile pictures back. It takes
-- away the 49 follows the removal gave the review account, and the notices
-- those follows made. The four triggers it names are held off while the
-- rows go back and turned on again at the end, so nothing new is notified
-- or pushed.
--
-- It needs removed_20261108. After
--   drop schema removed_20261108 cascade;
-- it cannot run, and nothing can be put back.
--
-- Since 14_remove_empty_house_accounts.sql ran on production (also on
-- 8 November), it cannot run on its own either: 590 of the 679 photographs
-- belonged to the 97 accounts that file removed, so it stops at the first
-- of them and changes nothing (tried on a local copy). Putting them back
-- would mean putting those accounts back first, which nothing here does
-- and nothing has tested.
--
-- ---------------------------------------------------------------------------
-- VINTAGE · put back what was removed on 8 November 2026, only if ever wanted.
-- All-or-nothing. The app's own reactions (new notices, push calls, recounting)
-- are held off while the rows go back, so everything returns exactly as it was.
alter table public.posts disable trigger posts_push_trigger;
alter table public.likes disable trigger likes_activity_trigger;
alter table public.comments disable trigger comments_activity_trigger;
alter table public.activity disable trigger activity_push_trigger;

insert into public.posts select * from removed_20261108.posts on conflict (id) do nothing;
insert into public.comments select * from removed_20261108.comments on conflict (id) do nothing;
insert into public.likes select * from removed_20261108.likes on conflict do nothing;
insert into public.activity select * from removed_20261108.activity on conflict (id) do nothing;
update public.posts p set like_count = b.like_count, comment_count = b.comment_count
  from removed_20261108.posts b where b.id = p.id;
update public.reports r set post_id = b.post_id
  from removed_20261108.reports b where b.id = r.id and r.post_id is null;
update public.profiles p set avatar_url = b.avatar_url
  from removed_20261108.avatars b where b.id = p.id and p.avatar_url is null;
delete from public.activity a using removed_20261108.review_follows_added f
  where a.type = 'follow' and a.actor_id = f.follower_id and a.recipient_id = f.followee_id;
delete from public.follows x using removed_20261108.review_follows_added f
  where x.follower_id = f.follower_id and x.followee_id = f.followee_id;

alter table public.posts enable trigger posts_push_trigger;
alter table public.likes enable trigger likes_activity_trigger;
alter table public.comments enable trigger comments_activity_trigger;
alter table public.activity enable trigger activity_push_trigger;
