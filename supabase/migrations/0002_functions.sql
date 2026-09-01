-- VINTAGE · 0002 · RPCs
-- Membership decisions, invites, and admin moderation actions. All the
-- privileged writes go through these definer functions so RLS can stay
-- strict on the tables themselves.

-- Number of invitation codes a newly approved member receives.
create or replace function public.default_invite_quota()
returns integer language sql immutable as $$ select 3 $$;

create or replace function public.username_available(p_username text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select not exists (
    select 1 from public.profiles where username = lower(p_username)
  );
$$;

-- ---------------------------------------------------------------------------
-- Invites
-- ---------------------------------------------------------------------------
create or replace function public.generate_invite_code()
returns text
language plpgsql volatile set search_path = public
as $$
declare
  -- No 0/O or 1/I: codes get read out loud.
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text := '';
  i integer;
begin
  for i in 1..8 loop
    code := code || substr(alphabet, 1 + floor(random() * 32)::integer, 1);
    if i = 4 then
      code := code || '-';
    end if;
  end loop;
  return code;
end;
$$;

-- Mint one invite code, limited by the caller's quota.
create or replace function public.create_invite()
returns text
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_quota integer;
  v_minted integer;
  v_code text;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_active_member(v_user) then
    raise exception 'Only approved members can nominate';
  end if;

  select invite_quota into v_quota from public.profiles where id = v_user;
  select count(*) into v_minted from public.invites where created_by = v_user;
  if v_minted >= v_quota then
    raise exception 'You have used all of your nominations';
  end if;

  loop
    v_code := public.generate_invite_code();
    begin
      insert into public.invites (code, created_by) values (v_code, v_user);
      return v_code;
    exception when unique_violation then
      -- astronomically unlikely; try another code
    end;
  end loop;
end;
$$;

-- Redeem a code: marks it used and approves the caller immediately.
create or replace function public.redeem_invite(p_code text)
returns boolean
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_invite public.invites%rowtype;
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
      invite_quota = greatest(invite_quota, public.default_invite_quota())
  where id = v_user;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Applications: admin decisions
-- ---------------------------------------------------------------------------
create or replace function public.decide_application(p_application_id uuid, p_decision text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_app public.applications%rowtype;
  v_new_status text;
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
    insert into public.activity (recipient_id, actor_id, type, message)
    values (v_app.user_id, null, 'moderation', 'Welcome to VINTAGE. Your application was approved.');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Moderation: warnings, suspensions, removals, report resolution.
-- Every action is recorded in moderation_actions. None of these are ever
-- triggered automatically — they exist only behind the admin dashboard.
-- ---------------------------------------------------------------------------
create or replace function public.admin_warn_member(p_profile_id uuid, p_note text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
begin
  if not public.is_admin(v_admin) then
    raise exception 'Admins only';
  end if;
  insert into public.moderation_actions (admin_id, target_profile_id, action, note)
  values (v_admin, p_profile_id, 'warning', p_note);
  insert into public.activity (recipient_id, actor_id, type, message)
  values (p_profile_id, null, 'moderation', 'A note from the admins: ' || p_note);
end;
$$;

create or replace function public.admin_set_suspension(p_profile_id uuid, p_suspended boolean, p_note text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
begin
  if not public.is_admin(v_admin) then
    raise exception 'Admins only';
  end if;
  if p_profile_id = v_admin then
    raise exception 'You cannot suspend yourself';
  end if;

  update public.profiles
  set status = case when p_suspended then 'suspended' else 'approved' end
  where id = p_profile_id;

  insert into public.moderation_actions (admin_id, target_profile_id, action, note)
  values (v_admin, p_profile_id,
          case when p_suspended then 'suspension' else 'reinstatement' end,
          p_note);
end;
$$;

create or replace function public.admin_remove_post(p_post_id uuid, p_note text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_author uuid;
begin
  if not public.is_admin(v_admin) then
    raise exception 'Admins only';
  end if;
  select author_id into v_author from public.posts where id = p_post_id;
  if not found then
    raise exception 'Post not found';
  end if;

  update public.posts set removed_at = now(), removed_by = v_admin
  where id = p_post_id and removed_at is null;

  insert into public.moderation_actions (admin_id, target_profile_id, action, post_id, note)
  values (v_admin, v_author, 'post_removal', p_post_id, p_note);
  insert into public.activity (recipient_id, actor_id, type, message)
  values (v_author, null, 'moderation', 'One of your posts was removed by the admins: ' || p_note);
end;
$$;

create or replace function public.admin_remove_comment(p_comment_id uuid, p_note text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_author uuid;
begin
  if not public.is_admin(v_admin) then
    raise exception 'Admins only';
  end if;
  select author_id into v_author from public.comments where id = p_comment_id;
  if not found then
    raise exception 'Comment not found';
  end if;

  update public.comments set removed_at = now(), removed_by = v_admin
  where id = p_comment_id and removed_at is null;

  insert into public.moderation_actions (admin_id, target_profile_id, action, comment_id, note)
  values (v_admin, v_author, 'comment_removal', p_comment_id, p_note);
end;
$$;

create or replace function public.resolve_report(p_report_id uuid, p_status text, p_note text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
begin
  if not public.is_admin(v_admin) then
    raise exception 'Admins only';
  end if;
  if p_status not in ('resolved', 'dismissed') then
    raise exception 'Invalid status %', p_status;
  end if;

  update public.reports
  set status = p_status, resolution_note = p_note, resolved_by = v_admin, resolved_at = now()
  where id = p_report_id;
end;
$$;
