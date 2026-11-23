-- 0041: a member's number is shown only if they choose.
--
-- Asked as the members it is about, through the same grants and policies
-- the app and PostgREST go through. Ana and Ben are members; Sam is a
-- member the admins suspend. Every profile starts with the number hidden;
-- Ben turns his on and off from Settings, as the app sends it, and
-- changes nobody else's; with it he still changes nothing else he could
-- not change before (his number least of all); a suspended member and a
-- signed-out visitor change nothing. Then the file applied again over
-- itself, and 0039 applied again after it, which takes the column back
-- until this file runs once more. Runs in one transaction and rolls back.

begin;

create temp table n_start as select coalesce(max(seq), 0) as seq from tests.results;

-- A statement as a member (or, with null, a signed-out visitor): OK and
-- how many rows it touched, DENIED, or the error's own words.
create or replace function tests.n_as(p_uid uuid, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v text;
  n bigint;
begin
  if p_uid is null then
    execute 'set local role anon';
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  end if;
  begin
    execute p_sql;
    get diagnostics n = row_count;
    v := 'OK:' || n;
  exception
    when insufficient_privilege then v := 'DENIED';
    when others then v := 'ERROR:' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end
$fn$;

-- What a member reads: the first column of the first row, or '-'.
create or replace function tests.n_read(p_uid uuid, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  begin
    execute p_sql into v;
    v := coalesce(v, '-');
  exception when others then v := 'ERROR:' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end
$fn$;

-- What is stored, read as the owner at the moment it is asked.
create or replace function tests.n_now(p_sql text)
returns text
language plpgsql
as $fn$
declare
  v text;
begin
  execute p_sql into v;
  return coalesce(v, '-');
end
$fn$;

-- The columns of profiles a member may change, in order.
create or replace function tests.n_writable()
returns text
language sql
as $fn$
  select coalesce(string_agg(a.attname, ',' order by a.attname collate "C"), '-')
  from pg_attribute a
  where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped
    and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
$fn$;

\set ana '0a410000-0000-4000-8000-000000000001'
\set ben '0a410000-0000-4000-8000-000000000002'
\set sam '0a410000-0000-4000-8000-000000000003'
\set admin '11111111-1111-1111-1111-111111111111'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'ana', 'ana@number.test', '{"username":"n41.ana"}'),
  (:'ben', 'ben@number.test', '{"username":"n41.ben"}'),
  (:'sam', 'sam@number.test', '{"username":"n41.sam"}');
-- Let in, with numbers of their own (set here as the owner, so the
-- sequence the approvals draw from is left as it was).
update public.profiles set status = 'approved', approved_at = now(), member_no = 941001 where id = :'ana';
update public.profiles set status = 'approved', approved_at = now(), member_no = 941002 where id = :'ben';
update public.profiles set status = 'approved', approved_at = now(), member_no = 941003 where id = :'sam';

-- ---------------------------------------------------------------------------
-- the column, and where everyone starts
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  ('profiles.show_member_no: a boolean, never null, false unless set', 'boolean,NO,false',
   (select data_type || ',' || is_nullable || ',' || column_default
      from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'show_member_no')),
  ('every profile, those here before and those made since, starts with the number hidden', '0',
   (select count(*)::text from public.profiles where show_member_no)),
  ('a member reads another''s choice with the profile (select *, as the app reads it)', 'false,941002',
   tests.n_read(:'ana', format('select show_member_no::text || '','' || member_no from public.profiles where id = %L', :'ben')));

-- ---------------------------------------------------------------------------
-- the member's own choice, from Settings
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  -- What the switch sends: the one column, on the member's own row.
  ('Ben turns on "Show my member number"', 'OK:1',
   tests.n_as(:'ben', format('update public.profiles set show_member_no = true where id = %L', :'ben')));
insert into tests.results (name, expected, actual) values
  ('it is stored, and Ana reads it with his number, which is as it was', 'true,true,941002',
   tests.n_now(format('select show_member_no::text from public.profiles where id = %L', :'ben')) || ',' ||
   tests.n_read(:'ana', format('select show_member_no::text || '','' || member_no from public.profiles where id = %L', :'ben')));
insert into tests.results (name, expected, actual) values
  ('and turns it off again, and on', 'OK:1,false,OK:1,true',
   tests.n_as(:'ben', format('update public.profiles set show_member_no = false where id = %L', :'ben')) || ',' ||
   tests.n_now(format('select show_member_no::text from public.profiles where id = %L', :'ben')) || ',' ||
   tests.n_as(:'ben', format('update public.profiles set show_member_no = true where id = %L', :'ben')) || ',' ||
   tests.n_now(format('select show_member_no::text from public.profiles where id = %L', :'ben')));
insert into tests.results (name, expected, actual) values
  ('Ben cannot choose for Ana', 'OK:0,false',
   tests.n_as(:'ben', format('update public.profiles set show_member_no = true where id = %L', :'ana')) || ',' ||
   tests.n_now(format('select show_member_no::text from public.profiles where id = %L', :'ana'))),
  ('nor change his number with it, or alone, or anything else 0039 keeps from him', 'DENIED,DENIED,DENIED,DENIED,DENIED,DENIED',
   tests.n_as(:'ben', format('update public.profiles set show_member_no = true, member_no = 1 where id = %L', :'ben')) || ',' ||
   tests.n_as(:'ben', format('update public.profiles set member_no = 1 where id = %L', :'ben')) || ',' ||
   tests.n_as(:'ben', format('update public.profiles set show_member_no = false, role = ''admin'' where id = %L', :'ben')) || ',' ||
   tests.n_as(:'ben', format('update public.profiles set status = ''approved'' where id = %L', :'ben')) || ',' ||
   tests.n_as(:'ben', format('update public.profiles set follower_count = 9999 where id = %L', :'ben')) || ',' ||
   tests.n_as(:'ben', format('update public.profiles set username = ''vintage'' where id = %L', :'ben'))),
  ('his number, role and standing are as they were', '941002,member,approved,true',
   tests.n_now(format('select member_no::text || '','' || role || '','' || status || '','' || show_member_no from public.profiles where id = %L', :'ben'))),
  -- What Save sends is untouched by the switch, and leaves it as it is.
  ('Settings'' Save still writes name, bio and city, and leaves the choice alone', 'OK:1,true',
   tests.n_as(:'ben', format('update public.profiles set full_name = ''Ben N'', bio = ''prints'', city = ''Hull'' where id = %L', :'ben')) || ',' ||
   tests.n_now(format('select show_member_no::text from public.profiles where id = %L', :'ben'))),
  ('a member files no profile, with the choice or without it', 'DENIED',
   tests.n_as(:'ana', 'insert into public.profiles (id, username, show_member_no) values (gen_random_uuid(), ''n41.new'', true)'));

-- ---------------------------------------------------------------------------
-- a suspended member, and a visitor
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  ('the admins suspend Sam', 'ok',
   tests.n_read(:'admin', format('select ''ok'' from (select public.admin_set_suspension(%L, true, ''spam'')) s', :'sam')));
insert into tests.results (name, expected, actual) values
  ('a suspended member changes nothing of his profile, this included', 'OK:0,false',
   tests.n_as(:'sam', format('update public.profiles set show_member_no = true where id = %L', :'sam')) || ',' ||
   tests.n_now(format('select show_member_no::text from public.profiles where id = %L', :'sam'))),
  ('a signed-out visitor changes nobody''s', 'DENIED',
   tests.n_as(null, format('update public.profiles set show_member_no = false where id = %L', :'ben'))),
  ('members may change exactly these columns of their profile: 0039''s five and this one', 'avatar_url,bio,city,full_name,is_private,show_member_no',
   tests.n_writable()),
  ('visitors none', '0',
   (select count(*)::text from pg_attribute a
     where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped
       and (has_column_privilege('anon', a.attrelid, a.attnum, 'UPDATE')
            or has_column_privilege('anon', a.attrelid, a.attnum, 'INSERT'))));

-- ---------------------------------------------------------------------------
-- the file again, and 0039 again after it
-- ---------------------------------------------------------------------------
create temp table n_acl as
select a.attname::text as col, a.attacl::text as acl
from pg_attribute a where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped;
create temp table n_pol as
select policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'profiles';

\o /dev/null
\ir ../migrations/0041_member_number_shown_by_choice.sql
\o
insert into tests.results (name, expected, actual) values
  ('applied twice: one column, the choices kept, the same grants and policies', '1,true,false,0,0',
   (select count(*)::text from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'show_member_no') || ',' ||
   tests.n_now(format('select show_member_no::text from public.profiles where id = %L', :'ben')) || ',' ||
   tests.n_now(format('select show_member_no::text from public.profiles where id = %L', :'ana')) || ',' ||
   (select count(*)::text from (
      (select a.attname::text, a.attacl::text from pg_attribute a
        where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped
       except select * from n_acl)
      union all
      (select * from n_acl except
       select a.attname::text, a.attacl::text from pg_attribute a
        where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped)) d) || ',' ||
   (select count(*)::text from (
      (select policyname, permissive, roles, cmd, qual, with_check from pg_policies
        where schemaname = 'public' and tablename = 'profiles'
       except select * from n_pol)
      union all
      (select * from n_pol except
       select policyname, permissive, roles, cmd, qual, with_check from pg_policies
        where schemaname = 'public' and tablename = 'profiles')) d));

-- 0039 takes back every update on profiles and gives back its own five:
-- run after this file, it takes this column away, and the switch is
-- refused until this file runs again (its header says so).
\o /dev/null
\ir ../migrations/0039_writes_only_what_the_app_writes.sql
\o
insert into tests.results (name, expected, actual) values
  ('0039 run again after it takes the column back: the switch is refused, the choice kept', 'DENIED,true',
   tests.n_as(:'ben', format('update public.profiles set show_member_no = false where id = %L', :'ben')) || ',' ||
   tests.n_now(format('select show_member_no::text from public.profiles where id = %L', :'ben')));
\o /dev/null
\ir ../migrations/0041_member_number_shown_by_choice.sql
\o
insert into tests.results (name, expected, actual) values
  ('and this file again gives it back, as it was', 'OK:1,avatar_url,bio,city,full_name,is_private,show_member_no,0',
   tests.n_as(:'ben', format('update public.profiles set show_member_no = false where id = %L', :'ben')) || ',' ||
   tests.n_writable() || ',' ||
   (select count(*)::text from (
      (select a.attname::text, a.attacl::text from pg_attribute a
        where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped
       except select * from n_acl)
      union all
      (select * from n_acl except
       select a.attname::text, a.attacl::text from pg_attribute a
        where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped)) d));

\pset border 2
select r.seq, r.name, r.expected, r.actual,
       case when r.expected = r.actual then 'pass' else 'FAIL' end as status
from tests.results r, n_start s
where r.seq > s.seq
order by r.seq;

do $verdict$
declare v_failed int;
begin
  select count(*) into v_failed from tests.results r, n_start s
   where r.seq > s.seq and r.expected is distinct from r.actual;
  if v_failed > 0 then
    raise exception '% member number checks FAILED', v_failed;
  end if;
  raise notice 'member number checks passed';
end
$verdict$;

rollback;
