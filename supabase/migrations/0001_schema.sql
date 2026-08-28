-- VINTAGE · 0001 · core schema
-- Tables, constraints, triggers for counters and activity fan-out.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user. Membership status gates the whole app.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  username        text not null unique
                  check (username ~ '^[a-z0-9_.]{3,24}$'),
  full_name       text,
  bio             text not null default '' check (char_length(bio) <= 160),
  avatar_url      text,
  city            text,
  social_handle   text,
  role            text not null default 'member' check (role in ('member', 'admin')),
  status          text not null default 'applied'
                  check (status in ('applied', 'waitlisted', 'approved', 'rejected', 'suspended')),
  invite_quota    integer not null default 0 check (invite_quota >= 0),
  post_count      integer not null default 0,
  follower_count  integer not null default 0,
  following_count integer not null default 0,
  created_at      timestamptz not null default now(),
  approved_at     timestamptz
);

-- ---------------------------------------------------------------------------
-- applications: the membership queue reviewed by admins.
-- ---------------------------------------------------------------------------
create table public.applications (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  full_name        text not null,
  desired_username text not null,
  avatar_url       text,
  social_handle    text,
  city             text,
  inviter          text,
  reason           text not null,
  status           text not null default 'pending'
                   check (status in ('pending', 'approved', 'waitlisted', 'rejected')),
  decided_by       uuid references public.profiles (id),
  decided_at       timestamptz,
  created_at       timestamptz not null default now()
);

create index applications_status_idx on public.applications (status, created_at);
create index applications_user_idx on public.applications (user_id);

-- ---------------------------------------------------------------------------
-- invites: approved members mint codes up to their quota; a code admits one
-- person immediately.
-- ---------------------------------------------------------------------------
create table public.invites (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  created_by uuid not null references public.profiles (id) on delete cascade,
  used_by    uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  used_at    timestamptz
);

create index invites_created_by_idx on public.invites (created_by);

-- ---------------------------------------------------------------------------
-- follows: the chronological social graph.
-- ---------------------------------------------------------------------------
create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create index follows_followee_idx on public.follows (followee_id);

-- ---------------------------------------------------------------------------
-- posts: one photograph (or short video) each, with a mandatory filter.
-- Removal is soft (removed_at) so moderation keeps an audit trail.
-- ---------------------------------------------------------------------------
create table public.posts (
  id               uuid primary key default gen_random_uuid(),
  author_id        uuid not null references public.profiles (id) on delete cascade,
  media_type       text not null check (media_type in ('photo', 'video')),
  media_path       text not null,
  thumb_path       text,
  width            integer,
  height           integer,
  duration_seconds integer check (duration_seconds is null or duration_seconds between 1 and 60),
  filter_id        text not null,
  show_date_stamp  boolean not null default false,
  caption          text not null default '' check (char_length(caption) <= 500),
  like_count       integer not null default 0,
  comment_count    integer not null default 0,
  created_at       timestamptz not null default now(),
  removed_at       timestamptz,
  removed_by       uuid references public.profiles (id)
);

create index posts_author_idx on public.posts (author_id, created_at desc);
create index posts_feed_idx on public.posts (created_at desc) where removed_at is null;

-- ---------------------------------------------------------------------------
-- likes & comments
-- ---------------------------------------------------------------------------
create table public.likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles (id)
);

create index comments_post_idx on public.comments (post_id, created_at);

-- ---------------------------------------------------------------------------
-- activity: likes, comments, follows and moderation notes, per recipient.
-- ---------------------------------------------------------------------------
create table public.activity (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  actor_id     uuid references public.profiles (id) on delete cascade,
  type         text not null check (type in ('like', 'comment', 'follow', 'moderation')),
  post_id      uuid references public.posts (id) on delete cascade,
  comment_id   uuid references public.comments (id) on delete cascade,
  message      text,
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);

create index activity_recipient_idx on public.activity (recipient_id, created_at desc);

-- ---------------------------------------------------------------------------
-- reports & moderation_actions: human moderation, never automated.
-- ---------------------------------------------------------------------------
create table public.reports (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid not null references public.profiles (id) on delete cascade,
  target_type     text not null check (target_type in ('post', 'comment', 'profile')),
  post_id         uuid references public.posts (id) on delete set null,
  comment_id      uuid references public.comments (id) on delete set null,
  profile_id      uuid references public.profiles (id) on delete set null,
  reason          text not null,
  details         text,
  status          text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolution_note text,
  resolved_by     uuid references public.profiles (id),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index reports_status_idx on public.reports (status, created_at);

create table public.moderation_actions (
  id                uuid primary key default gen_random_uuid(),
  admin_id          uuid not null references public.profiles (id),
  target_profile_id uuid not null references public.profiles (id) on delete cascade,
  action            text not null check (action in
                    ('warning', 'suspension', 'reinstatement', 'post_removal', 'comment_removal')),
  post_id           uuid references public.posts (id) on delete set null,
  comment_id        uuid references public.comments (id) on delete set null,
  note              text not null,
  created_at        timestamptz not null default now()
);

create index moderation_actions_target_idx on public.moderation_actions (target_profile_id, created_at desc);

-- ---------------------------------------------------------------------------
-- helper predicates (security definer so RLS policies can consult profiles
-- without recursive policy evaluation)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = p_user and role = 'admin' and status = 'approved'
  );
