-- VINTAGE · 0042 · a like is read by the member who made it and the
-- photograph's author, nobody else
--
-- The owner asked, after build 58, that the likes on a photograph be its
-- author's to see: how many, and who, under their own posts, and under
-- nobody else's. The app from this round shows the count, and who liked
-- it, on the member's own photographs only (src/utils/ownLikes.ts).
--
-- The gap. The app asked for the likers of the member's own photographs
-- only, but the database answered more: any member could read every like
-- on any photograph they may see ("likes: members read", 0023, narrowed
-- by 0018's block rule and 0028's "only with their photograph"), so
-- GET /rest/v1/likes?post_id=eq.<any photograph they see> named everyone
-- who liked it. Who liked whose photograph is the author's to know.
--
-- The change. One restrictive SELECT policy on public.likes: a member
-- reads a like only when it is their own (user_id), or when the
-- photograph is theirs (an exists on posts, read as the member, with the
-- photograph's author). Restrictive, so it narrows what the other read
-- policies allow and widens nothing; every one of them still holds:
--   "likes: members read" (0023)              an active member, still
--   "likes: not between blocked" (0018/0023)  none from across a block,
--                                             so an author does not read
--                                             the like of a member they
--                                             blocked, or who blocked them
--   "likes: only with their photograph" (0028) none on a photograph the
--                                             member may not see, bar
--                                             their own
-- and 0040's "likes: none across a block" still refuses a new like across
-- a block. No write policy, grant, column, function or row changes. The
-- admins read likes as members do now: their own, and those on their own
-- photographs (nothing the app's admin pages show reads a like).
--
-- Every reader of public.likes, and what this leaves it:
--   * the likers list (src/api/posts.ts fetchLikersPage, app/likes.tsx):
--     the member's own photograph only, so the author's exists: every
--     like on it, as before.
--   * "did I like these" (fetchMyLikes): the member's own likes, by
--     user_id, as before.
--   * a like and an unlike (likePost, unlikePost): the insert asks for no
--     row back, and the delete finds the member's own like (an update or
--     delete that names columns must also pass the read policies, and
--     user_id = the member does). 0040's insert check is unchanged.
--   * the like count (posts.like_count, bump_like_count) and the like's
--     notice (notify_like, then the push function): triggers that run as
--     their owner, past row-level security, as before. The push function
--     reads Activity, not likes, with its service key.
--   * a photograph deleted, an account deleted (delete_my_account):
--     cascades, and a function run as its owner, past row-level security.
--   * feed_page (0025) and every view of photographs read posts, never
--     likes; posts.like_count is a column of posts and is unchanged.
--   * the demo (src/demo/store.ts demoFetchLikers) answers as this does.
--   * the house seed, supabase/production's and supabase/staging's
--     scripts and verify script 12 run as the project's owner, past
--     row-level security.
--
-- What members notice (with the app of this round): nothing they could
-- see before is gone from a screen: no screen of the app showed anyone
-- else's likers. The build before it showed the count under every
-- photograph, which is posts.like_count and is unchanged by this file.
-- What the API stops answering: who liked a photograph that is not the
-- member's own, bar their own like.
--
-- Proven by supabase/tests/21_likes_0042.sql (npm run test:rls): the
-- photograph's author reads all its likers; a liker reads their own like
-- and no one else's; another member, an admin and a signed-out visitor
-- read none; a block still hides a like from the author; a like on a
-- photograph the member cannot see is still theirs to read and take
-- back; liking and unliking still work and the count follows them; and
-- the file applied twice. Checked by verify script 12, row 70.
--
-- Cost. The exists is a primary-key lookup on posts per like read, with
-- the posts policies' once-a-statement reads (0023), as 0028's is; the
-- member's own likes are found by user_id first. The likers list reads
-- fifty likes a page.
--
-- Order: after 0028. It needs nothing 0041 makes, and 0041 nothing of it.
--
-- lock_timeout, as in 0023 (creating a policy locks its table). No begin
-- or commit of its own: the SQL editor, given the whole file, runs it in
-- one transaction. Idempotent: the policy is dropped if it is there and
-- made again.
--
-- Rollback:
--   drop policy if exists "likes: the liker's and the author's" on public.likes;

set local lock_timeout = '5s';

drop policy if exists "likes: the liker's and the author's" on public.likes;
create policy "likes: the liker's and the author's" on public.likes
  as restrictive for select using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.posts p
      where p.id = post_id and p.author_id = (select auth.uid())
    )
  );
