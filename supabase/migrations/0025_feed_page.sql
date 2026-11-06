-- VINTAGE · 0025 · the home feed, asked for in one piece
--
-- The app built the home feed by reading the list of members the caller
-- follows, then asking for posts whose author is in that list. The list
-- travels in the request's URL, one uuid per member followed, and URLs
-- have a ceiling (commonly 8 KB): somewhere past two hundred follows,
-- the request is refused and the home feed of an engaged member stops
-- loading altogether - the more they use the club, the sooner. The list
-- was also read through PostgREST's max_rows, so past a thousand follows
-- the rest went missing from the feed without a word.
--
-- feed_page asks the same question inside the database: the caller's own
-- posts and those of everyone they follow (accepted follows), live ones
-- only, newest first, a page at a time. It is SECURITY INVOKER: it runs
-- as the member calling it, so every policy on posts and follows applies
-- exactly as it does to the app's own query - private accounts, blocks,
-- suspended members, all of it. It adds nothing anyone may see. Ties in
-- time are broken by id, so a page boundary never shows a post twice or
-- skips one when two were posted in the same instant.
--
-- How it is asked matters as much as what. Written as one SQL statement
-- ("author is me, or in the subquery of whom I follow"), the planner
-- cannot know how many authors that is, so it walks every live post in
-- the club newest first and tests each against the list until the page
-- is full. For a member who follows a busy club that stops quickly; for
-- a new member who follows three people, and at the end of anyone's
-- feed, it reads every post there is. On the policy harness at 1,000
-- members (6,679 posts), a member who follows nobody read 6,611 posts
-- in 38 ms to find none; with ten times the posts, 66,611 in 114 ms. It
-- grows with the whole club. So the function first reads the
-- caller's follows into a list, then plans the posts query with that
-- list in hand (EXECUTE ... USING plans each call with the values): a
-- short list is read author by author through posts_author_idx, a long
-- one by the walk through posts_feed_idx, whichever reads less. The
-- same member now reads no posts at all (under a millisecond); past the
-- end of a typical feed, 105 posts (their authors') instead of 6,611; a
-- member who follows the whole club still reads 13 for a page of 12.
-- supabase/tests/09_scale_plans.sql checks all three, and that each page
-- is the one the old read gave.
--
-- The app asks for it first and, where it is not there yet (a project
-- this file has not reached), falls back to the old two-step read, so
-- the build works before and after this is applied.
--
-- One function, its grants. No table, policy or row is touched. No begin
-- or commit of its own, like the other migrations. Idempotent.
--
-- Rollback:
--   drop function if exists public.feed_page(integer, integer);

create or replace function public.feed_page(p_limit integer default 12, p_offset integer default 0)
returns setof public.posts
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_authors uuid[];
begin
  if v_me is null then
    return;
  end if;

  -- Who the caller follows, through follows' own policies, as before.
  select coalesce(array_agg(f.followee_id), '{}'::uuid[]) || v_me
    into v_authors
  from public.follows f
  where f.follower_id = v_me
    and f.status = 'accepted';

  -- Planned with the list itself (EXECUTE plans each call afresh, with
  -- the values in hand), so the planner sees how many authors and how
  -- many posts: a few authors are read through posts_author_idx, many
  -- by walking posts_feed_idx newest first until the page is full.
  return query execute
    'select p.* from public.posts p
      where p.removed_at is null
        and p.author_id = any ($1)
      order by p.created_at desc, p.id desc
      limit $2 offset $3'
  using v_authors,
        least(greatest(coalesce(p_limit, 12), 1), 100),
        greatest(coalesce(p_offset, 0), 0);
end
$$;

-- Members only, in the manner of 0008: nothing is reachable unless listed.
revoke execute on function public.feed_page(integer, integer) from public, anon, authenticated;
grant execute on function public.feed_page(integer, integer) to authenticated;
