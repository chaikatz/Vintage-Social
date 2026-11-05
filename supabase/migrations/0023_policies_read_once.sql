-- VINTAGE · 0023 · every policy asks who you are once, not once a row
--
-- Explore took 119 ms on average in production in November 2026, 486 at
-- worst, with 161 members and 1,139 photographs; on the policy harness,
-- at 1,000 members and 6,600 photographs, the same query takes 600 ms.
-- It grows with the club, not with the page: carried on in a straight
-- line, it passes the 8-second statement timeout somewhere past 13,000
-- members, and Explore stops loading for everyone. Nothing about the
-- query is wrong. The policies are.
--
-- A policy is an expression PostgreSQL evaluates for every row it looks
-- at. Written as `auth.uid()`, the caller's id is re-read for each row,
-- and the JWT it lives in is re-parsed each time; written as
-- `public.is_active_member(auth.uid())`, a lookup in profiles runs for
-- each row; and `public.blocked_between(auth.uid(), author_id)` runs a
-- SECURITY DEFINER function, with its own search_path switch, for each
-- row. Worst of all, "posts: members read live" asks whether the caller
-- follows the author, and the planner answers that by reading every row
-- of follows in the club and putting each through follows' own policies
-- - two blocked_between calls and a membership lookup per row - before
-- hashing the result. That is the 600 ms, and it is O(every follow
-- anyone has ever made), on every Explore, every profile, every feed.
--
-- So, for every policy that reads the caller (65 in public and the 8 on
-- storage.objects):
--
--   * auth.uid() becomes (select auth.uid()), and is_admin(...),
--     is_active_member(...) become (select public.is_admin(...)): an
--     InitPlan, evaluated once per statement, the first time a row needs
--     it. The value is the same for every row of a statement (these are
--     STABLE functions: one statement, one snapshot, one answer), so
--     nothing any policy allows or refuses changes.
--
--   * The update policy on profiles compared the new row with the stored
--     one through six subqueries on profiles. PostgreSQL refuses a policy
--     on a table that reads that same table through a subquery once the
--     table's read policies hold a subquery too (42P17, recursion), which
--     they now do; so the comparison moves into own_profile_unchanged(),
--     which reads the caller's stored row directly. Same answer: the
--     subqueries read that row through the read policies, and "read own"
--     always lets a member read their own row.
--
--   * "no row involving someone on the other side of a block" asked
--     blocked_between(me, them) per row. It now asks, once per statement,
--     for the members on the other side of a block with the caller
--     (my_block_partners) and tests membership in that list; the profile
--     policy, which hides a blocker from the member they blocked, asks
--     for the members who blocked the caller (my_blockers). Same answer
--     for every row: blocked_between(me, x) is true exactly when x is in
--     my_block_partners(), and blocked_by(me, x) exactly when x is in
--     my_blockers(), for any signed-in caller and any x; for a signed-out
--     caller both are false and both lists are empty. Neither function
--     takes an argument, so neither can be asked about anyone else, and
--     neither tells a member anything blocked_by(me, x) could not
--     already: anon may call neither, as with blocked_between.
--     The policies that compare two columns of the row (a conversation's
--     pair, who follows whom, who tags whom) are checks on a single
--     write or a member's own few threads, read no caller, and are left
--     exactly as they are.
--
-- Permissive policies stay as they are. PostgreSQL already ORs the
-- permissive policies for a command into one expression and stops at the
-- first that holds; with the caller read once, "admins read all" and
-- "authors read own" cost one comparison a row, and merging them would
-- buy next to nothing while renaming policies that earlier migrations,
-- scripts and tests refer to by name - and a later migration that drops
-- one of them by name, to take a permission away, would then quietly
-- take nothing away. The advisor's "multiple permissive policies" notes
-- are therefore expected to remain, and are harmless.
--
-- Indexes, for the foreign keys that are looked up when something is
-- deleted, and for the reads that are hot:
--
--   * Deleting a photograph cascades to activity (post_id), and sets
--     null on messages, reports, moderation_actions and share_events
--     (post_id). None of those columns had an index, so every deletion
--     read the whole of each table: production's activity table shows 81
--     sequential scans reading 1.26 million rows, against 66 deletions.
--     Deleting an account does the same across a dozen columns.
--   * profiles.invited_by is counted on every invitation page, every join
--     and every Invitations screen (how many has this member brought in);
--     it was a scan of every profile.
--   * likes by member (account deletion, and "did I like these"), the
--     followers list newest first, a post's likers newest first, unread
--     Activity, private members (asked by every posts policy check), and
--     photographs by capture date for the daily On This Day notice.
--   Partial where the column is mostly null, so they stay small. Nothing
--   is dropped.
--
-- At today's size every CREATE INDEX here takes milliseconds, so plain
-- CREATE INDEX inside the migration's transaction is fine: it holds a
-- write lock on each table only while that index builds. On a club a
-- hundred times larger, build them first, one at a time, outside a
-- transaction, with CREATE INDEX CONCURRENTLY and the same names (the
-- "if not exists" below then skips them), and apply this file after.
--
-- No begin or commit of its own, like the other migrations: the runner
-- applies each file in one transaction, so no table is ever without its
-- policies, even for a moment. Idempotent: drop policy if exists before
-- each create, create index if not exists, create or replace function.
--
-- Proven on the policy harness (npm run test:rls):
--   supabase/tests/08_policy_rewrite.sql  every member, signed-out
--     visitor and admin, against every table, reading, inserting,
--     updating and deleting every row: the same answers under these
--     policies as under the ones they replace, which the harness keeps
--     from just before this file ran.
--   supabase/tests/09_scale_plans.sql  the plans, at 1,000 members:
--     Explore 600 ms before this file, about 3-7 ms after; searching
--     names 53 ms before, 2-3 after; a member's followers 10 before, 3-4
--     after (this machine, not the database server: the ratio is the
--     point, not the milliseconds).
--   supabase/tests/10_rollback_0023.sql  the rollback, for real.
--
-- Rollback: supabase/tests/0023_rollback.sql puts back every policy as
-- 0003-0022 left it and drops the three functions and the indexes made
-- here; 10_rollback_0023.sql applies it and checks the policies match
-- the ones kept from before, exactly, then applies this file again.
-- Nothing needs rolling back for correctness: no answer changes.

