-- VINTAGE · 0016 · invitations finished; places named by a provider
--
-- Invitations
--   * Five per member by default, and the default itself is an admin
--     setting rather than a number in a function body.
--   * Admins can grant a member more, one member at a time.
--   * Joining answers with a reason, not a boolean: the app can tell a
--     stranger's typo from a spent allowance, and a retry after success is
--     a no-op that says so instead of spending anything twice.
--
-- Places
--   * A post may carry the provider's identifier for the place it names,
--     alongside the name (`location`) and point (`lat`/`lng`) it already
--     has. Existing posts keep everything they have.
--
-- Additive only: one settings table, one column, new functions, one
-- function redefined to read the setting. Nothing weakened, no rows removed.
-- The one data change is deliberate and stated: approved members who still
-- held fewer than five invitations are brought up to five.

-- ---------------------------------------------------------------------------
-- app settings: a few numbers an admin may turn
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

alter table public.app_settings enable row level security;

-- Read by definer functions only; admins may read it directly for the panel.
create policy "app_settings: admins read" on public.app_settings
  for select using (public.is_admin(auth.uid()));

insert into public.app_settings (key, value)
values ('default_invite_quota', to_jsonb(5))
on conflict (key) do nothing;

/** The number every new member is given. Read from settings, so it is an
 * admin decision; five if nobody has decided. */
create or replace function public.default_invite_quota()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (value #>> '{}')::integer from public.app_settings where key = 'default_invite_quota'),
    5
  )
$$;

/** Admin: set the default for everyone who joins from now on. */
create or replace function public.admin_set_default_invite_quota(p_quota integer)
returns integer
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
begin
  if not public.is_admin(v_admin) then
    raise exception 'Admins only';
  end if;
  if p_quota is null or p_quota < 0 or p_quota > 1000 then
    raise exception 'The default must be between 0 and 1000.';
  end if;
  insert into public.app_settings (key, value, updated_at, updated_by)
  values ('default_invite_quota', to_jsonb(p_quota), now(), v_admin)
  on conflict (key) do update
    set value = excluded.value, updated_at = now(), updated_by = v_admin;
  return p_quota;
end;
$$;

/** Admin: give one member a new allowance. The member sees a note. */
create or replace function public.admin_set_invite_quota(p_profile_id uuid, p_quota integer)
returns integer
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_old   integer;
begin
  if not public.is_admin(v_admin) then
    raise exception 'Admins only';
  end if;
  if p_quota is null or p_quota < 0 or p_quota > 1000 then
    raise exception 'An allowance is between 0 and 1000.';
  end if;
  select invite_quota into v_old from public.profiles where id = p_profile_id for update;
  if v_old is null then
    raise exception 'No such member';
  end if;
  update public.profiles set invite_quota = p_quota where id = p_profile_id;
  insert into public.moderation_actions (admin_id, target_profile_id, action, note)
  values (v_admin, p_profile_id, 'warning', 'Invitations set to ' || p_quota || ' (was ' || v_old || ').');
  if p_quota > v_old then
    insert into public.activity (recipient_id, actor_id, type, message)
    values (p_profile_id, null, 'moderation',
      'The admins have given you ' || (p_quota - v_old) || ' more ' ||
      case when p_quota - v_old = 1 then 'invitation.' else 'invitations.' end);
  end if;
  return p_quota;
end;
$$;

-- Members already inside who held the old default are brought up to the new
-- one. Nobody is taken down; a member an admin gave more keeps more.
update public.profiles
set invite_quota = 5
where status = 'approved' and invite_quota < 5;

-- ---------------------------------------------------------------------------
-- joining, with a reason
-- ---------------------------------------------------------------------------
/**
 * Take up an invitation. Same rules as join_with_invite (which stays for
 * older builds), but answers with why, and is safe to call again:
 *
 *   'joined'         membership granted now; one invitation spent
 *   'already_member' the caller was already approved; nothing spent
 *   'unknown'        no link by that name (or its owner is not a member)
 *   'own'            the caller's own link
 *   'closed'         the owner's allowance is spent
 *
 * The inviter's row is locked for the check-and-spend, so two people on
 * the same link at the same moment cannot both take the last place. The
 * allowance is only ever counted from `invited_by`, which is only ever set
 * here, in the same statement that grants membership — so an invitation
 * cannot be spent without the join, nor the join happen without the spend.
 */
create or replace function public.redeem_invite_link(p_slug text)
returns text
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_status text;
  v_owner  uuid;
  v_quota  integer;
  v_used   integer;
  v_no     integer;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;

  select status into v_status from public.profiles where id = v_user;
  if v_status = 'approved' then
    return 'already_member';
  end if;
  if v_status = 'suspended' then
    raise exception 'This account is suspended';
  end if;

  select l.owner_id into v_owner
  from public.invite_links l where l.slug = lower(trim(coalesce(p_slug, '')));
  if v_owner is null then
    return 'unknown';
  end if;
  if v_owner = v_user then
    return 'own';
  end if;

  -- Lock the inviter so the count cannot move under us.
  select p.invite_quota into v_quota
  from public.profiles p where p.id = v_owner and p.status = 'approved'
  for update;
  if v_quota is null then
    return 'unknown';
  end if;

  select count(*)::integer into v_used from public.profiles c where c.invited_by = v_owner;
  if v_used >= v_quota then
    return 'closed';
  end if;

  update public.profiles
  set status       = 'approved',
      approved_at  = coalesce(approved_at, now()),
      invite_quota = greatest(invite_quota, public.default_invite_quota()),
      invited_by   = v_owner
  where id = v_user;

  -- An application, if one was filed, is settled by the invitation.
  update public.applications
  set status = 'approved', decided_at = coalesce(decided_at, now())
  where user_id = v_user and status in ('pending', 'waitlisted');

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
  values (v_owner, v_user, 'moderation', 'Someone joined VINTAGE on your invitation.');

  return 'joined';
end;
$$;

-- ---------------------------------------------------------------------------
-- places
-- ---------------------------------------------------------------------------
-- The provider's own identifier for the place a post names, so the same
-- restaurant is the same place on every post that chose it. Null for the
-- free text a member typed before places could be chosen, and for posts
-- that name no place at all.
alter table public.posts
  add column if not exists place_id text check (place_id is null or char_length(place_id) <= 200);

-- ---------------------------------------------------------------------------
-- grants, in the manner of 0008
-- ---------------------------------------------------------------------------
revoke execute on function
  public.default_invite_quota(),
  public.admin_set_default_invite_quota(integer),
  public.admin_set_invite_quota(uuid, integer),
  public.redeem_invite_link(text)
from public, anon, authenticated;

grant execute on function public.default_invite_quota()                   to authenticated;
grant execute on function public.admin_set_default_invite_quota(integer)  to authenticated;
grant execute on function public.admin_set_invite_quota(uuid, integer)    to authenticated;
grant execute on function public.redeem_invite_link(text)                 to authenticated;
