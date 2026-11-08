-- supabase/production/13_remove_unsplash_house_photos.sql
--
-- RUN ON PRODUCTION (scfwowqsqrnzpknzurmm) ON 8 NOVEMBER 2026, once, in the
-- SQL Editor. Kept here as the record of what was run: below this header
-- the file is the script exactly as it was run.
--
-- What it did on production (read back afterwards):
--   - removed the 679 house photographs whose media_path is
--     https://picsum.photos/... (Unsplash photographs, through Lorem
--     Picsum), and with them, by cascade, 8,346 likes (3 of them by
--     members), 3,131 comments (none by members) and 11,478 activity rows;
--   - cleared the 112 house profile pictures that were picsum addresses
--     (the 38 house profile pictures that were not stay);
--   - had the review account (app_review) follow the 49 house accounts
--     that still have photographs and that it did not already follow, so
--     it follows 61 accounts, every one a house account, and its Home
--     shows all 229 house photographs that remain.
--   Left on production: 229 house photographs, all from Wikimedia Commons
--   (143 public domain, 70 CC0, 16 marked "no restrictions"). 97 of the
--   150 house accounts had no photographs left; they were kept then, and
--   14_remove_empty_house_accounts.sql removed them the same day.
--
-- A copy of everything it removed is in the schema removed_20261108,
-- which anon and authenticated cannot use. 13_restore_unsplash_house_photos.sql
-- puts all of it back; that file exists only to undo this one. Once you
-- are sure you will not want it back, run in the SQL Editor:
--   drop schema removed_20261108 cascade;
--
-- On a fresh project seeded with 08_house_accounts.sql, run this after 08,
-- whole, in the SQL Editor (which runs the file as one transaction)
-- (and after 10_reviewer_account.sql, so the review account is there to
-- follow) to match production. It counts before it changes anything: it
-- refuses unless there are exactly 679 Unsplash house photographs, and
-- undoes everything unless exactly 229 house photographs are left.
--
-- ---------------------------------------------------------------------------
-- VINTAGE · remove the house accounts' Unsplash photographs (8 November 2026)
-- All-or-nothing: if any check fails, nothing is changed. A copy of
-- everything removed is kept in the schema removed_20261108, which the
-- app cannot reach, so it can be put back.

do $check$
begin
  if (select count(*) from public.posts p join public.profiles a on a.id = p.author_id
      where a.is_house and p.media_path ~ '^https://picsum\.photos/') <> 679 then
    raise exception 'Expected 679 Unsplash house photographs. Nothing was changed.';
  end if;
  if to_regnamespace('removed_20261108') is not null then
    raise exception 'This has already been run (removed_20261108 exists). Nothing was changed.';
  end if;
end
$check$;

create schema removed_20261108;
revoke all on schema removed_20261108 from public, anon, authenticated;

create table removed_20261108.posts as
  select p.* from public.posts p join public.profiles a on a.id = p.author_id
  where a.is_house and p.media_path ~ '^https://picsum\.photos/';
create table removed_20261108.likes as
  select l.* from public.likes l where l.post_id in (select id from removed_20261108.posts);
create table removed_20261108.comments as
  select c.* from public.comments c where c.post_id in (select id from removed_20261108.posts);
create table removed_20261108.activity as
  select a.* from public.activity a
  where a.post_id in (select id from removed_20261108.posts)
     or a.comment_id in (select id from removed_20261108.comments);
create table removed_20261108.reports as
  select r.id, r.post_id from public.reports r
  where r.post_id in (select id from removed_20261108.posts);
create table removed_20261108.avatars as
  select id, avatar_url from public.profiles
  where is_house and avatar_url ~ '^https://picsum\.photos/';

delete from public.posts where id in (select id from removed_20261108.posts);

update public.profiles p set avatar_url = null
  from removed_20261108.avatars r where r.id = p.id;

create table removed_20261108.review_follows_added as
  select r.id as follower_id, h.id as followee_id
  from public.profiles r
  join public.profiles h on h.is_house
  where r.username = 'app_review'
    and exists (select 1 from public.posts p where p.author_id = h.id and p.removed_at is null)
    and not exists (select 1 from public.follows f where f.follower_id = r.id and f.followee_id = h.id);
insert into public.follows (follower_id, followee_id, status)
  select follower_id, followee_id, 'accepted' from removed_20261108.review_follows_added;

do $after$
begin
  if exists (select 1 from public.posts p join public.profiles a on a.id = p.author_id
             where a.is_house and p.media_path ~ '^https://picsum\.photos/') then
    raise exception 'Unsplash photographs remain. Nothing was changed.';
  end if;
  if (select count(*) from public.posts p join public.profiles a on a.id = p.author_id where a.is_house) <> 229 then
    raise exception 'Expected 229 house photographs to remain. Nothing was changed.';
  end if;
  if exists (select 1 from public.profiles where is_house and avatar_url ~ '^https://picsum\.photos/') then
    raise exception 'Unsplash profile pictures remain. Nothing was changed.';
  end if;
  if exists (select 1 from public.likes l where l.post_id in (select id from removed_20261108.posts))
     or exists (select 1 from public.comments c where c.post_id in (select id from removed_20261108.posts)) then
    raise exception 'Likes or comments of removed photographs remain. Nothing was changed.';
  end if;
end
$after$;
