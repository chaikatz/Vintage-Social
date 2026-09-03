-- VINTAGE · 0012 · one invitation link per member
--
-- Replaces the one-shot code with a durable link, and moves the moment an
-- invitation is spent from *sending* to *joining*.
--
-- The old model made a member ration something they could not see the
-- effect of: mint a code, deliver the code by hand, hope it is used, and
-- meanwhile the count has already gone down. Sending cost you one whether
-- or not anybody came. So people hoarded them.
--
-- Now: every member has exactly one link, they can share it with whoever
-- they like, and the allowance is only spent when somebody actually joins
-- through it. Sharing is free; only success costs. The link can be given a
-- custom suffix so it reads as theirs, and rotated if it gets somewhere it
-- should not have.
--
-- The old `invites` table and its create_invite/redeem_invite functions are
-- left in place, unused, so no history is lost. Nothing calls them.

-- ---------------------------------------------------------------------------
-- the link
-- ---------------------------------------------------------------------------
create table public.invite_links (
  owner_id   uuid primary key references public.profiles (id) on delete cascade,
  -- 8-64 characters, lowercase letters, digits and hyphens, never starting
  -- or ending with a hyphen. Enforced here as well as in the setter, since
  -- a check constraint is the only guard that cannot be forgotten.
  slug       text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{6,62}[a-z0-9]$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index invite_links_slug_idx on public.invite_links (slug);

alter table public.invite_links enable row level security;

-- A member sees their own link and nothing else. The public lookup that the
-- invitation page needs goes through a definer function below, so the table
-- itself is never exposed to anon.
create policy "invite links: read own" on public.invite_links
  for select using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- what a suffix may not be
-- ---------------------------------------------------------------------------
-- Words that would make a link read as though it came from VINTAGE itself,
-- or that collide with a route the invitation site needs.
create or replace function public.reserved_invite_slugs()
returns text[] language sql immutable set search_path = public as $$
  select array[
    'vintage', 'vintagesocial', 'vintage-social', 'official', 'admin', 'root',
    'invite', 'invites', 'invitation', 'invitations', 'join', 'signup', 'sign-up',
    'signin', 'sign-in', 'login', 'logout', 'register', 'account', 'accounts',
    'member', 'members', 'membership', 'founder', 'founders', 'founding',
    'app', 'api', 'www', 'mail', 'email', 'support', 'help', 'contact',
    'about', 'terms', 'privacy', 'legal', 'security', 'settings', 'billing',
    'download', 'install', 'testflight', 'appstore', 'app-store', 'ios',
    'explore', 'search', 'feed', 'profile', 'photos', 'moderation', 'staff'
  ]
$$;

/**
 * Is this suffix usable? Format, reserved list, and uniqueness in one
 * answer, so the field can say why as you type.
 *
 * Returns 'ok', or a short reason: 'format', 'reserved', 'taken'.
 */
create or replace function public.invite_slug_status(p_slug text)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_slug text := lower(trim(coalesce(p_slug, '')));
begin
  if v_slug !~ '^[a-z0-9][a-z0-9-]{6,62}[a-z0-9]$' then
    return 'format';
  end if;
  -- A reserved word is out on its own, but also as the whole of a suffix
  -- padded with hyphens ("the-vintage" is fine, "vintage" is not).
  if v_slug = any (public.reserved_invite_slugs()) then
    return 'reserved';
  end if;
  if exists (
    select 1 from public.invite_links l
    where l.slug = v_slug and l.owner_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    return 'taken';
  end if;
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- minting and rotating
-- ---------------------------------------------------------------------------
create or replace function public.random_invite_slug()
returns text
language plpgsql volatile set search_path = public
as $$
declare
  alphabet constant text := 'abcdefghijkmnpqrstuvwxyz23456789';
  slug text := '';
  i integer;
begin
  for i in 1..12 loop
    slug := slug || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
  end loop;
  return slug;
end;
$$;

/**
 * The caller's link, made on first use.
 *
 * A member should never have to think about "creating" one — they have a
 * link the same way they have a username. The first suffix is derived from
 * that username where it fits the rules, because a link somebody can read
 * is worth more than a random token, and falls back to a token where it
 * does not.
 */
create or replace function public.ensure_invite_link()
returns table (slug text, allowance integer, used integer)
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_slug  text;
  v_from  text;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_active_member(v_user) then
    raise exception 'Only approved members have invitations';
  end if;

  select l.slug into v_slug from public.invite_links l where l.owner_id = v_user;

  if v_slug is null then
    -- Try the username first: "chai.katz" reads as "chai-katz".
    select replace(p.username, '.', '-') into v_from from public.profiles p where p.id = v_user;
    if public.invite_slug_status(v_from) = 'ok' then
      v_slug := v_from;
    else
      loop
        v_slug := public.random_invite_slug();
        exit when not exists (select 1 from public.invite_links where invite_links.slug = v_slug);
      end loop;
    end if;
    insert into public.invite_links (owner_id, slug) values (v_user, v_slug)
    on conflict (owner_id) do nothing;
    select l.slug into v_slug from public.invite_links l where l.owner_id = v_user;
  end if;

  return query
  select v_slug,
         p.invite_quota,
         (select count(*)::integer from public.profiles c where c.invited_by = v_user)
  from public.profiles p where p.id = v_user;
end;
$$;

/** Give the link a suffix of the member's choosing. The old URL stops
 * working; everybody who already joined stays attributed to them. */
create or replace function public.set_invite_slug(p_slug text)
returns text
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_slug   text := lower(trim(coalesce(p_slug, '')));
  v_status text;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_active_member(v_user) then
    raise exception 'Only approved members have invitations';
  end if;

  v_status := public.invite_slug_status(v_slug);
  if v_status = 'format' then
    raise exception 'A suffix is 8 to 64 letters, numbers or hyphens, and cannot begin or end with a hyphen.';
  elsif v_status = 'reserved' then
    raise exception 'That suffix is reserved.';
  elsif v_status = 'taken' then
    raise exception 'That suffix is already in use.';
  end if;

  insert into public.invite_links (owner_id, slug) values (v_user, v_slug)
  on conflict (owner_id) do update set slug = excluded.slug, updated_at = now();

  return v_slug;
end;
$$;

/** Retire the current link and issue a new one. What "revoke" means when a
 * member has exactly one link: the address they gave out stops working. */
create or replace function public.rotate_invite_link()
returns text
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_slug text;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_active_member(v_user) then
    raise exception 'Only approved members have invitations';
  end if;

  loop
    v_slug := public.random_invite_slug();
    exit when not exists (select 1 from public.invite_links where invite_links.slug = v_slug);
  end loop;

  insert into public.invite_links (owner_id, slug) values (v_user, v_slug)
  on conflict (owner_id) do update set slug = excluded.slug, updated_at = now();

  return v_slug;
end;
$$;

-- ---------------------------------------------------------------------------
-- what the invitation page is allowed to know
-- ---------------------------------------------------------------------------
/**
 * Who is behind this link, and can it still admit anyone?
 *
 * Called by the invitation web page before the recipient has an account, so
 * it answers to anon — and therefore says as little as possible: a display
 * name and whether the door is open. No ids, no counts, no email, nothing
 * about the member's own account. An unknown slug is indistinguishable from
 * one whose allowance is spent, so the endpoint cannot be used to sweep for
 * live links.
 */
create or replace function public.invite_link_owner(p_slug text)
returns table (inviter text, open boolean)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_owner uuid;
  v_name  text;
  v_quota integer;
  v_used  integer;
begin
  select l.owner_id into v_owner
  from public.invite_links l where l.slug = lower(trim(coalesce(p_slug, '')));

  if v_owner is null then
    return query select null::text, false;
    return;
  end if;

  select coalesce(nullif(p.full_name, ''), p.username), p.invite_quota
    into v_name, v_quota
  from public.profiles p where p.id = v_owner and p.status = 'approved';

  if v_name is null then
    return query select null::text, false;
    return;
  end if;

  select count(*)::integer into v_used from public.profiles c where c.invited_by = v_owner;
  return query select v_name, (v_used < v_quota);
end;
$$;

-- ---------------------------------------------------------------------------
-- joining
-- ---------------------------------------------------------------------------
/**
 * Take up an invitation. Replaces redeem_invite.
 *
 * The allowance is checked and spent here — the one place a join actually
 * happens — with the inviter's row locked, so two people arriving on the
 * same link at the same moment cannot both take the last place.
 */
create or replace function public.join_with_invite(p_slug text)
returns boolean
language plpgsql volatile security definer set search_path = public
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- grants, in the manner of 0008: nothing is reachable unless it is listed
-- ---------------------------------------------------------------------------
revoke execute on function
  public.reserved_invite_slugs(),
  public.random_invite_slug(),
  public.invite_slug_status(text),
  public.ensure_invite_link(),
  public.set_invite_slug(text),
  public.rotate_invite_link(),
  public.invite_link_owner(text),
  public.join_with_invite(text)
from public, anon, authenticated;

-- The invitation page reads this before its visitor has an account.
grant execute on function public.invite_link_owner(text) to anon, authenticated;

-- Members manage their own link; each function checks membership itself.
grant execute on function public.invite_slug_status(text) to authenticated;
grant execute on function public.ensure_invite_link()     to authenticated;
grant execute on function public.set_invite_slug(text)    to authenticated;
grant execute on function public.rotate_invite_link()     to authenticated;
grant execute on function public.join_with_invite(text)   to authenticated;
