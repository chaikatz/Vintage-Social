-- VINTAGE · 0040 · a block holds for comments and likes, and reaches the
-- admins; a message is notified; portraits are pictures; the push
-- function's caller is the database
--
-- Six things, each its own section below.
--
--   1. Comments and likes across a block. Blocking hid each member's
--      comments and likes from the other (0018, read policies only), but
--      nothing stopped the member blocked from writing them: a comment or
--      a like on the blocker's photograph was filed, every other member
--      saw it under the photograph, and its notice (with the comment's
--      words) went to the blocker's lock screen, from someone they had
--      blocked and could no longer see, report or delete. Now a member's
--      comment or like on a photograph whose author they have blocked, or
--      who has blocked them, is refused: one restrictive INSERT policy on
--      each table, which narrows "comments: comment as self" and "likes:
--      like as self" and widens nothing. The policy asks one function,
--      private.post_across_a_block(post_id): it reads the photograph's
--      author and the blocks past row-level security, as it must (the
--      photograph of a member who blocked the caller is hidden from the
--      caller, so a check read through the posts policies would find
--      nothing and let the comment through). It answers only about the
--      caller, lives in private (which the API does not publish), and
--      members may run it only because the policies run as them, as with
--      0023's helpers.
--      Tags and messages already refuse a write across a block ("post_tags:
--      no tagging across a block", "messages: none across a block" with
--      "messages: send as self", which reads the conversation as the
--      sender, and a blocked pair's conversation is hidden from both), and
--      follows too ("follows: no following across a block"); nothing
--      changes there.
--   2. Notices across a block. As a second guard, the triggers that file a
--      like, a comment or a tag in Activity (notify_like, notify_comment,
--      notify_tag) file nothing when the two members are on either side of
--      a block, whoever wrote the row (a definer, a script). No notice, so
--      no push. Otherwise each is as it was.
--   3. A block reaches the admins. block_member also files a report about
--      the member blocked, as the member who blocked them, with the reason
--      "Blocked by a member", unless the block was there already or a
--      report of theirs about that member is still open. The report is an
--      ordinary one: the admins' Reports screen lists it (a member report,
--      with "View member"), 0032's trigger tells the admins' phones once
--      ("A report is waiting."), and it outlives its reporter (0031). A
--      report about a member hides nothing from the member who filed it
--      (0033 hides only a reported photograph). Only an active member's
--      block files one, as only an active member may file a report.
--   4. A message is notified. Settings has offered a Messages switch since
--      0017, and the push function a "message" notice, but nothing filed
--      one: a member heard of a new message only by opening the app. Now a
--      trigger after each new message files a 'message' row in Activity for
--      the other member of the thread (never for the sender, and never
--      across a block), which the existing trigger hands to the push
--      function: "<name> sent you a message.", opening the inbox, unless
--      that member turned Messages off (the function reads the switch, as
--      it does for every kind). Nothing of the message itself is in the
--      row or on the lock screen. The deployed function (version 2)
--      already sends it; no redeploy is needed for this. The Activity tab
--      leaves these rows out (src/api/activity.ts): a message is read in
--      the inbox, whose own unread count is the messages' read marks
--      (0037), not these rows.
--   5. The avatars bucket takes portraits only. Any signed-up account
--      (an applicant uploads a portrait before approval) could put files
--      of any type and any size in its own avatars folder, each served
--      publicly. The app uploads a 512-pixel JPEG there and nothing else
--      (src/api/media.ts prepareAvatar, as image/jpeg). Now the bucket
--      takes JPEG and PNG images up to 2 MB. The media and thumbnails
--      buckets are unchanged: only an active member may write to them,
--      and their limits are the platform's.
--   6. The push function knows its caller. push_event (0017) sends, with
--      each call, a header only the database knows (x-push-secret), when
--      the push hook has one ("secret" in app_settings.push_hook, set by
--      the owner, never in the repository). The push function, from its
--      version 3, refuses any call without it, so the public anon key no
--      longer lets anyone set off the day's On This Day early or announce
--      a photograph again. Until the hook has a secret, push_event sends
--      exactly what it sent before; version 2 ignores the header.
--      Order on production: this file; the secret set on the function
--      (PUSH_HOOK_SECRET) and in the hook; then version 3 (APP_STORE_LAUNCH.md,
--      step 4, item 5).
--
-- What members would notice: a like or comment on the photograph of a
-- member on the other side of a block is refused (the heart goes back;
-- the comments screen says "Couldn't post the comment"), where a screen
-- still held the photograph from before the block; a new message
-- reaches the other member's phone; a portrait that is not a picture is
-- refused. Nothing else.
--
-- Proven by supabase/tests/18_blocks_messages_files_0040.sql: a block
-- each way, as the members it is about, through the same policies,
-- grants and triggers the app and PostgREST go through; and the app's
-- own writes (a like, a comment, a tag, a message, a report, a block)
-- still made where no block stands. supabase/tests/08_policy_rewrite.sql
-- asks every table everything with these policies in place, under 0023's
-- policies and under the ones before them.
--
-- lock_timeout, as in 0023 (creating a policy or a trigger locks its
-- table). No begin or commit of its own: the SQL editor, given the whole
-- file, runs it in one transaction. Idempotent: create or replace, drop
-- policy and trigger if exists, grants that are the same the second time.
--
-- Rollback (each part as 0001-0038 left it):
--   drop policy if exists "comments: none across a block" on public.comments;
--   drop policy if exists "likes: none across a block" on public.likes;
--   drop function if exists private.post_across_a_block(uuid);
--   drop trigger if exists messages_notify_trigger on public.messages;
--   drop function if exists private.notify_message();
--   update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'avatars';
--   then notify_like, notify_comment (0001), notify_tag (0015), block_member
--   (0018) and push_event (0017) as those files wrote them, each run again
--   from its file's own text.

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. no comment or like across a block
-- ---------------------------------------------------------------------------
/**
 * True when the caller and the author of this photograph are on either
 * side of a block. Read past row-level security: the photograph of a
 * member who has blocked the caller is hidden from the caller. Answers
 * only about the caller; false when signed out or the photograph is gone.
 */