-- ---------------------------------------------------------------------------
-- who is on the other side of a block from the caller, read once
-- ---------------------------------------------------------------------------
/** Everyone the caller has blocked or been blocked by. Empty when signed out. */
create or replace function public.my_block_partners()
returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(distinct partner), '{}'::uuid[])
  from (
    select b.blocked_id as partner from public.blocks b where b.blocker_id = auth.uid()
    union all
    select b.blocker_id from public.blocks b where b.blocked_id = auth.uid()
  ) s
$$;

/** Everyone who has blocked the caller: the one direction a profile hides in. */
create or replace function public.my_blockers()
returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(b.blocker_id), '{}'::uuid[])
  from public.blocks b where b.blocked_id = auth.uid()
$$;

-- As blocked_between and blocked_by (0018): members only. Policies run as
-- the querying role, so authenticated needs EXECUTE; anon gets none, as
-- with the functions these replace in the policies.
revoke execute on function public.my_block_partners(), public.my_blockers() from public, anon, authenticated;
grant execute on function public.my_block_partners(), public.my_blockers() to authenticated;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select using (id = (select auth.uid()));

drop policy if exists "profiles: members read members" on public.profiles;
create policy "profiles: members read members" on public.profiles
  for select using (
    (select public.is_active_member((select auth.uid())))
    and status in ('approved', 'suspended')
  );

drop policy if exists "profiles: admins read all" on public.profiles;
create policy "profiles: admins read all" on public.profiles
  for select using ((select public.is_admin((select auth.uid()))));

