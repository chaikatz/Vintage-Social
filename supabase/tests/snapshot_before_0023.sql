-- Taken by the runner just before 0023 is applied: every policy, index and
-- public function as 0001-0022 left them. 08_policy_rewrite.sql puts these
-- policies (and functions) back to ask every question again under them,
-- and checks the rollback restores exactly these policies; nothing here
-- is used by the app.

create schema if not exists before_0023;

drop table if exists before_0023.policies;
create table before_0023.policies as
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage');

drop table if exists before_0023.indexes;
create table before_0023.indexes as
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname in ('public', 'storage');

drop table if exists before_0023.functions;
create table before_0023.functions as
select p.oid::regprocedure::text as signature, pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f';
