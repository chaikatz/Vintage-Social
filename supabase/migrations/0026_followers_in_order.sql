-- VINTAGE · 0026 · a photograph's followers, read in pages that do not repeat work
--
-- When a member posts, the push function tells their followers, a page
-- of a thousand at a time (PostgREST stops at max_rows). It read each
-- page by offset, in follower order: "the accepted followers of this
-- author, ordered by follower, rows 4,000 to 4,999". No index held the
-- followers of an author in follower order (follows_pkey begins with the
-- follower; follows_followers_idx, 0023, keeps them newest first), so
-- every page read and sorted all of that author's followers again to
-- find its thousand: fifty pages for a member with 50,000 followers,
-- each reading all 50,000. The function now asks for the next thousand
-- after the last follower it told (keyset paging), and this index hands
-- them over in order, so each page reads a thousand rows and stops.
--
-- The push function reads with the service role, past row-level
-- security; no policy reads this index and no member's query changes.
--
-- At today's size the index builds in milliseconds; CREATE INDEX holds
-- off writes to follows (not reads) while it builds. On a much larger
-- club, build it first with CREATE INDEX CONCURRENTLY and the same name,
-- outside a transaction, and "if not exists" below then skips it.
-- lock_timeout, as in 0023: a lock not granted within five seconds stops
-- the run and undoes it, to be run again a little later.
--
-- One index. Nothing dropped, no row touched. No begin or commit of its
-- own, like the other migrations. Idempotent.
--
-- Rollback:
--   drop index if exists public.follows_followers_by_id_idx;

set local lock_timeout = '5s';

create index if not exists follows_followers_by_id_idx on public.follows (followee_id, follower_id)
  where status = 'accepted';