-- The update policy compared the new row with the stored one through six
-- subqueries on profiles. A policy on profiles may not read profiles
-- through a subquery once profiles' own read policies contain one (as
-- they now do, to read the caller once): PostgreSQL refuses it as
-- recursion (42P17). So the comparison moves into a function that reads
-- the caller's stored row directly. The answer is the same: the
-- subqueries read that row through the read policies, and "read own"
-- always lets a member read their own row; when there is no such row,
-- or nobody is signed in, both find nothing and refuse the update.
/**
 * Whether the guarded columns of the caller's own row would be unchanged
 * by these values: role, status, invitation allowance, membership
 * number, who invited them, and whether it is a house account. Members
 * change their own name, bio, city, avatar and privacy; these six only
 * change through the definer functions that own them.
 */
create or replace function public.own_profile_unchanged(
  p_role text, p_status text, p_invite_quota integer,
  p_member_no integer, p_invited_by uuid, p_is_house boolean)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = p_role
      and p.status = p_status
      and p.invite_quota = p_invite_quota
      and p.member_no is not distinct from p_member_no
      and p.invited_by is not distinct from p_invited_by
      and p.is_house = p_is_house
  )
$$;

revoke execute on function public.own_profile_unchanged(text, text, integer, integer, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.own_profile_unchanged(text, text, integer, integer, uuid, boolean)
  to authenticated;

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and public.own_profile_unchanged(role, status, invite_quota, member_no, invited_by, is_house)
  );

drop policy if exists "profiles: hidden from those blocked" on public.profiles;
create policy "profiles: hidden from those blocked" on public.profiles
  as restrictive for select using (
    id = (select auth.uid())
    or (select public.is_admin((select auth.uid())))
    or not coalesce(id = any ((select public.my_blockers())::uuid[]), false)
  );

-- ---------------------------------------------------------------------------
-- applications
-- ---------------------------------------------------------------------------
drop policy if exists "applications: submit own" on public.applications;
create policy "applications: submit own" on public.applications
  for insert with check (user_id = (select auth.uid()));

drop policy if exists "applications: read own" on public.applications;
create policy "applications: read own" on public.applications
  for select using (user_id = (select auth.uid()));

drop policy if exists "applications: admins read" on public.applications;
create policy "applications: admins read" on public.applications
  for select using ((select public.is_admin((select auth.uid()))));

-- ---------------------------------------------------------------------------
-- invites
-- ---------------------------------------------------------------------------
drop policy if exists "invites: read own" on public.invites;
create policy "invites: read own" on public.invites
  for select using (created_by = (select auth.uid()) or used_by = (select auth.uid()));

drop policy if exists "invites: admins read" on public.invites;
create policy "invites: admins read" on public.invites
  for select using ((select public.is_admin((select auth.uid()))));

-- ---------------------------------------------------------------------------
-- follows
-- ---------------------------------------------------------------------------
drop policy if exists "follows: members read" on public.follows;
create policy "follows: members read" on public.follows
  for select using ((select public.is_active_member((select auth.uid()))));

drop policy if exists "follows: follow as self" on public.follows;
create policy "follows: follow as self" on public.follows
  for insert with check (
    follower_id = (select auth.uid()) and (select public.is_active_member((select auth.uid())))
  );

drop policy if exists "follows: unfollow as self" on public.follows;
create policy "follows: unfollow as self" on public.follows
  for delete using (follower_id = (select auth.uid()));

drop policy if exists "follows: not between blocked" on public.follows;
create policy "follows: not between blocked" on public.follows
  as restrictive for select using (
    not coalesce(follower_id = any ((select public.my_block_partners())::uuid[]), false)
    and not coalesce(followee_id = any ((select public.my_block_partners())::uuid[]), false)
  );

-- ---------------------------------------------------------------------------
-- posts
-- ---------------------------------------------------------------------------
drop policy if exists "posts: members read live" on public.posts;
create policy "posts: members read live" on public.posts
  for select using (
    (select public.is_active_member((select auth.uid())))
    and removed_at is null
    and (
      author_id = (select auth.uid())
      or not exists (
        select 1 from public.profiles a
        where a.id = author_id and a.is_private
      )
      or exists (
        select 1 from public.follows f
        where f.followee_id = author_id
          and f.follower_id = (select auth.uid())
          and f.status = 'accepted'
      )
    )
  );

