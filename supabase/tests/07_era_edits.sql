-- A member's own names and arrangement for their eras (migration 0022):
-- the member writes their own row and nobody else's; it is read by exactly
-- those who may see the member's photographs (public, private and
-- followed, blocked, not yet a member, signed out); the row holds two maps
-- of words of a sane size; and it goes when the member does.
--
-- Runs in one transaction and rolls back, so the members made here are
-- not left for the files that run after it.

\set founder   '11111111-1111-1111-1111-111111111111'
\set second    '22222222-2222-2222-2222-222222222222'
\set applicant 'e0000000-0000-4000-8000-000000000007'
\set author    'e0000000-0000-4000-8000-000000000001'
\set private   'e0000000-0000-4000-8000-000000000002'
\set follower  'e0000000-0000-4000-8000-000000000003'
\set asking    'e0000000-0000-4000-8000-000000000004'
\set blocker   'e0000000-0000-4000-8000-000000000005'
\set leaving   'e0000000-0000-4000-8000-000000000006'

begin;

create temp table eras_start as select coalesce(max(seq), 0) as seq from tests.results;

-- How many rows of a query a member sees, or DENIED when they may not ask.
create or replace function tests.count_as(p_uid text, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v_count bigint;
begin
  if p_uid is null then
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '', true);
  else
    execute 'set local role authenticated';
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', p_uid, 'role', 'authenticated')::text,
      true);
  end if;
  begin
    execute 'select count(*) from (' || p_sql || ') q' into v_count;
  exception when insufficient_privilege then
    execute 'reset role';
    return 'DENIED';
  end;
  execute 'reset role';
  return v_count::text;
end
$fn$;

-- Six more approved members, and one who has only applied (the fixtures'
-- applicant has joined on a link by now, in 04). Status is set directly,
-- as in the fixtures, so none of them draws a membership number.
insert into auth.users (id, email, raw_user_meta_data) values
  ('e0000000-0000-4000-8000-000000000001', 'author@eras.test',    '{"username":"eras.author"}'),
  ('e0000000-0000-4000-8000-000000000002', 'private@eras.test',   '{"username":"eras.private"}'),
  ('e0000000-0000-4000-8000-000000000003', 'follower@eras.test',  '{"username":"eras.follower"}'),
  ('e0000000-0000-4000-8000-000000000004', 'asking@eras.test',    '{"username":"eras.asking"}'),
  ('e0000000-0000-4000-8000-000000000005', 'blocker@eras.test',   '{"username":"eras.blocker"}'),
  ('e0000000-0000-4000-8000-000000000006', 'leaving@eras.test',   '{"username":"eras.leaving"}'),
  ('e0000000-0000-4000-8000-000000000007', 'applicant@eras.test', '{"username":"eras.applicant"}');
update public.profiles set status = 'approved', approved_at = now()
 where id::text like 'e0000000-0000-4000-8000-00000000000_'
   and id <> 'e0000000-0000-4000-8000-000000000007';
update public.profiles set is_private = true where id = 'e0000000-0000-4000-8000-000000000002';

-- One accepted follower of the private member, one still asking.
insert into public.follows (follower_id, followee_id, status) values
  ('e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000002', 'accepted'),
  ('e0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000002', 'pending');

\o /dev/null

-- ---------------------------------------------------------------------------
-- the member writes their own row
-- ---------------------------------------------------------------------------
select tests.run('a member saves their own arrangement, and the zone it was read in', :'author', 'OK',
  $q$ insert into public.era_edits (author_id, titles, moves, time_zone)
      values ('e0000000-0000-4000-8000-000000000001', '{"Lisbon 2023":"The long weekend"}', '{"p1":"Lisbon 2023"}', 'Europe/Lisbon') $q$);
select tests.run('and saves it again over itself, as the app''s upsert does', :'author', 'OK',
  $q$ insert into public.era_edits (author_id, titles, moves, time_zone)
      values ('e0000000-0000-4000-8000-000000000001', '{"Lisbon 2023":"Lisbon, slowly"}', '{"p1":"Lisbon 2023"}', 'Europe/Lisbon')
      on conflict (author_id) do update
        set author_id = excluded.author_id, titles = excluded.titles, moves = excluded.moves,
            time_zone = excluded.time_zone $q$);
select tests.run('a private member saves theirs', :'private', 'OK',
  $q$ insert into public.era_edits (author_id, titles) values ('e0000000-0000-4000-8000-000000000002', '{"Winter 2024":"Snowed in"}') $q$);
select tests.run('so does a member who will block another', :'blocker', 'OK',
  $q$ insert into public.era_edits (author_id, titles) values ('e0000000-0000-4000-8000-000000000005', '{"Kyoto 2022":"Kyoto, in the rain"}') $q$);
