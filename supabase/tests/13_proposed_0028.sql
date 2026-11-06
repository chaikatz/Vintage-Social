-- The proposed 0028 (proposed_0028_comments_likes_tags_follow_the_photograph.sql),
-- tried and rolled back: comments, likes and tags are read only with
-- their photograph, or when they are the reader's own.
--
-- A small club with a private member and a public one, an accepted
-- follower and one still asking, a block, a removed photograph, and
-- comments, likes and tags on each from members who can and cannot see
-- them. Nine callers read every comment, like and tag they can, and
-- every photograph, before the proposal and after it. After must be
-- exactly before, less the rows whose photograph the caller could not
-- see and that are not theirs. Their own rows on a photograph they cannot
-- see can still be taken back, declined and removed, as before.
--
-- Runs in one transaction and rolls back: nothing here, the proposal
-- included, outlives the file.

begin;

create temp table proposal_start as select coalesce(max(seq), 0) as seq from tests.results;

insert into auth.users (id, email, raw_user_meta_data) values
  ('d0000000-0000-4000-8000-000000000001', 'pub@p28.test',      '{"username":"p28.public"}'),
  ('d0000000-0000-4000-8000-000000000002', 'priv@p28.test',     '{"username":"p28.private"}'),
  ('d0000000-0000-4000-8000-000000000003', 'fol@p28.test',      '{"username":"p28.follower"}'),
  ('d0000000-0000-4000-8000-000000000004', 'ask@p28.test',      '{"username":"p28.asking"}'),
  ('d0000000-0000-4000-8000-000000000005', 'stranger@p28.test', '{"username":"p28.stranger"}'),
  ('d0000000-0000-4000-8000-000000000006', 'blocked@p28.test',  '{"username":"p28.blocked"}'),
  ('d0000000-0000-4000-8000-000000000007', 'applicant@p28.test','{"username":"p28.applicant"}');
update public.profiles set status = 'approved', approved_at = now()
 where id::text like 'd0000000-0000-4000-8000-00000000000_' and id <> 'd0000000-0000-4000-8000-000000000007';
update public.profiles set is_private = true where id = 'd0000000-0000-4000-8000-000000000002';

insert into public.follows (follower_id, followee_id, status) values
  ('d0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000002', 'accepted'),
  ('d0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000002', 'pending'),
  ('d0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000002', 'accepted');

insert into public.posts (id, author_id, media_type, media_path, filter_id, caption) values
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'photo', 'd0000000-0000-4000-8000-000000000001/1.jpg', 'kodachrome', 'public'),
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'photo', 'd0000000-0000-4000-8000-000000000002/1.jpg', 'kodachrome', 'private'),
  ('d1000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', 'photo', 'd0000000-0000-4000-8000-000000000001/2.jpg', 'kodachrome', 'removed');

