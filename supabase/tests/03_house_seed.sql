-- Checks on the generated house-account seed, run against a throwaway
-- database after 08_house_accounts.sql has been applied to it.
--
-- The point is to catch a bad seed here rather than in production, where
-- the one mistake that cannot be undone — a house account drawing a
-- membership number — is permanent.

do $seeded$
declare
  v_accounts int;
  v_numbered int;
  v_posts    int;
  v_seq      bigint;
  v_relative int;
  v_visible  int;
  v_private  int;
  v_admin_sees int;
begin
  select count(*) into v_accounts from public.profiles where is_house;
  select count(*) into v_numbered from public.profiles where is_house and member_no is not null;
  select count(*) into v_posts from public.posts
    where author_id in (select id from public.profiles where is_house);
  select last_value into v_seq from public.member_no_seq;

  -- Every house photograph is referenced by url, never as a storage key —
  -- a bare key would render as a broken image and would also be filtered
  -- twice, since the display-filter rule keys off the scheme.
  select count(*) into v_relative from public.posts
   where author_id in (select id from public.profiles where is_house)
     and media_path !~ '^https?:';

  insert into tests.results (name, expected, actual) values
    ('seed created house accounts', 'MANY', case when v_accounts >= 50 then 'MANY' else 'FEW' end),
    ('no house account holds a number', '0', v_numbered::text),
    -- The real invariant, and one that does not care how many members have
    -- joined by the time this runs: every number the sequence handed out is
    -- on a real member's profile. A house account burning one would show up
    -- here as a gap, whatever the absolute value happens to be.
    ('every number drawn is on a real member', 'true',
     (v_seq = (select count(*) from public.profiles where member_no is not null))::text),
    ('seed created photographs', 'MANY', case when v_posts >= 300 then 'MANY' else 'FEW' end),
    ('every house photograph is a url', '0', v_relative::text);

  -- An ordinary approved member sees the public house accounts' work...
  -- Deliberately not the founder: they are an admin, and "posts: admins
  -- read all" means an admin sees private accounts too, which is correct
  -- and would hide a real privacy failure here.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  select count(*) into v_visible from public.posts
    where author_id in (select id from public.profiles where is_house);
  -- ...and not the work of the private ones, whom they do not follow.
  select count(*) into v_private from public.posts
    where author_id in (select id from public.profiles where is_house and is_private);
  reset role;

  -- The admin does see them, which is the moderation surface working.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  select count(*) into v_admin_sees from public.posts
    where author_id in (select id from public.profiles where is_house and is_private);
  reset role;

  insert into tests.results (name, expected, actual) values
    ('member sees house photographs', 'YES', case when v_visible > 0 then 'YES' else 'NO' end),
    ('private house accounts stay private from members', '0', v_private::text),
    ('admin can still see private accounts', 'YES',
     case when v_admin_sees > 0 then 'YES' else 'NO' end);
end
$seeded$;

\pset border 2
select seq, name, expected, actual,
       case when expected = actual then 'pass' else 'FAIL' end as status
from tests.results where seq > (select coalesce(max(seq), 0) - 8 from tests.results)
order by seq;

do $verdict$
declare v_failed int;
begin
  select count(*) into v_failed from tests.results where expected <> actual;
  if v_failed > 0 then
    raise exception '% seed checks FAILED', v_failed;
  end if;
  raise notice 'house seed checks passed';
end
$verdict$;
