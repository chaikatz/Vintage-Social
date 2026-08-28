-- VINTAGE · 0003 · row-level security
-- The rules, in short:
--   * Only approved ("active") members can read social data.
--   * Users can only ever write their own rows — nobody can modify another
--     member's data. Privileged changes go through the definer RPCs in 0002.
--   * Admins read everything they need for the dashboard.

alter table public.profiles           enable row level security;
alter table public.applications      enable row level security;
alter table public.invites           enable row level security;
alter table public.follows           enable row level security;
alter table public.posts             enable row level security;
alter table public.likes             enable row level security;
alter table public.comments          enable row level security;
alter table public.activity          enable row level security;
alter table public.reports           enable row level security;
alter table public.moderation_actions enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- Everyone signed in can read their own profile (needed for the gate);
-- approved members can read other members; admins read everyone.
create policy "profiles: read own" on public.profiles
  for select using (id = auth.uid());

create policy "profiles: members read members" on public.profiles
  for select using (
    public.is_active_member(auth.uid())
    and status in ('approved', 'suspended')
  );

create policy "profiles: admins read all" on public.profiles
  for select using (public.is_admin(auth.uid()));

-- Only your own row, and never the privileged columns: role, status and
-- invite_quota changes are blocked by comparing against the stored row.
create policy "profiles: update own" on public.profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select p.role from public.profiles p where p.id = auth.uid())
    and status = (select p.status from public.profiles p where p.id = auth.uid())
    and invite_quota = (select p.invite_quota from public.profiles p where p.id = auth.uid())
  );

-- Inserts happen only via the auth trigger (definer), so no insert policy.

-- ---------------------------------------------------------------------------
-- applications
-- ---------------------------------------------------------------------------
create policy "applications: submit own" on public.applications
  for insert with check (user_id = auth.uid());

create policy "applications: read own" on public.applications
  for select using (user_id = auth.uid());

create policy "applications: admins read" on public.applications
  for select using (public.is_admin(auth.uid()));

-- Decisions go through decide_application(); no direct update policy for
-- non-admins, and even admins use the RPC.

-- ---------------------------------------------------------------------------
-- invites
-- ---------------------------------------------------------------------------
-- Minting and redemption go through RPCs. Members see the codes they created.
create policy "invites: read own" on public.invites
  for select using (created_by = auth.uid() or used_by = auth.uid());

create policy "invites: admins read" on public.invites
  for select using (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- follows
-- ---------------------------------------------------------------------------
create policy "follows: members read" on public.follows
  for select using (public.is_active_member(auth.uid()));

create policy "follows: follow as self" on public.follows
  for insert with check (
    follower_id = auth.uid() and public.is_active_member(auth.uid())
  );

create policy "follows: unfollow as self" on public.follows
  for delete using (follower_id = auth.uid());

-- ---------------------------------------------------------------------------
-- posts
-- ---------------------------------------------------------------------------
-- Members see live posts; authors see their own (including removed); admins
-- see everything.
create policy "posts: members read live" on public.posts
  for select using (
    public.is_active_member(auth.uid()) and removed_at is null
  );

create policy "posts: authors read own" on public.posts
  for select using (author_id = auth.uid());

create policy "posts: admins read all" on public.posts
  for select using (public.is_admin(auth.uid()));

create policy "posts: create as self" on public.posts
  for insert with check (
    author_id = auth.uid()
    and public.is_active_member(auth.uid())
    and removed_at is null
    and removed_by is null
    and like_count = 0
    and comment_count = 0
  );

create policy "posts: authors edit caption" on public.posts
  for update using (author_id = auth.uid())
  with check (author_id = auth.uid());

create policy "posts: authors delete own" on public.posts
  for delete using (author_id = auth.uid());

-- ---------------------------------------------------------------------------
-- likes
-- ---------------------------------------------------------------------------
create policy "likes: members read" on public.likes
  for select using (public.is_active_member(auth.uid()));

create policy "likes: like as self" on public.likes
  for insert with check (
    user_id = auth.uid() and public.is_active_member(auth.uid())
  );

create policy "likes: unlike as self" on public.likes
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------
create policy "comments: members read live" on public.comments
  for select using (
    public.is_active_member(auth.uid()) and removed_at is null
  );

create policy "comments: admins read all" on public.comments
  for select using (public.is_admin(auth.uid()));

create policy "comments: comment as self" on public.comments
  for insert with check (
    author_id = auth.uid()
    and public.is_active_member(auth.uid())
    and removed_at is null
    and removed_by is null
  );

create policy "comments: delete own" on public.comments
  for delete using (author_id = auth.uid());

-- ---------------------------------------------------------------------------
-- activity
-- ---------------------------------------------------------------------------
-- Rows are written by definer triggers/RPCs; recipients read and mark read.
create policy "activity: read own" on public.activity
  for select using (recipient_id = auth.uid());

create policy "activity: mark read" on public.activity
  for update using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------
create policy "reports: file as self" on public.reports
  for insert with check (
    reporter_id = auth.uid()
    and public.is_active_member(auth.uid())
    and status = 'open'
    and resolved_by is null
  );

create policy "reports: read own" on public.reports
  for select using (reporter_id = auth.uid());

create policy "reports: admins read" on public.reports
  for select using (public.is_admin(auth.uid()));

-- Resolution goes through resolve_report().

-- ---------------------------------------------------------------------------
-- moderation_actions
-- ---------------------------------------------------------------------------
-- Written only by definer RPCs. Members may see actions about themselves
-- (their warnings); admins see the full log.
create policy "moderation: read own" on public.moderation_actions
  for select using (target_profile_id = auth.uid());

create policy "moderation: admins read" on public.moderation_actions
  for select using (public.is_admin(auth.uid()));