select tests.run('and one who is leaving', :'leaving', 'OK',
  $q$ insert into public.era_edits (author_id, titles) values ('e0000000-0000-4000-8000-000000000006', '{"Summer 2021":"That summer"}') $q$);

-- ---------------------------------------------------------------------------
-- nobody else writes it
-- ---------------------------------------------------------------------------
select tests.run('another member cannot make a row for someone who has none', :'second', 'DENIED',
  $q$ insert into public.era_edits (author_id) values ('e0000000-0000-4000-8000-000000000003') $q$);
select tests.run('nor upsert over the member''s row', :'second', 'DENIED',
  $q$ insert into public.era_edits (author_id, titles) values ('e0000000-0000-4000-8000-000000000001', '{"Lisbon 2023":"Mine now"}')
      on conflict (author_id) do update set titles = excluded.titles $q$);
select tests.run('an update of the member''s row by another changes nothing', :'second', 'OK',
  $q$ update public.era_edits set titles = '{"Lisbon 2023":"Mine now"}' where author_id = 'e0000000-0000-4000-8000-000000000001' $q$);
select tests.run('a delete of it by another removes nothing', :'second', 'OK',
  $q$ delete from public.era_edits where author_id = 'e0000000-0000-4000-8000-000000000001' $q$);
select tests.run('an admin does not write it either', :'founder', 'OK',
  $q$ update public.era_edits set titles = '{}' where author_id = 'e0000000-0000-4000-8000-000000000001' $q$);
select tests.run('the member cannot hand their row to someone else', :'author', 'DENIED',
  $q$ update public.era_edits set author_id = 'e0000000-0000-4000-8000-000000000003' where author_id = 'e0000000-0000-4000-8000-000000000001' $q$);
select tests.run('someone not yet a member cannot write one, even their own', :'applicant', 'DENIED',
  $q$ insert into public.era_edits (author_id) values ('e0000000-0000-4000-8000-000000000007') $q$);
select tests.run('a signed-out visitor cannot write one', null, 'DENIED',
  $q$ insert into public.era_edits (author_id) values ('e0000000-0000-4000-8000-000000000003') $q$);

-- ---------------------------------------------------------------------------
-- what a row may hold
-- ---------------------------------------------------------------------------
select tests.run('names are a map, not a list', :'follower', 'ERROR:23514',
  $q$ insert into public.era_edits (author_id, titles) values ('e0000000-0000-4000-8000-000000000003', '["Lisbon 2023"]') $q$);
select tests.run('moves are a map, not a string', :'follower', 'ERROR:23514',
  $q$ insert into public.era_edits (author_id, moves) values ('e0000000-0000-4000-8000-000000000003', '"p1"') $q$);
select tests.run('a name is words, not a number', :'follower', 'ERROR:23514',
  $q$ insert into public.era_edits (author_id, titles) values ('e0000000-0000-4000-8000-000000000003', '{"Lisbon 2023":2023}') $q$);
select tests.run('a move names an era in words', :'follower', 'ERROR:23514',
  $q$ insert into public.era_edits (author_id, moves) values ('e0000000-0000-4000-8000-000000000003', '{"p1":null}') $q$);
select tests.run('a name is words, not a list of them', :'follower', 'ERROR:23514',
  $q$ insert into public.era_edits (author_id, titles) values ('e0000000-0000-4000-8000-000000000003', '{"Lisbon 2023":["x"]}') $q$);
select tests.run('a move is not an empty list', :'follower', 'ERROR:23514',
  $q$ insert into public.era_edits (author_id, moves) values ('e0000000-0000-4000-8000-000000000003', '{"p1":[]}') $q$);
select tests.run('a time zone is a name the phone gave', :'follower', 'ERROR:23514',
  $q$ insert into public.era_edits (author_id, time_zone) values ('e0000000-0000-4000-8000-000000000003', 'Lisbon; drop table') $q$);
select tests.run('never an empty one', :'follower', 'ERROR:23514',
  $q$ insert into public.era_edits (author_id, time_zone) values ('e0000000-0000-4000-8000-000000000003', '') $q$);
select tests.run('nor one past 64 characters', :'follower', 'ERROR:23514',
  $q$ insert into public.era_edits (author_id, time_zone) values ('e0000000-0000-4000-8000-000000000003', repeat('A', 65)) $q$);
select tests.run('a name is never empty', :'follower', 'ERROR:23514',
  $q$ insert into public.era_edits (author_id, titles) values ('e0000000-0000-4000-8000-000000000003', '{"Lisbon 2023":""}') $q$);
