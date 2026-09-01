-- VINTAGE · 0007 · membership numbers, founding members, inviter attribution
--
-- Every member gets a number when they are let in, and keeps it. Numbers
-- are handed out in order from 1 and are never reused, never edited and
-- never reassigned — suspending someone does not free their number, and
-- reinstating them does not give them a new one. The first ten thousand
-- carry FOUNDING MEMBER for the life of the account.
--
-- The number is assigned at exactly two moments, because those are the two
-- ways into VINTAGE: an admin approving an application, and a nomination
-- being redeemed.

create sequence if not exists public.member_no_seq as integer start with 1;

alter table public.profiles
  add column member_no integer unique,
  -- Who nominated them. Recorded permanently at the moment of joining,
  -- even if that member later leaves or is suspended.
  add column invited_by uuid references public.profiles (id) on delete set null;

create index profiles_member_no_idx on public.profiles (member_no);

-- The cut-off for founding membership. A function rather than a literal so
-- the number lives in one place if it is ever quoted elsewhere.
create or replace function public.founding_member_limit()
returns integer language sql immutable as $$ select 10000 $$;

/**
 * Give this member the next number, if they do not already have one.
 *
 * Idempotent on purpose: an account can be approved, suspended and
 * reinstated, and must come back with the number it started with. The
 * `member_no is null` guard is what makes the number permanent.
 */
create or replace function public.assign_member_no(p_user uuid)
returns integer
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_no integer;
begin
  select member_no into v_no from public.profiles where id = p_user for update;
  if v_no is not null then
    return v_no;
  end if;

  v_no := nextval('public.member_no_seq');
  update public.profiles set member_no = v_no where id = p_user;
  return v_no;
end;
$$;

-- ---------------------------------------------------------------------------
-- Approval assigns the number
-- ---------------------------------------------------------------------------
create or replace function public.decide_application(p_application_id uuid, p_decision text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_app public.applications%rowtype;
  v_new_status text;
  v_no integer;
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

  v_new_status := case p_decision
    when 'approved' then 'approved'
    when 'waitlisted' then 'waitlisted'
    else 'rejected'
  end;

  update public.profiles
  set status = v_new_status,
      approved_at = case when p_decision = 'approved' then coalesce(approved_at, now()) else approved_at end,
      invite_quota = case when p_decision = 'approved'
                          then greatest(invite_quota, public.default_invite_quota())
                          else invite_quota end
  where id = v_app.user_id;

  if p_decision = 'approved' then
    v_no := public.assign_member_no(v_app.user_id);
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
end;
$$;

-- ---------------------------------------------------------------------------
-- A redeemed nomination assigns the number and records who vouched
-- ---------------------------------------------------------------------------
create or replace function public.redeem_invite(p_code text)
returns boolean
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_invite public.invites%rowtype;
  v_no integer;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;

  select * into v_invite
  from public.invites
  where code = upper(trim(p_code)) and used_by is null
  for update;

  if not found then
    return false;
  end if;
  if v_invite.created_by = v_user then
    return false;
  end if;

  update public.invites
  set used_by = v_user, used_at = now()
  where id = v_invite.id;

  update public.profiles
  set status = 'approved',
      approved_at = coalesce(approved_at, now()),
      invite_quota = greatest(invite_quota, public.default_invite_quota()),
      invited_by = coalesce(invited_by, v_invite.created_by)
  where id = v_user;

  v_no := public.assign_member_no(v_user);

  insert into public.activity (recipient_id, actor_id, type, message)
  values (
    v_user, null, 'moderation',
    case
      when v_no <= public.founding_member_limit()
        then 'Welcome to VINTAGE. You are founding member no. ' || lpad(v_no::text, 5, '0') || '.'
      else 'Welcome to VINTAGE. You are member no. ' || lpad(v_no::text, 5, '0') || '.'
    end
  );

  -- The member who nominated them sees that it was taken up.
  insert into public.activity (recipient_id, actor_id, type, message)
  values (v_invite.created_by, v_user, 'moderation', 'Your nomination was accepted.');

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Neither column is the member's to edit
--
-- The existing policy already pinned role, status and invite_quota to their
-- stored values. Membership number and attribution join them: they are
-- assigned by the definer functions above and by nothing else.
-- ---------------------------------------------------------------------------
drop policy if exists "profiles: update own" on public.profiles;

create policy "profiles: update own" on public.profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select p.role from public.profiles p where p.id = auth.uid())
    and status = (select p.status from public.profiles p where p.id = auth.uid())
    and invite_quota = (select p.invite_quota from public.profiles p where p.id = auth.uid())
    and member_no is not distinct from
        (select p.member_no from public.profiles p where p.id = auth.uid())
    and invited_by is not distinct from
        (select p.invited_by from public.profiles p where p.id = auth.uid())
  );
