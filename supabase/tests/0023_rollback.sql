-- VINTAGE · undo 0023, should it ever be wanted
--
-- 0023 changes how often the policies ask who the caller is, not what
-- they answer, so nothing needs undoing for correctness. This is here so
-- that "put it back as it was" is one tested file rather than an
-- afternoon: every policy 0023 replaced, exactly as 0003-0022 left it
-- (generated from the policy harness just before 0023, and checked by
-- 10_rollback_0023.sql to match those policies one for one), then the
-- three functions, the private schema they lived in (when nothing else
-- is in it) and the indexes 0023 made.
--
-- One transaction: no table is ever without its policies. Run as a whole
-- in the SQL editor, or with psql -f. Nothing else in the database is
-- touched; no data changes.
--
-- One policy here was replaced again after 0023: "media: read own
-- folder", by 0035 (a member's own files whatever their membership, so
-- Delete my account can remove a suspended member's photographs). This
-- puts back 0009's version, with the membership check; apply
-- 0035_own_files_whatever_the_membership.sql again after it.
--
-- 0038 (follows that respect private accounts) keeps its three trigger
-- functions in the schema private, so with 0038 applied the schema
-- stays, holding only those; 0038's policies, grants and triggers are not
-- 0023's, and are left as they are (0038's own way back is
-- 0038_rollback.sql).
--
-- 0039 (members write only what the app writes) adds five restrictive
-- policies of its own, narrows grants and replaces three invitation
-- functions; none of that is 0023's, and it is left as it is (0039's own
-- way back is 0039_rollback.sql).

begin;

-- As in 0023: a lock not granted within five seconds stops the run and
-- undoes all of it, rather than leaving members' reads queued behind it.
set local lock_timeout = '5s';
set local search_path = public, extensions;

drop policy if exists "activity: mark read" on public.activity;
create policy "activity: mark read" on public.activity
  for update
  using ((recipient_id = auth.uid()))
  with check ((recipient_id = auth.uid()));

drop policy if exists "activity: not from blocked" on public.activity;
create policy "activity: not from blocked" on public.activity
  as restrictive
  for select
  using (((actor_id IS NULL) OR (NOT blocked_between(auth.uid(), actor_id))));

drop policy if exists "activity: read own" on public.activity;
create policy "activity: read own" on public.activity
  for select
  using ((recipient_id = auth.uid()));

drop policy if exists "app_settings: admins read" on public.app_settings;
create policy "app_settings: admins read" on public.app_settings
  for select
  using (is_admin(auth.uid()));

drop policy if exists "applications: admins read" on public.applications;
create policy "applications: admins read" on public.applications
  for select
  using (is_admin(auth.uid()));

drop policy if exists "applications: read own" on public.applications;
create policy "applications: read own" on public.applications
  for select
  using ((user_id = auth.uid()));

drop policy if exists "applications: submit own" on public.applications;
create policy "applications: submit own" on public.applications
  for insert
  with check ((user_id = auth.uid()));

drop policy if exists "blocks: own" on public.blocks;
create policy "blocks: own" on public.blocks
  for all
  using ((blocker_id = auth.uid()))
  with check ((blocker_id = auth.uid()));

drop policy if exists "comments: admins read all" on public.comments;
create policy "comments: admins read all" on public.comments
  for select
  using (is_admin(auth.uid()));

drop policy if exists "comments: comment as self" on public.comments;
create policy "comments: comment as self" on public.comments
  for insert
  with check (((author_id = auth.uid()) AND is_active_member(auth.uid()) AND (removed_at IS NULL) AND (removed_by IS NULL)));

drop policy if exists "comments: delete own" on public.comments;
create policy "comments: delete own" on public.comments
  for delete
  using ((author_id = auth.uid()));

drop policy if exists "comments: members read live" on public.comments;
create policy "comments: members read live" on public.comments
  for select
  using ((is_active_member(auth.uid()) AND (removed_at IS NULL)));

drop policy if exists "comments: not between blocked" on public.comments;
create policy "comments: not between blocked" on public.comments
  as restrictive
  for select
  using ((is_admin(auth.uid()) OR (NOT blocked_between(auth.uid(), author_id))));