select tests.run('a name of 60 characters is kept', :'follower', 'OK',
  $q$ insert into public.era_edits (author_id, titles)
      values ('e0000000-0000-4000-8000-000000000003', jsonb_build_object('Lisbon 2023', repeat('é', 60))) $q$);
select tests.run('a zone of 64 characters is kept', :'follower', 'OK',
  $q$ update public.era_edits set time_zone = repeat('A', 64)
      where author_id = 'e0000000-0000-4000-8000-000000000003' $q$);
select tests.run('and so is every shape of IANA name', :'follower', 'OK',
  $q$ do $d$
      declare v_zone text;
      begin
        foreach v_zone in array array['America/Argentina/Buenos_Aires', 'Etc/GMT+3', 'Etc/GMT-14', 'UTC'] loop
          update public.era_edits set time_zone = v_zone where author_id = 'e0000000-0000-4000-8000-000000000003';
        end loop;
      end
      $d$ $q$);
-- An era the member makes (src/utils/eraEdits.ts) is keyed "~" and ten
-- letters and digits, a word like any other, and named in 1 to 60
-- characters like any other: the row takes it as it is, with no change
-- to 0022.
select tests.run('an era the member made is kept: its own key, its name, and the photographs moved into it', :'follower', 'OK',
  $q$ update public.era_edits
         set titles = titles || '{"~k3j9x0ab12":"The long weekend"}',
             moves = '{"p1":"~k3j9x0ab12","p2":"~k3j9x0ab12","p3":"Lisbon 2023"}'
       where author_id = 'e0000000-0000-4000-8000-000000000003' $q$);
insert into tests.results (name, expected, actual) values
  ('and reads back as it was saved', 'The long weekend · ~k3j9x0ab12',
   coalesce((select (titles ->> '~k3j9x0ab12') || ' · ' || (moves ->> 'p2') from public.era_edits
              where author_id = 'e0000000-0000-4000-8000-000000000003'), '<none>'));
select tests.run('a thousand photographs moved into fifty of them, named in sixty characters each, fit', :'follower', 'OK',
  $q$ update public.era_edits
         set titles = (select jsonb_object_agg('~' || lpad(to_hex(n), 10, '0'), repeat('é', 60)) from generate_series(1, 50) n),
             moves = (select jsonb_object_agg(gen_random_uuid()::text, '~' || lpad(to_hex(n % 50 + 1), 10, '0'))
                        from generate_series(1, 1000) n)
       where author_id = 'e0000000-0000-4000-8000-000000000003' $q$);
insert into tests.results (name, expected, actual) values
  ('every one of them', '50 names · 1000 moves',
   coalesce((select (select count(*) from jsonb_object_keys(titles)) || ' names · ' || (select count(*) from jsonb_object_keys(moves)) || ' moves'
               from public.era_edits where author_id = 'e0000000-0000-4000-8000-000000000003'), '<none>'));
select tests.run('one of 61 is refused', :'follower', 'ERROR:23514',
  $q$ update public.era_edits set titles = jsonb_build_object('Lisbon 2023', repeat('é', 61))
      where author_id = 'e0000000-0000-4000-8000-000000000003' $q$);
select tests.run('and so is a row past its size', :'follower', 'ERROR:23514',
  $q$ update public.era_edits
         set moves = (select jsonb_object_agg('post-' || n, 'Lisbon 2023 and a long way after') from generate_series(1, 8000) n)
       where author_id = 'e0000000-0000-4000-8000-000000000003' $q$);

\o

