-- VINTAGE · 0031 · a report outlives the member who filed it
--
-- reports.reporter_id was ON DELETE CASCADE (0001): when a member deleted
-- their account, every report they had filed was deleted with it, open
-- ones included. A member who reports harassment and then leaves took the
-- report with them, unread, and the Terms promise that reports are
-- reviewed within 24 hours.
--
-- Now a report stays when its reporter goes, with no reporter attached
-- (reporter_id becomes null, as reports.profile_id already does for the
-- member reported). It holds what was reported and why; nothing else of
-- the reporter's stays. The admins see it as reported by "unknown".
--
-- Who may do what is unchanged: "reports: file as self" still requires
-- reporter_id to be the member filing it, so a report with no reporter
-- arises only from a deletion; "reports: read own" matches no member for
-- one; the admins read every report, as before. The index on reporter_id
-- (0023) serves the deletion's update as it served its delete.
--
-- The Privacy Policy says today that the reports a member filed are
-- deleted with their account; its wording changes with this (the door
-- group's handoff, and tests/store-legal.test.ts holds the two together).
--
-- lock_timeout, as in 0023 (the constraint is rebuilt on reports and
-- checks profiles). No begin or commit of its own. Idempotent.
--
-- Rollback (reports already kept without a reporter must go first, as
-- the column cannot be made required again while one has none):
--   delete from public.reports where reporter_id is null;
--   alter table public.reports drop constraint if exists reports_reporter_id_fkey;
--   alter table public.reports add constraint reports_reporter_id_fkey
--     foreign key (reporter_id) references public.profiles (id) on delete cascade;
--   alter table public.reports alter column reporter_id set not null;

set local lock_timeout = '5s';

alter table public.reports alter column reporter_id drop not null;
alter table public.reports drop constraint if exists reports_reporter_id_fkey;
alter table public.reports add constraint reports_reporter_id_fkey
  foreign key (reporter_id) references public.profiles (id) on delete set null;
