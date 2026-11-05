-- Who has blocked whom is nobody's business but the two of them (0024).
--
-- A member may ask the database whether they and someone else are on
-- either side of a block - the policies have to - but not about two other
-- people. Asked directly, as PostgREST would let anyone ask, both
-- functions answer truthfully about the caller and say false about anyone
-- else. Signed-out visitors cannot ask at all.
--
-- Runs in one transaction and rolls back.

\set ana   'c0000000-0000-4000-8000-000000000001'
\set ben   'c0000000-0000-4000-8000-000000000002'
\set cara  'c0000000-0000-4000-8000-000000000003'

begin;

create temp table privacy_start as select coalesce(max(seq), 0) as seq from tests.results;

insert into auth.users (id, email, raw_user_meta_data) values
  ('c0000000-0000-4000-8000-000000000001', 'ana@privacy.test',  '{"username":"pv.ana"}'),
  ('c0000000-0000-4000-8000-000000000002', 'ben@privacy.test',  '{"username":"pv.ben"}'),
  ('c0000000-0000-4000-8000-000000000003', 'cara@privacy.test', '{"username":"pv.cara"}');
update public.profiles set status = 'approved', approved_at = now()
 where id::text like 'c0000000-0000-4000-8000-00000000000_';

-- Ana has blocked Ben.
insert into public.blocks (blocker_id, blocked_id) values
  ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002');

-- What a member gets back from a question, asked as them.
create or replace function tests.ask_as(p_uid text, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v text;
begin
  if p_uid is null then
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '', true);
  else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  end if;
  begin
    execute p_sql into v;
  exception
    when insufficient_privilege then v := 'DENIED';
  end;
  execute 'reset role';
  return v;
end
$fn$;

insert into tests.results (name, expected, actual) values
  ('Cara cannot learn that Ana blocked Ben', 'false',
   tests.ask_as(:'cara', $q$select public.blocked_between('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002')::text$q$)),
  ('nor by asking the other way round', 'false',
   tests.ask_as(:'cara', $q$select public.blocked_between('c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001')::text$q$)),
  ('nor whether Ben is blocked by Ana', 'false',
   tests.ask_as(:'cara', $q$select public.blocked_by('c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001')::text$q$)),
  ('Ana knows she blocked Ben', 'true',
   tests.ask_as(:'ana', $q$select public.blocked_between('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002')::text$q$)),
  ('Ben is between a block with Ana, as the policies must know', 'true',
   tests.ask_as(:'ben', $q$select public.blocked_between('c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001')::text$q$)),
  ('Ben is blocked by Ana, as the profile policy must know', 'true',
   tests.ask_as(:'ben', $q$select public.blocked_by('c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001')::text$q$)),
  ('Ben cannot ask on Ana''s behalf whether he blocked her', 'false',
   tests.ask_as(:'ben', $q$select public.blocked_by('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002')::text$q$)),
  ('Ana has not been blocked by Ben', 'false',
   tests.ask_as(:'ana', $q$select public.blocked_by('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002')::text$q$)),
  ('a signed-out visitor cannot ask at all', 'DENIED',
   tests.ask_as(null, $q$select public.blocked_between('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002')::text$q$)),
  ('the block still hides Ana''s profile from Ben', '0',
   tests.ask_as(:'ben', $q$select count(*)::text from public.profiles where id = 'c0000000-0000-4000-8000-000000000001'$q$)),
  ('and nothing of it from Cara', '1',
   tests.ask_as(:'cara', $q$select count(*)::text from public.profiles where id = 'c0000000-0000-4000-8000-000000000001'$q$)),
  ('Ben still cannot follow Ana', 'DENIED',
   tests.ask_as(:'ben', $q$insert into public.follows (follower_id, followee_id) values ('c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001') returning 'inserted'$q$)),
  ('nor open a conversation with her', 'DENIED',
   tests.ask_as(:'ben', $q$insert into public.conversations (user_a, user_b) values ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002') returning 'opened'$q$)),
  ('while Cara can follow either', 'inserted',
   tests.ask_as(:'cara', $q$insert into public.follows (follower_id, followee_id) values ('c0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001') returning 'inserted'$q$)),
  ('signatures, owner and grants are as 0018 made them', 'true,true,false,false,true,true',
   (select string_agg(x::text, ',') from (values
     ((select prosecdef from pg_proc where oid = 'public.blocked_between(uuid, uuid)'::regprocedure)),
     ((select prosecdef from pg_proc where oid = 'public.blocked_by(uuid, uuid)'::regprocedure)),
     (has_function_privilege('anon', 'public.blocked_between(uuid, uuid)', 'execute')),
     (has_function_privilege('anon', 'public.blocked_by(uuid, uuid)', 'execute')),
     (has_function_privilege('authenticated', 'public.blocked_between(uuid, uuid)', 'execute')),
     (has_function_privilege('authenticated', 'public.blocked_by(uuid, uuid)', 'execute'))) v(x)));

\pset border 2
select r.seq, r.name, r.expected, r.actual,
       case when r.expected = r.actual then 'pass' else 'FAIL' end as status
from tests.results r, privacy_start s
where r.seq > s.seq
order by r.seq;

do $verdict$
declare v_failed int;
begin
  select count(*) into v_failed from tests.results r, privacy_start s
   where r.seq > s.seq and r.expected is distinct from r.actual;
  if v_failed > 0 then
    raise exception '% block privacy checks FAILED', v_failed;
  end if;
  raise notice 'block privacy checks passed';
end
$verdict$;

rollback;