drop policy if exists "conversations: members touch own" on public.conversations;
create policy "conversations: members touch own" on public.conversations
  for update
  using (((auth.uid() = user_a) OR (auth.uid() = user_b)))
  with check (((auth.uid() = user_a) OR (auth.uid() = user_b)));

drop policy if exists "conversations: open as self" on public.conversations;
create policy "conversations: open as self" on public.conversations
  for insert
  with check ((is_active_member(auth.uid()) AND ((auth.uid() = user_a) OR (auth.uid() = user_b))));

drop policy if exists "conversations: read own" on public.conversations;
create policy "conversations: read own" on public.conversations
  for select
  using (((auth.uid() = user_a) OR (auth.uid() = user_b)));

drop policy if exists "era_edits: admins read all" on public.era_edits;
create policy "era_edits: admins read all" on public.era_edits
  for select to authenticated
  using (is_admin(auth.uid()));

drop policy if exists "era_edits: authors change own" on public.era_edits;
create policy "era_edits: authors change own" on public.era_edits
  for update to authenticated
  using ((author_id = auth.uid()))
  with check (((author_id = auth.uid()) AND is_active_member(auth.uid())));

drop policy if exists "era_edits: authors delete own" on public.era_edits;
create policy "era_edits: authors delete own" on public.era_edits
  for delete to authenticated
  using ((author_id = auth.uid()));

drop policy if exists "era_edits: authors read own" on public.era_edits;
create policy "era_edits: authors read own" on public.era_edits
  for select to authenticated
  using ((author_id = auth.uid()));

drop policy if exists "era_edits: authors write own" on public.era_edits;
create policy "era_edits: authors write own" on public.era_edits
  for insert to authenticated
  with check (((author_id = auth.uid()) AND is_active_member(auth.uid())));

drop policy if exists "era_edits: members read" on public.era_edits;
create policy "era_edits: members read" on public.era_edits
  for select to authenticated
  using ((is_active_member(auth.uid()) AND ((author_id = auth.uid()) OR (NOT (EXISTS ( SELECT 1
   FROM profiles a
  WHERE ((a.id = era_edits.author_id) AND a.is_private)))) OR (EXISTS ( SELECT 1
   FROM follows f
  WHERE ((f.followee_id = era_edits.author_id) AND (f.follower_id = auth.uid()) AND (f.status = 'accepted'::text)))))));

drop policy if exists "era_edits: not between blocked" on public.era_edits;
create policy "era_edits: not between blocked" on public.era_edits
  as restrictive
  for select to authenticated
  using ((is_admin(auth.uid()) OR (NOT blocked_between(auth.uid(), author_id))));

drop policy if exists "follows: follow as self" on public.follows;
create policy "follows: follow as self" on public.follows
  for insert
  with check (((follower_id = auth.uid()) AND is_active_member(auth.uid())));

drop policy if exists "follows: members read" on public.follows;
create policy "follows: members read" on public.follows
  for select
  using (is_active_member(auth.uid()));

drop policy if exists "follows: not between blocked" on public.follows;
create policy "follows: not between blocked" on public.follows
  as restrictive
  for select
  using (((NOT blocked_between(auth.uid(), follower_id)) AND (NOT blocked_between(auth.uid(), followee_id))));

drop policy if exists "follows: unfollow as self" on public.follows;
create policy "follows: unfollow as self" on public.follows
  for delete
  using ((follower_id = auth.uid()));

drop policy if exists "invite links: read own" on public.invite_links;
create policy "invite links: read own" on public.invite_links
  for select
  using ((owner_id = auth.uid()));

drop policy if exists "invites: admins read" on public.invites;
create policy "invites: admins read" on public.invites
  for select
  using (is_admin(auth.uid()));

drop policy if exists "invites: read own" on public.invites;
create policy "invites: read own" on public.invites
  for select
  using (((created_by = auth.uid()) OR (used_by = auth.uid())));

drop policy if exists "likes: like as self" on public.likes;
create policy "likes: like as self" on public.likes
  for insert
  with check (((user_id = auth.uid()) AND is_active_member(auth.uid())));

