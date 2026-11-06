-- VINTAGE · 0028 · comments, likes and tags are seen only with their photograph
--
-- Tried first as a proposal beside the tests, now a migration: every read
-- the app makes of these three tables was checked against it (below), and
-- none loses anything it shows. Apply after 0023-0027, in the SQL editor,
-- as the others.
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
-- What members would notice: nothing in the app. Every read it makes of
-- these tables is of rows on a photograph it is showing, or of the
-- member's own rows: a photograph's comments and its preview comments
-- (asked through the photograph itself), its likers (the author's own
-- photograph), whether the member liked these photographs and where they
-- stand in these tags (their own rows, by user_id), the tags on a
-- photograph shown, and the photographs a member accepted being tagged in
-- (each read through the photograph itself, so one the reader cannot see
-- was already left out; now its tag row is too).
-- Activity reads none of the three: its rows name the photograph and are
-- read through posts. A member's own like, comment or tag on a photograph
-- they can no longer see (a private account they stopped following, a
-- block, a removal) is still theirs to read, take back, delete, decline
-- or remove. What the API stops answering: rows on photographs the member
-- may not see that are not theirs.
--
-- Proven by supabase/tests/13_photograph_rows_0028.sql: for each of nine
-- callers, what they read of each table with this is exactly what they
-- read without it, less the rows whose photograph they cannot see and
-- that are not theirs; and their own likes, comments and tags on such a
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