drop policy if exists "posts: authors read own" on public.posts;
create policy "posts: authors read own" on public.posts
  for select using (author_id = (select auth.uid()));

drop policy if exists "posts: admins read all" on public.posts;
create policy "posts: admins read all" on public.posts
  for select using ((select public.is_admin((select auth.uid()))));

drop policy if exists "posts: create as self" on public.posts;
create policy "posts: create as self" on public.posts
  for insert with check (
    author_id = (select auth.uid())
    and (select public.is_active_member((select auth.uid())))
    and removed_at is null
    and removed_by is null
    and like_count = 0
    and comment_count = 0
  );

drop policy if exists "posts: authors edit caption" on public.posts;
create policy "posts: authors edit caption" on public.posts
  for update using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

drop policy if exists "posts: authors delete own" on public.posts;
create policy "posts: authors delete own" on public.posts
  for delete using (author_id = (select auth.uid()));

drop policy if exists "posts: not between blocked" on public.posts;
create policy "posts: not between blocked" on public.posts
  as restrictive for select using (
    (select public.is_admin((select auth.uid())))
    or not coalesce(author_id = any ((select public.my_block_partners())::uuid[]), false)
  );

-- ---------------------------------------------------------------------------
-- likes
-- ---------------------------------------------------------------------------
drop policy if exists "likes: members read" on public.likes;
create policy "likes: members read" on public.likes
  for select using ((select public.is_active_member((select auth.uid()))));

drop policy if exists "likes: like as self" on public.likes;
create policy "likes: like as self" on public.likes
  for insert with check (
    user_id = (select auth.uid()) and (select public.is_active_member((select auth.uid())))
  );

drop policy if exists "likes: unlike as self" on public.likes;
create policy "likes: unlike as self" on public.likes
  for delete using (user_id = (select auth.uid()));

drop policy if exists "likes: not between blocked" on public.likes;
create policy "likes: not between blocked" on public.likes
  as restrictive for select using (
    not coalesce(user_id = any ((select public.my_block_partners())::uuid[]), false)
  );

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------
drop policy if exists "comments: members read live" on public.comments;
create policy "comments: members read live" on public.comments
  for select using (
    (select public.is_active_member((select auth.uid()))) and removed_at is null
  );

drop policy if exists "comments: admins read all" on public.comments;
create policy "comments: admins read all" on public.comments
  for select using ((select public.is_admin((select auth.uid()))));

drop policy if exists "comments: comment as self" on public.comments;
create policy "comments: comment as self" on public.comments
  for insert with check (
    author_id = (select auth.uid())
    and (select public.is_active_member((select auth.uid())))
    and removed_at is null
    and removed_by is null
  );

drop policy if exists "comments: delete own" on public.comments;
create policy "comments: delete own" on public.comments
  for delete using (author_id = (select auth.uid()));

drop policy if exists "comments: not between blocked" on public.comments;
create policy "comments: not between blocked" on public.comments
  as restrictive for select using (
    (select public.is_admin((select auth.uid())))
    or not coalesce(author_id = any ((select public.my_block_partners())::uuid[]), false)
  );

-- ---------------------------------------------------------------------------
-- activity
-- ---------------------------------------------------------------------------
drop policy if exists "activity: read own" on public.activity;
create policy "activity: read own" on public.activity
  for select using (recipient_id = (select auth.uid()));

drop policy if exists "activity: mark read" on public.activity;
create policy "activity: mark read" on public.activity
  for update using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

drop policy if exists "activity: not from blocked" on public.activity;
create policy "activity: not from blocked" on public.activity
  as restrictive for select using (
    actor_id is null
    or not coalesce(actor_id = any ((select public.my_block_partners())::uuid[]), false)
  );

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------
drop policy if exists "reports: file as self" on public.reports;
create policy "reports: file as self" on public.reports
  for insert with check (
    reporter_id = (select auth.uid())
    and (select public.is_active_member((select auth.uid())))
    and status = 'open'
    and resolved_by is null
  );

