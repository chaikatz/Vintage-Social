-- VINTAGE · 0033 · a photograph a member reports leaves their own view
--
-- App Review's Guideline 1.2 asks for a way to filter objectionable
-- content. A member could report a photograph and block its author; the
-- photograph itself stayed in their feed, Explore and the author's grid
-- until an admin acted, and after, if the admin found nothing to remove.
--
-- Now a photograph a member has reported is not shown to that member
-- again: one restrictive read policy on posts, asked of the member's own
-- reports (the rows "reports: read own" already lets them read). It holds
-- whatever becomes of the report, open, resolved or dismissed, and it is
-- the member's own choice: nobody else's view changes. A member's own
-- photographs are never hidden from them, and admins see everything, as
-- they must to act on the report. Every read of photographs goes through
-- it (the feed, feed_page, Explore, grids, a photograph's own page, a
-- message or a notice that carries it), and so, through 0028, do its
-- comments, likes and tags, bar the member's own.
--
-- The member's reported photographs are read once a statement (an
-- InitPlan, through reports_reporter_idx, 0023), not once a row: a member
-- who has reported nothing pays one index probe a read, and each row is
-- checked against a list as long as their reports.
--
-- The app takes the photograph out of what is on screen the moment the
-- report is sent (app/report.tsx); this keeps it out of every read after.
--
-- lock_timeout, as in 0023. One policy; nothing else changes. No begin or
-- commit of its own. Idempotent.
--
-- Rollback:
--   drop policy if exists "posts: not what I reported" on public.posts;

set local lock_timeout = '5s';

drop policy if exists "posts: not what I reported" on public.posts;
create policy "posts: not what I reported" on public.posts
  as restrictive for select using (
    (select public.is_admin((select auth.uid())))
    or author_id = (select auth.uid())
    or id <> all (coalesce((
      select array_agg(r.post_id) from public.reports r
      where r.reporter_id = (select auth.uid()) and r.post_id is not null
    ), '{}'::uuid[]))
  );
