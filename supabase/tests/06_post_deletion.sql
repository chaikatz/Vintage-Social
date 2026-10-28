-- Deleting a photograph that was sent in a message (migration 0021): the
-- owner can delete it whoever sent it and whether or not a note went with
-- it, and so can delete_my_account; the message stays in the thread with
-- neither; nobody can write a message with neither; and members change
-- nothing on a message but when it was read.
--
-- Runs in one transaction and rolls back, so the members and posts made
-- here are not left for the files that run after it.

\set second '22222222-2222-2222-2222-222222222222'
\set owner  'd0000000-0000-4000-8000-000000000001'
\set peer   'd0000000-0000-4000-8000-000000000002'
\set third  'd0000000-0000-4000-8000-000000000003'

begin;

create temp table deletion_start as select coalesce(max(seq), 0) as seq from tests.results;

-- Three more approved members. Their status is set directly, as in the
-- fixtures, so none of them draws a membership number.
insert into auth.users (id, email, raw_user_meta_data) values
  ('d0000000-0000-4000-8000-000000000001', 'owner@deletion.test', '{"username":"deletion.owner"}'),
  ('d0000000-0000-4000-8000-000000000002', 'peer@deletion.test',  '{"username":"deletion.peer"}'),
  ('d0000000-0000-4000-8000-000000000003', 'third@deletion.test', '{"username":"deletion.third"}');
update public.profiles set status = 'approved', approved_at = now()
 where id in ('d0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000003');

