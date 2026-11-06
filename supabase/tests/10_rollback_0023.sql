-- The way back from 0023, tried for real, and the way forward again.
--
-- 0023_rollback.sql is applied to this database as it would be to the
-- project: then every policy must be exactly as 0001-0022 left it (the
-- runner kept them just before 0023 ran), and the indexes and functions
-- 0023 made must be gone, with every other index still there. Then 0023
-- is applied again, over the top of that, and every policy must be as it
-- was after the first time: the migration is safe to run twice, and safe
-- to run after its own rollback.
--
-- Leaves the database as 0023 made it, with 0035 over it as before.

create temp table rollback_start as select coalesce(max(seq), 0) as seq from tests.results;

-- As 0023 left things, to compare against after going back and forth.
create temp table after_first as
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname in ('public', 'storage');
create temp table indexes_first as
select schemaname, indexname, indexdef from pg_indexes where schemaname in ('public', 'storage');

\ir 0023_rollback.sql

-- Policies a later migration added (0028 on) are not 0023's to take back:
-- its rollback leaves them as they are, and they are left out here.
create temp table added_later as
select a.schemaname, a.tablename, a.policyname from after_first a
where not exists (select 1 from before_0023.policies b
                   where b.schemaname = a.schemaname and b.tablename = a.tablename and b.policyname = a.policyname);

