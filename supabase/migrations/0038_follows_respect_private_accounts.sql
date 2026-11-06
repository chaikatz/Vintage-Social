-- VINTAGE · 0038 · follows that respect private accounts
--
-- A follow of a private member is a request ('pending') until that member
-- accepts it, and only an accepted follow lets the follower read their
-- photographs and eras ("posts: members read live", "era_edits: members
-- read"). Until now the database took the follow's status from the
-- client:
--
--   * "follows: follow as self" asks only that the follower is the member
--     signed in and an active member, never what status they file, and
--     the column's default is 'accepted'. So any member could file
--     follows(themselves, a private member, 'accepted') with their own
--     session and read every photograph and era of that account with no
--     approval. The app did the same without anyone meaning to: follow()
--     read the followee's is_private first and, when that read failed (a
--     timeout on a bad connection), filed the follow as accepted.
--   * There was no UPDATE policy on follows, and the only DELETE policy
--     was the follower's own. A private member who tapped Accept or
--     Decline in Requests changed nothing, with no error (row-level
--     security filters the row out; it does not refuse the statement), and
--     the app reported success: a private account could let nobody in and
--     turn nobody away.
--   * bump_follow_counts counted every follow, requests included, and
--     notify_follow filed every follow as 'follow' ("started following
--     you"), never 'follow_request' ("asked to follow you", which Activity
--     and the push function already know and send to Requests).
--
-- This file, whatever build is on the phone (the one in TestFlight too):
--
-- 1. A member's new follow takes its status from the followee, whatever
--    the client sends: 'pending' when the followee's account is private,
--    'accepted' when it is not. A BEFORE INSERT trigger decides it,
--    through private.follow_status_from_followee(), which runs as its
--    owner (it reads the followee's is_private even where a policy would
--    hide their profile) with an empty search path, in the schema the API
--    does not publish, and which nobody may call. Row-level security
--    checks the row after the trigger has set it. Only a request made as
--    a member (auth.uid() set, as every request through the API with a
--    member's session is) is decided: the owner's own SQL in the editor
--    and the service role carry no member, and what they write stands
--    (the house seed, 08_house_accounts.sql, files house accounts'
--    follows of the club's private house accounts as accepted;
--    10_reviewer_account.sql the review account's follows). No row
--    already there changes.
-- 2. The followee accepts a request: "follows: followee accepts" lets the
--    member a follow is of change it from 'pending' to 'accepted', and
--    nothing else (never back, never another member's). UPDATE on follows
--    is granted on the status column alone, so neither side can rewrite
--    who follows whom (an accept that also changed follower_id could
--    file a stranger as A's follower and fill their Home with A's
--    photographs). Signed-out visitors may update nothing.
-- 3. The followee declines a request, or removes a follower: "follows:
--    followee removes" lets the member a follow is of delete it, beside
--    the follower's own "follows: unfollow as self". (A new policy, not a
--    rewrite of that one, so 0023's rollback, which puts back the
--    policies 0023 replaced, leaves both as they are.)
-- 4. Follower and following counts count accepted follows only: a request
--    counts nothing, and is counted when it is accepted (the count
--    trigger now also runs on an update of status). Then one recount of
--    every profile's two counts from accepted follows; it changes only a
--    profile whose counts are off (on production on 6 November, none: 0
--    pending follows, every count equal to its accepted follows).
-- 5. A request is filed in the followee's Activity as 'follow_request'
--    ("asked to follow you."; its push says the same and opens
--    Requests), an accepted follow as 'follow' as before. Accepting files
--    nothing: no notice type says "accepted your request", and 'follow'
--    sent to the follower would read "started following you", which
--    would be untrue; the follower's button reads Following the next
--    time it is read.
--
-- What members notice: a private member's Accept and Decline work, and a
-- private account's photographs open only to the members it accepted.
-- A tap on Follow of a private member in a build that thought the
-- account public (its read failed) files a request, not a follow.
--
-- Proven on the policy harness (npm run test:rls):
-- supabase/tests/17_follows_0038.sql, as a private member and the
-- members who follow or ask to follow them. Checked by verify script 12,
-- rows 40-45.
--
-- 0023's rollback (supabase/tests/0023_rollback.sql) leaves this file's
-- policies, grants and triggers as they are, and leaves the schema
-- private in place while this file's function is in it.
--
-- lock_timeout, as in 0023: a lock not granted within five seconds stops
-- the file and undoes all of it. No begin or commit of its own.
-- Idempotent.
--
-- Rollback (as 0037 left things; counts recounted as 0001 counted them):
--   drop trigger if exists follows_status_from_followee on public.follows;
--   drop function if exists private.follow_status_from_followee();
--   drop policy if exists "follows: followee accepts" on public.follows;
--   drop policy if exists "follows: followee removes" on public.follows;
--   grant update on public.follows to anon, authenticated;
--   drop trigger if exists follows_count_trigger on public.follows;
--   create trigger follows_count_trigger after insert or delete on public.follows
--     for each row execute function public.bump_follow_counts();
--   then apply bump_follow_counts() and notify_follow() as
--   0001_schema.sql made them (both still revoked from members, 0018).
--   Rolling back reopens the hole in 1 and stops Accept and Decline
--   working; do it only to undo a fault in this file.

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. a member's new follow: its status from the followee
-- ---------------------------------------------------------------------------
-- 0023 made the schema and its grants; made here too only so that this
-- file never stops on its absence.
create schema if not exists private;

create or replace function private.follow_status_from_followee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- No member: the owner's SQL or the service role. What it wrote stands.
  if (select auth.uid()) is null then
    return new;
  end if;
  new.status := case
    when exists (select 1 from public.profiles p where p.id = new.followee_id and p.is_private)
      then 'pending'
    else 'accepted'
  end;
  return new;
end
$$;

-- A trigger's function is run by the trigger, not called: nobody needs it
-- (a function made in a schema is executable by PUBLIC until taken away).
revoke execute on function private.follow_status_from_followee() from public, anon, authenticated;

drop trigger if exists follows_status_from_followee on public.follows;
create trigger follows_status_from_followee
  before insert on public.follows
  for each row execute function private.follow_status_from_followee();

-- ---------------------------------------------------------------------------
-- 2. the followee accepts: pending to accepted, the status column only
-- ---------------------------------------------------------------------------
drop policy if exists "follows: followee accepts" on public.follows;
create policy "follows: followee accepts" on public.follows
  for update
  using (followee_id = (select auth.uid()) and status = 'pending')
  with check (followee_id = (select auth.uid()) and status = 'accepted');

revoke update on public.follows from anon, authenticated;
grant update (status) on public.follows to authenticated;

-- ---------------------------------------------------------------------------
-- 3. the followee declines a request, or removes a follower
-- ---------------------------------------------------------------------------
drop policy if exists "follows: followee removes" on public.follows;
create policy "follows: followee removes" on public.follows
  for delete
  using (followee_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. counts: accepted follows only
-- ---------------------------------------------------------------------------
create or replace function public.bump_follow_counts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and old.status is not distinct from new.status
     and old.follower_id = new.follower_id and old.followee_id = new.followee_id then
    return null;
  end if;
  -- What the follow counted before (an update or a delete) is taken away ...
  if tg_op <> 'INSERT' then
    if old.status = 'accepted' then
      update public.profiles set following_count = greatest(0, following_count - 1) where id = old.follower_id;
      update public.profiles set follower_count = greatest(0, follower_count - 1) where id = old.followee_id;
    end if;
  end if;
  -- ... and what it counts now (an insert or an update) is added.
  if tg_op <> 'DELETE' then
    if new.status = 'accepted' then
      update public.profiles set following_count = following_count + 1 where id = new.follower_id;
      update public.profiles set follower_count = follower_count + 1 where id = new.followee_id;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists follows_count_trigger on public.follows;
create trigger follows_count_trigger
  after insert or delete or update of status on public.follows
  for each row execute function public.bump_follow_counts();

-- Once: every profile's counts from its accepted follows, where they differ.
update public.profiles p
   set follower_count = c.followers, following_count = c.following
  from (
    select pr.id,
           (select count(*) from public.follows f where f.followee_id = pr.id and f.status = 'accepted')::int as followers,
           (select count(*) from public.follows f where f.follower_id = pr.id and f.status = 'accepted')::int as following
    from public.profiles pr
  ) c
 where c.id = p.id
   and (p.follower_count <> c.followers or p.following_count <> c.following);

-- ---------------------------------------------------------------------------
-- 5. a request is a request in Activity
-- ---------------------------------------------------------------------------
create or replace function public.notify_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity (recipient_id, actor_id, type)
  values (new.followee_id, new.follower_id,
          case when new.status = 'pending' then 'follow_request' else 'follow' end);
  return new;
end;
$$;

-- As 0018 left them: run by their triggers, nobody's to call.
revoke execute on function public.bump_follow_counts(), public.notify_follow() from public, anon, authenticated;
