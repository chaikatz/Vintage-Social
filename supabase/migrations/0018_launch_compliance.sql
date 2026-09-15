-- VINTAGE · 0018 · launch compliance
--
-- Two things the App Store asks of every app with accounts and other
-- people's photographs, and one round of tightening:
--
--   1. Blocking. A member may block another. From then on neither sees the
--      other's photographs, comments, likes, follows, tags, messages or
--      activity, and the blocked member cannot see the blocker's profile.
--      Enforced by RESTRICTIVE policies, which AND with the existing ones —
--      nothing already granted is widened, and no existing policy is edited.
--   2. Account deletion. A member may delete their own account from
--      Settings. The auth user is removed and everything cascades from it;
--      references that would otherwise keep the row alive are released
--      first. Membership numbers are untouched — a deleted member's number
--      is simply never reissued.
--   3. Trigger functions are no longer callable through the API.
--
-- Additive only: one table, two functions, restrictive policies, revokes.

-- ---------------------------------------------------------------------------
-- 1. blocks
-- ---------------------------------------------------------------------------
create table public.blocks (
  blocker_id  uuid not null references public.profiles (id) on delete cascade,
  blocked_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index blocks_blocked_idx on public.blocks (blocked_id);

alter table public.blocks enable row level security;

-- You see the blocks you made, and nothing of anyone else's.
create policy "blocks: own" on public.blocks
  for all using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

/** True when either of the two has blocked the other. Definer, so policies
 * on other tables can ask without the blocks policy getting in the way. */
create or replace function public.blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_a is not null and p_b is not null and exists (
    select 1 from public.blocks
    where (blocker_id = p_a and blocked_id = p_b)
       or (blocker_id = p_b and blocked_id = p_a)
  )
$$;

/** True when p_other has blocked p_me — the one direction a profile hides in. */
create or replace function public.blocked_by(p_me uuid, p_other uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_me is not null and p_other is not null and exists (
    select 1 from public.blocks where blocker_id = p_other and blocked_id = p_me
  )
$$;

revoke execute on function public.blocked_between(uuid, uuid), public.blocked_by(uuid, uuid) from public, anon;
grant execute on function public.blocked_between(uuid, uuid) to authenticated;
grant execute on function public.blocked_by(uuid, uuid) to authenticated;

-- Restrictive: a row is visible only if the permissive policies allow it AND
-- nobody in it has blocked the reader (or been blocked by them). Admins keep
-- their view for moderation.
create policy "posts: not between blocked" on public.posts
  as restrictive for select using (
    public.is_admin(auth.uid()) or not public.blocked_between(auth.uid(), author_id)
  );

create policy "comments: not between blocked" on public.comments
  as restrictive for select using (
    public.is_admin(auth.uid()) or not public.blocked_between(auth.uid(), author_id)
  );

create policy "likes: not between blocked" on public.likes
  as restrictive for select using (
    not public.blocked_between(auth.uid(), user_id)
  );

create policy "follows: not between blocked" on public.follows
  as restrictive for select using (
    not public.blocked_between(auth.uid(), follower_id)
    and not public.blocked_between(auth.uid(), followee_id)
  );

create policy "follows: no following across a block" on public.follows
  as restrictive for insert with check (
    not public.blocked_between(follower_id, followee_id)
  );

create policy "post_tags: not between blocked" on public.post_tags
  as restrictive for select using (
    not public.blocked_between(auth.uid(), user_id)
    and not public.blocked_between(auth.uid(), tagged_by)
  );

create policy "post_tags: no tagging across a block" on public.post_tags
  as restrictive for insert with check (
    not public.blocked_between(tagged_by, user_id)
  );

create policy "conversations: not between blocked" on public.conversations
  as restrictive for select using (
    not public.blocked_between(user_a, user_b)
  );

create policy "conversations: none across a block" on public.conversations
  as restrictive for insert with check (
    not public.blocked_between(user_a, user_b)
  );

create policy "messages: not between blocked" on public.messages
  as restrictive for select using (
    not public.blocked_between(auth.uid(), sender_id)
  );

create policy "messages: none across a block" on public.messages
  as restrictive for insert with check (
    not exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and public.blocked_between(c.user_a, c.user_b)
    )
  );

create policy "activity: not from blocked" on public.activity
  as restrictive for select using (
    actor_id is null or not public.blocked_between(auth.uid(), actor_id)
  );

-- A profile hides from the people it has blocked. The blocker still sees the
-- profiles they blocked — so they can find them again to unblock — and the
-- member always sees their own row.
create policy "profiles: hidden from those blocked" on public.profiles
  as restrictive for select using (
    id = auth.uid() or public.is_admin(auth.uid()) or not public.blocked_by(auth.uid(), id)
  );

/** Block a member. Follows between the two end, pending tags are withdrawn. */
create or replace function public.block_member(p_user uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
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

  delete from public.follows
  where (follower_id = v_me and followee_id = p_user)
     or (follower_id = p_user and followee_id = v_me);
  perform public.recount_follows(v_me, p_user);
  perform public.recount_follows(p_user, v_me);

  delete from public.post_tags
  where status = 'pending'
    and ((user_id = v_me and tagged_by = p_user) or (user_id = p_user and tagged_by = v_me));
end;
$$;

create or replace function public.unblock_member(p_user uuid)
returns void
language sql volatile security definer set search_path = public
as $$
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_user
$$;

revoke execute on function public.block_member(uuid), public.unblock_member(uuid) from public, anon;
grant execute on function public.block_member(uuid), public.unblock_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. account deletion
-- ---------------------------------------------------------------------------
/** Delete the calling member's account, for good.
 *
 * The auth user goes and everything of theirs cascades: profile, posts,
 * comments, likes, follows, tags, messages, tokens, preferences, invite
 * link. References that only point *at* the member from other people's
 * rows (who decided an application, who resolved a report, who removed a
 * post) are set to null so the history stays and the row can go. Their
 * files are removed by the app through the Storage API before this is
 * called; the rows here are removed as a backstop where the platform
 * allows it. The membership sequence is not touched.
 *
 * The only admin cannot delete themselves: the club would have no one to
 * let anyone in. */
create or replace function public.delete_my_account()
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;
  if exists (select 1 from public.profiles where id = v_user and role = 'admin')
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'You are the only admin. Make another member an admin before deleting this account.';
  end if;

  -- Release the references that would otherwise keep the row alive.
  update public.applications set decided_by = null where decided_by = v_user;
  update public.invites set used_by = null where used_by = v_user;
  update public.posts set removed_by = null where removed_by = v_user;
  update public.comments set removed_by = null where removed_by = v_user;
  update public.reports set resolved_by = null where resolved_by = v_user;
  -- Moderation actions taken *by* this member (as an admin) are kept, on
  -- the record, but the actor can no longer be a foreign key.
  delete from public.moderation_actions where admin_id = v_user
    and not exists (select 1 from public.profiles where id = target_profile_id and id <> v_user);
  update public.moderation_actions set admin_id = target_profile_id where admin_id = v_user;

  -- Files, where direct deletion is permitted; the app has already asked
  -- the Storage API to remove them.
  begin
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.objects where (storage.foldername(name))[1] = v_user::text;
  exception when others then
    null;
  end;

  delete from auth.users where id = v_user;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. tightening
-- ---------------------------------------------------------------------------
-- Trigger functions run as their owner when a row changes; nobody needs to
-- call them through the API.
revoke execute on function
  public.handle_new_user(),
  public.bump_post_count(),
  public.bump_follow_counts(),
  public.bump_like_count(),
  public.bump_comment_count(),
  public.notify_like(),
  public.notify_comment(),
  public.notify_follow(),
  public.notify_tag(),
  public.touch_conversation(),
  public.on_activity_push(),
  public.on_post_push()
from public, anon, authenticated;
