-- VINTAGE · proposed 0028 · comments, likes and tags are seen only with their photograph
--
-- NOT A MIGRATION YET. It changes what members may read, so it waits for
-- the owner's decision; it lives beside the tests, which apply it inside
-- a transaction and roll it back (supabase/tests/13_proposed_0028.sql),
-- and nothing applies it on its own. To adopt it: copy this file to
-- supabase/migrations/0028_comments_likes_tags_follow_the_photograph.sql,
-- then apply it to staging and production after 0023-0027, in the SQL
-- editor, as the others.
--
-- The gap. A photograph on a private account is seen only by its author,
-- their accepted followers and the admins ("posts: members read live").
-- But the rows hanging off it were never tied to it:
--   comments   "comments: members read live" - any member, any live comment
--   likes      "likes: members read" - any member, any like
--   post_tags  "post_tags: members read accepted" - any member, any accepted tag
-- The app only ever asks for these on a photograph the member can see,
-- so nothing on a screen shows them; but the API is open to any member
-- with their own session, and GET /rest/v1/comments?select=* returns
-- every live comment in the club - what was said, by whom, on which
-- private photograph - and the likes and tags say who was there. The
-- same goes for the photographs of a member who has blocked the reader,
-- and for photographs the admins have removed.
--
-- The change. One restrictive SELECT policy on each of the three tables:
-- a row is read only if its photograph can be read by the same member
-- (an exists on posts, which applies every posts policy - privacy,
-- blocks, removal, admins - as the member), or if the row is the
-- member's own:
--   comments   their own comment (author_id), so they can still delete it
--   likes      their own like (user_id), so they can still take it back
--   post_tags  a tag on them, or one they made (user_id, tagged_by), so
--              they can still accept, decline or remove it
-- Restrictive, so it narrows what the existing policies allow and never
-- widens it; admins read every photograph, so they still read every row.
-- Nothing else changes: no write policy, no column, no row.
--
-- What members would notice: nothing in the app (it asks only for rows on
-- photographs it shows, and for the member's own). What the API stops
-- answering: rows on photographs the member may not see.
--
-- Proven by supabase/tests/13_proposed_0028.sql: for each of nine
-- callers, what they read of each table afterwards is exactly what they
-- read before, less the rows whose photograph they cannot see and that
-- are not theirs; and their own likes, comments and tags on such a
-- photograph can still be removed, declined or taken back.
--
-- Cost. The exists is a primary-key lookup on posts per row read, with
-- the posts policies' once-a-statement reads (0023). The app's reads of
-- these tables are a photograph's comments, a page of previews, a
-- photograph's likers (at most 500) and the member's own rows.
--
-- lock_timeout, as in 0023 (creating a policy locks its table). No begin
-- or commit of its own, like the migrations. Idempotent.
--
-- Rollback:
--   drop policy if exists "comments: only with their photograph" on public.comments;
--   drop policy if exists "likes: only with their photograph" on public.likes;
--   drop policy if exists "post_tags: only with their photograph" on public.post_tags;

set local lock_timeout = '5s';

drop policy if exists "comments: only with their photograph" on public.comments;
create policy "comments: only with their photograph" on public.comments
  as restrictive for select using (
    author_id = (select auth.uid())
    or exists (select 1 from public.posts p where p.id = post_id)
  );

drop policy if exists "likes: only with their photograph" on public.likes;
create policy "likes: only with their photograph" on public.likes
  as restrictive for select using (
    user_id = (select auth.uid())
    or exists (select 1 from public.posts p where p.id = post_id)
  );

drop policy if exists "post_tags: only with their photograph" on public.post_tags;
create policy "post_tags: only with their photograph" on public.post_tags
  as restrictive for select using (
    user_id = (select auth.uid())
    or tagged_by = (select auth.uid())
    or exists (select 1 from public.posts p where p.id = post_id)
  );
