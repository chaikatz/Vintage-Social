-- VINTAGE · 0029 · a waitlisted or rejected application says so on the profile
--
-- decide_application wrote every decision to the applicant's profile
-- (0007): approved, waitlisted or rejected. When 0011 redefined it to
-- give house accounts no number, the profile update kept only its
-- approval branch, so since then an application waitlisted or rejected
-- has said so on the application and nowhere else: the profile stays at
-- "applied", the status the app's gate reads first, as if nobody had
-- looked at it. On production in November 2026, four profiles are at
-- "applied" whose latest application was rejected (and one has no
-- application at all, which this leaves alone).
--
-- The function, as 0011 left it, with the profile written for a waitlist
-- or a rejection again. Only a profile still outside the club is changed
-- ("applied", "waitlisted" or "rejected"): an old application decided late
-- never demotes a member let in since, by invitation or by an approval,
-- and never lifts or overrides a suspension. Approval is as before.
--
-- Then the profiles this left behind: a profile at "applied" whose latest
-- application was waitlisted or rejected is given that decision. Nothing
-- else is touched; a profile with no application, or whose latest
-- application is still pending, stays at "applied".
--
-- No table, column or policy changes. The function keeps its grants
-- (members may call it; it refuses anyone not an admin, as before). No
-- begin or commit of its own. Idempotent: run twice, the second run finds
-- nothing to repair.
--
-- Rollback: the function as 0011 defined it (copy it from
-- supabase/migrations/0011_house_accounts.sql and run it). The repaired
-- profiles keep their status; put one back with
--   update public.profiles set status = 'applied' where id = '<id>';
-- if that is ever wanted.

create or replace function public.decide_application(p_application_id uuid, p_decision text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_app   public.applications%rowtype;
  v_no    integer;
begin
  if not public.is_admin(v_admin) then
    raise exception 'Admins only';
  end if;
  if p_decision not in ('approved', 'waitlisted', 'rejected') then
    raise exception 'Invalid decision %', p_decision;
  end if;

  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'Application not found';
  end if;

  update public.applications
  set status = p_decision, decided_by = v_admin, decided_at = now()
  where id = p_application_id;

  -- A waitlist or a rejection is written to the profile too, as before
  -- 0011, but only to a profile still outside the club: never over a
  -- member let in since, or a suspension.
  if p_decision in ('waitlisted', 'rejected') then
    update public.profiles
    set status = p_decision
    where id = v_app.user_id
      and status in ('applied', 'waitlisted', 'rejected');
  end if;

  if p_decision = 'approved' then
    update public.profiles
    set status = 'approved',
        approved_at = coalesce(approved_at, now()),
        invite_quota = greatest(invite_quota, public.default_invite_quota())
    where id = v_app.user_id;

    v_no := public.assign_member_no(v_app.user_id);

    if v_no is not null then
      insert into public.activity (recipient_id, actor_id, type, message)
      values (
        v_app.user_id, null, 'moderation',
        case
          when v_no <= public.founding_member_limit()
            then 'Welcome to VINTAGE. You are founding member no. ' || lpad(v_no::text, 5, '0') || '.'
          else 'Welcome to VINTAGE. You are member no. ' || lpad(v_no::text, 5, '0') || '.'
        end
      );
    end if;
  end if;
end;
$$;

-- The profiles left at "applied" after their application was decided.
update public.profiles p
set status = a.status
from (
  select distinct on (user_id) user_id, status
  from public.applications
  order by user_id, created_at desc, id desc
) a
where a.user_id = p.id
  and p.status = 'applied'
  and a.status in ('waitlisted', 'rejected');
