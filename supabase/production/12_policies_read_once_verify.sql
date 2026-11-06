-- VINTAGE · production · verify 0023-0038 (policies read the caller once;
-- block checks answer only for the caller; the home feed in one piece,
-- paged by cursor; a photograph's followers in order; Expo's receipts;
-- comments, likes and tags only with their photograph; decisions reach
-- the profile; a removal once; reports outlive their reporter and reach
-- the admins; what a member reports leaves their view; the house
-- thumbnails at a standard size; a member's own files whatever their
-- membership; a phone's push token under whoever signed in on it last;
-- unread messages counted in the database; follows that respect private
-- accounts)
--
-- Run after applying, in number order, every file in supabase/migrations
-- from 0023_policies_read_once.sql to
-- 0038_follows_respect_private_accounts.sql. Paste the whole file into
-- the SQL editor and run it once. Read-only: the block at the start only plans a query (EXPLAIN
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
-- supabase/tests/0023_rollback.sql and the notes at the top of 0024-0038,
-- and none of 0023-0028 or 0030-0037 changes any member's data (0029
-- repairs profiles left at "applied", 0034 the house photographs'
-- thumbnails, 0038 recounts follower and following counts that are off,
-- none on production on 6 November; each says how to put them back). Run before the
-- migrations, it runs just the same and says false where they have not
-- been applied.

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
  --    as before 0023 (0023 replaces policies; it adds and removes none),
  --    the four restrictive ones 0028 and 0033 add, and the followee's
  --    two 0038 adds: 76.
  select 4, 'policies on public', count(*)::text, '76'
  from pg_policies where schemaname = 'public'
  union all
  select 5, 'policies on storage.objects (VINTAGE''s own)', count(*)::text, '8'
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname ~ '^(avatars|media): '
  union all
  select 6, 'restrictive policies (blocking, 0028, 0033)', count(*)::text, '18'
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
  union all
  -- 13. 0025, as it is now: the next page after the last post held, no offset.
  select 24, '0025: feed_page takes a cursor (time, id), and no offset version is left',
         coalesce(string_agg(pg_get_function_identity_arguments(p.oid), ' | '), 'none'),
         'p_limit integer, p_before_at timestamp with time zone, p_before_id uuid'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'feed_page'
  union all
  -- 14. 0028: comments, likes and tags only with their photograph.
  select 25, '0028: comments, likes, tags read only with their photograph (restrictive, reader once)', count(*)::text, '3'
  from pg_policies
  where schemaname = 'public' and permissive = 'RESTRICTIVE' and cmd = 'SELECT'
    and policyname in ('comments: only with their photograph', 'likes: only with their photograph',
                       'post_tags: only with their photograph')
    and qual ~ 'EXISTS' and qual ~ '\( SELECT auth\.uid\(\) AS uid\)'
  union all
  -- 15. 0029: a waitlist or a rejection is written to the profile, an
  --     approval never lifts a suspension, and no profile is left at
  --     "applied" after its application was decided.
  select 26, '0029: decide_application writes a waitlist or rejection to the profile', count(*)::text, '1'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'decide_application'
    and p.prosrc ~ 'p_decision in \(''waitlisted'', ''rejected''\)'
    and p.prosrc ~ 'status in \(''applied'', ''waitlisted'', ''rejected''\)'
  union all
  select 27, '0029: an approval refuses a suspended account (never lifts a suspension)', count(*)::text, '1'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'decide_application'
    and p.prosrc ~ 'if v_status = ''suspended'' then\s+[a-z]+ exception ''This account is suspended'''
  union all
  select 28, '0029: profiles at applied whose latest application was decided', count(*)::text, '0'
  from public.profiles pr
  join lateral (select a.status from public.applications a where a.user_id = pr.id
                order by a.created_at desc, a.id desc limit 1) last on true
  where pr.status = 'applied' and last.status in ('waitlisted', 'rejected')
  union all
  -- 16. 0030: removing what is removed already records and tells nothing.
  select 29, '0030: admin_remove_post / admin_remove_comment stop when removed already', count(*)::text, '2'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('admin_remove_post', 'admin_remove_comment')
    and p.prosrc ~ 'removed_at is null;\s+if not found then'
  union all
  -- 17. 0031: a report outlives its reporter.
  select 30, '0031: reports.reporter_id set to null when the reporter goes, and may be',
         coalesce((select c.confdeltype::text from pg_constraint c
                    where c.conname = 'reports_reporter_id_fkey' and c.conrelid = 'public.reports'::regclass), 'none')
         || ',' || coalesce((select is_nullable from information_schema.columns
                    where table_schema = 'public' and table_name = 'reports' and column_name = 'reporter_id'), 'none'),
         'n,YES'
  union all
  -- 18. 0032: a report filed asks the push function to tell the admins.
  select 31, '0032: report trigger present, its function nobody''s to call, reports.pushed_at there', count(*)::text, '1'
  from pg_trigger t
  join pg_proc f on f.oid = t.tgfoid
  where t.tgname = 'reports_push_trigger' and t.tgrelid = 'public.reports'::regclass and not t.tgisinternal
    and f.proname = 'on_report_push' and f.prosecdef
    and not has_function_privilege('authenticated', f.oid, 'execute')
    and not has_function_privilege('anon', f.oid, 'execute')
    and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'reports' and column_name = 'pushed_at')
  union all
  -- 19. 0033: a photograph a member reports leaves their own view.
  select 32, '0033: what a member reports leaves their view (restrictive, read once a statement)', count(*)::text, '1'
  from pg_policies
  where schemaname = 'public' and tablename = 'posts' and policyname = 'posts: not what I reported'
    and permissive = 'RESTRICTIVE' and cmd = 'SELECT'
    and qual ~ '<> ALL' and qual ~ 'reporter_id = \( SELECT auth\.uid\(\) AS uid\)'
  union all
  -- 20. 0034: the house photographs' thumbnails at a Wikimedia standard width.
  select 33, '0034: house photographs whose thumbnail is still the full Wikimedia picture', count(*)::text, '0'
  from public.posts p join public.profiles a on a.id = p.author_id
  where a.is_house and p.thumb_path = p.media_path
    and p.media_path ~ '^https://(thumb|upload)\.wikimedia\.org/'
  union all
  -- 960: the smallest width Wikimedia serves (20, 40, 60, 120, 250, 330,
  -- 500, 960, 1280, 1920, 3840) whose short side is the app's 540 for
  -- every shape up to 16:9 (src/uploads/thumbSize.ts); 500 drew soft.
  select 34, '0034: house Wikimedia thumbnails at a width other than 960 (short side 540 up to 16:9)', count(*)::text, '0'
  from public.posts p join public.profiles a on a.id = p.author_id
  where a.is_house and p.thumb_path <> p.media_path
    and p.thumb_path ~ '^https://(thumb|upload)\.wikimedia\.org/.*/[0-9]+px-[^/]+$'
    and substring(p.thumb_path from '/([0-9]+)px-[^/]+$')::int <> 960
  union all
  -- 0034, picsum: the house thumbnails cut as a member's are (short side
  -- 540), where the photograph is that large.
  select 35, '0034: house picsum thumbnails under the standard size (short side 540)', count(*)::text, '0'
  from public.posts p join public.profiles a on a.id = p.author_id
  where a.is_house
    and p.thumb_path ~ '^https://picsum\.photos/id/[0-9]+/[0-9]+/[0-9]+$'
    and p.media_path ~ '^https://picsum\.photos/id/[0-9]+/[0-9]+/[0-9]+$'
    and split_part(p.thumb_path, '/', 5) = split_part(p.media_path, '/', 5)
    and least(split_part(p.thumb_path, '/', 6)::int, split_part(p.thumb_path, '/', 7)::int) < 540
    and least(split_part(p.media_path, '/', 6)::int, split_part(p.media_path, '/', 7)::int) >= 540
    and greatest(split_part(p.media_path, '/', 6)::int, split_part(p.media_path, '/', 7)::int)
        <= 2 * least(split_part(p.media_path, '/', 6)::int, split_part(p.media_path, '/', 7)::int)
  union all
  -- 21. 0035: a member reads their own media and thumbnails rows whatever
  --     their membership, so Delete my account can list and remove them;
  --     putting or changing a file there still needs an active member.
  select 36, '0035: own media and thumbnails readable whatever the membership; writing them still members only', count(*)::text, '3'
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and ((policyname = 'media: read own folder' and cmd = 'SELECT' and roles = '{authenticated}'
          and qual ~ 'foldername' and qual ~ '\( SELECT auth\.uid\(\) AS uid\)' and qual !~ 'is_active_member')
      -- the two that put a file there or change one, the only others of
      -- the media policies that ask for membership (this script names no
      -- writing command, so they are found that way)
      or (policyname ~ '^media: ' and cmd <> 'SELECT'
          and coalesce(qual, '') || coalesce(with_check, '') ~ 'is_active_member'))
  union all
  -- 22. 0036: a phone's token is filed under whoever signed in on it last.
  select 37, '0036: claim_push_token runs as its owner, with an empty search path, for members only', count(*)::text, '1'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'claim_push_token'
    and pg_get_function_identity_arguments(p.oid) = 'p_token text, p_platform text, p_device text'
    and p.prosecdef and p.proconfig @> array['search_path=""']
    and has_function_privilege('authenticated', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute')
  union all
  -- 23. 0037: unread messages counted in the database, as the reader.
  select 38, '0037: unread_message_counts runs as the caller, read only, for members only', count(*)::text, '1'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'unread_message_counts'
    and not p.prosecdef and p.provolatile = 's'
    and has_function_privilege('authenticated', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute')
  union all
  select 39, '0037: it finds a thread''s unread messages by messages_unread_idx (present and valid)', count(*)::text, '1'
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'messages_unread_idx' and i.indisvalid and i.indisready
  union all
  -- 24. 0038: follows that respect private accounts. (This script names
  --     no writing command, so the trigger's events, the policies' commands
  --     and the privileges are read from the catalogue's own letters: in
  --     tgtype, 1 a row, 2 before, 4 a new row, 8 a removal, 16 a change;
  --     in polcmd, w a change and d a removal; in an ACL, w the privilege
  --     to change rows.)
  select 40, '0038: a member''s new follow takes its status from the followee (a trigger as it is filed; its function in private, run as its owner, nobody''s to call)', count(*)::text, '1'
  from pg_trigger t
  join pg_proc f on f.oid = t.tgfoid
  join pg_namespace n on n.oid = f.pronamespace
  where t.tgrelid = 'public.follows'::regclass and t.tgname = 'follows_status_from_followee' and not t.tgisinternal
    and t.tgtype = 7
    and n.nspname = 'private' and f.proname = 'follow_status_from_followee'
    and f.prosecdef and f.proconfig @> array['search_path=""']
    and not has_function_privilege('authenticated', f.oid, 'execute')
    and not has_function_privilege('anon', f.oid, 'execute')
  union all
  select 41, '0038: the followee accepts a request (pending to accepted, nothing else) and may remove a follow', count(*)::text, '2'
  from pg_policies pp
  join pg_policy pol on pol.polrelid = 'public.follows'::regclass and pol.polname = pp.policyname
  where pp.schemaname = 'public' and pp.tablename = 'follows'
    and ((pp.policyname = 'follows: followee accepts' and pol.polcmd = 'w'
          and pp.qual ~ 'followee_id = \( SELECT auth\.uid\(\) AS uid\)' and pp.qual ~ 'status = ''pending'''
          and pp.with_check ~ 'followee_id = \( SELECT auth\.uid\(\) AS uid\)' and pp.with_check ~ 'status = ''accepted''')
      or (pp.policyname = 'follows: followee removes' and pol.polcmd = 'd'
          and pp.qual ~ 'followee_id = \( SELECT auth\.uid\(\) AS uid\)'))
  union all
  -- Whether members or visitors may change any column of follows; whether
  -- members may change status; any other column; visitors, status.
  select 42, '0038: members may change a follow''s status and nothing else; signed-out visitors nothing',
         concat_ws(',',
           (select coalesce(bool_or(split_part(split_part(a::text, '=', 2), '/', 1) ~ 'w'), false)
              from pg_class c, unnest(c.relacl) a
             where c.oid = 'public.follows'::regclass and split_part(a::text, '=', 1) in ('authenticated', 'anon'))::text,
           (select coalesce(bool_or(split_part(split_part(a::text, '=', 2), '/', 1) ~ 'w'), false)
              from pg_attribute c, unnest(c.attacl) a
             where c.attrelid = 'public.follows'::regclass and c.attname = 'status'
               and split_part(a::text, '=', 1) = 'authenticated')::text,
           (select coalesce(bool_or(split_part(split_part(a::text, '=', 2), '/', 1) ~ 'w'), false)
              from pg_attribute c, unnest(c.attacl) a
             where c.attrelid = 'public.follows'::regclass and c.attnum > 0 and c.attname <> 'status'
               and split_part(a::text, '=', 1) in ('authenticated', 'anon'))::text,
           (select coalesce(bool_or(split_part(split_part(a::text, '=', 2), '/', 1) ~ 'w'), false)
              from pg_attribute c, unnest(c.attacl) a
             where c.attrelid = 'public.follows'::regclass and c.attname = 'status'
               and split_part(a::text, '=', 1) = 'anon')::text),
         'false,true,false,false'
  union all
  select 43, '0038: follower and following counts move with accepted follows only, and when a request is accepted', count(*)::text, '1'
  from pg_trigger t
  join pg_proc f on f.oid = t.tgfoid
  where t.tgrelid = 'public.follows'::regclass and t.tgname = 'follows_count_trigger' and not t.tgisinternal
    and t.tgtype = 29
    and t.tgattr::text = (select attnum::text from pg_attribute
                           where attrelid = 'public.follows'::regclass and attname = 'status')
    and f.proname = 'bump_follow_counts'
    and f.prosrc ~ 'old\.status = ''accepted''' and f.prosrc ~ 'new\.status = ''accepted'''
  union all
  select 44, '0038: a request is filed in Activity as follow_request', count(*)::text, '1'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'notify_follow'
    and p.prosrc ~ 'when new\.status = ''pending'' then ''follow_request'''
  union all
  select 45, '0038: profiles whose follower or following count is not their accepted follows', count(*)::text, '0'
  from public.profiles p
  where p.follower_count <> (select count(*) from public.follows f where f.followee_id = p.id and f.status = 'accepted')
     or p.following_count <> (select count(*) from public.follows f where f.follower_id = p.id and f.status = 'accepted')
)
select n, what, found, expected, coalesce(found = expected, false) as ok
from checks
order by n;
