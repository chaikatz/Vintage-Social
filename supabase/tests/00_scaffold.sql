-- Enough of Supabase to run VINTAGE's migrations against a bare PostgreSQL.
--
-- This is deliberately faithful to the parts the policies actually touch —
-- the roles, auth.uid(), auth.users, and the storage tables with their real
-- ownership and unique constraint — because those are what decide whether a
-- policy passes. It is not a Supabase emulator and does not try to be.

create extension if not exists pgcrypto;

-- The three PostgREST roles plus the storage owner. In a real project these
-- exist before any migration runs.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role supabase_storage_admin nologin noinherit;

create schema if not exists auth;
create schema if not exists storage authorization supabase_storage_admin;

grant usage on schema auth, storage, public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth
-- ---------------------------------------------------------------------------
-- The columns the app and the seed actually write. Supabase's real table is
-- much wider, but everything else on it is nullable or defaulted, so an
-- insert that works here works there.
create table auth.users (
  id                  uuid primary key default gen_random_uuid(),
  instance_id         uuid,
  aud                 text,
  role                text,
  email               text unique,
  encrypted_password  text,
  email_confirmed_at  timestamptz,
  raw_app_meta_data   jsonb not null default '{}'::jsonb,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  is_sso_user         boolean not null default false,
  is_anonymous        boolean not null default false
);

-- The real thing, verbatim in behaviour: the subject claim of the request's
-- JWT, or null when the caller is anonymous.
create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

-- ---------------------------------------------------------------------------
-- storage
-- ---------------------------------------------------------------------------
create table storage.buckets (
  id         text primary key,
  name       text not null,
  public     boolean not null default false,
  created_at timestamptz not null default now()
);

-- The unique (bucket_id, name) is what makes `upsert` an
-- `insert ... on conflict do update`, so it matters to these tests.
create table storage.objects (
  id               uuid primary key default gen_random_uuid(),
  bucket_id        text references storage.buckets (id),
  name             text,
  owner            uuid,
  owner_id         text,
  metadata         jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_accessed_at timestamptz not null default now(),
  unique (bucket_id, name)
);

alter table storage.objects owner to supabase_storage_admin;
alter table storage.buckets owner to supabase_storage_admin;
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language plpgsql immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end
$$;

grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Tables and functions the migrations are about to create in `public` get
-- the same blanket grants Supabase hands out, so that row-level security is
-- what gates access rather than a missing GRANT.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
