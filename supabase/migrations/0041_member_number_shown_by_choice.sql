-- VINTAGE · 0041 · a member's number is shown only if they choose
--
-- Every member is given a number when they are let in (0007), and every
-- profile showed it to everyone who opened it, "MEMBER · NO. 00027", as
-- did every print shared from the app. The owner asked, after build 52,
-- for a choice in Settings: the profile always says MEMBER, and the
-- number is shown only by a member who wants it shown. Hidden unless they
-- choose otherwise.
--
--   1. profiles.show_member_no, a boolean, false unless the member turns
--      it on. Every member, those here now and those to come, starts with
--      it off. A constant default, so adding the column rewrites no row
--      and holds its lock only for a moment.
--   2. Members may change it, on their own row only: one more column in
--      0039's list of what a member may write (grant update
--      (show_member_no) to authenticated). The update policies are as
--      they were and ask what they asked: "profiles: update own" (the row
--      is the member's, and private.own_profile_unchanged keeps role,
--      status, allowance, number, inviter and house as stored, so the
--      number itself is still nobody's to change), and the restrictive
--      "profiles: own-folder portrait, nothing while suspended" (a
--      suspended member changes nothing). Signed-out visitors write
--      nothing, as before. Nothing else is granted, and no policy changes.
--
-- The number itself is unchanged, and read as before: the admins'
-- Members list shows it, and a member's own welcome notice names it. The
-- app from build 53 draws it on a profile and a print only where
-- show_member_no is true, and treats a profile read without the column
-- (a database before this file) as hidden. A build before 53 draws it as
-- it always has.
--
-- What members notice (build 53): their number leaves their profile and
-- the prints they share, and the word MEMBER stays, until they turn on
-- "Show my member number" in Settings.
--
-- Order: after 0039. 0039 takes back every update on profiles and gives
-- back its own five columns, so 0039 run again after this file takes
-- this column away too (Settings then says it couldn't save the switch,
-- and puts it back): run this file again after it.
--
-- Proven by supabase/tests/20_member_number_0041.sql (npm run test:rls):
-- the column as it is made, members turning it on and off for themselves
-- and for nobody else, a suspended member and a visitor refused, the
-- number and every other guarded column still refused, the file applied
-- twice, and after 0039 again. supabase/tests/18_writes_0039.sql lists
-- this column among what members may write. Checked by verify script 12,
-- row 69.
--
-- lock_timeout, as in 0023: a lock not granted within five seconds stops
-- the file and undoes all of it. No begin or commit of its own: the SQL
-- editor, given the whole file, runs it in one transaction. Idempotent:
-- the column is added only if it is not there, and the grant is the same
-- the second time.
--
-- Rollback (members' choices are lost with the column):
--   revoke update (show_member_no) on public.profiles from authenticated;
--   alter table public.profiles drop column if exists show_member_no;
-- Build 53 then reads every number as hidden, and its switch says it
-- couldn't save.

set local lock_timeout = '5s';

alter table public.profiles
  add column if not exists show_member_no boolean not null default false;

comment on column public.profiles.show_member_no is
  'Whether the member''s number is shown on their profile and prints. Theirs to change (Settings); false unless they do.';

grant update (show_member_no) on public.profiles to authenticated;
