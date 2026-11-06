-- VINTAGE · production · verify 0023-0027 (policies read the caller once;
-- block checks answer only for the caller; the home feed in one piece;
-- a photograph's followers in order; Expo's receipts)
--
-- Run after applying, in order, supabase/migrations/
-- 0023_policies_read_once.sql, 0024_block_checks_answer_for_the_caller.sql,
-- 0025_feed_page.sql, 0026_followers_in_order.sql and
-- 0027_push_tickets.sql. Paste the whole file into the SQL editor and run
-- it once. Read-only: the block at the start only plans a query (EXPLAIN
-- without ANALYZE runs nothing) as a member and keeps what it saw in a
-- setting of this session, and the one SELECT at the end reads the
-- catalogues and that setting. Nothing is written. The same script runs
-- on the policy harness at the end of npm run test:rls, so its
-- expectations are tested too.
--
-- The result is one table, the last statement's, which is the one the
-- SQL editor shows: each row says what it checked, what it found and
-- what it should be. Every `ok` must read true. If any does not, do not
-- ship the build that relies on them; the rollbacks are
-- supabase/tests/0023_rollback.sql and the notes at the top of 0024-0027,
-- and none changes any member's data. Run before the migrations, it runs
-- just the same and says false where they have not been applied.

-- What a member's Explore is planned as, now: planned only, as the first
-- approved member, and the role it takes is given back before it ends.
-- Sequential scans are discouraged while it plans (enable_seqscan off,
-- for this plan only): on tables as small as today's, reading a whole
-- table is often the cheaper plan and is no fault, so the answers say
-- what the indexes allow, whatever the size of the tables. The four
-- answers are kept in the setting vintage.verify_plan for the table
-- below. It never stops the script: a plan it could not make is an
-- answer too, and reads as not ok below.
do $plan$
declare
  v_member uuid;
  v_line   record;
  v_plan   text := '';
  v_answer text;
begin
  select id into v_member from public.profiles
  where status = 'approved' and not is_house order by member_no nulls last limit 1;
  if v_member is null then
    perform set_config('vintage.verify_plan', 'no approved member to plan as', false);
    return;
  end if;

  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    execute 'set local enable_seqscan = off';
    for v_line in execute format(
      'explain select p.* from public.posts p
        where p.removed_at is null and p.author_id <> %L
        order by p.created_at desc limit 60', v_member)
    loop
      v_plan := v_plan || v_line."QUERY PLAN" || E'\n';
    end loop;
    execute 'reset enable_seqscan';
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    v_answer := concat_ws('|',
      case when v_plan ~ 'InitPlan' then 'yes' else 'no' end,
      case when v_plan !~ 'current_setting' then 'yes' else 'no' end,
      case when v_plan ~ 'posts_feed_idx' then 'yes' else 'no' end,
      case when v_plan !~ 'Seq Scan on follows' then 'yes' else 'no' end);
  exception when others then
    -- The role, setting and claims taken above are undone with the failed step.
    v_answer := 'could not plan: ' || replace(sqlerrm, '|', '/');
  end;
  perform set_config('vintage.verify_plan', v_answer, false);
end
$plan$;

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
  -- 4. 0023's three helpers: in the schema private, which the API does not
  --    publish, run as their owner, members only.
  select 7, 'my_block_partners, my_blockers, own_profile_unchanged in private', count(*)::text, '3'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname in ('my_block_partners', 'my_blockers', 'own_profile_unchanged')
    and p.prosecdef
  union all
  select 8, 'signed-out visitors may call them', count(*)::text, '0'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname in ('my_block_partners', 'my_blockers', 'own_profile_unchanged')
    and has_function_privilege('anon', p.oid, 'execute')
  union all
  select 9, 'members may call them (the policies do, as the member)', count(*)::text, '3'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname in ('my_block_partners', 'my_blockers', 'own_profile_unchanged')
    and has_function_privilege('authenticated', p.oid, 'execute')
  union all
  -- PostgREST publishes every function in public a member may execute, at
  -- /rest/v1/rpc/<name>; there, my_blockers() would tell a member who has
  -- blocked them.
  select 10, 'of them, left in public where the API would publish them', count(*)::text, '0'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('my_block_partners', 'my_blockers', 'own_profile_unchanged')
  union all
  -- 5. The thirty indexes, built and valid.
  select 11, '0023''s indexes present and valid', count(*)::text, '30'
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
  select 12, 'foreign keys without a covering index', count(*)::text, '0'
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
  select 13, 'public tables without row-level security', count(*)::text, '0'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  union all
  -- 8. 0024: the block checks answer only about the caller.
  select 14, '0024: blocked_between / blocked_by ask who is calling', count(*)::text, '2'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('blocked_between', 'blocked_by')
    and p.prosrc ~ 'auth\.uid\(\)' and p.prosecdef
  union all
  -- 9. 0025: the home feed function, run as the caller, members only,
  --    planned with the list of who the caller follows.
  select 15, '0025: feed_page runs as the caller', count(*)::text, '1'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'feed_page' and not p.prosecdef
  union all
  select 16, '0025: feed_page callable by members, not by signed-out visitors', count(*)::text, '1'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'feed_page'
    and has_function_privilege('authenticated', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute')
  union all
  select 17, '0025: feed_page plans its posts with the author list in hand', count(*)::text, '1'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public' and p.proname = 'feed_page'
    and l.lanname = 'plpgsql' and p.prosrc ~ 'author_id = any \(\$1\)'
  union all
  -- 10. 0026: an author's followers in follower order, for the push function.
  select 18, '0026: follows_followers_by_id_idx present and valid', count(*)::text, '1'
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'follows_followers_by_id_idx'
    and i.indisvalid and i.indisready
  union all
  -- 11. 0027: Expo's tickets, the push function's alone.
  select 19, '0027: push_tickets, row-level security on, nothing for members or visitors', count(*)::text, '1'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'push_tickets' and c.relrowsecurity
    and not exists (select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                     where a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole))
    and not exists (select 1 from pg_policy pol where pol.polrelid = c.oid)
  union all
  -- 12. Explore, planned as a member (the block above).
  select 20, 'Explore as a member: the caller is read once (InitPlan)',
         split_part(coalesce(current_setting('vintage.verify_plan', true), 'not planned'), '|', 1), 'yes'
  union all
  select 21, 'Explore as a member: the JWT is not parsed per row',
         coalesce(nullif(split_part(coalesce(current_setting('vintage.verify_plan', true), ''), '|', 2), ''), 'not planned'), 'yes'
  union all
  select 22, 'Explore as a member: can walk posts_feed_idx and stop early',
         coalesce(nullif(split_part(coalesce(current_setting('vintage.verify_plan', true), ''), '|', 3), ''), 'not planned'), 'yes'
  union all
  select 23, 'Explore as a member: the follows check need not read all of follows',
         coalesce(nullif(split_part(coalesce(current_setting('vintage.verify_plan', true), ''), '|', 4), ''), 'not planned'), 'yes'
)
select n, what, found, expected, coalesce(found = expected, false) as ok
from checks
order by n;
