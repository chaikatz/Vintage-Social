-- VINTAGE · undo 0039 (members write only what the app writes), should it
-- ever be wanted
--
-- Puts every privilege, policy and function 0039 changes back as 0038 left
-- them: signed-out visitors and members may again file and change every
-- column of the tables 0039 narrowed (the column grants 0039 made are
-- taken away first, so what is left is exactly what was there); the five
-- policies 0039 adds are dropped; join_with_invite, redeem_invite and
-- create_invite are again as 0012, 0011 and 0010 made them (in the
-- repository's wording: production's create_invite said "nominate" until
-- 0039, and comes back saying "invite"). Rolling back reopens every hole
-- 0039 closes (a removed photograph undone by its author, files and
-- portraits from anywhere, forged counts and dates, conversations and tags
-- moved, a suspension lifted by its member): do it only to undo a fault in
-- 0039, such as a write the app makes that is refused.
--
-- Untouched, as 0039 left them alone: UPDATE on follows (0038's, status
-- alone) and on messages (0021's, read_at alone); everything on era_edits
-- for members; DELETE and SELECT everywhere.
--
-- Paste the whole file into the SQL editor and run it once: one run is
-- one transaction, and a lock not granted within five seconds stops it
-- and undoes all of it. No begin or commit of its own (the policy harness
-- runs it inside its own transaction: supabase/tests/18_writes_0039.sql,
-- which checks it leaves things exactly so, then applies 0039 again).

set local lock_timeout = '5s';

-- The five policies.
drop policy if exists "posts: files from the author's own folder" on public.posts;
drop policy if exists "posts: a caption while live, by a member" on public.posts;
drop policy if exists "applications: a portrait from the applicant's own folder" on public.applications;
drop policy if exists "profiles: own-folder portrait, nothing while suspended" on public.profiles;
drop policy if exists "messages: read marks by the member they were sent to" on public.messages;

-- Every column grant 0039 made, taken away (taking back a table's
-- privilege takes it back from each column too), then the table's whole.
revoke insert, update on public.posts, public.profiles, public.applications, public.conversations,
  public.post_tags, public.comments, public.likes, public.reports, public.share_events, public.activity,
  public.app_settings, public.blocks, public.invite_links, public.invites, public.moderation_actions,
  public.post_shares from anon, authenticated;
grant insert, update on public.posts, public.profiles, public.applications, public.conversations,
  public.post_tags, public.comments, public.likes, public.reports, public.share_events, public.activity,
  public.app_settings, public.blocks, public.invite_links, public.invites, public.moderation_actions,
  public.post_shares to anon, authenticated;
revoke insert on public.follows, public.messages from anon, authenticated;
grant insert on public.follows, public.messages to anon, authenticated;
grant insert, update on public.notification_prefs, public.push_tokens to anon;

-- The three functions, as 0012, 0011 and 0010 made them (a create or
-- replace keeps their grants).
CREATE OR REPLACE FUNCTION public.join_with_invite(p_slug text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user  uuid := auth.uid();
  v_owner uuid;
  v_quota integer;
  v_used  integer;
  v_no    integer;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;

  select l.owner_id into v_owner
  from public.invite_links l where l.slug = lower(trim(coalesce(p_slug, '')));
  if v_owner is null then
    return false;
  end if;
  if v_owner = v_user then
    return false;
  end if;

  -- Lock the inviter so the count cannot move under us.
  select p.invite_quota into v_quota
  from public.profiles p where p.id = v_owner and p.status = 'approved'
  for update;
  if v_quota is null then
    return false;
  end if;

  select count(*)::integer into v_used from public.profiles c where c.invited_by = v_owner;
  if v_used >= v_quota then
    return false;
  end if;

  update public.profiles
  set status       = 'approved',
      approved_at  = coalesce(approved_at, now()),
      invite_quota = greatest(invite_quota, public.default_invite_quota()),
      invited_by   = coalesce(invited_by, v_owner)
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
  values (v_owner, v_user, 'moderation', 'Someone joined VINTAGE on your invitation.');

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.redeem_invite(p_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.create_invite()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

