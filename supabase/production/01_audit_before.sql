-- VINTAGE · production audit — RUN FIRST, CHANGES NOTHING
--
-- Confirms the project is genuinely empty before any VINTAGE migration
-- touches it. Every statement here is a read. If any count below is
-- non-zero, stop: something is already in this project and applying the
-- migrations could collide with it.

select 'existing VINTAGE tables' as check,
       count(*)::text as value,
       'expected 0' as expected
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'profiles','applications','invites','follows','posts','likes','comments',
    'activity','reports','moderation_actions','conversations','messages'
  )

union all
select 'any table in public', count(*)::text, 'expected 0'
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'

union all
select 'auth users', count(*)::text, 'expected 0'
from auth.users

union all
select 'storage buckets', count(*)::text, 'expected 0'
from storage.buckets

union all
select 'VINTAGE functions', count(*)::text, 'expected 0'
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'assign_member_no','decide_application','redeem_invite','create_invite',
    'is_admin','is_active_member','handle_new_user'
  )

union all
select 'member_no_seq exists', count(*)::text, 'expected 0'
from information_schema.sequences
where sequence_schema = 'public' and sequence_name = 'member_no_seq'

union all
select 'pgcrypto installed', count(*)::text, '0 or 1, both fine'
from pg_extension where extname = 'pgcrypto';