drop policy if exists "reports: read own" on public.reports;
create policy "reports: read own" on public.reports
  for select using (reporter_id = (select auth.uid()));

drop policy if exists "reports: admins read" on public.reports;
create policy "reports: admins read" on public.reports
  for select using ((select public.is_admin((select auth.uid()))));

-- ---------------------------------------------------------------------------
-- moderation_actions
-- ---------------------------------------------------------------------------
drop policy if exists "moderation: read own" on public.moderation_actions;
create policy "moderation: read own" on public.moderation_actions
  for select using (target_profile_id = (select auth.uid()));

drop policy if exists "moderation: admins read" on public.moderation_actions;
create policy "moderation: admins read" on public.moderation_actions
  for select using ((select public.is_admin((select auth.uid()))));

-- ---------------------------------------------------------------------------
-- conversations and messages
-- ---------------------------------------------------------------------------
drop policy if exists "conversations: read own" on public.conversations;
create policy "conversations: read own" on public.conversations
  for select using ((select auth.uid()) in (user_a, user_b));

drop policy if exists "conversations: open as self" on public.conversations;
create policy "conversations: open as self" on public.conversations
  for insert with check (
    (select public.is_active_member((select auth.uid())))
    and (select auth.uid()) in (user_a, user_b)
  );

drop policy if exists "conversations: members touch own" on public.conversations;
create policy "conversations: members touch own" on public.conversations
  for update using ((select auth.uid()) in (user_a, user_b))
  with check ((select auth.uid()) in (user_a, user_b));

drop policy if exists "messages: read own conversations" on public.messages;
create policy "messages: read own conversations" on public.messages
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (select auth.uid()) in (c.user_a, c.user_b)
    )
  );

drop policy if exists "messages: send as self" on public.messages;
create policy "messages: send as self" on public.messages
  for insert with check (
    sender_id = (select auth.uid())
    and (select public.is_active_member((select auth.uid())))
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (select auth.uid()) in (c.user_a, c.user_b)
    )
  );

drop policy if exists "messages: mark read" on public.messages;
create policy "messages: mark read" on public.messages
  for update using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (select auth.uid()) in (c.user_a, c.user_b)
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (select auth.uid()) in (c.user_a, c.user_b)
    )
  );

drop policy if exists "messages: not between blocked" on public.messages;
create policy "messages: not between blocked" on public.messages
  as restrictive for select using (
    not coalesce(sender_id = any ((select public.my_block_partners())::uuid[]), false)
  );

-- ---------------------------------------------------------------------------
-- blocks
-- ---------------------------------------------------------------------------
drop policy if exists "blocks: own" on public.blocks;
create policy "blocks: own" on public.blocks
  for all using (blocker_id = (select auth.uid())) with check (blocker_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- invitation links
-- ---------------------------------------------------------------------------
drop policy if exists "invite links: read own" on public.invite_links;
create policy "invite links: read own" on public.invite_links
  for select using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- tags
-- ---------------------------------------------------------------------------
drop policy if exists "post_tags: members read accepted" on public.post_tags;
create policy "post_tags: members read accepted" on public.post_tags
  for select using (
    (select public.is_active_member((select auth.uid())))
    and (status = 'accepted' or user_id = (select auth.uid()) or tagged_by = (select auth.uid()))
  );

drop policy if exists "post_tags: author tags" on public.post_tags;
create policy "post_tags: author tags" on public.post_tags
  for insert with check (
    tagged_by = (select auth.uid())
    and (select public.is_active_member((select auth.uid())))
    and status = 'pending'
    and exists (
      select 1 from public.posts p
      where p.id = post_id and p.author_id = (select auth.uid()) and p.removed_at is null
    )
    and exists (
      select 1 from public.profiles t
      where t.id = user_id and t.status = 'approved'
    )
  );

drop policy if exists "post_tags: tagged decides" on public.post_tags;
create policy "post_tags: tagged decides" on public.post_tags
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and status in ('accepted', 'declined'));

