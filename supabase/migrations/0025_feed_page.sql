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
-- same member now reads no posts at all (under a millisecond); a typical
-- member's first page reads 105 posts (their authors') instead of
-- walking the club's; a member who follows the whole club reads 19 for a
-- page of 12. supabase/tests/09_scale_plans.sql checks each, and that
-- each page is the one the old read gave.
--
-- A page is asked for by where the last one ended, not by how many came
-- before it: the caller hands back the time and id of the last post they
-- hold (p_before_at, p_before_id), and the next page is the posts older
-- than that one, in the same order. Counted by offset, a post deleted
-- between two pages shifted every later post up by one, so the next page
-- began one post too far and that post was never shown; a post arriving
-- between two pages pushed the last one down onto the next page, shown
-- twice. From a post, neither can happen: whatever is added or taken away
-- above it, the next page starts right after it. And each page costs what
-- the first does, or less: the cursor is a condition on created_at that
-- both indexes start from. On the harness at 1,000 members, twenty pages
-- in, a member who follows the whole club reads 14 posts
-- (posts_feed_idx, from the cursor down) where the offset read 259; past
-- the end of a typical feed, 1 (the post held, through posts_author_idx)
-- where the offset read all 105 of its authors' to find none.
--
-- The app asks for it first and, where it is not there yet (a project
-- this file has not reached), falls back to the old two-step read, so
-- the build works before and after this is applied.
--
-- One function, its grants. No table, policy or row is touched. No begin
-- or commit of its own, like the other migrations. Idempotent. Applied
-- nowhere before it took a cursor; an earlier draft took an offset
-- (p_limit, p_offset), and is dropped if a project has it.
--
-- Rollback:
--   drop function if exists public.feed_page(integer, timestamptz, uuid);

drop function if exists public.feed_page(integer, integer);

create or replace function public.feed_page(
  p_limit     integer default 12,
  p_before_at timestamptz default null,
  p_before_id uuid default null
)
returns setof public.posts
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_authors uuid[];
  v_sql     text;
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
  v_sql := 'select p.* from public.posts p
      where p.removed_at is null
        and p.author_id = any ($1)';
  -- After the post the caller holds last: older, or as old with a
  -- smaller id (the order's own tie-break). Written so created_at <= $3
  -- stands alone, as a condition either index can start from.
  if p_before_at is not null then
    v_sql := v_sql || '
        and p.created_at <= $3
        and (p.created_at < $3 or p.id < $4)';
  end if;
  v_sql := v_sql || '
      order by p.created_at desc, p.id desc
      limit $2';

  return query execute v_sql
  using v_authors,
        least(greatest(coalesce(p_limit, 12), 1), 100),
        p_before_at,
        p_before_id;
end
$$;

-- Members only, in the manner of 0008: nothing is reachable unless listed.
revoke execute on function public.feed_page(integer, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.feed_page(integer, timestamptz, uuid) to authenticated;
