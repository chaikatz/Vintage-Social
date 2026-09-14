-- VINTAGE · 0017 · push notifications
--
-- A member hears about the things that already appear in Activity — a like,
-- a comment, a new follower, a tag, a message — and about a photograph
-- posted by someone they follow, and, once a day at most, about one of
-- their own photographs from this day in another year.
--
-- How it moves: a database trigger (pg_net) posts the new activity row, or
-- the new post, to the `push` edge function; the function decides who
-- hears what (honouring their preferences), writes the notice through the
-- Expo push service, and stamps the row `pushed_at` so it can never be sent
-- twice. A daily job (pg_cron) asks the same function for the day's
-- memories. Nothing here reads the phone's photo library: a memory is one
-- of the member's own posts, by its capture date.
--
-- Additive only: two tables, two nullable columns, two extensions, triggers,
-- one scheduled job. No policy weakened.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- where a member can be reached
-- ---------------------------------------------------------------------------
create table public.push_tokens (
  token       text primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  platform    text not null check (platform in ('ios', 'android', 'web')),
  device      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Set when the push service reports the device is gone; ignored after.
  invalid_at  timestamptz
);

create index push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

create policy "push_tokens: own" on public.push_tokens
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- what a member wants to hear about
-- ---------------------------------------------------------------------------
create table public.notification_prefs (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  likes       boolean not null default true,
  comments    boolean not null default true,
  follows     boolean not null default true,
  tags        boolean not null default true,
  messages    boolean not null default true,
  posts       boolean not null default true,   -- a photograph from someone you follow
  memories    boolean not null default true,   -- one of yours, from this day in another year
  updated_at  timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

create policy "notification_prefs: own" on public.notification_prefs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- once and only once
-- ---------------------------------------------------------------------------
alter table public.activity add column if not exists pushed_at timestamptz;
alter table public.posts    add column if not exists notified_at timestamptz;

-- ---------------------------------------------------------------------------
-- the hook: where the function lives, per project
-- ---------------------------------------------------------------------------
-- app_settings.push_hook = {"url": "https://<ref>.supabase.co/functions/v1/push",
--                           "key": "<anon key>"}
-- Set per project after this migration; without it the triggers do nothing.
create or replace function public.push_hook()
returns jsonb language sql stable security definer set search_path = public as $$
  select value from public.app_settings where key = 'push_hook'
$$;

/** Post one event to the push function. Fire and forget: a failure here
 * must never fail the like or the comment that caused it. */
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
    ),
    body    := jsonb_build_object('kind', p_kind, 'id', p_id),
    timeout_milliseconds := 5000
  );
exception when others then
  -- A push that could not be asked for is a push that did not happen.
  null;
end;
$$;

create or replace function public.on_activity_push()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.push_event('activity', new.id);
  return new;
end;
$$;

create trigger activity_push_trigger
  after insert on public.activity
  for each row execute function public.on_activity_push();

create or replace function public.on_post_push()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.push_event('post', new.id);
  return new;
end;
$$;

create trigger posts_push_trigger
  after insert on public.posts
  for each row execute function public.on_post_push();

-- Once a day, mid-morning across the Americas, the function looks for
-- memories. It sends at most one per member per day.
select cron.schedule(
  'vintage-memories',
  '0 15 * * *',
  $$ select public.push_event('memories', null) $$
);

revoke execute on function
  public.push_hook(),
  public.push_event(text, uuid)
from public, anon, authenticated;