drop policy if exists "post_tags: either party removes" on public.post_tags;
create policy "post_tags: either party removes" on public.post_tags
  for delete using (user_id = (select auth.uid()) or tagged_by = (select auth.uid()));

drop policy if exists "post_tags: not between blocked" on public.post_tags;
create policy "post_tags: not between blocked" on public.post_tags
  as restrictive for select using (
    not coalesce(user_id = any ((select public.my_block_partners())::uuid[]), false)
    and not coalesce(tagged_by = any ((select public.my_block_partners())::uuid[]), false)
  );

-- ---------------------------------------------------------------------------
-- settings, push, preferences
-- ---------------------------------------------------------------------------
drop policy if exists "app_settings: admins read" on public.app_settings;
create policy "app_settings: admins read" on public.app_settings
  for select using ((select public.is_admin((select auth.uid()))));

drop policy if exists "push_tokens: own" on public.push_tokens;
create policy "push_tokens: own" on public.push_tokens
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "notification_prefs: own" on public.notification_prefs;
create policy "notification_prefs: own" on public.notification_prefs
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- sharing
-- ---------------------------------------------------------------------------
drop policy if exists "post_shares: read own" on public.post_shares;
create policy "post_shares: read own" on public.post_shares
  for select using (owner_id = (select auth.uid()));

drop policy if exists "share_events: members write own" on public.share_events;
create policy "share_events: members write own" on public.share_events
  for insert with check (
    actor_id = (select auth.uid())
    and kind in ('share_started', 'link_created')
    and (select public.is_active_member((select auth.uid())))
  );

drop policy if exists "share_events: admins read" on public.share_events;
create policy "share_events: admins read" on public.share_events
  for select using ((select public.is_admin((select auth.uid()))));

-- ---------------------------------------------------------------------------
-- eras
-- ---------------------------------------------------------------------------
drop policy if exists "era_edits: authors read own" on public.era_edits;
create policy "era_edits: authors read own" on public.era_edits
  for select to authenticated using (author_id = (select auth.uid()));

drop policy if exists "era_edits: admins read all" on public.era_edits;
create policy "era_edits: admins read all" on public.era_edits
  for select to authenticated using ((select public.is_admin((select auth.uid()))));

drop policy if exists "era_edits: members read" on public.era_edits;
create policy "era_edits: members read" on public.era_edits
  for select to authenticated using (
    (select public.is_active_member((select auth.uid())))
    and (
      author_id = (select auth.uid())
      or not exists (
        select 1 from public.profiles a
        where a.id = author_id and a.is_private
      )
      or exists (
        select 1 from public.follows f
        where f.followee_id = author_id
          and f.follower_id = (select auth.uid())
          and f.status = 'accepted'
      )
    )
  );

drop policy if exists "era_edits: not between blocked" on public.era_edits;
create policy "era_edits: not between blocked" on public.era_edits
  as restrictive for select to authenticated using (
    (select public.is_admin((select auth.uid())))
    or not coalesce(author_id = any ((select public.my_block_partners())::uuid[]), false)
  );

drop policy if exists "era_edits: authors write own" on public.era_edits;
create policy "era_edits: authors write own" on public.era_edits
  for insert to authenticated with check (
    author_id = (select auth.uid()) and (select public.is_active_member((select auth.uid())))
  );

drop policy if exists "era_edits: authors change own" on public.era_edits;
create policy "era_edits: authors change own" on public.era_edits
  for update to authenticated using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()) and (select public.is_active_member((select auth.uid()))));

drop policy if exists "era_edits: authors delete own" on public.era_edits;
create policy "era_edits: authors delete own" on public.era_edits
  for delete to authenticated using (author_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- storage: a member's own folder
-- ---------------------------------------------------------------------------
drop policy if exists "avatars: upload own folder" on storage.objects;
create policy "avatars: upload own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars: update own folder" on storage.objects;
create policy "avatars: update own folder" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatars: delete own folder" on storage.objects;
create policy "avatars: delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatars: read own folder" on storage.objects;
create policy "avatars: read own folder" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "media: upload own folder" on storage.objects;
create policy "media: upload own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('media', 'thumbnails')
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_active_member((select auth.uid())))
  );