drop policy if exists "likes: members read" on public.likes;
create policy "likes: members read" on public.likes
  for select
  using (is_active_member(auth.uid()));

drop policy if exists "likes: not between blocked" on public.likes;
create policy "likes: not between blocked" on public.likes
  as restrictive
  for select
  using ((NOT blocked_between(auth.uid(), user_id)));

drop policy if exists "likes: unlike as self" on public.likes;
create policy "likes: unlike as self" on public.likes
  for delete
  using ((user_id = auth.uid()));

drop policy if exists "messages: mark read" on public.messages;
create policy "messages: mark read" on public.messages
  for update
  using ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND ((auth.uid() = c.user_a) OR (auth.uid() = c.user_b))))))
  with check ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND ((auth.uid() = c.user_a) OR (auth.uid() = c.user_b))))));

drop policy if exists "messages: not between blocked" on public.messages;
create policy "messages: not between blocked" on public.messages
  as restrictive
  for select
  using ((NOT blocked_between(auth.uid(), sender_id)));

drop policy if exists "messages: read own conversations" on public.messages;
create policy "messages: read own conversations" on public.messages
  for select
  using ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND ((auth.uid() = c.user_a) OR (auth.uid() = c.user_b))))));

drop policy if exists "messages: send as self" on public.messages;
create policy "messages: send as self" on public.messages
  for insert
  with check (((sender_id = auth.uid()) AND is_active_member(auth.uid()) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND ((auth.uid() = c.user_a) OR (auth.uid() = c.user_b)))))));

drop policy if exists "moderation: admins read" on public.moderation_actions;
create policy "moderation: admins read" on public.moderation_actions
  for select
  using (is_admin(auth.uid()));

drop policy if exists "moderation: read own" on public.moderation_actions;
create policy "moderation: read own" on public.moderation_actions
  for select
  using ((target_profile_id = auth.uid()));

drop policy if exists "notification_prefs: own" on public.notification_prefs;
create policy "notification_prefs: own" on public.notification_prefs
  for all
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));

drop policy if exists "post_shares: read own" on public.post_shares;
create policy "post_shares: read own" on public.post_shares
  for select
  using ((owner_id = auth.uid()));

drop policy if exists "post_tags: author tags" on public.post_tags;
create policy "post_tags: author tags" on public.post_tags
  for insert
  with check (((tagged_by = auth.uid()) AND is_active_member(auth.uid()) AND (status = 'pending'::text) AND (EXISTS ( SELECT 1
   FROM posts p
  WHERE ((p.id = post_tags.post_id) AND (p.author_id = auth.uid()) AND (p.removed_at IS NULL)))) AND (EXISTS ( SELECT 1
   FROM profiles t
  WHERE ((t.id = post_tags.user_id) AND (t.status = 'approved'::text))))));

drop policy if exists "post_tags: either party removes" on public.post_tags;
create policy "post_tags: either party removes" on public.post_tags
  for delete
  using (((user_id = auth.uid()) OR (tagged_by = auth.uid())));

drop policy if exists "post_tags: members read accepted" on public.post_tags;
create policy "post_tags: members read accepted" on public.post_tags
  for select
  using ((is_active_member(auth.uid()) AND ((status = 'accepted'::text) OR (user_id = auth.uid()) OR (tagged_by = auth.uid()))));

drop policy if exists "post_tags: not between blocked" on public.post_tags;
create policy "post_tags: not between blocked" on public.post_tags
  as restrictive
  for select
  using (((NOT blocked_between(auth.uid(), user_id)) AND (NOT blocked_between(auth.uid(), tagged_by))));

drop policy if exists "post_tags: tagged decides" on public.post_tags;
create policy "post_tags: tagged decides" on public.post_tags
  for update
  using ((user_id = auth.uid()))
  with check (((user_id = auth.uid()) AND (status = ANY (ARRAY['accepted'::text, 'declined'::text]))));

drop policy if exists "posts: admins read all" on public.posts;
create policy "posts: admins read all" on public.posts
  for select
  using (is_admin(auth.uid()));

drop policy if exists "posts: authors delete own" on public.posts;
create policy "posts: authors delete own" on public.posts
  for delete
  using ((author_id = auth.uid()));

