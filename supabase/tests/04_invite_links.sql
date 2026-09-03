-- Invitation links: who may hold one, what a suffix may be, what the public
-- lookup gives away, and — the one that matters — that an allowance cannot
-- be overspent.

\set founder   '11111111-1111-1111-1111-111111111111'
\set second    '22222222-2222-2222-2222-222222222222'
\set pending   '33333333-3333-3333-3333-333333333333'
\set suspended '55555555-5555-5555-5555-555555555555'

-- Give the founder room to invite; the fixtures leave quotas at 0.
update public.profiles set invite_quota = 2
  where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set invite_quota = 1
  where id = '22222222-2222-2222-2222-222222222222';

\o /dev/null

-- ---------------------------------------------------------------------------
-- who may hold a link
-- ---------------------------------------------------------------------------
select tests.run('approved member gets a link', :'founder', 'OK',
  $q$ select public.ensure_invite_link() $q$);
select tests.run('pending applicant gets no link', :'pending', 'ERROR:P0001',
  $q$ select public.ensure_invite_link() $q$);
select tests.run('suspended member gets no link', :'suspended', 'ERROR:P0001',
  $q$ select public.ensure_invite_link() $q$);
select tests.run('signed-out visitor cannot mint a link', null, 'DENIED',
  $q$ select public.ensure_invite_link() $q$);

-- ---------------------------------------------------------------------------
-- what a suffix may be
-- ---------------------------------------------------------------------------
select tests.run('a good suffix is accepted', :'founder', 'OK',
  $q$ select public.set_invite_slug('chai-katz-photographs') $q$);
select tests.run('too short is refused', :'founder', 'ERROR:P0001',
  $q$ select public.set_invite_slug('chai') $q$);
select tests.run('leading hyphen is refused', :'founder', 'ERROR:P0001',
  $q$ select public.set_invite_slug('-chai-katz') $q$);
select tests.run('symbols are refused', :'founder', 'ERROR:P0001',
  $q$ select public.set_invite_slug('chai katz!') $q$);
select tests.run('a reserved word is refused', :'founder', 'ERROR:P0001',
  $q$ select public.set_invite_slug('membership') $q$);
select tests.run('another member''s suffix is refused', :'second', 'ERROR:P0001',
  $q$ select public.set_invite_slug('chai-katz-photographs') $q$);
select tests.run('a member may keep their own suffix', :'founder', 'OK',
  $q$ select public.set_invite_slug('chai-katz-photographs') $q$);
select tests.run('signed-out visitor cannot set a suffix', null, 'DENIED',
  $q$ select public.set_invite_slug('somebody-elses') $q$);

-- ---------------------------------------------------------------------------
-- the table itself is never public
-- ---------------------------------------------------------------------------
-- Not an error: row-level security answers an unauthorised read with an
-- empty set rather than a refusal, which is what we want — the reader
-- learns nothing, not even that there was something to learn. So the
-- assertion is about rows returned, made in the block below.

\o

do $checks$
declare
  v_inviter text;
  v_open    boolean;
  v_slug    text;
  v_old     text;
  v_joined  boolean;
  v_visible int;
begin
  -- The public lookup, as the invitation page will call it: anon.
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  select inviter, open into v_inviter, v_open
    from public.invite_link_owner('chai-katz-photographs');
  insert into tests.results (name, expected, actual) values
    ('invitation page sees the inviter''s name', 'founder', coalesce(v_inviter, '<null>')),
    ('invitation page sees the door is open', 'true', coalesce(v_open::text, '<null>'));

  select inviter, open into v_inviter, v_open
    from public.invite_link_owner('no-such-link-at-all');
  insert into tests.results (name, expected, actual) values
    ('an unknown link gives away nothing', '<null>', coalesce(v_inviter, '<null>')),
    ('an unknown link is not open', 'false', coalesce(v_open::text, '<null>'));

  -- Nobody signed out sees a single row of that table.
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_visible from public.invite_links;
  reset role;
  insert into tests.results (name, expected, actual) values
    ('signed-out visitor reads no link rows', '0', v_visible::text);

  -- A member cannot read anyone else's link row even when signed in.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  select count(*) into v_visible from public.invite_links;
  reset role;
  insert into tests.results (name, expected, actual) values
    ('a member sees only their own link row', '0', v_visible::text);

  -- Rotating retires the old address.
  select slug into v_old from public.invite_links
   where owner_id = '11111111-1111-1111-1111-111111111111';
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  select public.rotate_invite_link() into v_slug;
  reset role;
  insert into tests.results (name, expected, actual) values
    ('rotating issues a different link', 'different',
     case when v_slug is distinct from v_old then 'different' else 'same' end);

  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  select open into v_open from public.invite_link_owner(v_old);
  reset role;
  insert into tests.results (name, expected, actual) values
    ('the retired address stops working', 'false', coalesce(v_open::text, '<null>'));
end
$checks$;

-- ---------------------------------------------------------------------------
-- joining, and the allowance
-- ---------------------------------------------------------------------------
do $joining$
declare
  v_slug   text;
  v_ok     boolean;
  v_no     integer;
  v_by     uuid;
begin
  select slug into v_slug from public.invite_links
   where owner_id = '11111111-1111-1111-1111-111111111111';

  -- The pending applicant takes it up. Quota is 2, so this is the first.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  select public.join_with_invite(v_slug) into v_ok;
  reset role;

  select member_no, invited_by into v_no, v_by from public.profiles
   where id = '33333333-3333-3333-3333-333333333333';

  insert into tests.results (name, expected, actual) values
    ('joining on a live link works', 'true', v_ok::text),
    ('the joiner is attributed to the inviter', 'yes',
     case when v_by = '11111111-1111-1111-1111-111111111111' then 'yes' else 'no' end),
    ('the joiner is given a membership number', 'yes',
     case when v_no is not null then 'yes' else 'no' end);

  -- Second one: quota 2, so this fills it.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
  select public.join_with_invite(v_slug) into v_ok;
  reset role;
  insert into tests.results (name, expected, actual) values
    ('the second joiner fills the allowance', 'true', v_ok::text);

  -- Third: the allowance is spent. This is the check that matters.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
  select public.join_with_invite(v_slug) into v_ok;
  reset role;
  insert into tests.results (name, expected, actual) values
    ('a spent allowance admits nobody else', 'false', v_ok::text);

  -- And the page now says so, without saying why.
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  select open into v_ok from public.invite_link_owner(v_slug);
  reset role;
  insert into tests.results (name, expected, actual) values
    ('a spent link reads as closed', 'false', coalesce(v_ok::text, '<null>'));

  -- You cannot admit yourself.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  select public.join_with_invite(v_slug) into v_ok;
  reset role;
  insert into tests.results (name, expected, actual) values
    ('a member cannot join on their own link', 'false', v_ok::text);
end
$joining$;

\pset border 2
select seq, name, expected, actual,
       case when expected = actual then 'pass' else 'FAIL' end as status
from tests.results where seq > (select coalesce(max(seq), 0) - 27 from tests.results)
order by seq;

do $verdict$
declare v_failed int;
begin
  select count(*) into v_failed from tests.results where expected <> actual;
  if v_failed > 0 then
    raise exception '% invitation-link checks FAILED', v_failed;
  end if;
  raise notice 'invitation link checks passed';
end
$verdict$;
