-- VINTAGE · 0039 · members write only what the app writes
--
-- Supabase gives the API's two roles, anon and authenticated, INSERT and
-- UPDATE on every column of every table, and row-level security alone
-- decided what a member could write. Several policies ask only whose row
-- it is, never which columns change or what the row says, so with a
-- member's own session and the public key in the app, anyone could:
--
--   * undo an admin's removal of their photograph (set removed_at and
--     removed_by back to null), set its likes and comments to any number,
--     date it 2099 so it stays first in every Explore and every
--     follower's Home, or point it at another file, after review
--     ("posts: authors edit caption" asks only that it is the author's;
--     a suspended author could do all of it too);
--   * file a photograph whose media_path or thumb_path is any URL on the
--     internet, or another member's file, dated as they liked, so every
--     phone that drew it asked a stranger's server for it (and told it
--     the viewer's address), and the picture could change after an admin
--     had looked at it; and set their own portrait, or an application's,
--     to such a URL (an admin reviewing applications loaded it);
--   * set their own follower, following and photograph counts, approval
--     date, username or social handle, which the app never changes
--     ("profiles: update own" guards role, status, allowance, number,
--     inviter and house only); a suspended member could still change the
--     name, words and portrait the club sees;
--   * move a private conversation to a third member, who then read the
--     other party's messages while that party lost the thread
--     ("conversations: members touch own" asks only that the member
--     stays in it; the app never changes a conversation);
--   * move a tag of theirs onto any photograph as accepted, attributed to
--     that photograph's author ("post_tags: tagged decides" asks only
--     whose tag it is and the status);
--   * back-date or forward-date their comments, likes, follows, messages
--     (and mark them read for the other side), reports (and mark them
--     sent to the admins already, so no admin was told), share records,
--     and their own notices; re-target a block, or write rows of tables
--     the app writes only through functions.
--
-- And two old invitation functions, which the app has not called since
-- 14 September and which any member can still call:
--
--   * join_with_invite(slug) and redeem_invite(code) made the caller an
--     approved member without asking what they were: a suspended member
--     lifted their own suspension with any open link (or an unused code).
--     redeem_invite_link, which the app calls, already refuses them.
--   * create_invite() counted the codes a member had made without holding
--     anything, so two calls at once both passed the count; and it counted
--     codes apart from the members the link had let in, and redeem_invite
--     checked no allowance at all, so a member could let in their
--     allowance by link and as many again by code.
--
-- This file, whatever build is on the phone (every build since 14
-- September writes exactly these columns; the outbox's media keys have
-- been {member}/{post id}.{jpg|mp4|mov} since then):
--
-- 1. Table by table, members may file and change only the columns the
--    app sends (src/api/*.ts, read 8 November): grants are taken back
--    for the whole table and given again for those columns. Signed-out
--    visitors may file and change nothing in any table (they only ever
--    call functions). What the app writes through SECURITY DEFINER
--    functions (removals, counts, approvals, blocks, invitations, share
--    links, push receipts) and what the service role writes (the push
--    function's notified_at and pushed_at) do not use these grants and
--    are untouched; so is the owner's own SQL (the house seed,
--    08_house_accounts.sql, and 10_reviewer_account.sql). Every column
--    a member could write that is left out takes its default, or is set
--    by a trigger or a function as it always has been: a photograph's
--    created_at and notified_at, every count, every removal and every
--    decision. Reading is unchanged everywhere.
--      posts          file: the 17 columns of a new post (NewPost);
--                     change: caption
--      profiles       change: full_name, bio, avatar_url, city,
--                     is_private (made by a trigger, never filed)
--      applications   file: the 8 columns the Apply form sends
--      conversations  file: user_a, user_b; change: nothing
--      post_tags      file: post_id, user_id, tagged_by;
--                     change: status, decided_at
--      comments       file: post_id, author_id, body
--      likes          file: post_id, user_id
--      follows        file: follower_id, followee_id, status (0038
--                     decides the status; change: status, as 0038)
--      messages       file: conversation_id, sender_id, body, post_id
--                     (change: read_at, as 0021)
--      reports        file: the 7 columns of a report
--      share_events   file: kind, actor_id, post_id, token, format, theme
--      activity       change: read_at
--      app_settings, blocks, invite_links, invites, moderation_actions,
--      post_shares    nothing (functions write them)
--      era_edits, notification_prefs, push_tokens  as they were for
--                     members (the app's upserts write every column but
--                     a timestamp of the member's own row); nothing for
--                     visitors
-- 2. A photograph's files are in its author's own folder: a member's new
--    post names media_path, and thumb_path when it has one, as
--    {their id}/{file name}, one level down, never a URL and never
--    another member's file. A portrait is the same, on the profile and
--    on an application. (Restrictive policies, so they hold whatever
--    else allows the write. On production on 8 November every member's
--    photograph (241), portrait (3) and application portrait was already
--    in its owner's folder, so nothing there changes.)
-- 3. A caption changes only while the photograph is up and its author an
--    active member: a removed photograph's words stay as the admins left
--    them, and a suspended author changes nothing. A suspended member
--    changes nothing of their profile either (the club still sees it).
--    A read mark is set by the member a message was sent to, never by
--    its sender (the app marks only the other side's messages).
-- 4. join_with_invite and redeem_invite refuse a suspended account with
--    redeem_invite_link's words ('This account is suspended'), and leave
--    a member already in as they are, as redeem_invite_link does (false:
--    nothing taken up, nothing spent or filed; until now a member could
--    spend an inviter's allowance on themselves and notify them).
-- 5. One allowance for links and codes. create_invite holds the member's
--    row while it counts, so a second call waits for the first and
--    counts what it made, and it counts the members already let in, by
--    link or code, with the codes made and not yet used. redeem_invite
--    lets someone in only while the code's maker is an approved member
--    with room left in that same count, their row held, exactly as the
--    link does; a code once used stays used. (create_invite's wording
--    becomes the repository's, 'invite' for 'nominate', which production
--    still had.)
--
-- What members notice: nothing in the app. A request through the API
-- that writes anything else is refused: a column left out with
-- "permission denied", a file outside the member's folder or a caption
-- of a removed photograph as row-level security refuses.
--
-- Proven on the policy harness (npm run test:rls):
-- supabase/tests/18_writes_0039.sql, every hole above tried as a member
-- and refused, every write the app makes tried the same way and allowed,
-- the definer functions (admin removal and suspension, approvals,
-- invitation links, account deletion, blocks, tags, follows, read marks,
-- eras, push tokens) run as the members who call them, two create_invite
-- calls at once from two sessions, and the rollback below applied for
-- real and this file again over it. 08_policy_rewrite.sql asks every
-- member everything with these grants and policies in place, under 0023's
-- policies and the ones before them. Checked by verify script 12, rows
-- 49-60. It depends on nothing made after 0038 and makes nothing a later
-- file needs.
--
-- lock_timeout, as in 0023: a lock not granted within five seconds stops
-- the file and undoes all of it. No begin or commit of its own.
-- Idempotent: grants are taken back before they are given, every policy
-- is dropped if it exists before it is made, every function replaced.
--
-- Rollback: supabase/tests/0039_rollback.sql, pasted whole into the SQL
-- editor (one run, one transaction). It gives anon and authenticated
-- back every privilege this file takes away (exactly as 0038 left them),
-- drops the five policies, and puts back the three functions as 0010,
-- 0011 and 0012 left them. Rolling back reopens every hole above; do it
-- only to undo a fault in this file (a write the app makes that is
-- refused).

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. members file and change only the columns the app sends
-- ---------------------------------------------------------------------------
-- Taking back a table's privilege takes back the same privilege on each of
-- its columns too, so what is given after is all there is.

-- A photograph: filed with what the outbox sends (src/api/posts.ts,
-- NewPost); its caption changed from Edit caption (updateCaption).
revoke insert, update on public.posts from anon, authenticated;
grant insert (id, author_id, media_type, media_path, thumb_path, width, height, duration_seconds,
              filter_id, filter_baked, show_date_stamp, caption, taken_at, location, lat, lng, place_id)
  on public.posts to authenticated;
grant update (caption) on public.posts to authenticated;

-- A profile: made by handle_new_user when the account is; changed from
-- Settings (updateOwnProfile) and, at sign-up, its portrait.
revoke insert, update on public.profiles from anon, authenticated;
grant update (full_name, bio, avatar_url, city, is_private) on public.profiles to authenticated;

-- An application: filed once, from Apply (submitApplication).
revoke insert, update on public.applications from anon, authenticated;
grant insert (user_id, full_name, desired_username, avatar_url, social_handle, city, inviter, reason)
  on public.applications to authenticated;

-- A conversation: opened (openConversation), never changed by a member;
-- its last_message_at is touch_conversation's, as its owner.
revoke insert, update on public.conversations from anon, authenticated;
grant insert (user_a, user_b) on public.conversations to authenticated;

-- A tag: filed by the photograph's author (tagMembers); decided by the
-- member tagged (decideTag).
revoke insert, update on public.post_tags from anon, authenticated;
grant insert (post_id, user_id, tagged_by) on public.post_tags to authenticated;
grant update (status, decided_at) on public.post_tags to authenticated;

-- A comment and a like (addComment, likePost).
revoke insert, update on public.comments from anon, authenticated;
grant insert (post_id, author_id, body) on public.comments to authenticated;
revoke insert, update on public.likes from anon, authenticated;
grant insert (post_id, user_id) on public.likes to authenticated;

-- A follow (follow; its status is the followee's, 0038). Its update is
-- 0038's, status alone, and stays.
revoke insert on public.follows from anon, authenticated;
grant insert (follower_id, followee_id, status) on public.follows to authenticated;

-- A message (sendMessage). Its update is 0021's, read_at alone, and stays.
revoke insert on public.messages from anon, authenticated;
grant insert (conversation_id, sender_id, body, post_id) on public.messages to authenticated;

-- A report (submitReport) and a share record (recordShareEvent).
revoke insert, update on public.reports from anon, authenticated;
grant insert (reporter_id, target_type, post_id, comment_id, profile_id, reason, details)
  on public.reports to authenticated;
revoke insert, update on public.share_events from anon, authenticated;
grant insert (kind, actor_id, post_id, token, format, theme) on public.share_events to authenticated;

-- A notice: filed by the triggers and functions, as their owner; marked
-- read by its member (markActivityRead).
revoke insert, update on public.activity from anon, authenticated;
grant update (read_at) on public.activity to authenticated;

-- Written only through functions, as their owner: settings
-- (admin_set_default_invite_quota), blocks (block_member,
-- unblock_member), invitation links (ensure_invite_link and the rest),
-- codes (create_invite, redeem_invite), the admins' record, share links
-- (create_post_share, revoke_post_share).
revoke insert, update on public.app_settings, public.blocks, public.invite_links, public.invites,
  public.moderation_actions, public.post_shares from anon, authenticated;

-- A member's own eras, notification settings and phones: the app's
-- upserts write every column of them but a timestamp of the member's own
-- row, so members keep what they had. Signed-out visitors, nothing.
revoke insert, update on public.era_edits, public.notification_prefs, public.push_tokens from anon;

-- ---------------------------------------------------------------------------
-- 2. a photograph's files, and a portrait, from the member's own folder
-- ---------------------------------------------------------------------------
-- {member id}/{file name}: the folder the storage policies let a member
-- upload into, one level down, and a name that cannot climb out of it.
drop policy if exists "posts: files from the author's own folder" on public.posts;
create policy "posts: files from the author's own folder" on public.posts
  as restrictive for insert
  with check (
    media_path ~ ('^' || (select auth.uid())::text || '/[A-Za-z0-9_-][A-Za-z0-9._-]*$')
    and (thumb_path is null
         or thumb_path ~ ('^' || (select auth.uid())::text || '/[A-Za-z0-9_-][A-Za-z0-9._-]*$'))
  );

drop policy if exists "applications: a portrait from the applicant's own folder" on public.applications;
create policy "applications: a portrait from the applicant's own folder" on public.applications
  as restrictive for insert
  with check (
    avatar_url is null
    or avatar_url ~ ('^' || (select auth.uid())::text || '/[A-Za-z0-9_-][A-Za-z0-9._-]*$')
  );

-- ---------------------------------------------------------------------------
-- 3. a caption while the photograph is up; a profile while not suspended;
--    a read mark by the member a message was sent to
-- ---------------------------------------------------------------------------
drop policy if exists "posts: a caption while live, by a member" on public.posts;
create policy "posts: a caption while live, by a member" on public.posts
  as restrictive for update
  using (removed_at is null and (select public.is_active_member((select auth.uid()))))
  with check (removed_at is null and (select public.is_active_member((select auth.uid()))));

drop policy if exists "profiles: own-folder portrait, nothing while suspended" on public.profiles;
create policy "profiles: own-folder portrait, nothing while suspended" on public.profiles
  as restrictive for update
  using (status <> 'suspended')
  with check (
    status <> 'suspended'
    and (avatar_url is null
         or avatar_url ~ ('^' || (select auth.uid())::text || '/[A-Za-z0-9_-][A-Za-z0-9._-]*$'))
  );

drop policy if exists "messages: read marks by the member they were sent to" on public.messages;
create policy "messages: read marks by the member they were sent to" on public.messages
  as restrictive for update
  using (sender_id <> (select auth.uid()))
  with check (sender_id <> (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 4 and 5. the old invitation functions
-- ---------------------------------------------------------------------------
-- As 0012 made it, and: a suspended account is refused, and a member
-- already in is left as they are, as redeem_invite_link (0016) does.
create or replace function public.join_with_invite(p_slug text)
returns boolean
language plpgsql
security definer
set search_path = public
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
    return false;
  end if;
  if v_status = 'suspended' then
    raise exception 'This account is suspended';
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
$$;

-- As 0011 made it, and: a suspended account is refused and a member
-- already in left as they are (4); a code never used before, whose maker
-- is an approved member with room left, counted as the link counts, with
-- their row held (5).
create or replace function public.redeem_invite(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_status text;
  v_invite public.invites%rowtype;
  v_quota  integer;
  v_used   integer;
  v_no     integer;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;

  select status into v_status from public.profiles where id = v_user;
  if v_status = 'approved' then
    return false;
  end if;
  if v_status = 'suspended' then
    raise exception 'This account is suspended';
  end if;

  select * into v_invite
  from public.invites
  where code = upper(trim(p_code)) and used_by is null and used_at is null
  for update;

  if not found then
    return false;
  end if;
  if v_invite.created_by is null or v_invite.created_by = v_user then
    return false;
  end if;

  -- Lock the code's maker so the count cannot move under us: one
  -- allowance, the link's, whichever way someone comes in.
  select p.invite_quota into v_quota
  from public.profiles p where p.id = v_invite.created_by and p.status = 'approved'
  for update;
  if v_quota is null then
    return false;
  end if;

  select count(*)::integer into v_used from public.profiles c where c.invited_by = v_invite.created_by;
  if v_used >= v_quota then
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

-- As 0010 made it, and: the member's row held while counting (a second
-- call waits, and counts this one's code); one allowance, the members let
-- in by link or code and the codes not yet used (5).
create or replace function public.create_invite()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_quota integer;
  v_spent integer;
  v_code  text;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_active_member(v_user) then
    raise exception 'Only approved members can invite';
  end if;

  select invite_quota into v_quota from public.profiles where id = v_user for update;

  select (select count(*) from public.profiles c where c.invited_by = v_user)
       + (select count(*) from public.invites i
           where i.created_by = v_user and i.used_by is null and i.used_at is null)
    into v_spent;
  if v_spent >= v_quota then
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
$$;