drop policy if exists "posts: authors edit caption" on public.posts;
create policy "posts: authors edit caption" on public.posts
  for update
  using ((author_id = auth.uid()))
  with check ((author_id = auth.uid()));

drop policy if exists "posts: authors read own" on public.posts;
create policy "posts: authors read own" on public.posts
  for select
  using ((author_id = auth.uid()));

drop policy if exists "posts: create as self" on public.posts;
create policy "posts: create as self" on public.posts
  for insert
  with check (((author_id = auth.uid()) AND is_active_member(auth.uid()) AND (removed_at IS NULL) AND (removed_by IS NULL) AND (like_count = 0) AND (comment_count = 0)));

drop policy if exists "posts: members read live" on public.posts;
create policy "posts: members read live" on public.posts
  for select
  using ((is_active_member(auth.uid()) AND (removed_at IS NULL) AND ((author_id = auth.uid()) OR (NOT (EXISTS ( SELECT 1
   FROM profiles a
  WHERE ((a.id = posts.author_id) AND a.is_private)))) OR (EXISTS ( SELECT 1
   FROM follows f
  WHERE ((f.followee_id = posts.author_id) AND (f.follower_id = auth.uid()) AND (f.status = 'accepted'::text)))))));

drop policy if exists "posts: not between blocked" on public.posts;
create policy "posts: not between blocked" on public.posts
  as restrictive
  for select
  using ((is_admin(auth.uid()) OR (NOT blocked_between(auth.uid(), author_id))));

drop policy if exists "profiles: admins read all" on public.profiles;
create policy "profiles: admins read all" on public.profiles
  for select
  using (is_admin(auth.uid()));

drop policy if exists "profiles: hidden from those blocked" on public.profiles;
create policy "profiles: hidden from those blocked" on public.profiles
  as restrictive
  for select
  using (((id = auth.uid()) OR is_admin(auth.uid()) OR (NOT blocked_by(auth.uid(), id))));

drop policy if exists "profiles: members read members" on public.profiles;
create policy "profiles: members read members" on public.profiles
  for select
  using ((is_active_member(auth.uid()) AND (status = ANY (ARRAY['approved'::text, 'suspended'::text]))));

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select
  using ((id = auth.uid()));

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update
  using ((id = auth.uid()))
  with check (((id = auth.uid()) AND (role = ( SELECT p.role
   FROM profiles p
  WHERE (p.id = auth.uid()))) AND (status = ( SELECT p.status
   FROM profiles p
  WHERE (p.id = auth.uid()))) AND (invite_quota = ( SELECT p.invite_quota
   FROM profiles p
  WHERE (p.id = auth.uid()))) AND (NOT (member_no IS DISTINCT FROM ( SELECT p.member_no
   FROM profiles p
  WHERE (p.id = auth.uid())))) AND (NOT (invited_by IS DISTINCT FROM ( SELECT p.invited_by
   FROM profiles p
  WHERE (p.id = auth.uid())))) AND (is_house = ( SELECT p.is_house
   FROM profiles p
  WHERE (p.id = auth.uid())))));

drop policy if exists "push_tokens: own" on public.push_tokens;
create policy "push_tokens: own" on public.push_tokens
  for all
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));

drop policy if exists "reports: admins read" on public.reports;
create policy "reports: admins read" on public.reports
  for select
  using (is_admin(auth.uid()));

drop policy if exists "reports: file as self" on public.reports;
create policy "reports: file as self" on public.reports
  for insert
  with check (((reporter_id = auth.uid()) AND is_active_member(auth.uid()) AND (status = 'open'::text) AND (resolved_by IS NULL)));

drop policy if exists "reports: read own" on public.reports;
create policy "reports: read own" on public.reports
  for select
  using ((reporter_id = auth.uid()));

drop policy if exists "share_events: admins read" on public.share_events;
create policy "share_events: admins read" on public.share_events
  for select
  using (is_admin(auth.uid()));

drop policy if exists "share_events: members write own" on public.share_events;
create policy "share_events: members write own" on public.share_events
  for insert
  with check (((actor_id = auth.uid()) AND (kind = ANY (ARRAY['share_started'::text, 'link_created'::text])) AND is_active_member(auth.uid())));