drop policy if exists "media: update own folder" on storage.objects;
create policy "media: update own folder" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('media', 'thumbnails')
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_active_member((select auth.uid())))
  )
  with check (
    bucket_id in ('media', 'thumbnails')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "media: delete own folder" on storage.objects;
create policy "media: delete own folder" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('media', 'thumbnails')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "media: read own folder" on storage.objects;
create policy "media: read own folder" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('media', 'thumbnails')
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_active_member((select auth.uid())))
  );

-- ---------------------------------------------------------------------------
-- indexes: what a deletion looks up
-- ---------------------------------------------------------------------------
-- Activity is the fastest-growing table, and the one every deletion of a
-- photograph, a comment or a member reaches into.
create index if not exists activity_post_idx on public.activity (post_id) where post_id is not null;
create index if not exists activity_comment_idx on public.activity (comment_id) where comment_id is not null;
create index if not exists activity_actor_idx on public.activity (actor_id) where actor_id is not null;

create index if not exists comments_author_idx on public.comments (author_id);
create index if not exists likes_user_idx on public.likes (user_id);
create index if not exists messages_sender_idx on public.messages (sender_id);
create index if not exists messages_post_idx on public.messages (post_id) where post_id is not null;
create index if not exists post_tags_tagged_by_idx on public.post_tags (tagged_by);
create index if not exists post_shares_owner_idx on public.post_shares (owner_id);
create index if not exists share_events_post_idx on public.share_events (post_id) where post_id is not null;
create index if not exists share_events_actor_idx on public.share_events (actor_id) where actor_id is not null;
create index if not exists reports_reporter_idx on public.reports (reporter_id);
create index if not exists reports_post_idx on public.reports (post_id) where post_id is not null;
create index if not exists reports_comment_idx on public.reports (comment_id) where comment_id is not null;
create index if not exists reports_profile_idx on public.reports (profile_id) where profile_id is not null;
create index if not exists moderation_actions_post_idx on public.moderation_actions (post_id) where post_id is not null;
create index if not exists moderation_actions_comment_idx on public.moderation_actions (comment_id) where comment_id is not null;
create index if not exists moderation_actions_admin_idx on public.moderation_actions (admin_id);

-- Who removed, decided or resolved something: rare, and released by
-- delete_my_account (0018) before the member goes.
create index if not exists posts_removed_by_idx on public.posts (removed_by) where removed_by is not null;
create index if not exists comments_removed_by_idx on public.comments (removed_by) where removed_by is not null;
create index if not exists applications_decided_by_idx on public.applications (decided_by) where decided_by is not null;
create index if not exists reports_resolved_by_idx on public.reports (resolved_by) where resolved_by is not null;
create index if not exists invites_used_by_idx on public.invites (used_by) where used_by is not null;
create index if not exists app_settings_updated_by_idx on public.app_settings (updated_by) where updated_by is not null;

-- ---------------------------------------------------------------------------
-- indexes: what is read all the time
-- ---------------------------------------------------------------------------
-- How many has this member brought in: every invitation page and join.
create index if not exists profiles_invited_by_idx on public.profiles (invited_by) where invited_by is not null;

-- The private members, asked about by every read of posts and eras.
create index if not exists profiles_private_idx on public.profiles (id) where is_private;

-- A member's followers, newest first, and the people told of a new post.
create index if not exists follows_followers_idx on public.follows (followee_id, created_at desc)
  where status = 'accepted';

-- Who liked a photograph, newest first.
create index if not exists likes_post_recent_idx on public.likes (post_id, created_at desc);

-- Marking Activity read touches only what is unread.
create index if not exists activity_unread_idx on public.activity (recipient_id) where read_at is null;

-- On This Day: photographs by when they were taken.
create index if not exists posts_taken_idx on public.posts (taken_at)
  where removed_at is null and taken_at is not null;
