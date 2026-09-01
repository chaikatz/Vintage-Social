-- VINTAGE · production verification — RUN AFTER 0001–0007, CHANGES NOTHING
--
-- Proves the schema landed, the guard rails are on, and — the part that
-- matters most before anyone joins — that the membership counter has never
-- issued a number, so the first real approved member will be no. 1.

-- 1. Tables ------------------------------------------------------------------
select 'tables created' as check,
       count(*)::text as value,
       '12 expected' as expected
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
  and table_name in (
    'profiles','applications','invites','follows','posts','likes','comments',
    'activity','reports','moderation_actions','conversations','messages'
  )

-- 2. Row-level security is on for every one of them --------------------------
union all
select 'tables WITHOUT row-level security',
       coalesce(string_agg(c.relname, ', '), 'none'),
       'none expected'
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity

-- 3. Storage -----------------------------------------------------------------
union all
select 'storage buckets',
       coalesce(string_agg(id, ', ' order by id), 'none'),
       'avatars, media, thumbnails'
from storage.buckets

-- 4. The membership machinery ------------------------------------------------
union all
select 'assign_member_no exists', count(*)::text, '1 expected'
from information_schema.routines
where routine_schema = 'public' and routine_name = 'assign_member_no'

union all
select 'founding member limit',
       coalesce((select public.founding_member_limit()::text), 'missing'),
       '10000 expected'

-- 5. Nobody is here yet ------------------------------------------------------
union all
select 'profiles', count(*)::text, '0 expected' from public.profiles
union all
select 'auth users', count(*)::text, '0 expected' from auth.users
union all
select 'posts', count(*)::text, '0 expected' from public.posts
union all
select 'invites (nominations)', count(*)::text, '0 expected' from public.invites

-- 6. THE ONE THAT DECIDES MEMBER #1 ------------------------------------------
-- last_value with is_called = false means the sequence has never been drawn
-- from, so the next nextval() returns exactly last_value.
union all
select 'membership numbers already issued', count(*)::text, '0 expected'
from public.profiles where member_no is not null

union all
select 'NEXT MEMBER NUMBER WILL BE',
       (select case when is_called then last_value + 1 else last_value end::text
        from public.member_no_seq),
       '1 expected';
