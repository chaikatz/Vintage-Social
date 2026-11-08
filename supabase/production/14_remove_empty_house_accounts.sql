-- supabase/production/14_remove_empty_house_accounts.sql
--
-- RUN ON PRODUCTION (scfwowqsqrnzpknzurmm) ON 8 NOVEMBER 2026, once, in the
-- SQL Editor, after 13_remove_unsplash_house_photos.sql. Kept here as the
-- record of what was run: below this header the file is the script exactly
-- as it was run.
--
-- What it did on production (read back afterwards):
--   - removed the 97 house accounts that 13_remove had left with no
--     photographs, and with them, by cascade:
--   - 1,607 follows: 1,575 between house accounts, 8 by the review account
--     and 24 by the owner's account;
--   - 1,796 likes and 682 comments, all made by those accounts on house
--     photographs (none on a member's photograph);
--   - 4,086 activity rows, none of them addressed to a member;
--   - 1 moderation record: the owner's suspension of the one house account
--     that was suspended;
--   - 2 conversations between the owner's account and two of those accounts
--     (4 and 6 September), with their messages. The messages were NOT
--     copied: the copy has the two conversation rows only.
--   Left on production: 53 house accounts, all approved, each with
--   photographs (the 229); the review account follows all 53.
--
-- A copy of everything else it removed is in the schema removed_20261108
-- (the tables named accounts_*), beside the copy 13_remove made, and anon
-- and authenticated cannot use that schema. There is no restore script for
-- this file, and none has been tested. Once you are sure you will not want
-- any of it back, run in the SQL Editor (it drops 13_remove's copy too):
--   drop schema removed_20261108 cascade;
--
-- On a fresh project seeded with 08_house_accounts.sql, run this after
-- 13_remove_unsplash_house_photos.sql, whole, in the SQL Editor (which runs
-- the file as one transaction), to match production. It counts before it
-- changes anything: it refuses unless 13_remove has made removed_20261108
-- and this has not run before, unless exactly 97 house accounts have no
-- photographs and nothing else refers to them, and undoes everything unless
-- exactly 53 house accounts and 229 house photographs are left.
--
-- ---------------------------------------------------------------------------
-- VINTAGE · remove the 97 house accounts left with no photographs (8 November 2026)
-- All-or-nothing: if any check fails, nothing is changed. A copy of what
-- is removed is kept in the schema removed_20261108, beside the copy of
-- the Unsplash photographs, where the app cannot reach it.

do $check$
begin
  if to_regnamespace('removed_20261108') is null then
    raise exception 'Run the Unsplash removal first (removed_20261108 is missing). Nothing was changed.';
  end if;
  if to_regclass('removed_20261108.accounts_ids') is not null then
    raise exception 'This has already been run. Nothing was changed.';
  end if;
  if (select count(*) from public.profiles a where a.is_house
      and not exists (select 1 from public.posts p where p.author_id = a.id)) <> 97 then
    raise exception 'Expected 97 house accounts with no photographs. Nothing was changed.';
  end if;
end
$check$;

create table removed_20261108.accounts_ids as
  select a.id from public.profiles a
  where a.is_house and not exists (select 1 from public.posts p where p.author_id = a.id);

do $refs$
begin
  if exists (select 1 from public.applications where decided_by in (select id from removed_20261108.accounts_ids))
     or exists (select 1 from public.posts where removed_by in (select id from removed_20261108.accounts_ids))
     or exists (select 1 from public.comments where removed_by in (select id from removed_20261108.accounts_ids))
     or exists (select 1 from public.reports where resolved_by in (select id from removed_20261108.accounts_ids))
     or exists (select 1 from public.moderation_actions where admin_id in (select id from removed_20261108.accounts_ids))
     or exists (select 1 from public.invites where used_by in (select id from removed_20261108.accounts_ids))
     or exists (select 1 from public.profiles where id in (select id from removed_20261108.accounts_ids) and not is_house) then
    raise exception 'Something else still refers to these accounts. Nothing was changed.';
  end if;
end
$refs$;

create table removed_20261108.accounts_users as
  select u.* from auth.users u where u.id in (select id from removed_20261108.accounts_ids);
create table removed_20261108.accounts_profiles as
  select p.* from public.profiles p where p.id in (select id from removed_20261108.accounts_ids);
create table removed_20261108.accounts_follows as
  select f.* from public.follows f
  where f.follower_id in (select id from removed_20261108.accounts_ids)
     or f.followee_id in (select id from removed_20261108.accounts_ids);
create table removed_20261108.accounts_likes as
  select l.* from public.likes l where l.user_id in (select id from removed_20261108.accounts_ids);
create table removed_20261108.accounts_comments as
  select c.* from public.comments c where c.author_id in (select id from removed_20261108.accounts_ids);
create table removed_20261108.accounts_activity as
  select a.* from public.activity a
  where a.actor_id in (select id from removed_20261108.accounts_ids)
     or a.recipient_id in (select id from removed_20261108.accounts_ids)
     or a.comment_id in (select id from removed_20261108.accounts_comments);
create table removed_20261108.accounts_conversations as
  select c.* from public.conversations c
  where c.user_a in (select id from removed_20261108.accounts_ids)
     or c.user_b in (select id from removed_20261108.accounts_ids);
create table removed_20261108.accounts_moderation as
  select m.* from public.moderation_actions m
  where m.target_profile_id in (select id from removed_20261108.accounts_ids);

delete from auth.users where id in (select id from removed_20261108.accounts_ids);

do $after$
begin
  if exists (select 1 from public.profiles a where a.is_house
             and not exists (select 1 from public.posts p where p.author_id = a.id)) then
    raise exception 'House accounts with no photographs remain. Nothing was changed.';
  end if;
  if (select count(*) from public.profiles where is_house) <> 53 then
    raise exception 'Expected 53 house accounts to remain. Nothing was changed.';
  end if;
  if (select count(*) from public.posts p join public.profiles a on a.id = p.author_id where a.is_house) <> 229 then
    raise exception 'Expected the 229 house photographs to remain. Nothing was changed.';
  end if;
  if exists (select 1 from public.profiles where id in (select id from removed_20261108.accounts_ids)) then
    raise exception 'Profiles remain. Nothing was changed.';
  end if;
end
$after$;
