-- VINTAGE · undo 0038 (follows that respect private accounts), should it
-- ever be wanted
--
-- Puts follows back as 0037 left them: no trigger decides a new follow's
-- status, the followee can neither accept nor decline, every member reads
-- every follow, members may change any column of follows, counts count
-- every follow and every follow is filed in Activity as 'follow'. Rolling
-- back reopens the hole 0038 closes (any member could file themselves an
-- accepted follower of a private account) and stops Accept and Decline
-- working: do it only to undo a fault in 0038.
--
-- Then every profile's two counts are counted again as 0001's trigger
-- counts them, from every follow, requests included: 0001's trigger takes
-- one away for every follow removed, so a request it never counted,
-- withdrawn after the rollback, would leave a count one low.
--
-- Paste the whole file into the SQL editor and run it once: one run is
-- one transaction, and a lock not granted within five seconds stops it
-- and undoes all of it. No begin or commit of its own (the policy harness
-- runs it inside its own transaction: supabase/tests/17_follows_0038.sql,
-- which checks it leaves things exactly so, then applies 0038 again).
-- Leaves the schema private in place: 0023 made it, and its functions
-- live there.

set local lock_timeout = '5s';

-- 8, 7, 6: the request seen by its two members only; an account made
-- public letting its requests in; a request's notice leaving Activity.
drop policy if exists "follows: a request seen by its two members" on public.follows;
drop trigger if exists profiles_public_accepts_requests on public.profiles;
drop function if exists private.accept_requests_when_public();
drop trigger if exists follows_request_notice_gone on public.follows;
drop function if exists private.forget_follow_request();

-- 1: the status of a new follow, as the client sends it.
drop trigger if exists follows_status_from_followee on public.follows;
drop function if exists private.follow_status_from_followee();

-- 2, 3: the followee's accept and remove; members' update of every column.
drop policy if exists "follows: followee accepts" on public.follows;
drop policy if exists "follows: followee removes" on public.follows;
revoke update (status) on public.follows from authenticated;
grant update on public.follows to anon, authenticated;

-- 4, 5: counts and notices as 0001_schema.sql made them.
create or replace function public.bump_follow_counts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set following_count = following_count + 1 where id = new.follower_id;
    update public.profiles set follower_count = follower_count + 1 where id = new.followee_id;
    return new;
  else
    update public.profiles set following_count = greatest(0, following_count - 1) where id = old.follower_id;
    update public.profiles set follower_count = greatest(0, follower_count - 1) where id = old.followee_id;
    return old;
  end if;
end;
$$;

drop trigger if exists follows_count_trigger on public.follows;
create trigger follows_count_trigger
  after insert or delete on public.follows
  for each row execute function public.bump_follow_counts();

create or replace function public.notify_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity (recipient_id, actor_id, type)
  values (new.followee_id, new.follower_id, 'follow');
  return new;
end;
$$;

-- As 0018 left them: run by their triggers, nobody's to call.
revoke execute on function public.bump_follow_counts(), public.notify_follow() from public, anon, authenticated;

-- Counted again as 0001's trigger counts: every follow, requests included.
update public.profiles p
   set follower_count = c.followers, following_count = c.following
  from (
    select pr.id,
           (select count(*) from public.follows f where f.followee_id = pr.id)::int as followers,
           (select count(*) from public.follows f where f.follower_id = pr.id)::int as following
    from public.profiles pr
  ) c
 where c.id = p.id
   and (p.follower_count <> c.followers or p.following_count <> c.following);