drop policy if exists "avatars: delete own folder" on storage.objects;
create policy "avatars: delete own folder" on storage.objects
  for delete to authenticated
  using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

drop policy if exists "avatars: read own folder" on storage.objects;
create policy "avatars: read own folder" on storage.objects
  for select to authenticated
  using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

drop policy if exists "avatars: update own folder" on storage.objects;
create policy "avatars: update own folder" on storage.objects
  for update to authenticated
  using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)))
  with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

drop policy if exists "avatars: upload own folder" on storage.objects;
create policy "avatars: upload own folder" on storage.objects
  for insert to authenticated
  with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

drop policy if exists "media: delete own folder" on storage.objects;
create policy "media: delete own folder" on storage.objects
  for delete to authenticated
  using (((bucket_id = ANY (ARRAY['media'::text, 'thumbnails'::text])) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

drop policy if exists "media: read own folder" on storage.objects;
create policy "media: read own folder" on storage.objects
  for select to authenticated
  using (((bucket_id = ANY (ARRAY['media'::text, 'thumbnails'::text])) AND ((storage.foldername(name))[1] = (auth.uid())::text) AND is_active_member(auth.uid())));

drop policy if exists "media: update own folder" on storage.objects;
create policy "media: update own folder" on storage.objects
  for update to authenticated
  using (((bucket_id = ANY (ARRAY['media'::text, 'thumbnails'::text])) AND ((storage.foldername(name))[1] = (auth.uid())::text) AND is_active_member(auth.uid())))
  with check (((bucket_id = ANY (ARRAY['media'::text, 'thumbnails'::text])) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

drop policy if exists "media: upload own folder" on storage.objects;
create policy "media: upload own folder" on storage.objects
  for insert to authenticated
  with check (((bucket_id = ANY (ARRAY['media'::text, 'thumbnails'::text])) AND ((storage.foldername(name))[1] = (auth.uid())::text) AND is_active_member(auth.uid())));

-- The policies above no longer call these.
drop function if exists private.my_block_partners();
drop function if exists private.my_blockers();
drop function if exists private.own_profile_unchanged(text, text, integer, integer, uuid, boolean);

-- And the schema 0023 made for them, if nothing else has been put in it
-- since (should something have been, it stays, and so does what is in it).
do $private$
begin
  if exists (select 1 from pg_namespace where nspname = 'private')
     and not exists (select 1 from pg_depend d
                      where d.refclassid = 'pg_namespace'::regclass
                        and d.refobjid = 'private'::regnamespace
                        and d.deptype = 'n') then
    drop schema private;
  end if;
end
$private$;

drop index if exists public.activity_post_idx;
drop index if exists public.activity_comment_idx;
drop index if exists public.activity_actor_idx;
drop index if exists public.comments_author_idx;
drop index if exists public.likes_user_idx;
drop index if exists public.messages_sender_idx;
drop index if exists public.messages_post_idx;
drop index if exists public.post_tags_tagged_by_idx;
drop index if exists public.post_shares_owner_idx;
drop index if exists public.share_events_post_idx;
drop index if exists public.share_events_actor_idx;
drop index if exists public.reports_reporter_idx;
drop index if exists public.reports_post_idx;
drop index if exists public.reports_comment_idx;
drop index if exists public.reports_profile_idx;
drop index if exists public.moderation_actions_post_idx;
drop index if exists public.moderation_actions_comment_idx;
drop index if exists public.moderation_actions_admin_idx;
drop index if exists public.posts_removed_by_idx;
drop index if exists public.comments_removed_by_idx;
drop index if exists public.applications_decided_by_idx;
drop index if exists public.reports_resolved_by_idx;
drop index if exists public.invites_used_by_idx;
drop index if exists public.app_settings_updated_by_idx;
drop index if exists public.profiles_invited_by_idx;
drop index if exists public.profiles_private_idx;
drop index if exists public.follows_followers_idx;
drop index if exists public.likes_post_recent_idx;
drop index if exists public.activity_unread_idx;
drop index if exists public.posts_taken_idx;

commit;
