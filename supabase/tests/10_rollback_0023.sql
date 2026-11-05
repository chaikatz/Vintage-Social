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
-- Leaves the database as 0023 made it.

create temp table rollback_start as select coalesce(max(seq), 0) as seq from tests.results;

-- As 0023 left things, to compare against after going back and forth.
create temp table after_first as
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname in ('public', 'storage');
create temp table indexes_first as
select schemaname, indexname, indexdef from pg_indexes where schemaname in ('public', 'storage');

\ir 0023_rollback.sql

insert into tests.results (name, expected, actual) values
  ('after the rollback, every policy is as 0001-0022 left it', '0',
   (select count(*)::text from (
      (select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from before_0023.policies
       except
       select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies
        where schemaname in ('public', 'storage'))
      union all
      (select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies
        where schemaname in ('public', 'storage')
       except
       select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from before_0023.policies)
    ) d)),
  ('and every index is as it was before 0023', '0',
   (select count(*)::text from (
      (select schemaname, indexname, indexdef from before_0023.indexes
       except select schemaname, indexname, indexdef from pg_indexes where schemaname in ('public', 'storage'))
      union all
      (select schemaname, indexname, indexdef from pg_indexes where schemaname in ('public', 'storage')
       except select schemaname, indexname, indexdef from before_0023.indexes)
    ) d)),
  ('and the functions 0023 made are gone', '0',
   (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('my_block_partners', 'my_blockers', 'own_profile_unchanged')));

-- And forward again.
\o /dev/null
\ir ../migrations/0023_policies_read_once.sql
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

-- And once more on top of itself.
\o /dev/null
\ir ../migrations/0023_policies_read_once.sql
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