create or replace function private.post_across_a_block(p_post uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.posts p
    join public.blocks b
      on (b.blocker_id = p.author_id and b.blocked_id = (select auth.uid()))
      or (b.blocked_id = p.author_id and b.blocker_id = (select auth.uid()))
    where p.id = p_post
  )
$$;

-- As 0023's helpers: members only, because the policies run as them; the
-- API does not publish private, so nobody can call it from outside.
revoke execute on function private.post_across_a_block(uuid) from public, anon, authenticated;
grant execute on function private.post_across_a_block(uuid) to authenticated;

-- Restrictive: a comment or a like must pass these as well as the
-- permissive "as self" policies. For members (the only ones those admit).
drop policy if exists "comments: none across a block" on public.comments;
create policy "comments: none across a block" on public.comments
  as restrictive for insert to authenticated
  with check (not private.post_across_a_block(post_id));

drop policy if exists "likes: none across a block" on public.likes;
create policy "likes: none across a block" on public.likes
  as restrictive for insert to authenticated
  with check (not private.post_across_a_block(post_id));

-- ---------------------------------------------------------------------------
-- 2. no notice across a block
-- ---------------------------------------------------------------------------
create or replace function public.notify_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_author uuid;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  if v_author is not null and v_author <> new.user_id
     and not exists (
       select 1 from public.blocks b
       where (b.blocker_id = v_author and b.blocked_id = new.user_id)
          or (b.blocker_id = new.user_id and b.blocked_id = v_author)
     ) then
    insert into public.activity (recipient_id, actor_id, type, post_id)
    values (v_author, new.user_id, 'like', new.post_id);
  end if;
  return new;
end;
$$;

create or replace function public.notify_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_author uuid;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  if v_author is not null and v_author <> new.author_id
     and not exists (
       select 1 from public.blocks b
       where (b.blocker_id = v_author and b.blocked_id = new.author_id)
          or (b.blocker_id = new.author_id and b.blocked_id = v_author)
     ) then
    insert into public.activity (recipient_id, actor_id, type, post_id, comment_id)
    values (v_author, new.author_id, 'comment', new.post_id, new.id);
  end if;
  return new;
end;
$$;

create or replace function public.notify_tag()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.blocks b
    where (b.blocker_id = new.tagged_by and b.blocked_id = new.user_id)
       or (b.blocker_id = new.user_id and b.blocked_id = new.tagged_by)
  ) then
    insert into public.activity (recipient_id, actor_id, type, post_id)
    values (new.user_id, new.tagged_by, 'tag', new.post_id);
  end if;
  return new;
end;
$$;