$$;

create or replace function public.is_active_member(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = p_user and status = 'approved'
  );
$$;

-- ---------------------------------------------------------------------------
-- profile bootstrap: every new auth user gets an 'applied' profile built
-- from the signup metadata.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_username text;
begin
  v_username := lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)));
  v_username := regexp_replace(v_username, '[^a-z0-9_.]', '', 'g');
  if char_length(v_username) < 3 then
    v_username := 'member_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  -- Guarantee uniqueness by suffixing if taken.
  if exists (select 1 from public.profiles where username = v_username) then
    v_username := substr(v_username, 1, 16) || '_' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;

  insert into public.profiles (id, username, full_name)
  values (new.id, v_username, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- counter triggers
-- ---------------------------------------------------------------------------
create or replace function public.bump_post_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set post_count = post_count + 1 where id = new.author_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.profiles set post_count = greatest(0, post_count - 1) where id = old.author_id;
    return old;
  elsif tg_op = 'UPDATE' and old.removed_at is null and new.removed_at is not null then
    update public.profiles set post_count = greatest(0, post_count - 1) where id = new.author_id;
    return new;
  elsif tg_op = 'UPDATE' and old.removed_at is not null and new.removed_at is null then
    update public.profiles set post_count = post_count + 1 where id = new.author_id;
    return new;
  end if;
  return new;
end;
$$;

create trigger posts_count_trigger
  after insert or update or delete on public.posts
  for each row execute function public.bump_post_count();

create or replace function public.bump_follow_counts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set following_count = following_count + 1 where id = new.follower_id;
    update public.profiles set follower_count = follower_count + 1 where id = new.followee_id;
    return new;
  else
    update public.profiles set following_count = greatest(0, following_count - 1) where id = old.follower_id;
    update public.profiles set follower_count = greatest(0, follower_count - 1) where id = old.followee_id;
    return old;
  end if;
end;
$$;

create trigger follows_count_trigger
  after insert or delete on public.follows
  for each row execute function public.bump_follow_counts();

create or replace function public.bump_like_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set like_count = like_count + 1 where id = new.post_id;
    return new;
  else
    update public.posts set like_count = greatest(0, like_count - 1) where id = old.post_id;
    return old;
  end if;
end;
$$;

create trigger likes_count_trigger
  after insert or delete on public.likes
  for each row execute function public.bump_like_count();

create or replace function public.bump_comment_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set comment_count = comment_count + 1 where id = new.post_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.posts set comment_count = greatest(0, comment_count - 1) where id = old.post_id;
    return old;
  elsif tg_op = 'UPDATE' and old.removed_at is null and new.removed_at is not null then
    update public.posts set comment_count = greatest(0, comment_count - 1) where id = new.post_id;
  end if;
  return new;
end;
$$;

create trigger comments_count_trigger
  after insert or update or delete on public.comments
  for each row execute function public.bump_comment_count();

-- ---------------------------------------------------------------------------
-- activity fan-out
-- ---------------------------------------------------------------------------
create or replace function public.notify_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_author uuid;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  if v_author is not null and v_author <> new.user_id then
    insert into public.activity (recipient_id, actor_id, type, post_id)
    values (v_author, new.user_id, 'like', new.post_id);
  end if;
  return new;
end;
$$;

create trigger likes_activity_trigger
  after insert on public.likes
  for each row execute function public.notify_like();

create or replace function public.notify_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_author uuid;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  if v_author is not null and v_author <> new.author_id then
    insert into public.activity (recipient_id, actor_id, type, post_id, comment_id)
    values (v_author, new.author_id, 'comment', new.post_id, new.id);
  end if;
  return new;
end;
$$;

create trigger comments_activity_trigger
  after insert on public.comments
  for each row execute function public.notify_comment();

create or replace function public.notify_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity (recipient_id, actor_id, type)
  values (new.followee_id, new.follower_id, 'follow');
  return new;
end;
$$;

create trigger follows_activity_trigger
  after insert on public.follows
  for each row execute function public.notify_follow();
