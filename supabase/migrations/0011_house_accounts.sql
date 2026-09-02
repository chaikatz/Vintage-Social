-- VINTAGE · 0011 · house accounts
--
-- A members' club with an empty Explore tab is a bad first impression, so
-- VINTAGE ships with a body of photography of its own. Those accounts are
-- house accounts: they post, they can be followed and searched, and they
-- are not people.
--
-- The one thing they must never do is take a membership number. Numbers are
-- permanent, sequential, and the whole point of "FOUNDING MEMBER NO. 00027"
-- is that no. 27 was the twenty-seventh person let in. If the house took
-- 2 through 151, the first real invitation would be no. 00152 and the
-- founding cohort would be mostly furniture. So:
--
--   * `is_house` marks them, and it is the only thing that marks them —
--     everything else about the row is an ordinary approved profile, which
--     is what makes them visible to the feed and search policies.
--   * assign_member_no refuses them and, crucially, refuses them *before*
--     touching the sequence. nextval() is not transactional: a number drawn
--     and then rolled back is still spent, and there is no way to put it
--     back.
--   * The self-update policy pins the flag, so a member cannot set it on
--     their own row.

alter table public.profiles
  add column if not exists is_house boolean not null default false;

-- Explore and search read these constantly; the partial index keeps the
-- "everyone real" and "everyone house" reads cheap.
create index if not exists profiles_house_idx on public.profiles (is_house)
  where is_house;

-- ---------------------------------------------------------------------------
-- numbering
-- ---------------------------------------------------------------------------
-- Identical to 0007 but for the guard, which comes first for the reason
-- above. Returns null rather than raising: a house account is not an error,
-- it simply has no number, and both callers already handle a null by
-- writing no welcome note.
create or replace function public.assign_member_no(p_user uuid)
returns integer
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_no    integer;
  v_house boolean;
begin
  select member_no, is_house into v_no, v_house
  from public.profiles where id = p_user for update;

  if v_house then
    return null;
  end if;
  if v_no is not null then
    return v_no;
  end if;

  v_no := nextval('public.member_no_seq');
  update public.profiles set member_no = v_no where id = p_user;
  return v_no;
end;
$$;

-- Both callers write a welcome note naming the number. With a null number
-- there is nothing to name, and nobody is reading a house account's
-- Activity tab anyway.
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

create or replace function public.redeem_invite(p_code text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user   uuid := auth.uid();
  v_invite public.invites%rowtype;
  v_no     integer;
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

  if v_no is not null then
    insert into public.activity (recipient_id, actor_id, type, message)
    values (
      v_user, null, 'moderation',
      case
        when v_no <= public.founding_member_limit()
          then 'Welcome to VINTAGE. You are founding member no. ' || lpad(v_no::text, 5, '0') || '.'
        else 'Welcome to VINTAGE. You are member no. ' || lpad(v_no::text, 5, '0') || '.'
      end
    );
  end if;

  insert into public.activity (recipient_id, actor_id, type, message)
  values (v_invite.created_by, v_user, 'moderation', 'Your invitation was accepted.');

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- a member cannot make themselves the house
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
    and is_house = (select p.is_house from public.profiles p where p.id = auth.uid())
  );