-- As 0018 left them: run by their triggers, nobody's to call.
revoke execute on function public.notify_like(), public.notify_comment(), public.notify_tag()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. a block reaches the admins
-- ---------------------------------------------------------------------------
/** Block a member. Follows between the two end, pending tags are withdrawn,
 * and the admins are told, by a report about the member blocked. */
create or replace function public.block_member(p_user uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_new boolean;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if p_user is null or p_user = v_me then
    raise exception 'You cannot block yourself';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Member not found';
  end if;

  insert into public.blocks (blocker_id, blocked_id)
  values (v_me, p_user)
  on conflict do nothing;
  v_new := found;

  delete from public.follows
  where (follower_id = v_me and followee_id = p_user)
     or (follower_id = p_user and followee_id = v_me);
  perform public.recount_follows(v_me, p_user);
  perform public.recount_follows(p_user, v_me);

  delete from public.post_tags
  where status = 'pending'
    and ((user_id = v_me and tagged_by = p_user) or (user_id = p_user and tagged_by = v_me));

  -- The admins are told, through the reports queue and its notice (0032):
  -- once a block, not again while a report of this member's about them is
  -- open, and only for an active member, who alone may file a report.
  if v_new
     and public.is_active_member(v_me)
     and not exists (
       select 1 from public.reports r
       where r.reporter_id = v_me and r.target_type = 'profile'
         and r.profile_id = p_user and r.status = 'open'
     ) then
    insert into public.reports (reporter_id, target_type, profile_id, reason)
    values (v_me, 'profile', p_user, 'Blocked by a member');
  end if;
end;
$$;

-- As 0018 left it: members only.
revoke execute on function public.block_member(uuid) from public, anon;
grant execute on function public.block_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. a message is notified
-- ---------------------------------------------------------------------------
-- As its owner: a member may not file a row in another member's Activity.
create or replace function private.notify_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_other uuid;
begin
  select case when c.user_a = new.sender_id then c.user_b else c.user_a end
    into v_other
    from public.conversations c
   where c.id = new.conversation_id
     and new.sender_id in (c.user_a, c.user_b);
  if v_other is null or v_other = new.sender_id then
    return null;
  end if;
  -- Never across a block, whoever wrote the message.
  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = new.sender_id and b.blocked_id = v_other)
       or (b.blocker_id = v_other and b.blocked_id = new.sender_id)
  ) then
    return null;
  end if;
  -- Nothing of the message itself: who sent one, and to whom.
  insert into public.activity (recipient_id, actor_id, type)
  values (v_other, new.sender_id, 'message');
  return null;
end
$$;

-- A trigger's function is run by the trigger, not called (a function made
-- in a schema is executable by PUBLIC until taken away).
revoke execute on function private.notify_message() from public, anon, authenticated;

drop trigger if exists messages_notify_trigger on public.messages;
create trigger messages_notify_trigger
  after insert on public.messages
  for each row execute function private.notify_message();

-- ---------------------------------------------------------------------------
-- 5. the avatars bucket takes portraits only
-- ---------------------------------------------------------------------------
-- 2 MB: the app's portrait is a 512-pixel JPEG, a few hundred kilobytes at
-- most. JPEG and PNG: the app sends image/jpeg; nothing else is a picture
-- a profile shows.
update storage.buckets
   set file_size_limit = 2097152,
       allowed_mime_types = array['image/jpeg', 'image/png']
 where id = 'avatars';

-- ---------------------------------------------------------------------------
-- 6. the push function's caller is the database
-- ---------------------------------------------------------------------------
/** Post one event to the push function. Fire and forget: a failure here
 * must never fail the like or the comment that caused it. With the hook's
 * secret, when it has one, so the function knows the call is the
 * database's (0040). */
create or replace function public.push_event(p_kind text, p_id uuid)
returns void
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare
  v_hook jsonb := public.push_hook();
begin
  if v_hook is null or v_hook->>'url' is null or v_hook->>'key' is null then
    return;
  end if;
  perform net.http_post(
    url     := v_hook->>'url',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (v_hook->>'key')
    ) || case when coalesce(v_hook->>'secret', '') <> ''
              then jsonb_build_object('x-push-secret', v_hook->>'secret')
              else '{}'::jsonb
         end,
    body    := jsonb_build_object('kind', p_kind, 'id', p_id),
    timeout_milliseconds := 5000
  );
exception when others then
  -- A push that could not be asked for is a push that did not happen.
  null;
end;
$$;

-- As 0017 left it: the database's own.
revoke execute on function public.push_event(text, uuid) from public, anon, authenticated;
