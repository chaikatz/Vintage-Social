-- Regression tests for publishing.
--
-- The bug these exist for: an approved member could not publish, because
-- uploading with `upsert` makes PostgreSQL apply the SELECT policy on
-- storage.objects and there wasn't one. A plain insert of the same row
-- passed, so the write policies all looked correct. Both shapes are tested
-- here, and so is every way publishing is supposed to be refused.

create or replace function tests.run(p_name text, p_uid text, p_expected text, p_sql text)
returns void
language plpgsql
as $fn$
declare
  v_actual text;
begin
  if p_uid is null then
    -- Signed out: PostgREST would use the anon role and send no subject.
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '', true);
  else
    execute 'set local role authenticated';
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', p_uid, 'role', 'authenticated')::text,
      true);
  end if;

  v_actual := tests.attempt(p_sql);

  execute 'reset role';
  insert into tests.results (name, expected, actual) values (p_name, p_expected, v_actual);
end
$fn$;

-- The tests.run() calls return nothing useful; the report at the bottom is
-- the output that matters.
\o /dev/null

\set founder   '11111111-1111-1111-1111-111111111111'
\set second    '22222222-2222-2222-2222-222222222222'
\set pending   '33333333-3333-3333-3333-333333333333'
\set rejected  '44444444-4444-4444-4444-444444444444'
\set suspended '55555555-5555-5555-5555-555555555555'

-- ---------------------------------------------------------------------------
-- posts: who may publish
-- ---------------------------------------------------------------------------
select tests.run('approved member publishes own post', :'founder', 'OK', $q$
  insert into public.posts (author_id, media_type, media_path, thumb_path, filter_id)
  values ('11111111-1111-1111-1111-111111111111', 'photo',
          '11111111-1111-1111-1111-111111111111/a.jpg',
          '11111111-1111-1111-1111-111111111111/a.jpg', 'kodachrome')
$q$);

select tests.run('second approved member publishes own post', :'second', 'OK', $q$
  insert into public.posts (author_id, media_type, media_path, filter_id)
  values ('22222222-2222-2222-2222-222222222222', 'photo',
          '22222222-2222-2222-2222-222222222222/a.jpg', 'kodachrome')
$q$);

select tests.run('pending applicant cannot publish', :'pending', 'DENIED', $q$
  insert into public.posts (author_id, media_type, media_path, filter_id)
  values ('33333333-3333-3333-3333-333333333333', 'photo',
          '33333333-3333-3333-3333-333333333333/a.jpg', 'kodachrome')
$q$);

select tests.run('rejected applicant cannot publish', :'rejected', 'DENIED', $q$
  insert into public.posts (author_id, media_type, media_path, filter_id)
  values ('44444444-4444-4444-4444-444444444444', 'photo',
          '44444444-4444-4444-4444-444444444444/a.jpg', 'kodachrome')
$q$);

select tests.run('suspended member cannot publish', :'suspended', 'DENIED', $q$
  insert into public.posts (author_id, media_type, media_path, filter_id)
  values ('55555555-5555-5555-5555-555555555555', 'photo',
          '55555555-5555-5555-5555-555555555555/a.jpg', 'kodachrome')
$q$);

select tests.run('member cannot publish as another member', :'founder', 'DENIED', $q$
  insert into public.posts (author_id, media_type, media_path, filter_id)
  values ('22222222-2222-2222-2222-222222222222', 'photo',
          '22222222-2222-2222-2222-222222222222/forged.jpg', 'kodachrome')
$q$);

select tests.run('signed-out visitor cannot publish', null, 'DENIED', $q$
  insert into public.posts (author_id, media_type, media_path, filter_id)
  values ('11111111-1111-1111-1111-111111111111', 'photo',
          '11111111-1111-1111-1111-111111111111/anon.jpg', 'kodachrome')
$q$);

select tests.run('member cannot publish with forged like count', :'founder', 'DENIED', $q$
  insert into public.posts (author_id, media_type, media_path, filter_id, like_count)
  values ('11111111-1111-1111-1111-111111111111', 'photo',
          '11111111-1111-1111-1111-111111111111/liked.jpg', 'kodachrome', 500)
$q$);

select tests.run('member cannot publish pre-removed by another', :'founder', 'DENIED', $q$
  insert into public.posts (author_id, media_type, media_path, filter_id, removed_by)
  values ('11111111-1111-1111-1111-111111111111', 'photo',
          '11111111-1111-1111-1111-111111111111/rm.jpg', 'kodachrome',
          '22222222-2222-2222-2222-222222222222')
$q$);

-- ---------------------------------------------------------------------------
-- storage: plain upload
-- ---------------------------------------------------------------------------
select tests.run('approved member uploads media to own folder', :'founder', 'OK', $q$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('media', '11111111-1111-1111-1111-111111111111/a.jpg',
          '11111111-1111-1111-1111-111111111111')
$q$);

select tests.run('approved member uploads thumbnail to own folder', :'founder', 'OK', $q$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('thumbnails', '11111111-1111-1111-1111-111111111111/a.jpg',
          '11111111-1111-1111-1111-111111111111')
$q$);

select tests.run('applicant uploads own avatar before approval', :'pending', 'OK', $q$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('avatars', '33333333-3333-3333-3333-333333333333/avatar.jpg',
          '33333333-3333-3333-3333-333333333333')
$q$);

select tests.run('member cannot upload into another member folder', :'founder', 'DENIED', $q$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('media', '22222222-2222-2222-2222-222222222222/stolen.jpg',
          '11111111-1111-1111-1111-111111111111')
$q$);

select tests.run('member cannot upload to bucket root', :'founder', 'DENIED', $q$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('media', 'loose.jpg', '11111111-1111-1111-1111-111111111111')
$q$);

