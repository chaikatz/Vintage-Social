-- 0029-0033: decisions reach the profile, a removal happens once, a report
-- outlives its reporter and reaches the admins, and a photograph a member
-- reports leaves their own view and no one else's.
--
-- Each is asked as the members it is about, through the same functions
-- and policies the app goes through. Runs in one transaction and rolls
-- back.

begin;

create temp table m_start as select coalesce(max(seq), 0) as seq from tests.results;

-- A statement as a member: OK, DENIED, or the error's own words.
create or replace function tests.m_as(p_uid uuid, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  begin
    execute p_sql;
    v := 'OK';
  exception
    when insufficient_privilege then v := 'DENIED';
    when others then v := 'ERROR:' || sqlerrm;
  end;
  execute 'reset role';
  return v;
end
$fn$;

-- What a member reads: the ids a query returns, in order, or '-'.
create or replace function tests.m_read(p_uid uuid, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'select coalesce(string_agg(x::text, '',''), ''-'') from (' || p_sql || ') q(x)' into v;
  execute 'reset role';
  return v;
end
$fn$;

insert into auth.users (id, email, raw_user_meta_data)
select ('e0000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'm' || n || '@moderation.test',
       jsonb_build_object('username', 'mod.member' || n)
from generate_series(1, 14) n;

-- ---------------------------------------------------------------------------
-- 0029: a waitlist or a rejection reaches the profile
-- ---------------------------------------------------------------------------
-- e01 and e02 have applied. e03 was let in by invitation and e04
-- suspended, each with an old application still pending.
update public.profiles set status = 'approved', approved_at = now() where id = 'e0000000-0000-4000-8000-000000000003';
update public.profiles set status = 'suspended' where id = 'e0000000-0000-4000-8000-000000000004';
insert into public.applications (id, user_id, full_name, desired_username, reason)
select ('e1000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       ('e0000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'Member ' || n, 'mod.member' || n, 'Photographs.'
from generate_series(1, 4) n;

-- Each decision in a statement of its own (a statement reads the tables
-- as they were when it began), then what it left. No approval here: it
-- would draw a membership number, which a rollback does not give back.
create temp table m_did (step text primary key, answer text);
insert into m_did values ('reject e01', tests.m_as('11111111-1111-1111-1111-111111111111',
  'select public.decide_application(''e1000000-0000-4000-8000-000000000001'', ''rejected'')'));
insert into m_did values ('waitlist e02', tests.m_as('11111111-1111-1111-1111-111111111111',
  'select public.decide_application(''e1000000-0000-4000-8000-000000000002'', ''waitlisted'')'));
insert into m_did values ('reject e03', tests.m_as('11111111-1111-1111-1111-111111111111',
  'select public.decide_application(''e1000000-0000-4000-8000-000000000003'', ''rejected'')'));
insert into m_did values ('waitlist e04', tests.m_as('11111111-1111-1111-1111-111111111111',
  'select public.decide_application(''e1000000-0000-4000-8000-000000000004'', ''waitlisted'')'));
-- An application from a suspended account, approved: refused before
-- anything is written or a number drawn, so this approval is safe here.
insert into m_did values ('approve e04', tests.m_as('11111111-1111-1111-1111-111111111111',
  'select public.decide_application(''e1000000-0000-4000-8000-000000000004'', ''approved'')'));
insert into m_did values ('e03 decides', tests.m_as('e0000000-0000-4000-8000-000000000003',
  'select public.decide_application(''e1000000-0000-4000-8000-000000000001'', ''approved'')'));
insert into m_did values ('reject e01 again', tests.m_as('11111111-1111-1111-1111-111111111111',
  'select public.decide_application(''e1000000-0000-4000-8000-000000000001'', ''rejected'')'));

insert into tests.results (name, expected, actual) values
  ('0029: a rejection is written to the applicant''s profile', 'OK,rejected',
   (select answer from m_did where step = 'reject e01') || ',' ||
   (select status from public.profiles where id = 'e0000000-0000-4000-8000-000000000001')),
  ('0029: so is a place on the waitlist', 'OK,waitlisted',
   (select answer from m_did where step = 'waitlist e02') || ',' ||
   (select status from public.profiles where id = 'e0000000-0000-4000-8000-000000000002')),
  ('0029: an old application rejected late never demotes a member let in since', 'OK,approved',
   (select answer from m_did where step = 'reject e03') || ',' ||
   (select status from public.profiles where id = 'e0000000-0000-4000-8000-000000000003')),
  ('0029: nor lifts or overrides a suspension', 'OK,suspended',
   (select answer from m_did where step = 'waitlist e04') || ',' ||
   (select status from public.profiles where id = 'e0000000-0000-4000-8000-000000000004')),
  ('0029: an approval never lifts a suspension: refused, the profile and its number as they were',
   'ERROR:This account is suspended,suspended,waitlisted,',
   (select answer from m_did where step = 'approve e04') || ',' ||
   (select status || ',' ||
           (select a.status from public.applications a where a.id = 'e1000000-0000-4000-8000-000000000004') || ',' ||
           coalesce(member_no::text, '')
      from public.profiles where id = 'e0000000-0000-4000-8000-000000000004')),
  ('0029: the applications say so too, as before', 'rejected,waitlisted,rejected,waitlisted',
   (select string_agg(status, ',' order by id) from public.applications
     where id::text like 'e1000000-0000-4000-8000-00000000000_')),
  ('0029: a member who is not an admin cannot decide', 'ERROR:Admins only',
   (select answer from m_did where step = 'e03 decides')),
  ('0029: deciding again changes nothing more', 'OK,rejected',
   (select answer from m_did where step = 'reject e01 again') || ',' ||
   (select status from public.profiles where id = 'e0000000-0000-4000-8000-000000000001'));

-- The profiles 0011's version left behind: e05 rejected, e08 waitlisted,
-- e06 with no application, e07 rejected once and applying again.
insert into public.applications (user_id, full_name, desired_username, reason, status, created_at) values
  ('e0000000-0000-4000-8000-000000000005', 'Member 5', 'mod.member5', 'Photographs.', 'rejected', now() - interval '3 days'),
  ('e0000000-0000-4000-8000-000000000007', 'Member 7', 'mod.member7', 'Photographs.', 'rejected', now() - interval '3 days'),
  ('e0000000-0000-4000-8000-000000000007', 'Member 7', 'mod.member7', 'Photographs, again.', 'pending', now() - interval '1 day'),
  ('e0000000-0000-4000-8000-000000000008', 'Member 8', 'mod.member8', 'Photographs.', 'waitlisted', now() - interval '2 days');

create temp table m_profiles_before as select id, status from public.profiles;

\o /dev/null
\ir ../migrations/0029_decisions_reach_the_profile.sql
\o

insert into tests.results (name, expected, actual) values
  ('0029: the profiles left at applied after a decision are given it, and no other',
   'rejected,applied,applied,waitlisted',
   (select string_agg(status, ',' order by id) from public.profiles
     where id in ('e0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000006',
                  'e0000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000008'))),
  ('0029: the repair changed those two profiles and nothing else', '2',
   (select count(*)::text from public.profiles p join m_profiles_before b using (id) where p.status <> b.status));

create temp table m_profiles_after as select id, status from public.profiles;
\o /dev/null
\ir ../migrations/0029_decisions_reach_the_profile.sql
\o
insert into tests.results (name, expected, actual) values
  ('0029: applied again, it finds nothing more to repair', '0',
   (select count(*)::text from public.profiles p join m_profiles_after b using (id) where p.status <> b.status));

-- ---------------------------------------------------------------------------
-- 0030: removed once, told once
-- ---------------------------------------------------------------------------
update public.profiles set status = 'approved', approved_at = now()
 where id::text like 'e0000000-0000-4000-8000-0000000000__'
   and id not in ('e0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000006',
                  'e0000000-0000-4000-8000-000000000007');
insert into public.posts (id, author_id, media_type, media_path, filter_id) values
  ('e2000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000009', 'photo', 'e0000000-0000-4000-8000-000000000009/1.jpg', 'kodachrome'),
  ('e2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000010', 'photo', 'e0000000-0000-4000-8000-000000000010/1.jpg', 'kodachrome'),
  ('e2000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000011', 'photo', 'e0000000-0000-4000-8000-000000000011/1.jpg', 'kodachrome');
insert into public.comments (id, post_id, author_id, body) values
  ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000009', 'a remark'),
  ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000012', 'my own remark');

insert into m_did values ('remove post', tests.m_as('11111111-1111-1111-1111-111111111111',
  'select public.admin_remove_post(''e2000000-0000-4000-8000-000000000001'', ''first'')'));
insert into m_did values ('remove post again', tests.m_as('11111111-1111-1111-1111-111111111111',
  'select public.admin_remove_post(''e2000000-0000-4000-8000-000000000001'', ''second'')'));
insert into m_did values ('remove comment', tests.m_as('11111111-1111-1111-1111-111111111111',
  'select public.admin_remove_comment(''e3000000-0000-4000-8000-000000000001'', ''first'')'));
insert into m_did values ('remove comment again', tests.m_as('11111111-1111-1111-1111-111111111111',
  'select public.admin_remove_comment(''e3000000-0000-4000-8000-000000000001'', ''second'')'));
insert into m_did values ('remove nothing', tests.m_as('11111111-1111-1111-1111-111111111111',
  'select public.admin_remove_post(''e2000000-0000-4000-8000-0000000000ff'', ''x'')')
  || ',' || tests.m_as('11111111-1111-1111-1111-111111111111',
  'select public.admin_remove_comment(''e3000000-0000-4000-8000-0000000000ff'', ''x'')'));
insert into m_did values ('member removes', tests.m_as('e0000000-0000-4000-8000-000000000012',
  'select public.admin_remove_post(''e2000000-0000-4000-8000-000000000002'', ''x'')'));

insert into tests.results (name, expected, actual) values
  ('0030: an admin removes a photograph, and then again', 'OK,OK',
   (select answer from m_did where step = 'remove post') || ',' || (select answer from m_did where step = 'remove post again')),
  ('0030: one record of the removal, and its author told once', '1,1,first',
   (select count(*)::text from public.moderation_actions where post_id = 'e2000000-0000-4000-8000-000000000001')
   || ',' || (select count(*)::text from public.activity
               where recipient_id = 'e0000000-0000-4000-8000-000000000009' and type = 'moderation'
                 and message like 'One of your posts was removed by the admins:%')
   || ',' || coalesce((select string_agg(note, ',') from public.moderation_actions where post_id = 'e2000000-0000-4000-8000-000000000001'), '<none>')),
  ('0030: a comment removed twice is recorded once', 'OK,OK,1,true',
   (select answer from m_did where step = 'remove comment') || ',' || (select answer from m_did where step = 'remove comment again')
   || ',' || (select count(*)::text from public.moderation_actions where comment_id = 'e3000000-0000-4000-8000-000000000001')
   || ',' || (select (removed_at is not null)::text from public.comments where id = 'e3000000-0000-4000-8000-000000000001')),
  ('0030: something that was never there is still not found', 'ERROR:Post not found,ERROR:Comment not found',
   (select answer from m_did where step = 'remove nothing')),
  ('0030: and only admins remove', 'ERROR:Admins only',
   (select answer from m_did where step = 'member removes'));

-- ---------------------------------------------------------------------------
-- 0032: a report reaches the admins (the push function's door is in
-- supabase/functions/push; here, that filing one asks for it)
-- ---------------------------------------------------------------------------
create temp table m_pushes (kind text, id uuid);
grant all on m_pushes to authenticated;
-- push_event, for this transaction only, writes down what it is asked.
create or replace function public.push_event(p_kind text, p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $fn$
begin
  insert into m_pushes values (p_kind, p_id);
end
$fn$;

-- e13 reports e11's photograph, and e12 a member. As the app files a
-- report: no id (0039 lets a member file only the columns the app sends),
-- so the ids the rest of this file names are given after, as the owner,
-- to the reports and to what the push function was asked about them.
insert into m_did values ('e13 reports a photograph', tests.m_as('e0000000-0000-4000-8000-000000000013',
  'insert into public.reports (reporter_id, target_type, post_id, reason) values
     (''e0000000-0000-4000-8000-000000000013'', ''post'',
      ''e2000000-0000-4000-8000-000000000003'', ''Spam or scam'')'));
insert into m_did values ('e12 reports a member', tests.m_as('e0000000-0000-4000-8000-000000000012',
  'insert into public.reports (reporter_id, target_type, profile_id, reason) values
     (''e0000000-0000-4000-8000-000000000012'', ''profile'',
      ''e0000000-0000-4000-8000-000000000011'', ''Harassment or abuse'')'));
create temp table m_report_ids as
select r.id as old_id, v.new_id
from public.reports r
join (values
  ('e0000000-0000-4000-8000-000000000013'::uuid, 'e4000000-0000-4000-8000-000000000001'::uuid),
  ('e0000000-0000-4000-8000-000000000012'::uuid, 'e4000000-0000-4000-8000-000000000002'::uuid)
) v(reporter, new_id) on r.reporter_id = v.reporter;
update m_pushes p set id = k.new_id from m_report_ids k where p.kind = 'report' and p.id = k.old_id;
update public.reports r set id = k.new_id from m_report_ids k where r.id = k.old_id;
insert into tests.results (name, expected, actual) values
  ('0032: a member files a report as before', 'OK,OK',
   (select answer from m_did where step = 'e13 reports a photograph') || ',' ||
   (select answer from m_did where step = 'e12 reports a member'));
insert into tests.results (name, expected, actual) values
  ('0032: each report filed asks the push function to tell the admins, once', 'report:e4000000-0000-4000-8000-000000000001,report:e4000000-0000-4000-8000-000000000002',
   coalesce((select string_agg(kind || ':' || id, ',' order by id) from m_pushes where kind = 'report'), '<none>')),
  ('0032: the trigger function is nobody''s to call', 'false,false',
   has_function_privilege('authenticated', 'public.on_report_push()', 'execute')::text || ',' ||
   has_function_privilege('anon', 'public.on_report_push()', 'execute')::text),
  ('0032: reports have the column that says the admins were told', 'timestamp with time zone',
   (select data_type from information_schema.columns
     where table_schema = 'public' and table_name = 'reports' and column_name = 'pushed_at'));

-- ---------------------------------------------------------------------------
-- 0033: what a member reports leaves their view, and no one else's
-- ---------------------------------------------------------------------------
-- e13 reported e11's photograph above. e14 has reported nothing.
insert into public.comments (id, post_id, author_id, body) values
  ('e3000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000014', 'someone else''s'),
  ('e3000000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000013', 'the reporter''s own');
insert into public.likes (post_id, user_id) values
  ('e2000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000014');
-- And a photograph of e13's own, which they report too, and a comment report.
insert into public.posts (id, author_id, media_type, media_path, filter_id) values
  ('e2000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000013', 'photo', 'e0000000-0000-4000-8000-000000000013/1.jpg', 'kodachrome');
select tests.m_as('e0000000-0000-4000-8000-000000000013',
  'insert into public.reports (reporter_id, target_type, post_id, reason) values
     (''e0000000-0000-4000-8000-000000000013'', ''post'', ''e2000000-0000-4000-8000-000000000004'', ''Something else'')');
select tests.m_as('e0000000-0000-4000-8000-000000000013',
  'insert into public.reports (reporter_id, target_type, comment_id, reason) values
     (''e0000000-0000-4000-8000-000000000013'', ''comment'', ''e3000000-0000-4000-8000-000000000002'', ''Something else'')');

insert into tests.results (name, expected, actual) values
  ('0033: the photograph the member reported is gone from their reads', '-',
   tests.m_read('e0000000-0000-4000-8000-000000000013',
     'select id from public.posts where id = ''e2000000-0000-4000-8000-000000000003''')),
  ('0033: from their home feed too (feed_page runs as them)', '-',
   tests.m_read('e0000000-0000-4000-8000-000000000013',
     'select id from public.feed_page(100) where id = ''e2000000-0000-4000-8000-000000000003''')),
  ('0033: and its comments and likes with it, bar their own', 'e3000000-0000-4000-8000-000000000004,-',
   tests.m_read('e0000000-0000-4000-8000-000000000013',
     'select id from public.comments where post_id = ''e2000000-0000-4000-8000-000000000003'' order by id')
   || ',' || tests.m_read('e0000000-0000-4000-8000-000000000013',
     'select user_id from public.likes where post_id = ''e2000000-0000-4000-8000-000000000003''')),
  ('0033: a member who did not report it still sees it, its comments and its likes', 'e2000000-0000-4000-8000-000000000003,2,1',
   tests.m_read('e0000000-0000-4000-8000-000000000014',
     'select id from public.posts where id = ''e2000000-0000-4000-8000-000000000003''')
   || ',' || tests.m_read('e0000000-0000-4000-8000-000000000014',
     'select count(*) from public.comments where post_id = ''e2000000-0000-4000-8000-000000000003''')
   || ',' || tests.m_read('e0000000-0000-4000-8000-000000000014',
     'select count(*) from public.likes where post_id = ''e2000000-0000-4000-8000-000000000003''')),
  ('0033: so do its author and the admins', 'e2000000-0000-4000-8000-000000000003,e2000000-0000-4000-8000-000000000003',
   tests.m_read('e0000000-0000-4000-8000-000000000011',
     'select id from public.posts where id = ''e2000000-0000-4000-8000-000000000003''')
   || ',' || tests.m_read('11111111-1111-1111-1111-111111111111',
     'select id from public.posts where id = ''e2000000-0000-4000-8000-000000000003''')),
  ('0033: a member''s own photograph is never hidden from them', 'e2000000-0000-4000-8000-000000000004',
   tests.m_read('e0000000-0000-4000-8000-000000000013',
     'select id from public.posts where id = ''e2000000-0000-4000-8000-000000000004''')),
  ('0033: a report of a comment hides no photograph: they read the two they may', '2',
   tests.m_read('e0000000-0000-4000-8000-000000000013',
     'select count(*) from public.posts where id::text like ''e2000000-%''')
   ),
  ('0033: a member who has reported nothing reads every photograph they did', '3',
   tests.m_read('e0000000-0000-4000-8000-000000000014',
     'select count(*) from public.posts where id::text like ''e2000000-%'''));

-- Dismissed by the admins, the report still keeps it out of the reporter's view.
select tests.m_as('11111111-1111-1111-1111-111111111111',
  'select public.resolve_report(''e4000000-0000-4000-8000-000000000001'', ''dismissed'', ''No action needed'')');
insert into tests.results (name, expected, actual) values
  ('0033: whatever becomes of the report, it stays out of their view', 'dismissed,-',
   (select status from public.reports where id = 'e4000000-0000-4000-8000-000000000001')
   || ',' || tests.m_read('e0000000-0000-4000-8000-000000000013',
     'select id from public.posts where id = ''e2000000-0000-4000-8000-000000000003'''));

-- Read once a statement, not once a row.
create or replace function tests.m_plan(p_uid uuid, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v_line record;
  v_plan text := '';
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  for v_line in execute 'explain ' || p_sql loop
    v_plan := v_plan || v_line."QUERY PLAN" || E'\n';
  end loop;
  execute 'reset role';
  return v_plan;
end
$fn$;
insert into tests.results (name, expected, actual) values
  ('0033: the member''s reports are read once a statement (an InitPlan), not once a row', 'true,false',
   (tests.m_plan('e0000000-0000-4000-8000-000000000013',
      'select * from public.posts order by created_at desc limit 60') ~ 'InitPlan[^\n]*\n(\s+->[^\n]*\n)*?\s+->\s+(Bitmap Heap Scan|Index Scan|Index Only Scan|Seq Scan|Bitmap Index Scan)[^\n]*reports')::text
   || ',' ||
   (tests.m_plan('e0000000-0000-4000-8000-000000000013',
      'select * from public.posts order by created_at desc limit 60') ~ 'SubPlan[^\n]*\n(\s+->[^\n]*\n)*?\s+->[^\n]*reports')::text);

-- ---------------------------------------------------------------------------
-- 0031: a report outlives its reporter
-- ---------------------------------------------------------------------------
-- e12 filed a report on a member above, still open. They delete their account.
delete from auth.users where id = 'e0000000-0000-4000-8000-000000000012';

insert into tests.results (name, expected, actual) values
  ('0031: the open report stays, with no reporter', 'open,null,e0000000-0000-4000-8000-000000000011',
   coalesce((select status || ',' || coalesce(reporter_id::text, 'null') || ',' || profile_id
      from public.reports where id = 'e4000000-0000-4000-8000-000000000002'), '<gone>')),
  ('0031: and the admins still read it', 'e4000000-0000-4000-8000-000000000002',
   tests.m_read('11111111-1111-1111-1111-111111111111',
     'select id from public.reports where id = ''e4000000-0000-4000-8000-000000000002''')),
  ('0031: no member reads it', '-',
   tests.m_read('e0000000-0000-4000-8000-000000000014',
     'select id from public.reports where id = ''e4000000-0000-4000-8000-000000000002''')),
  ('0031: nobody files a report without being its reporter', 'DENIED',
   tests.m_as('e0000000-0000-4000-8000-000000000014',
     'insert into public.reports (reporter_id, target_type, profile_id, reason) values
        (null, ''profile'', ''e0000000-0000-4000-8000-000000000011'', ''Spam or scam'')')),
  ('0031: the foreign key sets the reporter to null, and the column allows it', 'n,YES',
   coalesce((select confdeltype::text from pg_constraint where conname = 'reports_reporter_id_fkey'), '<none>')
   || ',' || (select is_nullable from information_schema.columns
               where table_schema = 'public' and table_name = 'reports' and column_name = 'reporter_id'));

-- Applied again, each changes nothing.
\o /dev/null
\ir ../migrations/0030_removed_once.sql
\ir ../migrations/0031_reports_outlive_their_reporter.sql
\ir ../migrations/0032_reports_reach_the_admins.sql
\ir ../migrations/0033_what_a_member_reports_leaves_their_view.sql
\o
insert into tests.results (name, expected, actual) values
  ('0030-0033: each runs twice without error, and leaves one trigger and one policy', '1,1',
   (select count(*)::text from pg_trigger where tgname = 'reports_push_trigger')
   || ',' || (select count(*)::text from pg_policies where policyname = 'posts: not what I reported'));

\pset border 2
select r.seq, r.name, r.expected, r.actual,
       case when r.expected = r.actual then 'pass' else 'FAIL' end as status
from tests.results r, m_start s
where r.seq > s.seq
order by r.seq;

do $verdict$
declare v_failed int;
begin
  select count(*) into v_failed from tests.results r, m_start s
   where r.seq > s.seq and r.expected is distinct from r.actual;
  if v_failed > 0 then
    raise exception '% moderation checks FAILED', v_failed;
  end if;
  raise notice 'moderation checks passed';
end
$verdict$;

rollback;