-- Everyone has had their say on the private photograph, including those
-- who cannot see it (the API never asked whether they could).
insert into public.comments (id, post_id, author_id, body) values
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000003', 'from the follower'),
  ('d2000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'from the author'),
  ('d2000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000004', 'from the one asking'),
  ('d2000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005', 'on the public one'),
  ('d2000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'the private member, in public'),
  ('d2000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000005', 'on the removed one');

insert into public.likes (post_id, user_id) values
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000003'),
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000004'),
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000005'),
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000006'),
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002'),
  ('d1000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003');

insert into public.post_tags (post_id, user_id, tagged_by, status) values
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000002', 'accepted'),
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000002', 'pending'),
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000001', 'accepted');

-- Removed by the admins, and a block after the rows it now hides.
update public.posts set removed_at = now(), removed_by = '11111111-1111-1111-1111-111111111111'
 where id = 'd1000000-0000-4000-8000-000000000003';
insert into public.blocks (blocker_id, blocked_id) values
  ('d0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000006');

create temp table p28_viewers (label text primary key, uid uuid);
insert into p28_viewers values
  ('admin',     '11111111-1111-1111-1111-111111111111'),
  ('public',    'd0000000-0000-4000-8000-000000000001'),
  ('private',   'd0000000-0000-4000-8000-000000000002'),
  ('follower',  'd0000000-0000-4000-8000-000000000003'),
  ('asking',    'd0000000-0000-4000-8000-000000000004'),
  ('stranger',  'd0000000-0000-4000-8000-000000000005'),
  ('blocked',   'd0000000-0000-4000-8000-000000000006'),
  ('applicant', 'd0000000-0000-4000-8000-000000000007'),
  ('signed out', null);

-- What a caller reads of one table, this club's rows only, as keys.
create or replace function tests.p28_read(p_uid uuid, p_sql text)
returns text[]
language plpgsql
as $fn$
declare
  v text[];
begin
  if p_uid is null then
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '', true);
  else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  end if;
  begin
    execute p_sql into v;
  exception when insufficient_privilege then
    v := array['DENIED'];
  end;
  execute 'reset role';
  return coalesce(v, '{}');
end
$fn$;

-- A write as a caller, undone however it went: how many rows it touched.
create or replace function tests.p28_try(p_uid uuid, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v_rows bigint;
  v_out text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
    raise exception using errcode = 'VT028', message = v_rows::text;
  exception
    when sqlstate 'VT028' then v_out := 'OK:' || sqlerrm;
    when insufficient_privilege then v_out := 'DENIED';
    when others then v_out := 'ERROR:' || sqlstate;
  end;
  execute 'reset role';
  return v_out;
end
$fn$;

grant all on p28_viewers to anon, authenticated;
grant execute on function tests.p28_read(uuid, text), tests.p28_try(uuid, text) to anon, authenticated;

create temp table p28_reads (run text, viewer text, uid uuid, tbl text, keys text[], primary key (run, viewer, tbl));
grant all on p28_reads to anon, authenticated;

create or replace function tests.p28_read_all(p_run text)
returns void
language plpgsql
as $fn$
declare
  v record;
begin
  for v in select * from p28_viewers loop
    insert into p28_reads values
      (p_run, v.label, v.uid, 'posts', tests.p28_read(v.uid,
        'select array_agg(id::text order by id) from public.posts where id::text like ''d1000000-%''')),
      (p_run, v.label, v.uid, 'comments', tests.p28_read(v.uid,
        'select array_agg(id::text || ''@'' || post_id || ''@'' || author_id order by id) from public.comments where id::text like ''d2000000-%''')),
      (p_run, v.label, v.uid, 'likes', tests.p28_read(v.uid,
        'select array_agg(post_id || ''@'' || post_id || ''@'' || user_id order by post_id, user_id) from public.likes where post_id::text like ''d1000000-%''')),
      (p_run, v.label, v.uid, 'post_tags', tests.p28_read(v.uid,
        'select array_agg(post_id || ''@'' || user_id || ''@'' || tagged_by order by post_id, user_id) from public.post_tags where post_id::text like ''d1000000-%'''));
  end loop;
end
$fn$;

-- The writes a member makes on their own rows, on a photograph they
-- cannot see (the one asking, the stranger), and on one they can.
create temp table p28_writes (label text, uid uuid, sql text);
insert into p28_writes values
  ('the one asking takes back a like on the private photograph', 'd0000000-0000-4000-8000-000000000004',
   'delete from public.likes where post_id = ''d1000000-0000-4000-8000-000000000002'' and user_id = ''d0000000-0000-4000-8000-000000000004'''),
  ('the one asking deletes their comment on it', 'd0000000-0000-4000-8000-000000000004',
   'delete from public.comments where id = ''d2000000-0000-4000-8000-000000000003'''),
  ('the stranger declines a tag on it', 'd0000000-0000-4000-8000-000000000005',
   'update public.post_tags set status = ''declined'', decided_at = now() where post_id = ''d1000000-0000-4000-8000-000000000002'' and user_id = ''d0000000-0000-4000-8000-000000000005'''),
  ('the stranger takes themselves out of it', 'd0000000-0000-4000-8000-000000000005',
   'delete from public.post_tags where post_id = ''d1000000-0000-4000-8000-000000000002'' and user_id = ''d0000000-0000-4000-8000-000000000005'''),
  ('the author takes back a tag from their own photograph', 'd0000000-0000-4000-8000-000000000002',
   'delete from public.post_tags where post_id = ''d1000000-0000-4000-8000-000000000002'' and user_id = ''d0000000-0000-4000-8000-000000000003'''),
  ('the follower unlikes it', 'd0000000-0000-4000-8000-000000000003',
   'delete from public.likes where post_id = ''d1000000-0000-4000-8000-000000000002'' and user_id = ''d0000000-0000-4000-8000-000000000003'''),
  ('the stranger cannot delete someone else''s comment', 'd0000000-0000-4000-8000-000000000005',
   'delete from public.comments where id = ''d2000000-0000-4000-8000-000000000001''');
create temp table p28_write_answers (run text, label text, answer text);

-- Before.
select tests.p28_read_all('before');
insert into p28_write_answers select 'before', label, tests.p28_try(uid, sql) from p28_writes;

\o /dev/null
\ir proposed_0028_comments_likes_tags_follow_the_photograph.sql
\o

-- After.
select tests.p28_read_all('after');
insert into p28_write_answers select 'after', label, tests.p28_try(uid, sql) from p28_writes;

-- What each caller should read after: before, less the rows on a
-- photograph they could not see that are not theirs. Keys name the
-- photograph second (comments id@post@author, likes post@post@user) or
-- first (tags post@user@tagged_by).
create temp table p28_expected as
select b.viewer, b.tbl,
       coalesce((select array_agg(k order by k) from unnest(b.keys) k
                 where k = 'DENIED'
                    or split_part(k, '@', case when b.tbl = 'post_tags' then 1 else 2 end) = any (vis.keys)
                    or (b.uid is not null and (
                         (b.tbl in ('comments', 'likes') and split_part(k, '@', 3) = b.uid::text)
                      or (b.tbl = 'post_tags' and b.uid::text in (split_part(k, '@', 2), split_part(k, '@', 3)))))),
                '{}') as keys
from p28_reads b
join p28_reads vis on vis.run = 'before' and vis.viewer = b.viewer and vis.tbl = 'posts'
where b.run = 'before' and b.tbl <> 'posts';

insert into tests.results (name, expected, actual)
select 'proposed 0028: ' || a.viewer || ' reads of ' || a.tbl || ' exactly what they could, less rows on photographs they cannot see',
       array_to_string(e.keys, ','), array_to_string(a.keys, ',')
from p28_reads a
join p28_expected e on e.viewer = a.viewer and e.tbl = a.tbl
where a.run = 'after'
order by a.viewer, a.tbl;

insert into tests.results (name, expected, actual)
select 'proposed 0028: ' || b.viewer || ' sees the same photographs', array_to_string(b.keys, ','), array_to_string(a.keys, ',')
from p28_reads b join p28_reads a on a.viewer = b.viewer and a.tbl = b.tbl and a.run = 'after'
where b.run = 'before' and b.tbl = 'posts'
order by b.viewer;

insert into tests.results (name, expected, actual)
select 'proposed 0028: ' || b.label, b.answer, a.answer
from p28_write_answers b join p28_write_answers a on a.label = b.label and a.run = 'after'
where b.run = 'before';

-- The gap it closes, said plainly, so a proposal that hid nothing fails.
insert into tests.results (name, expected, actual) values
  ('proposed 0028: before it, the stranger read comments on the private photograph', 'true',
   (select array_to_string(keys, ',') ~ 'd1000000-0000-4000-8000-000000000002' from p28_reads
     where run = 'before' and viewer = 'stranger' and tbl = 'comments')::text),
  ('proposed 0028: after it, no longer', 'false',
   (select array_to_string(keys, ',') ~ 'd2000000-0000-4000-8000-00000000000[12]' from p28_reads
     where run = 'after' and viewer = 'stranger' and tbl = 'comments')::text),
  ('proposed 0028: the one asking still reads their own like on it, and nobody else''s', 'd0000000-0000-4000-8000-000000000004',
   coalesce((select string_agg(split_part(k, '@', 3), ',') from p28_reads, unnest(keys) k
     where run = 'after' and viewer = 'asking' and tbl = 'likes' and split_part(k, '@', 1) = 'd1000000-0000-4000-8000-000000000002'), '<none>')),
  ('proposed 0028: the follower and the admin still read every like on it', '4,4',
   (select count(*) from p28_reads, unnest(keys) k
     where run = 'after' and viewer = 'follower' and tbl = 'likes' and split_part(k, '@', 1) = 'd1000000-0000-4000-8000-000000000002')::text
   || ',' ||
   (select count(*) from p28_reads, unnest(keys) k
     where run = 'after' and viewer = 'admin' and tbl = 'likes' and split_part(k, '@', 1) = 'd1000000-0000-4000-8000-000000000002')::text),
  ('proposed 0028: a comment on a removed photograph is read by the admins, its author and the photograph''s, no one else', 'true,true,true,false',
   (select string_agg((array_to_string(keys, ',') ~ 'd2000000-0000-4000-8000-000000000006')::text, ',' order by o)
      from p28_reads join (values ('admin', 1), ('stranger', 2), ('public', 3), ('follower', 4)) v(viewer, o) using (viewer)
     where run = 'after' and tbl = 'comments')),
  ('proposed 0028: three restrictive policies, nothing else', '3',
   (select count(*)::text from pg_policies where schemaname = 'public'
     and policyname in ('comments: only with their photograph', 'likes: only with their photograph',
                        'post_tags: only with their photograph')
     and permissive = 'RESTRICTIVE' and cmd = 'SELECT'));

\pset border 2
select r.seq, r.name, r.expected, r.actual,
       case when r.expected = r.actual then 'pass' else 'FAIL' end as status
from tests.results r, proposal_start s
where r.seq > s.seq and (r.expected is distinct from r.actual or r.name !~ ' reads of ')
order by r.seq;

do $verdict$
declare v_failed int;
begin
  select count(*) into v_failed from tests.results r, proposal_start s
   where r.seq > s.seq and r.expected is distinct from r.actual;
  if v_failed > 0 then
    raise exception '% proposed 0028 checks FAILED', v_failed;
  end if;
  raise notice 'proposed 0028 checks passed';
end
$verdict$;

rollback;