select tests.run('suspended member cannot upload media', :'suspended', 'DENIED', $q$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('media', '55555555-5555-5555-5555-555555555555/a.jpg',
          '55555555-5555-5555-5555-555555555555')
$q$);

select tests.run('pending applicant cannot upload media', :'pending', 'DENIED', $q$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('media', '33333333-3333-3333-3333-333333333333/a.jpg',
          '33333333-3333-3333-3333-333333333333')
$q$);

select tests.run('signed-out visitor cannot upload', null, 'DENIED', $q$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('media', '11111111-1111-1111-1111-111111111111/anon.jpg',
          '11111111-1111-1111-1111-111111111111')
$q$);

-- ---------------------------------------------------------------------------
-- storage: upsert — the shape the client actually sends, and the one that
-- was refused before migration 0009
-- ---------------------------------------------------------------------------
select tests.run('approved member upserts media into own folder', :'founder', 'OK', $q$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('media', '11111111-1111-1111-1111-111111111111/upsert.jpg',
          '11111111-1111-1111-1111-111111111111')
  on conflict (bucket_id, name) do update set owner_id = excluded.owner_id
$q$);

select tests.run('member replaces own avatar (upsert over existing)', :'pending', 'OK', $q$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('avatars', '33333333-3333-3333-3333-333333333333/avatar.jpg',
          '33333333-3333-3333-3333-333333333333')
  on conflict (bucket_id, name) do update set owner_id = excluded.owner_id
$q$);

select tests.run('member cannot upsert into another member folder', :'founder', 'DENIED', $q$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('media', '22222222-2222-2222-2222-222222222222/stolen.jpg',
          '11111111-1111-1111-1111-111111111111')
  on conflict (bucket_id, name) do update set owner_id = excluded.owner_id
$q$);

select tests.run('suspended member cannot upsert media', :'suspended', 'DENIED', $q$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('media', '55555555-5555-5555-5555-555555555555/upsert.jpg',
          '55555555-5555-5555-5555-555555555555')
  on conflict (bucket_id, name) do update set owner_id = excluded.owner_id
$q$);

select tests.run('signed-out visitor cannot upsert', null, 'DENIED', $q$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('media', '11111111-1111-1111-1111-111111111111/anon2.jpg',
          '11111111-1111-1111-1111-111111111111')
  on conflict (bucket_id, name) do update set owner_id = excluded.owner_id
$q$);

-- ---------------------------------------------------------------------------
-- storage: the new read policy is scoped to the caller's own folder
-- ---------------------------------------------------------------------------
-- These assert on visible row counts rather than on allow/deny, since an
-- unreadable row is invisible rather than an error.
do $check$
declare
  v_own int;
  v_other int;
  v_anon int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  select count(*) into v_own from storage.objects
    where name like '11111111-1111-1111-1111-111111111111/%';
  select count(*) into v_other from storage.objects
    where name not like '11111111-1111-1111-1111-111111111111/%';
  reset role;

  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_anon from storage.objects;
  reset role;

  insert into tests.results (name, expected, actual) values
    ('member reads own storage rows',        'SOME',  case when v_own > 0 then 'SOME' else 'NONE' end),
    ('member reads no other storage rows',   'NONE',  case when v_other = 0 then 'NONE' else 'SOME' end),
    ('signed-out visitor reads no storage rows', 'NONE', case when v_anon = 0 then 'NONE' else 'SOME' end);
end
$check$;

-- ---------------------------------------------------------------------------
-- the RPC surface stays locked down
--
-- 0008 revoked execute on everything in `public` and granted back a short
-- list. 0010 rewrites two of those functions, and `create or replace` keeps
-- an existing ACL — but that is exactly the kind of thing worth asserting
-- rather than remembering.
-- ---------------------------------------------------------------------------
do $grants$
declare
  r text := '';
begin
  insert into tests.results (name, expected, actual) values
    ('assign_member_no unreachable by members', 'NO',
     case when has_function_privilege('authenticated', 'public.assign_member_no(uuid)', 'EXECUTE')
          then 'YES' else 'NO' end),
    ('assign_member_no unreachable by anon', 'NO',
     case when has_function_privilege('anon', 'public.assign_member_no(uuid)', 'EXECUTE')
          then 'YES' else 'NO' end),
    ('create_invite callable by members', 'YES',
     case when has_function_privilege('authenticated', 'public.create_invite()', 'EXECUTE')
          then 'YES' else 'NO' end),
    ('create_invite not callable by anon', 'NO',
     case when has_function_privilege('anon', 'public.create_invite()', 'EXECUTE')
          then 'YES' else 'NO' end),
    ('redeem_invite callable by members', 'YES',
     case when has_function_privilege('authenticated', 'public.redeem_invite(text)', 'EXECUTE')
          then 'YES' else 'NO' end),
    ('policy helper is_active_member callable', 'YES',
     case when has_function_privilege('authenticated', 'public.is_active_member(uuid)', 'EXECUTE')
          then 'YES' else 'NO' end);
  r := r;
end
$grants$;

-- ---------------------------------------------------------------------------
-- report
-- ---------------------------------------------------------------------------
\o
\pset border 2
select seq, name, expected, actual,
       case when expected = actual then 'pass' else 'FAIL' end as status
from tests.results order by seq;

do $verdict$
declare
  v_failed int;
  v_total  int;
begin
  select count(*) filter (where expected <> actual), count(*) into v_failed, v_total from tests.results;
  if v_failed > 0 then
    raise exception '% of % publish policy checks FAILED', v_failed, v_total;
  end if;
  raise notice 'all % publish policy checks passed', v_total;
end
$verdict$;