-- ---------------------------------------------------------------------------
-- who reads it: whoever may see the member's photographs
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  ('the member reads their own', '1',
   tests.count_as(:'author', $q$ select 1 from public.era_edits where author_id = 'e0000000-0000-4000-8000-000000000001' $q$)),
  ('and it holds what they last saved, untouched by the others', 'Lisbon, slowly',
   (select titles ->> 'Lisbon 2023' from public.era_edits where author_id = 'e0000000-0000-4000-8000-000000000001')),
  ('with the zone its keys were read in', 'Europe/Lisbon',
   (select time_zone from public.era_edits where author_id = 'e0000000-0000-4000-8000-000000000001')),
  ('another member reads a public member''s', '1',
   tests.count_as(:'second', $q$ select 1 from public.era_edits where author_id = 'e0000000-0000-4000-8000-000000000001' $q$)),
  ('a private member reads their own', '1',
   tests.count_as(:'private', $q$ select 1 from public.era_edits where author_id = 'e0000000-0000-4000-8000-000000000002' $q$)),
  ('an accepted follower reads a private member''s', '1',
   tests.count_as(:'follower', $q$ select 1 from public.era_edits where author_id = 'e0000000-0000-4000-8000-000000000002' $q$)),
  ('one still asking does not', '0',
   tests.count_as(:'asking', $q$ select 1 from public.era_edits where author_id = 'e0000000-0000-4000-8000-000000000002' $q$)),
  ('nor does any other member', '0',
   tests.count_as(:'second', $q$ select 1 from public.era_edits where author_id = 'e0000000-0000-4000-8000-000000000002' $q$)),
  ('an admin reads a private member''s', '1',
   tests.count_as(:'founder', $q$ select 1 from public.era_edits where author_id = 'e0000000-0000-4000-8000-000000000002' $q$)),
  ('someone not yet a member reads no one''s', '0',
   tests.count_as(:'applicant', $q$ select 1 from public.era_edits $q$)),
  ('a signed-out visitor may not ask', 'DENIED',
   tests.count_as(null, $q$ select 1 from public.era_edits $q$)),
  ('before the block, the blocker''s is read by the member they will block', '1',
   tests.count_as(:'author', $q$ select 1 from public.era_edits where author_id = 'e0000000-0000-4000-8000-000000000005' $q$));

-- The blocker blocks the author, as block_member would.
insert into public.blocks (blocker_id, blocked_id) values
  ('e0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000001');

insert into tests.results (name, expected, actual) values
  ('after it, the member blocked no longer reads the blocker''s', '0',
   tests.count_as(:'author', $q$ select 1 from public.era_edits where author_id = 'e0000000-0000-4000-8000-000000000005' $q$)),
  ('nor the blocker the blocked member''s', '0',
   tests.count_as(:'blocker', $q$ select 1 from public.era_edits where author_id = 'e0000000-0000-4000-8000-000000000001' $q$)),
  ('each still reads their own', '2',
   (tests.count_as(:'author', $q$ select 1 from public.era_edits where author_id = 'e0000000-0000-4000-8000-000000000001' $q$)::int
    + tests.count_as(:'blocker', $q$ select 1 from public.era_edits where author_id = 'e0000000-0000-4000-8000-000000000005' $q$)::int)::text),
  ('everyone else reads both', '2',
   tests.count_as(:'second', $q$ select 1 from public.era_edits
                                  where author_id in ('e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000005') $q$)),
  ('an admin reads across the block', '2',
   tests.count_as(:'founder', $q$ select 1 from public.era_edits
                                   where author_id in ('e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000005') $q$));

-- ---------------------------------------------------------------------------
-- when it last changed, and when it goes
-- ---------------------------------------------------------------------------
update public.era_edits set updated_at = now() - interval '1 day'
 where author_id = 'e0000000-0000-4000-8000-000000000001';
\o /dev/null
select tests.run('the member changes a name', :'author', 'OK',
  $q$ update public.era_edits set titles = '{"Lisbon 2023":"Lisbon, again"}' where author_id = 'e0000000-0000-4000-8000-000000000001' $q$);
\o
insert into tests.results (name, expected, actual) values
  ('the change is stamped by the database''s clock', 'true',
   (select (updated_at > now() - interval '1 hour')::text from public.era_edits
     where author_id = 'e0000000-0000-4000-8000-000000000001'));

delete from auth.users where id = 'e0000000-0000-4000-8000-000000000006';

insert into tests.results (name, expected, actual) values
  ('a member who leaves takes their arrangement with them', '0',
   (select count(*) from public.era_edits where author_id = 'e0000000-0000-4000-8000-000000000006')::text),
  ('signed-out visitors hold no privilege on the table', '<none>',
   coalesce((select string_agg(privilege_type, ',' order by privilege_type)
               from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'era_edits' and grantee = 'anon'), '<none>')),
  ('members read and write it, through the policies', 'DELETE,INSERT,SELECT,UPDATE',
   coalesce((select string_agg(privilege_type, ',' order by privilege_type)
               from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'era_edits' and grantee = 'authenticated'), '<none>')),
  ('row-level security is on', 'true',
   (select relrowsecurity::text from pg_class where oid = 'public.era_edits'::regclass));

\pset border 2
select r.seq, r.name, r.expected, r.actual,
       case when r.expected = r.actual then 'pass' else 'FAIL' end as status
from tests.results r, eras_start s
where r.seq > s.seq
order by r.seq;

do $verdict$
declare v_failed int;
begin
  select count(*) into v_failed from tests.results r, eras_start s
   where r.seq > s.seq and r.expected <> r.actual;
  if v_failed > 0 then
    raise exception '% era edits checks FAILED', v_failed;
  end if;
  raise notice 'era edits checks passed';
end
$verdict$;

rollback;
