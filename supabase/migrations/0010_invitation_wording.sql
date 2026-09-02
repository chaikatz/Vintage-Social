-- VINTAGE · 0010 · call them invitations
--
-- The app says "Invitations" everywhere now. Three strings live in the
-- database rather than the client and still said "nomination": two errors
-- from create_invite, and the note written into an inviter's Activity feed
-- when their invitation is taken up — which is the visible one.
--
-- These are the definitions currently in production, character for
-- character, with only those three strings changed. Nothing else about
-- either function moves: same signature, same SECURITY DEFINER, same
-- search_path, same logic, same grants (a `create or replace` keeps the
-- grants already made in 0008).

create or replace function public.create_invite()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    raise exception 'Only approved members can invite';
  end if;

  select invite_quota into v_quota from public.profiles where id = v_user;
  select count(*) into v_minted from public.invites where created_by = v_user;
  if v_minted >= v_quota then
    raise exception 'You have used all of your invitations';
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
$function$;

create or replace function public.redeem_invite(p_code text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  insert into public.activity (recipient_id, actor_id, type, message)
  values (v_invite.created_by, v_user, 'moderation', 'Your invitation was accepted.');

  return true;
end;
$function$;
