-- VINTAGE · 0032 · a report reaches the admins when it is filed
--
-- The Terms say reports are reviewed within 24 hours. Nothing told an
-- admin a report had been filed: it sat in the Reports screen until
-- someone happened to open it.
--
-- Now filing a report asks the push function to tell the admins, through
-- the path every other notice takes (push_event, 0017): a trigger after
-- each new report, and in supabase/functions/push a door for kind
-- "report" that claims the report once (reports.pushed_at, as
-- activity.pushed_at and posts.notified_at do), finds the approved
-- admins, and sends each of their devices "A report is waiting." with the
-- route /admin/reports. It says nothing of what was reported, or by whom:
-- a lock screen is not a place for that. Admins whose phones have push
-- turned off are not reached; the Reports screen is unchanged.
--
-- The function's new door is code in this repository (deployed with
-- `supabase functions deploy push`); until it is deployed, the deployed
-- function answers "Unknown kind" to these calls and nothing else
-- changes. Until this is applied, nothing calls it.
--
-- A trigger function run as its owner, as on_activity_push and
-- on_post_push are, and not callable through the API. One column, which
-- members cannot read (reports' policies: a member reads only their own
-- reports, and the column says only when the admins were told). No begin
-- or commit of its own. Idempotent.
--
-- Rollback:
--   drop trigger if exists reports_push_trigger on public.reports;
--   drop function if exists public.on_report_push();
--   alter table public.reports drop column if exists pushed_at;

set local lock_timeout = '5s';

alter table public.reports add column if not exists pushed_at timestamptz;

create or replace function public.on_report_push()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.push_event('report', new.id);
  return new;
end;
$$;

drop trigger if exists reports_push_trigger on public.reports;
create trigger reports_push_trigger
  after insert on public.reports
  for each row execute function public.on_report_push();

-- Nobody calls a trigger function through the API (0018).
revoke execute on function public.on_report_push() from public, anon, authenticated;
