-- VINTAGE · 0022 · a member's own names and arrangement for their eras
--
-- Eras are read on the phone from the photographs themselves (groupEras,
-- src/utils/memories.ts): a place and a year, or a season and a year.
-- The reading is right most of the time, and the member is the one who
-- knows when it is not: a trip written as two places, a winter that began
-- in the autumn before it, a name that says less than theirs would. So a
-- member may now give an era their own name and move a photograph from
-- one era into another. Eras are still gathered automatically; these are
-- the member's changes on top, applied by the app as it draws them
-- (src/utils/eraEdits.ts).
--
-- One row per member:
--   titles     an automatic era's name, its key ("Lisbon 2023") → the
--              member's name for it
--   moves      a photograph's id → the automatic era it was moved into
--   time_zone  the time zone those keys were read in ("Europe/Lisbon")
-- Both maps are keyed by what the automatic reading makes, so a change
-- whose photograph or era has since gone is simply not applied: a stale
-- edit never breaks Eras. Each time the member saves, the app lets go of
-- the names of eras none of their photographs falls in now, and the moves
-- of photographs since deleted, or into such an era, so the row does not
-- keep what the member deleted. It does so only once it has read all of
-- their photographs (fewer than PostgREST's max_rows), as what is missing
-- from a list cut short is not known to be gone.
--
-- A year, and a season, depend on the time zone they are read in: a
-- photograph taken late on New Year's Eve in Lisbon is already in the new
-- year in Tokyo, and still in the old one in New York. So the row keeps
-- the zone its keys were read in. The app writes the member's own when
-- they first save, and the one already kept every time after, so a
-- member who travels never has their keys read anew. Everyone who lays
-- the row over the member's photographs, the member included, reads them
-- in that zone. Null (no zone) reads them on each phone's own calendar,
-- as Eras were read before there was anything to arrange. An IANA name
-- only: letters, digits and _ + - /, at most 64 of them.
--
-- Other members read a member's Eras too, so the row is on the server,
-- where it outlives a reinstall and every reader sees the same names. Who
-- may read it is exactly who may see the member's photographs, because the
-- names and the arrangement are part of how those photographs are shown.
-- The SELECT policies mirror the live ones on public.posts (0003; 0006
-- 'posts: members read live'; 0018 'posts: not between blocked'): the
-- member, admins, active members when the account is public, accepted
-- followers when it is private, and never across a block. Only the member
-- writes their own row, and only while their membership is active.
-- Signed-out visitors have no access at all.
--
-- updated_at is kept by a trigger. The app writes the row directly (an
-- upsert), not through a function that could stamp it, and a phone's
-- clock is not the database's.
--
-- Additive only: one table, its policies, one trigger. No existing table
-- or policy is touched. No begin or commit of its own, like the other
-- migrations: the runner applies each file in one transaction. Idempotent:
-- if not exists, create or replace, drop ... if exists, and a revoke and
-- grant that end in the same state however often they run.
--
-- Until this file is applied the app reads no edits and offers no
-- editing, and Eras are drawn as they always were.
--
-- Rollback (every member's names and arrangement go with it):
--
--   begin;
--   drop table if exists public.era_edits;
--   drop function if exists public.touch_era_edits();
--   commit;

-- ---------------------------------------------------------------------------
-- the table
-- ---------------------------------------------------------------------------
create table if not exists public.era_edits (
  author_id  uuid primary key references public.profiles (id) on delete cascade,
  titles     jsonb not null default '{}'::jsonb,
  moves      jsonb not null default '{}'::jsonb,
  time_zone  text,
  updated_at timestamptz not null default now(),
  -- Two maps of words: an object each, whose every value is a string.
  -- Strict, as lax jsonpath would look inside a list and pass ["x"] or [].
  constraint era_edits_titles_object check (
    jsonb_typeof(titles) = 'object'
    and not jsonb_path_exists(titles, 'strict $.* ? (@.type() != "string")')
  ),
  constraint era_edits_moves_object check (
    jsonb_typeof(moves) = 'object'
    and not jsonb_path_exists(moves, 'strict $.* ? (@.type() != "string")')
  ),
  constraint era_edits_time_zone check (
    time_zone is null
    or (char_length(time_zone) between 1 and 64 and time_zone ~ '^[A-Za-z0-9_+/-]+$')
  ),
  -- A name is a line under a chapter, not a caption: 1 to 60 characters,
  -- as the app trims it (ERA_TITLE_MAX).
  constraint era_edits_title_length check (
    not jsonb_path_exists(titles, '$.* ? (!(@ like_regex "^.{1,60}$" flag "s"))')
  ),
  -- Room for some hundreds of names and some thousands of moves; enough
  -- that no member meets it, small enough that the row stays a row.
  constraint era_edits_size check (
    octet_length(titles::text) <= 32768
    and octet_length(moves::text) <= 262144
  )
);

alter table public.era_edits enable row level security;

-- ---------------------------------------------------------------------------
-- who reads it: whoever may see the member's photographs
-- ---------------------------------------------------------------------------
drop policy if exists "era_edits: authors read own" on public.era_edits;
create policy "era_edits: authors read own" on public.era_edits
  for select to authenticated using (author_id = auth.uid());

drop policy if exists "era_edits: admins read all" on public.era_edits;
create policy "era_edits: admins read all" on public.era_edits
  for select to authenticated using (public.is_admin(auth.uid()));

-- As 'posts: members read live' (0006): a private member's arrangement is
-- seen by that member and their accepted followers, and nobody else.
drop policy if exists "era_edits: members read" on public.era_edits;
create policy "era_edits: members read" on public.era_edits
  for select to authenticated using (
    public.is_active_member(auth.uid())
    and (
      author_id = auth.uid()
      or not exists (
        select 1 from public.profiles a
        where a.id = author_id and a.is_private
      )
      or exists (
        select 1 from public.follows f
        where f.followee_id = author_id
          and f.follower_id = auth.uid()
          and f.status = 'accepted'
      )
    )
  );

-- As 'posts: not between blocked' (0018): restrictive, so it holds over
-- every policy above. Admins keep their view for moderation.
drop policy if exists "era_edits: not between blocked" on public.era_edits;
create policy "era_edits: not between blocked" on public.era_edits
  as restrictive for select to authenticated using (
    public.is_admin(auth.uid()) or not public.blocked_between(auth.uid(), author_id)
  );

-- ---------------------------------------------------------------------------
-- who writes it: the member, their own row only
-- ---------------------------------------------------------------------------
drop policy if exists "era_edits: authors write own" on public.era_edits;
create policy "era_edits: authors write own" on public.era_edits
  for insert to authenticated with check (
    author_id = auth.uid() and public.is_active_member(auth.uid())
  );

drop policy if exists "era_edits: authors change own" on public.era_edits;
create policy "era_edits: authors change own" on public.era_edits
  for update to authenticated using (author_id = auth.uid())
  with check (author_id = auth.uid() and public.is_active_member(auth.uid()));

drop policy if exists "era_edits: authors delete own" on public.era_edits;
create policy "era_edits: authors delete own" on public.era_edits
  for delete to authenticated using (author_id = auth.uid());

-- Members only, and only what the policies govern. The project's default
-- privileges hand every new table to anon as well, and TRUNCATE, which no
-- policy reaches, to both; this takes them back.
revoke all on table public.era_edits from public, anon, authenticated;
grant select, insert, update, delete on table public.era_edits to authenticated;

-- ---------------------------------------------------------------------------
-- when it last changed, by the database's clock
-- ---------------------------------------------------------------------------
create or replace function public.touch_era_edits()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists era_edits_touch on public.era_edits;
create trigger era_edits_touch
before insert or update on public.era_edits
for each row execute function public.touch_era_edits();

-- A trigger function runs when a row changes; nobody calls it (as 0018).
revoke execute on function public.touch_era_edits() from public, anon, authenticated;