-- The photographs, inserted as their owners would have: 02 covers that.
insert into public.posts (id, author_id, media_type, media_path, width, height, filter_id) values
  ('d1000000-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'photo', '22222222-2222-2222-2222-222222222222/sent.jpg', 1000, 1000, 'none'),
  ('d1000000-0000-4000-8000-000000000002', '22222222-2222-2222-2222-222222222222', 'photo', '22222222-2222-2222-2222-222222222222/kept.jpg', 1000, 1000, 'none'),
  ('d1000000-0000-4000-8000-000000000003', '22222222-2222-2222-2222-222222222222', 'photo', '22222222-2222-2222-2222-222222222222/share.jpg', 1000, 1000, 'none'),
  ('d1000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000001', 'photo', 'd0000000-0000-4000-8000-000000000001/own.jpg', 1000, 1000, 'none'),
  ('d1000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000001', 'photo', 'd0000000-0000-4000-8000-000000000001/peer.jpg', 1000, 1000, 'none'),
  ('d1000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000001', 'photo', 'd0000000-0000-4000-8000-000000000001/third.jpg', 1000, 1000, 'none');

-- second ↔ peer, owner ↔ peer, peer ↔ third. Each pair in its stored order.
insert into public.conversations (id, user_a, user_b) values
  ('dc000000-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'd0000000-0000-4000-8000-000000000002'),
  ('dc000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002'),
  ('dc000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000003');

-- Every photograph here is sent with no note: body '' and the post.
insert into public.messages (id, conversation_id, sender_id, body, post_id) values
  -- a photograph of second's, sent by second to peer
  ('de000000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', '', 'd1000000-0000-4000-8000-000000000001'),
  -- one that only second may delete, sent by peer
  ('de000000-0000-4000-8000-000000000002', 'dc000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', '', 'd1000000-0000-4000-8000-000000000002'),
  -- for the write checks: a share, and words from each side
  ('de000000-0000-4000-8000-000000000003', 'dc000000-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', '', 'd1000000-0000-4000-8000-000000000003'),
  ('de000000-0000-4000-8000-000000000004', 'dc000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'hello', null),
  ('de000000-0000-4000-8000-000000000005', 'dc000000-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'mine', null),
  -- owner's photographs, for delete_my_account: their own share, the
  -- peer's inside their conversation, and a third party's outside it
  ('de000000-0000-4000-8000-000000000006', 'dc000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', '', 'd1000000-0000-4000-8000-000000000004'),
  ('de000000-0000-4000-8000-000000000007', 'dc000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', '', 'd1000000-0000-4000-8000-000000000005'),
  ('de000000-0000-4000-8000-000000000008', 'dc000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003', '', 'd1000000-0000-4000-8000-000000000006');

\o /dev/null

-- ---------------------------------------------------------------------------
-- the owner deletes a photograph that was sent with no note
-- ---------------------------------------------------------------------------
select tests.run('another member cannot delete the photograph (nothing happens)', :'peer', 'OK',
  $q$ delete from public.posts where id = 'd1000000-0000-4000-8000-000000000002' $q$);
select tests.run('a signed-out visitor cannot delete it', null, 'DENIED',
  $q$ delete from public.posts where id = 'd1000000-0000-4000-8000-000000000002' $q$);
insert into tests.results (name, expected, actual) values
  ('after both, the photograph is still there', '1',
   (select count(*) from public.posts where id = 'd1000000-0000-4000-8000-000000000002')::text);
select tests.run('the owner deletes a photograph they sent with no note', :'second', 'OK',
  $q$ delete from public.posts where id = 'd1000000-0000-4000-8000-000000000001' $q$);
select tests.run('the owner deletes a photograph someone else sent with no note', :'second', 'OK',
  $q$ delete from public.posts where id = 'd1000000-0000-4000-8000-000000000002' $q$);
select tests.run('deleting it again is not an error', :'second', 'OK',
  $q$ delete from public.posts where id = 'd1000000-0000-4000-8000-000000000001' $q$);

-- ---------------------------------------------------------------------------
-- what can be written to a message
-- ---------------------------------------------------------------------------
select tests.run('a message with neither words nor a photograph is refused', :'second', 'ERROR:23514',
  $q$ insert into public.messages (conversation_id, sender_id, body, post_id)
      values ('dc000000-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', '', null) $q$);
select tests.run('a photograph alone can still be sent', :'second', 'OK',
  $q$ insert into public.messages (conversation_id, sender_id, body, post_id)
      values ('dc000000-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', '', 'd1000000-0000-4000-8000-000000000003') $q$);
select tests.run('a member cannot take the photograph out of a message', :'peer', 'DENIED',
  $q$ update public.messages set post_id = null where id = 'de000000-0000-4000-8000-000000000003' $q$);
select tests.run('nor out of their own', :'second', 'DENIED',
  $q$ update public.messages set post_id = null where id = 'de000000-0000-4000-8000-000000000003' $q$);
select tests.run('a member cannot rewrite the other person''s words', :'peer', 'DENIED',
  $q$ update public.messages set body = 'rewritten' where id = 'de000000-0000-4000-8000-000000000005' $q$);
select tests.run('a member cannot blank their own words', :'peer', 'DENIED',
  $q$ update public.messages set body = '' where id = 'de000000-0000-4000-8000-000000000004' $q$);
select tests.run('a member marks the thread read', :'peer', 'OK',
  $q$ update public.messages set read_at = now()
      where conversation_id = 'dc000000-0000-4000-8000-000000000001'
        and sender_id <> 'd0000000-0000-4000-8000-000000000002' and read_at is null $q$);
select tests.run('a signed-out visitor marks nothing read', null, 'DENIED',
  $q$ update public.messages set read_at = now() where conversation_id = 'dc000000-0000-4000-8000-000000000001' $q$);

-- ---------------------------------------------------------------------------
-- delete_my_account, with the member's photographs sent by all three
-- ---------------------------------------------------------------------------
select tests.run('a member deletes their account although others sent their photographs with no note', :'owner', 'OK',
  $q$ select public.delete_my_account() $q$);

\o

-- As the table owner: the rule holds for every writer, not only members.
insert into tests.results (name, expected, actual) values
  ('even the owner of the table cannot blank a message of words', 'ERROR:23514',
   tests.attempt($q$ update public.messages set body = '' where id = 'de000000-0000-4000-8000-000000000004' $q$)),
  ('nor strip a share of both', 'ERROR:23514',
   tests.attempt($q$ update public.messages set body = '', post_id = null where id = 'de000000-0000-4000-8000-000000000003' $q$));

insert into tests.results (name, expected, actual) values
  ('the deleted photographs are gone', '0',
   (select count(*) from public.posts where id in ('d1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002'))::text),
  ('their messages stay in the thread, with neither', '2',
   (select count(*) from public.messages
     where id in ('de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000002')
       and post_id is null and body = '')::text),
  ('the words in the thread are as they were written', 'hello,mine',
   (select string_agg(body, ',' order by id) from public.messages
     where id in ('de000000-0000-4000-8000-000000000004', 'de000000-0000-4000-8000-000000000005'))),
  ('the photograph a member tried to take out is still in its message', 'd1000000-0000-4000-8000-000000000003',
   coalesce((select post_id::text from public.messages where id = 'de000000-0000-4000-8000-000000000003'), '<none>')),
  ('marking read reached the other person''s messages only', '4',
   (select count(*) from public.messages
     where conversation_id = 'dc000000-0000-4000-8000-000000000001' and read_at is not null)::text),
  ('the deleted account is gone', '0',
   (select count(*) from public.profiles where id = 'd0000000-0000-4000-8000-000000000001')::text),
  ('and its photographs with it', '0',
   (select count(*) from public.posts where author_id = 'd0000000-0000-4000-8000-000000000001')::text),
  ('the third party''s message stays, with neither', '1',
   (select count(*) from public.messages where id = 'de000000-0000-4000-8000-000000000008' and post_id is null)::text),
  ('messages_check is gone from the table', '0',
   (select count(*) from pg_constraint where conrelid = 'public.messages'::regclass and conname = 'messages_check')::text),
  ('the rule lives on the messages_not_empty trigger', '1',
   (select count(*) from pg_trigger where tgrelid = 'public.messages'::regclass and tgname = 'messages_not_empty')::text),
  ('members may update read_at and nothing else on a message', 'read_at',
   coalesce((select string_agg(column_name, ',' order by column_name)
               from information_schema.column_privileges
              where table_schema = 'public' and table_name = 'messages'
                and grantee = 'authenticated' and privilege_type = 'UPDATE'), '<none>')),
  ('signed-out visitors may update nothing on a message', '<none>',
   coalesce((select string_agg(column_name, ',' order by column_name)
               from information_schema.column_privileges
              where table_schema = 'public' and table_name = 'messages'
                and grantee = 'anon' and privilege_type = 'UPDATE'), '<none>'));

\pset border 2
select r.seq, r.name, r.expected, r.actual,
       case when r.expected = r.actual then 'pass' else 'FAIL' end as status
from tests.results r, deletion_start s
where r.seq > s.seq
order by r.seq;

do $verdict$
declare v_failed int;
begin
  select count(*) into v_failed from tests.results r, deletion_start s
   where r.seq > s.seq and r.expected <> r.actual;
  if v_failed > 0 then
    raise exception '% post deletion checks FAILED', v_failed;
  end if;
  raise notice 'post deletion checks passed';
end
$verdict$;

rollback;
