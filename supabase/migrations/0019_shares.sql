-- VINTAGE · 0019 · sharing a photograph beyond the club
--
-- A member may send one of their photographs out as a print — to a story,
-- a message, a camera roll — and, with it, a link that lets whoever sees
-- it look at that one photograph on the web and, if they like, ask to
-- join. Nothing else of the member's is reachable through it.
--
--   post_shares    one row per shared post, keyed by a 32-hex token drawn
--                  at random by the database. Only the post's author can
--                  mint one (create_post_share) or turn it off
--                  (revoke_post_share). Members read their own rows only.
--   shared_post    what the public page may know: the photograph's file,
--                  its shape, the place, the date, and the author's
--                  username. Anonymous-callable, by token only. A revoked
--                  share, a removed post, a suspended author, or an
--                  unknown token all answer with nothing — identically.
--   share_events   the loop, counted: share started, link created, page
--                  opened, membership requested. Members write their own
--                  first two; the page writes the last two through the
--                  functions; admins read.
--
-- No existing policy is touched. Additive only.
--
-- NOT YET APPLIED TO PRODUCTION. Applied to staging for testing. Run on
-- production before shipping the build that carries the Story link.

-- ---------------------------------------------------------------------------
-- post_shares
-- ---------------------------------------------------------------------------
create table public.post_shares (
  token          text primary key check (token ~ '^[a-f0-9]{32}$'),
  post_id        uuid not null references public.posts (id) on delete cascade,
  owner_id       uuid not null references public.profiles (id) on delete cascade,
  format         text not null check (format in ('print', 'story')),
  theme          text not null check (theme in ('paper', 'darkroom')),
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  view_count     integer not null default 0,
  last_viewed_at timestamptz
);

create index post_shares_post_idx on public.post_shares (post_id);

alter table public.post_shares enable row level security;

-- Your own links, to see and to know they exist. Writes go through the functions.
create policy "post_shares: read own" on public.post_shares
  for select using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- share_events
-- ---------------------------------------------------------------------------
create table public.share_events (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('share_started', 'link_created', 'page_opened', 'membership_requested')),
  actor_id   uuid references public.profiles (id) on delete set null,
  post_id    uuid references public.posts (id) on delete set null,
  token      text,
  format     text check (format is null or format in ('print', 'story')),
  theme      text check (theme is null or theme in ('paper', 'darkroom')),
  created_at timestamptz not null default now()
);

create index share_events_kind_idx on public.share_events (kind, created_at);

alter table public.share_events enable row level security;

-- A member marks their own share; the page's marks come through the functions below.
create policy "share_events: members write own" on public.share_events
  for insert with check (
    actor_id = auth.uid()
    and kind in ('share_started', 'link_created')
    and public.is_active_member(auth.uid())
  );

create policy "share_events: admins read" on public.share_events
  for select using (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- functions
-- ---------------------------------------------------------------------------
/** The author's link for a post: the live one if there is one, else a new one. */
create or replace function public.create_post_share(p_post_id uuid, p_format text, p_theme text)
returns text
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare
  v_user  uuid := auth.uid();
  v_token text;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_active_member(v_user) then
    raise exception 'Only members can share';
  end if;
  if p_format not in ('print', 'story') or p_theme not in ('paper', 'darkroom') then
    raise exception 'Unknown print';
  end if;
  if not exists (
    select 1 from public.posts p
    where p.id = p_post_id and p.author_id = v_user and p.removed_at is null
  ) then
    raise exception 'Only your own photographs can be shared';
  end if;

  select s.token into v_token
  from public.post_shares s
  where s.post_id = p_post_id and s.owner_id = v_user and s.revoked_at is null
  limit 1;
  if v_token is not null then
    return v_token;
  end if;

  v_token := encode(extensions.gen_random_bytes(16), 'hex');
  insert into public.post_shares (token, post_id, owner_id, format, theme)
  values (v_token, p_post_id, v_user, p_format, p_theme);
  return v_token;
end;
$$;

/** Turn the author's link for a post off. Idempotent. */
create or replace function public.revoke_post_share(p_post_id uuid)
returns void
language sql volatile security definer set search_path = public
as $$
  update public.post_shares
  set revoked_at = now()
  where post_id = p_post_id and owner_id = auth.uid() and revoked_at is null
$$;

/**
 * The one photograph a link points at, for anyone who holds the link.
 * Counts the visit. Returns no row — not an error — for anything that is
 * not a live share of a live post by a member in good standing.
 */
create or replace function public.shared_post(p_token text)
returns table (
  media_path text,
  thumb_path text,
  media_type text,
  width integer,
  height integer,
  location text,
  taken_at timestamptz,
  created_at timestamptz,
  username text
)
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_post_id uuid;
  v_format text;
  v_theme text;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{32}$' then
    return;
  end if;

  select s.post_id, s.format, s.theme into v_post_id, v_format, v_theme
  from public.post_shares s
  join public.posts p on p.id = s.post_id
  join public.profiles a on a.id = p.author_id
  where s.token = p_token
    and s.revoked_at is null
    and p.removed_at is null
    and a.status = 'approved';
  if v_post_id is null then
    return;
  end if;

  update public.post_shares
  set view_count = view_count + 1, last_viewed_at = now()
  where token = p_token;
  insert into public.share_events (kind, post_id, token, format, theme)
  values ('page_opened', v_post_id, p_token, v_format, v_theme);

  return query
  select p.media_path, p.thumb_path, p.media_type, p.width, p.height, p.location, p.taken_at, p.created_at, a.username
  from public.posts p
  join public.profiles a on a.id = p.author_id
  where p.id = v_post_id;
end;
$$;

/** The page says someone asked to join. Only that; only for a live link. */
create or replace function public.record_share_event(p_token text, p_kind text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_post_id uuid;
  v_format text;
  v_theme text;
begin
  if p_kind <> 'membership_requested' then
    return;
  end if;
  if p_token is null or p_token !~ '^[a-f0-9]{32}$' then
    return;
  end if;
  select s.post_id, s.format, s.theme into v_post_id, v_format, v_theme
  from public.post_shares s where s.token = p_token and s.revoked_at is null;
  if v_post_id is null then
    return;
  end if;
  insert into public.share_events (kind, post_id, token, format, theme)
  values (p_kind, v_post_id, p_token, v_format, v_theme);
end;
$$;

revoke execute on function
  public.create_post_share(uuid, text, text),
  public.revoke_post_share(uuid),
  public.shared_post(text),
  public.record_share_event(text, text)
from public, anon, authenticated;

grant execute on function public.create_post_share(uuid, text, text), public.revoke_post_share(uuid) to authenticated;
grant execute on function public.shared_post(text), public.record_share_event(text, text) to anon, authenticated;