insert into tests.results (name, expected, actual) values
  ('after the rollback, every policy is as 0001-0022 left it', '0',
   (select count(*)::text from (
      (select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from before_0023.policies
       except
       select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies
        where schemaname in ('public', 'storage'))
      union all
      (select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies p
        where schemaname in ('public', 'storage')
          and not exists (select 1 from added_later l
                           where l.schemaname = p.schemaname and l.tablename = p.tablename and l.policyname = p.policyname)
       except
       select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from before_0023.policies)
    ) d)),
  ('and the policies added after 0023 are still there, untouched', '0',
   (select count(*)::text from (
      select a.* from after_first a join added_later l using (schemaname, tablename, policyname)
      except
      select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies) d)),
  ('and every index from before 0023 is there, unchanged', '0',
   (select count(*)::text from (
      select schemaname, indexname, indexdef from before_0023.indexes
      except select schemaname, indexname, indexdef from pg_indexes where schemaname in ('public', 'storage')
    ) d)),
  -- Later migrations (0026, 0027) make indexes of their own, which this
  -- rollback is not about: it must take away 0023's and nothing else.
  ('and the indexes it took away are 0023''s thirty, no more', '30',
   (select count(*)::text from (
      select * from indexes_first
      except select schemaname, indexname, indexdef from pg_indexes where schemaname in ('public', 'storage')
    ) d
    where d.indexname in (
     'activity_post_idx', 'activity_comment_idx', 'activity_actor_idx', 'comments_author_idx',
     'likes_user_idx', 'messages_sender_idx', 'messages_post_idx', 'post_tags_tagged_by_idx',
     'post_shares_owner_idx', 'share_events_post_idx', 'share_events_actor_idx',
     'reports_reporter_idx', 'reports_post_idx', 'reports_comment_idx', 'reports_profile_idx',
     'moderation_actions_post_idx', 'moderation_actions_comment_idx', 'moderation_actions_admin_idx',
     'posts_removed_by_idx', 'comments_removed_by_idx', 'applications_decided_by_idx',
     'reports_resolved_by_idx', 'invites_used_by_idx', 'app_settings_updated_by_idx',
     'profiles_invited_by_idx', 'profiles_private_idx', 'follows_followers_idx',
     'likes_post_recent_idx', 'activity_unread_idx', 'posts_taken_idx'))),
  ('and every other index is still there, and none was added', '0',
   (select count(*)::text from (
      (select * from indexes_first
        except select schemaname, indexname, indexdef from pg_indexes where schemaname in ('public', 'storage'))
      union all
      (select schemaname, indexname, indexdef from pg_indexes where schemaname in ('public', 'storage')
        except select * from indexes_first)
    ) d
    where d.indexname not in (
     'activity_post_idx', 'activity_comment_idx', 'activity_actor_idx', 'comments_author_idx',
     'likes_user_idx', 'messages_sender_idx', 'messages_post_idx', 'post_tags_tagged_by_idx',
     'post_shares_owner_idx', 'share_events_post_idx', 'share_events_actor_idx',
     'reports_reporter_idx', 'reports_post_idx', 'reports_comment_idx', 'reports_profile_idx',
     'moderation_actions_post_idx', 'moderation_actions_comment_idx', 'moderation_actions_admin_idx',
     'posts_removed_by_idx', 'comments_removed_by_idx', 'applications_decided_by_idx',
     'reports_resolved_by_idx', 'invites_used_by_idx', 'app_settings_updated_by_idx',
     'profiles_invited_by_idx', 'profiles_private_idx', 'follows_followers_idx',
     'likes_post_recent_idx', 'activity_unread_idx', 'posts_taken_idx'))),
  ('and the functions 0023 made are gone, from either schema', '0',
   (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.proname in ('my_block_partners', 'my_blockers', 'own_profile_unchanged'))),
  -- The schema stays only while a later migration's function is in it
  -- (0038's three trigger functions, which the rollback is not about),
  -- and then holds those and nothing of 0023's.
  ('and the private schema holds nothing of 0023''s: only what a later migration put there',
   'accept_requests_when_public,follow_status_from_followee,forget_follow_request',
   coalesce((select string_agg(p.proname, ',' order by p.proname) from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private'), 'no schema')),
  ('and 0038''s triggers still run them', '3',
   (select count(*)::text from pg_trigger t join pg_proc p on p.oid = t.tgfoid
     where (t.tgrelid, t.tgname, p.proname) in (
       ('public.follows'::regclass, 'follows_status_from_followee', 'follow_status_from_followee'),
       ('public.follows'::regclass, 'follows_request_notice_gone', 'forget_follow_request'),
       ('public.profiles'::regclass, 'profiles_public_accepts_requests', 'accept_requests_when_public'))));

-- And forward again, followed, as on the project, by the later migrations
-- that replace a policy 0023 made: 0035 ("media: read own folder", a
-- member's own files whatever their membership). The rollback put 0009's
-- version back (checked above); 0023 makes 0023's, and 0035 its own.
\o /dev/null
\ir ../migrations/0023_policies_read_once.sql
\ir ../migrations/0035_own_files_whatever_the_membership.sql
\o

insert into tests.results (name, expected, actual) values
  ('0023 applied again over its rollback leaves every policy as the first time', '0',
   (select count(*)::text from (
      (select * from after_first
       except
       select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies
        where schemaname in ('public', 'storage'))
      union all
      (select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies
        where schemaname in ('public', 'storage')
       except
       select * from after_first)
    ) d)),
  ('and every index as the first time', '0',
   (select count(*)::text from (
      (select * from indexes_first
       except select schemaname, indexname, indexdef from pg_indexes where schemaname in ('public', 'storage'))
      union all
      (select schemaname, indexname, indexdef from pg_indexes where schemaname in ('public', 'storage')
       except select * from indexes_first)
    ) d));

-- And once more on top of itself, 0035 after it as above.
\o /dev/null
\ir ../migrations/0023_policies_read_once.sql
\ir ../migrations/0035_own_files_whatever_the_membership.sql
\o

insert into tests.results (name, expected, actual) values
  ('0023 applied a third time changes nothing', '0',
   (select count(*)::text from (
      (select * from after_first
       except
       select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies
        where schemaname in ('public', 'storage'))
      union all
      (select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies
        where schemaname in ('public', 'storage')
       except
       select * from after_first)
    ) d));

\pset border 2
select r.seq, r.name, r.expected, r.actual,
       case when r.expected = r.actual then 'pass' else 'FAIL' end as status
from tests.results r, rollback_start s
where r.seq > s.seq
order by r.seq;

do $verdict$
declare v_failed int;
begin
  select count(*) into v_failed from tests.results r, rollback_start s
   where r.seq > s.seq and r.expected <> r.actual;
  if v_failed > 0 then
    raise exception '% rollback checks FAILED', v_failed;
  end if;
  raise notice 'rollback checks passed';
end
$verdict$;
