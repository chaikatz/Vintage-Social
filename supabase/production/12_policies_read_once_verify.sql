-- VINTAGE · production · verify 0023-0025 (policies read the caller once;
-- block checks answer only for the caller; the home feed in one piece)
--
-- Run after applying, in order, supabase/migrations/
-- 0023_policies_read_once.sql, 0024_block_checks_answer_for_the_caller.sql
-- and 0025_feed_page.sql. Read-only: every statement is a SELECT, and the
-- one block at the end only plans a query (EXPLAIN without ANALYZE runs
-- nothing) and then raises, so even its role change is rolled back.
-- Nothing is written. The same script runs on the policy harness at the
-- end of npm run test:rls, so its expectations are tested too.
--
-- Each row says what it checked, what it found and what it should be.
-- Every `ok` must read true. If any does not, do not ship the build that
-- relies on them; the rollbacks are supabase/tests/0023_rollback.sql and
-- the notes at the top of 0024 and 0025, and none changes any data.
-- (Rows 7-9 name functions 0023 makes: before 0023, row 8 and 9 stop the
-- script with "function does not exist", which is itself the answer.)

with checks as (
  -- 1. No policy reads the caller, or asks is_admin / is_active_member,
  --    a row at a time. (These are the advisor's auth_rls_initplan.)
  select 1 as n, 'policies reading auth.uid() per row' as what,
         count(*)::text as found, '0' as expected
  from pg_policies
  where schemaname in ('public', 'storage')
    and regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                       '\( SELECT auth\.uid\(\) AS uid\)', '', 'g') ~ 'auth\.uid\(\)'
  union all
  select 2, 'policies calling is_admin / is_active_member per row', count(*)::text, '0'
  from pg_policies
  where schemaname in ('public', 'storage')
    and regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                       'SELECT (is_admin|is_active_member)\(', '', 'g') ~ '(is_admin|is_active_member)\('
  union all
  -- 2. Only the five pair checks (conversations x2, follows insert, tags
  --    insert, messages insert) still call blocked_between; none reads
  --    the caller.
  select 3, 'policies still calling blocked_between / blocked_by', count(*)::text, '5'
  from pg_policies
  where schemaname = 'public'
    and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ 'blocked_(between|by)\('
  union all
  -- 3. Every policy is still there: 70 on public, 8 on storage.objects,
  --    as before 0023 (0023 replaces policies; it adds and removes none).
  select 4, 'policies on public', count(*)::text, '70'
  from pg_policies where schemaname = 'public'
  union all
  select 5, 'policies on storage.objects (VINTAGE''s own)', count(*)::text, '8'
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname ~ '^(avatars|media): '
  union all
  select 6, 'restrictive policies (blocking)', count(*)::text, '14'
  from pg_policies where schemaname = 'public' and permissive = 'RESTRICTIVE'
  union all
  -- 4. The three functions, in private (the API does not publish it), members only.
  select 7, 'my_block_partners, my_blockers, own_profile_unchanged exist', count(*)::text, '3'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname in ('my_block_partners', 'my_blockers', 'own_profile_unchanged')
    and p.prosecdef
  union all
  select 8, 'anon may call them', count(*)::text, '0'
  from (values ('private.my_block_partners()'), ('private.my_blockers()'),
               ('private.own_profile_unchanged(text, text, integer, integer, uuid, boolean)')) f(sig)
  where has_function_privilege('anon', f.sig, 'execute')
  union all
  select 9, 'members may call them', count(*)::text, '3'
  from (values ('private.my_block_partners()'), ('private.my_blockers()'),
               ('private.own_profile_unchanged(text, text, integer, integer, uuid, boolean)')) f(sig)
  where has_function_privilege('authenticated', f.sig, 'execute')
  union all
  -- 5. The thirty indexes, built and valid.
  select 10, 'new indexes present and valid', count(*)::text, '30'
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and i.indisvalid and i.indisready
    and c.relname in (
     'activity_post_idx', 'activity_comment_idx', 'activity_actor_idx', 'comments_author_idx',
     'likes_user_idx', 'messages_sender_idx', 'messages_post_idx', 'post_tags_tagged_by_idx',
     'post_shares_owner_idx', 'share_events_post_idx', 'share_events_actor_idx',
     'reports_reporter_idx', 'reports_post_idx', 'reports_comment_idx', 'reports_profile_idx',
     'moderation_actions_post_idx', 'moderation_actions_comment_idx', 'moderation_actions_admin_idx',
     'posts_removed_by_idx', 'comments_removed_by_idx', 'applications_decided_by_idx',
     'reports_resolved_by_idx', 'invites_used_by_idx', 'app_settings_updated_by_idx',
     'profiles_invited_by_idx', 'profiles_private_idx', 'follows_followers_idx',
     'likes_post_recent_idx', 'activity_unread_idx', 'posts_taken_idx')
  union all
  -- 6. Every foreign key in public has an index that starts with it (the
  --    advisor's unindexed_foreign_keys).
  select 11, 'foreign keys without a covering index', count(*)::text, '0'
  from pg_constraint k
  join pg_class t on t.oid = k.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where k.contype = 'f' and n.nspname = 'public'
    and array_length(k.conkey, 1) = 1
    and not exists (
      select 1 from pg_index i
      where i.indrelid = k.conrelid and i.indkey[0] = k.conkey[1])
  union all
  -- 7. Row-level security still on everywhere it was.
  select 12, 'public tables without row-level security', count(*)::text, '0'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  union all
  -- 8. 0024: the block checks answer only about the caller.
  select 13, '0024: blocked_between / blocked_by ask who is calling', count(*)::text, '2'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('blocked_between', 'blocked_by')
    and p.prosrc ~ 'auth\.uid\(\)' and p.prosecdef
  union all
  -- 9. 0025: the home feed function, run as the caller, members only.
  select 14, '0025: feed_page runs as the caller', count(*)::text, '1'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'feed_page' and not p.prosecdef
  union all
  select 15, '0025: feed_page callable by members, not by signed-out visitors', count(*)::text, '1'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'feed_page'
    and has_function_privilege('authenticated', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute')
)
select n, what, found, expected, found = expected as ok
from checks
order by n;

-- 8. What a member's Explore is planned as, now. Plans only (EXPLAIN
--    without ANALYZE runs nothing), as the first approved member, and the
--    block always raises at the end, so the role it takes is given back.
--    Read the message it ends with: every line should say yes.
do $plan$
declare
  v_member uuid;
  v_line   record;
  v_plan   text := '';
begin
  select id into v_member from public.profiles
  where status = 'approved' and not is_house order by member_no nulls last limit 1;
  if v_member is null then
    raise exception 'No approved member to plan as.';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  for v_line in execute format(
    'explain select p.* from public.posts p
      where p.removed_at is null and p.author_id <> %L
      order by p.created_at desc limit 60', v_member)
  loop
    v_plan := v_plan || v_line."QUERY PLAN" || E'\n';
  end loop;
  execute 'reset role';

  raise exception E'\n\nRESULT (planned only, nothing was run or written):\n'
    '  the caller is read once (InitPlan):              %\n'
    '  the JWT is not parsed per row:                   %\n'
    '  Explore walks posts_feed_idx and stops early:    %\n'
    '  the follows check does not read all of follows:  %\n',
    case when v_plan ~ 'InitPlan' then 'yes' else 'NO' end,
    case when v_plan !~ 'current_setting' then 'yes' else 'NO' end,
    case when v_plan ~ 'posts_feed_idx' then 'yes' else 'NO' end,
    case when v_plan !~ 'Seq Scan on follows' then 'yes' else 'NO' end;
end
$plan$;
