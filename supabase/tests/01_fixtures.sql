-- Five members, one of each membership status, plus the harness that runs a
-- statement as a given member and reports whether row-level security let it
-- through.

create schema tests;

-- 'OK' when the statement was allowed, 'DENIED' when row-level security
-- refused it (42501), otherwise the SQLSTATE so a broken test is not
-- mistaken for a passing denial. The failed statement is rolled back by the
-- exception handler, so one test cannot leave debris for the next.
create or replace function tests.attempt(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'OK';
exception
  when insufficient_privilege then return 'DENIED';
  when others then return 'ERROR:' || sqlstate;
end
$$;

create table tests.results (
  seq       serial primary key,
  name      text not null,
  expected  text not null,
  actual    text not null
);

grant usage on schema tests to anon, authenticated;
grant execute on function tests.attempt(text) to anon, authenticated;
grant all on tests.results to anon, authenticated;
grant all on sequence tests.results_seq_seq to anon, authenticated;

-- ---------------------------------------------------------------------------
-- members
-- ---------------------------------------------------------------------------
-- The on_auth_user_created trigger builds each profile; status is set after,
-- the way decide_application would.
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'founder@example.test',   '{"username":"founder"}'),
  ('22222222-2222-2222-2222-222222222222', 'second@example.test',    '{"username":"second"}'),
  ('33333333-3333-3333-3333-333333333333', 'pending@example.test',   '{"username":"pending"}'),
  ('44444444-4444-4444-4444-444444444444', 'rejected@example.test',  '{"username":"rejected"}'),
  ('55555555-5555-5555-5555-555555555555', 'suspended@example.test', '{"username":"suspended"}');

update public.profiles set status = 'approved', role = 'admin', approved_at = now()
  where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set status = 'approved', approved_at = now()
  where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set status = 'applied'   where id = '33333333-3333-3333-3333-333333333333';
update public.profiles set status = 'rejected'  where id = '44444444-4444-4444-4444-444444444444';
update public.profiles set status = 'suspended' where id = '55555555-5555-5555-5555-555555555555';
