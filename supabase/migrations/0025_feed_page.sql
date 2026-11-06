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
language sql
stable
security invoker
set search_path = public
as $$
  select p.*
  from public.posts p
  where p.removed_at is null
    and (
      p.author_id = (select auth.uid())
      or p.author_id in (
        select f.followee_id
        from public.follows f
        where f.follower_id = (select auth.uid())
          and f.status = 'accepted'
      )
    )
  order by p.created_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 12), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- Members only, in the manner of 0008: nothing is reachable unless listed.
revoke execute on function public.feed_page(integer, integer) from public, anon, authenticated;
grant execute on function public.feed_page(integer, integer) to authenticated;
