-- 0040: a block holds for comments and likes, and reaches the admins; a
-- message is notified; portraits are pictures; the push function's
-- caller is the database.
--
-- Asked as the members it is about, through the same policies, grants
-- and triggers the app and PostgREST go through: Ana posts; Ben is a
-- member with nothing to do with any block; Cara is blocked by Ana; Dee
-- blocks Ana. Before any block, every write the app makes between them
-- (a like, a comment, a tag, a message, a report, a block) goes through
-- and files its notice; after, none across the block does, and nobody
-- else's changes. The push function's door is not here (it is in
-- supabase/functions/push, tested by tests/push-function.test.ts); what
-- the database sends it is, read from net.http_post. Then the file is
-- applied again over itself. Runs in one transaction and rolls back.

begin;

create temp table g_start as select coalesce(max(seq), 0) as seq from tests.results;

-- A statement as a member (or, with null, a signed-out visitor): OK and
-- how many rows it touched, DENIED, or the error's own words.
create or replace function tests.g_as(p_uid uuid, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v text;
  n bigint;
begin
  if p_uid is null then
    execute 'set local role anon';
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  end if;
  begin
    execute p_sql;
    get diagnostics n = row_count;
    v := 'OK:' || n;
  exception
    when insufficient_privilege then v := 'DENIED';
    when others then v := 'ERROR:' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end
$fn$;

-- What a member reads: the values a query returns, in order, or '-'.
create or replace function tests.g_read(p_uid uuid, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'select coalesce(string_agg(x::text, '',''), ''-'') from (' || p_sql || ') q(x)' into v;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end
$fn$;

-- The kinds of notice a member was sent by another, in alphabetical order
-- (every row here is made at the transaction's one now()), or '-'. (A
-- function, so that it reads what the statement it is asked in has done
-- so far.)
create or replace function tests.g_notices(p_recipient uuid, p_actor uuid)
returns text
language sql
as $fn$
  select coalesce(string_agg(type, ',' order by type), '-')
  from public.activity where recipient_id = p_recipient and actor_id = p_actor
$fn$;

-- The reports a member filed about another member: reason and status, or '-'.
create or replace function tests.g_reports(p_reporter uuid, p_member uuid)
returns text
language sql
as $fn$
  select coalesce(string_agg(reason || ':' || status, ',' order by created_at, id), '-')
  from public.reports where reporter_id = p_reporter and profile_id = p_member and target_type = 'profile'
$fn$;

-- What the database asks the push function, for this transaction only:
-- net.http_post (pg_net's, or the harness's stand-in) writes it down.
create temp table g_calls (seq serial, url text, headers jsonb, body jsonb);
create or replace function net.http_post(
  url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000)
returns bigint
language plpgsql
as $fn$
begin
  insert into pg_temp.g_calls (url, headers, body) values (url, headers, body);
  return 1;
end
$fn$;

-- The hook, as 0017's instructions write it (no secret: 0040's trigger
-- gives it one, section 6).
insert into public.app_settings (key, value) values
  ('push_hook', '{"url": "https://example.test/functions/v1/push", "key": "anon-key"}')
on conflict (key) do update set value = excluded.value;

\set ana  '0a400000-0000-4000-8000-000000000001'
\set ben  '0a400000-0000-4000-8000-000000000002'
\set cara '0a400000-0000-4000-8000-000000000003'
\set dee  '0a400000-0000-4000-8000-000000000004'
\set applicant '0a400000-0000-4000-8000-000000000005'
\set p_ana  '0a410000-0000-4000-8000-000000000001'
\set p_cara '0a410000-0000-4000-8000-000000000002'
\set p_dee  '0a410000-0000-4000-8000-000000000003'
\set p_ben  '0a410000-0000-4000-8000-000000000004'
\set t_ben  '0a420000-0000-4000-8000-000000000001'
\set t_cara '0a420000-0000-4000-8000-000000000002'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'ana',  'ana@blocks.test',  '{"username":"g40.ana"}'),
  (:'ben',  'ben@blocks.test',  '{"username":"g40.ben"}'),
  (:'cara', 'cara@blocks.test', '{"username":"g40.cara"}'),
  (:'dee',  'dee@blocks.test',  '{"username":"g40.dee"}'),
  (:'applicant', 'applicant@blocks.test', '{"username":"g40.applicant"}');
update public.profiles set status = 'approved', approved_at = now()
 where id::text like '0a400000-0000-4000-8000-00000000000_' and id <> :'applicant';
update public.profiles set status = 'applied' where id = :'applicant';

insert into public.posts (id, author_id, media_type, media_path, filter_id, caption) values
  (:'p_ana',  :'ana',  'photo', :'ana'  || '/1.jpg', 'kodachrome', 'ana'),
  (:'p_cara', :'cara', 'photo', :'cara' || '/1.jpg', 'kodachrome', 'cara'),
  (:'p_dee',  :'dee',  'photo', :'dee'  || '/1.jpg', 'kodachrome', 'dee'),
  (:'p_ben',  :'ben',  'photo', :'ben'  || '/1.jpg', 'kodachrome', 'ben');

-- Ana's two threads, with Ben and with Cara (each pair in its fixed order).
insert into public.conversations (id, user_a, user_b) values
  (:'t_ben',  :'ana', :'ben'),
  (:'t_cara', :'ana', :'cara');

-- ---------------------------------------------------------------------------
-- before any block: what the app writes goes through, with its notice
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  ('before: Cara likes Ana''s photograph', 'OK:1',
   tests.g_as(:'cara', format('insert into public.likes (post_id, user_id) values (%L, %L)', :'p_ana', :'cara'))),
  ('before: Cara comments on it', 'OK:1',
   tests.g_as(:'cara', format('insert into public.comments (post_id, author_id, body) values (%L, %L, ''lovely'')', :'p_ana', :'cara'))),
  ('before: Ana tags Cara in it', 'OK:1',
   tests.g_as(:'ana', format('insert into public.post_tags (post_id, user_id, tagged_by) values (%L, %L, %L)', :'p_ana', :'cara', :'ana'))),
  ('Ana is told of the like and the comment, Cara of the tag', 'comment,like|tag',
   tests.g_notices(:'ana', :'cara') || '|' || tests.g_notices(:'cara', :'ana')),
  ('before: Ana likes and comments on Dee''s photograph', 'OK:1,OK:1',
   tests.g_as(:'ana', format('insert into public.likes (post_id, user_id) values (%L, %L)', :'p_dee', :'ana')) || ',' ||
   tests.g_as(:'ana', format('insert into public.comments (post_id, author_id, body) values (%L, %L, ''hello'')', :'p_dee', :'ana')));

-- ---------------------------------------------------------------------------
-- 4. a message is notified, to the other member only
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  ('Ben writes to Ana', 'OK:1',
   tests.g_as(:'ben', format('insert into public.messages (conversation_id, sender_id, body) values (%L, %L, ''are you coming?'')', :'t_ben', :'ben')));
-- (A plain subquery reads the tables as its statement began: each check
-- of what a write did is a statement after it.)
insert into tests.results (name, expected, actual) values
  ('Ana is told: a message from Ben, and nothing of what it says', 'message|-|-|-',
   tests.g_notices(:'ana', :'ben') || '|' ||
   coalesce((select string_agg(coalesce(post_id::text, '-') || coalesce(comment_id::text, '') || coalesce(message, ''), ',')
               from public.activity where recipient_id = :'ana' and actor_id = :'ben'), 'none') || '|' ||
   tests.g_notices(:'ben', :'ben') || '|' || tests.g_notices(:'ben', :'ana')),
  ('Ana answers with a photograph and no words', 'OK:1',
   tests.g_as(:'ana', format('insert into public.messages (conversation_id, sender_id, body, post_id) values (%L, %L, '''', %L)', :'t_ben', :'ana', :'p_ana')));
insert into tests.results (name, expected, actual) values
  ('Ben is told, and Ana is not told of her own message', 'message|message',
   tests.g_notices(:'ben', :'ana') || '|' || tests.g_notices(:'ana', :'ben')),
  ('each message notice is handed to the push function, as every notice is', '2',
   (select count(*)::text from public.activity a
     where a.type = 'message' and a.actor_id in (:'ana', :'ben')
       and exists (select 1 from g_calls c where c.body = jsonb_build_object('kind', 'activity', 'id', a.id)))),
  ('Ana reads her message notice as her own Activity (the app leaves it out of the tab)', '1',
   tests.g_read(:'ana', 'select count(*) from public.activity where type = ''message''')),
  ('the inbox''s unread count is still the messages'' read marks (0037), not these rows', '1',
   tests.g_read(:'ana', 'select unread from public.unread_message_counts()'));

-- ---------------------------------------------------------------------------
-- 3. Ana blocks Cara: the admins are told, once
-- ---------------------------------------------------------------------------
delete from g_calls;
insert into tests.results (name, expected, actual) values
  ('Ana blocks Cara', 'OK:1',
   tests.g_as(:'ana', format('select public.block_member(%L)', :'cara')));
insert into tests.results (name, expected, actual) values
  ('a report about Cara is filed, as Ana, open', 'Blocked by a member:open',
   tests.g_reports(:'ana', :'cara')),
  ('it is a member report, with no photograph or comment, and no words of Ana''s', 'profile|||',
   (select target_type || '|' || coalesce(post_id::text, '') || '|' || coalesce(comment_id::text, '') || '|' || coalesce(details, '')
      from public.reports where reporter_id = :'ana' and profile_id = :'cara')),
  ('and the admins are asked to be told, once (0032)', '1',
   (select count(*)::text from g_calls c join public.reports r on c.body = jsonb_build_object('kind', 'report', 'id', r.id)
     where r.reporter_id = :'ana' and r.profile_id = :'cara')),
  ('the admins read it in the queue, with the member''s name', 'Blocked by a member:g40.cara',
   tests.g_read('11111111-1111-1111-1111-111111111111',
     format('select r.reason || '':'' || p.username from public.reports r join public.profiles p on p.id = r.profile_id where r.reporter_id = %L', :'ana'))),
  ('the pending tag between them is withdrawn, as before', '0',
   (select count(*)::text from public.post_tags where post_id = :'p_ana' and user_id = :'cara')),
  ('Ana still sees every photograph but Cara''s: the report hides nothing of hers', '3',
   tests.g_read(:'ana', format('select count(*) from public.posts where id in (%L, %L, %L, %L)', :'p_ana', :'p_cara', :'p_dee', :'p_ben'))),
  ('Ana blocks Cara again: no second report', 'OK:1|Blocked by a member:open',
   tests.g_as(:'ana', format('select public.block_member(%L)', :'cara')) || '|' || tests.g_reports(:'ana', :'cara')),
  ('Ana unblocks and blocks again while it is open: still one report', 'OK:1,OK:1|Blocked by a member:open',
   tests.g_as(:'ana', format('select public.unblock_member(%L)', :'cara')) || ',' ||
   tests.g_as(:'ana', format('select public.block_member(%L)', :'cara')) || '|' || tests.g_reports(:'ana', :'cara')),
  ('an applicant''s block is a block, but files no report (only a member files one)', 'OK:1',
   tests.g_as(:'applicant', format('select public.block_member(%L)', :'ben')));
insert into tests.results (name, expected, actual) values
  ('the applicant''s block stands, with no report', '1|-',
   (select count(*)::text from public.blocks where blocker_id = :'applicant' and blocked_id = :'ben') || '|' ||
   tests.g_reports(:'applicant', :'ben'));

-- Dee blocks Ana: the other direction.
insert into tests.results (name, expected, actual) values
  ('Dee blocks Ana', 'OK:1|Blocked by a member:open',
   tests.g_as(:'dee', format('select public.block_member(%L)', :'ana')) || '|' || tests.g_reports(:'dee', :'ana'));

-- ---------------------------------------------------------------------------
-- 1. no comment or like across a block, either way
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  -- Cara still holds her like (she may take it back, 0028), and knows the id.
  ('Cara takes her like back', 'OK:1',
   tests.g_as(:'cara', format('delete from public.likes where post_id = %L and user_id = %L', :'p_ana', :'cara'))),
  ('Cara likes Ana''s photograph again: refused', 'DENIED',
   tests.g_as(:'cara', format('insert into public.likes (post_id, user_id) values (%L, %L)', :'p_ana', :'cara'))),
  ('Cara comments on it: refused', 'DENIED',
   tests.g_as(:'cara', format('insert into public.comments (post_id, author_id, body) values (%L, %L, ''you are awful'')', :'p_ana', :'cara'))),
  ('Ana likes or comments on Cara''s: refused too', 'DENIED,DENIED',
   tests.g_as(:'ana', format('insert into public.likes (post_id, user_id) values (%L, %L)', :'p_cara', :'ana')) || ',' ||
   tests.g_as(:'ana', format('insert into public.comments (post_id, author_id, body) values (%L, %L, ''x'')', :'p_cara', :'ana'))),
  ('Ana on the photograph of Dee, who blocked her: refused (she already liked it, so a comment)', 'DENIED',
   tests.g_as(:'ana', format('insert into public.comments (post_id, author_id, body) values (%L, %L, ''again'')', :'p_dee', :'ana'))),
  ('Dee on Ana''s, whom she blocked: refused', 'DENIED,DENIED',
   tests.g_as(:'dee', format('insert into public.likes (post_id, user_id) values (%L, %L)', :'p_ana', :'dee')) || ',' ||
   tests.g_as(:'dee', format('insert into public.comments (post_id, author_id, body) values (%L, %L, ''x'')', :'p_ana', :'dee'))),
  ('so Ana was told of nothing from Cara or Dee since', 'comment,like|-',
   tests.g_notices(:'ana', :'cara') || '|' || tests.g_notices(:'ana', :'dee')),
  ('and Ben, a third member, sees no new comment of Cara''s under Ana''s photograph', 'lovely',
   tests.g_read(:'ben', format('select body from public.comments where post_id = %L and author_id = %L', :'p_ana', :'cara'))),
  -- Nobody else changes.
  ('Ben likes and comments on Ana''s photograph, as before', 'OK:1,OK:1',
   tests.g_as(:'ben', format('insert into public.likes (post_id, user_id) values (%L, %L)', :'p_ana', :'ben')) || ',' ||
   tests.g_as(:'ben', format('insert into public.comments (post_id, author_id, body) values (%L, %L, ''great'')', :'p_ana', :'ben'))),
  ('Cara likes and comments on Ben''s, as before', 'OK:1,OK:1',
   tests.g_as(:'cara', format('insert into public.likes (post_id, user_id) values (%L, %L)', :'p_ben', :'cara')) || ',' ||
   tests.g_as(:'cara', format('insert into public.comments (post_id, author_id, body) values (%L, %L, ''nice'')', :'p_ben', :'cara'))),
  ('Ana likes and comments on her own, as before', 'OK:1,OK:1',
   tests.g_as(:'ana', format('insert into public.likes (post_id, user_id) values (%L, %L)', :'p_ana', :'ana')) || ',' ||
   tests.g_as(:'ana', format('insert into public.comments (post_id, author_id, body) values (%L, %L, ''mine'')', :'p_ana', :'ana'))),
  ('Ben is told of Cara''s like and comment', 'comment,like',
   tests.g_notices(:'ben', :'cara')),
  ('a signed-out visitor still may not like or comment', 'DENIED,DENIED',
   tests.g_as(null, format('insert into public.likes (post_id, user_id) values (%L, %L)', :'p_ben', :'ana')) || ',' ||
   tests.g_as(null, format('insert into public.comments (post_id, author_id, body) values (%L, %L, ''x'')', :'p_ben', :'ana'))),
  -- The block check answers only about the member asking.
  ('the block check answers for the caller only: Ben asked about Ana''s photograph, false', 'false',
   tests.g_read(:'ben', format('select private.post_across_a_block(%L)', :'p_ana'))),
  ('asked by Cara, true; by Ana about her own, false', 'true|false',
   tests.g_read(:'cara', format('select private.post_across_a_block(%L)', :'p_ana')) || '|' ||
   tests.g_read(:'ana', format('select private.post_across_a_block(%L)', :'p_ana')));

-- Tags, messages and threads across a block were already refused; still so.
insert into tests.results (name, expected, actual) values
  ('Ana tags Cara: refused, as before', 'DENIED',
   tests.g_as(:'ana', format('insert into public.post_tags (post_id, user_id, tagged_by) values (%L, %L, %L)', :'p_ana', :'cara', :'ana'))),
  ('Cara writes in her thread with Ana: refused, as before', 'DENIED',
   tests.g_as(:'cara', format('insert into public.messages (conversation_id, sender_id, body) values (%L, %L, ''why'')', :'t_cara', :'cara'))),
  ('Ana writes to Dee in a new thread: refused, as before', 'DENIED',
   tests.g_as(:'ana', format('insert into public.conversations (user_a, user_b) values (%L, %L)', :'ana', :'dee')));

-- ---------------------------------------------------------------------------
-- 2. and should a row cross a block another way (a script, a definer),
--    no notice goes with it
-- ---------------------------------------------------------------------------
insert into public.likes (post_id, user_id) values (:'p_ana', :'cara');
insert into public.comments (post_id, author_id, body) values (:'p_ana', :'cara', 'by script');
insert into public.post_tags (post_id, user_id, tagged_by, status) values (:'p_ana', :'cara', :'ana', 'pending');
insert into public.messages (conversation_id, sender_id, body) values (:'t_cara', :'cara', 'by script');
insert into public.messages (conversation_id, sender_id, body) values (:'t_cara', :'ana', 'by script');
insert into tests.results (name, expected, actual) values
  ('a like, a comment, a tag and messages across the block file no notice, either way (these are from before it)', 'comment,like|tag',
   tests.g_notices(:'ana', :'cara') || '|' || tests.g_notices(:'cara', :'ana')),
  ('while Ben''s like and comment on Ana''s photograph did', 'comment,like,message',
   tests.g_notices(:'ana', :'ben'));

-- ---------------------------------------------------------------------------
-- 5. the avatars bucket takes portraits only; the others are as they were
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  ('avatars: 2 MB, JPEG and PNG', '2097152|{image/jpeg,image/png}',
   (select file_size_limit::text || '|' || allowed_mime_types::text from storage.buckets where id = 'avatars')),
  ('media and thumbnails: unchanged (the platform''s limits)', 'media:-:-,thumbnails:-:-',
   (select string_agg(id || ':' || coalesce(file_size_limit::text, '-') || ':' || coalesce(allowed_mime_types::text, '-'), ',' order by id)
      from storage.buckets where id in ('media', 'thumbnails'))),
  -- What the app writes there (src/api/membership.ts, app/settings.tsx), under the same policies.
  ('an applicant still puts a portrait in their own folder', 'OK:1',
   tests.g_as(:'applicant', format('insert into storage.objects (bucket_id, name, owner_id) values (''avatars'', %L, %L)',
     :'applicant' || '/avatar.jpg', :'applicant')));

-- ---------------------------------------------------------------------------
-- 6. the hook keeps a secret the database made, and push_event sends it
-- ---------------------------------------------------------------------------
-- The hook was written at the top without one, as 0017's instructions
-- write it: the trigger gave it one.
insert into tests.results (name, expected, actual) values
  ('the hook, written without a secret, was given one: 64 hexadecimal characters', 'true',
   (select ((value->>'secret') ~ '^[0-9a-f]{64}$')::text from public.app_settings where key = 'push_hook'));
create temp table g_secret as select value->>'secret' as s from public.app_settings where key = 'push_hook';

delete from g_calls;
\o /dev/null
select public.push_event('memories', null);
\o
insert into tests.results (name, expected, actual) values
  ('push_event sends it in x-push-secret, beside the key', 'Bearer anon-key|the hook''s secret|application/json',
   (select (headers->>'Authorization') || '|' ||
           case when headers->>'x-push-secret' = (select s from g_secret) then 'the hook''s secret' else coalesce(headers->>'x-push-secret', 'none') end || '|' ||
           (headers->>'Content-Type')
      from g_calls order by seq desc limit 1)),
  ('to the same address, with the same body', 'https://example.test/functions/v1/push|{"id": null, "kind": "memories"}',
   (select url || '|' || body::text from g_calls order by seq desc limit 1));

-- Rewritten without one (a new key), the hook keeps the secret it had.
update public.app_settings set value = '{"url": "https://example.test/functions/v1/push", "key": "anon-key-2"}' where key = 'push_hook';
insert into tests.results (name, expected, actual) values
  ('rewritten without a secret, the hook keeps the one it had, and takes the new key', 'true|anon-key-2',
   (select ((value->>'secret') = (select s from g_secret))::text || '|' || (value->>'key')
      from public.app_settings where key = 'push_hook'));
-- Emptied, it is the same.
update public.app_settings set value = value || '{"secret": ""}' where key = 'push_hook';
insert into tests.results (name, expected, actual) values
  ('given an empty secret, the hook keeps the one it had', 'true',
   (select ((value->>'secret') = (select s from g_secret))::text from public.app_settings where key = 'push_hook'));
-- Replaced by an insert that meets the row (insert ... on conflict do
-- update, as supabase/production/11_share_media_key.sql writes its row),
-- it is the same.
insert into public.app_settings (key, value) values
  ('push_hook', '{"url": "https://example.test/functions/v1/push", "key": "anon-key-3"}')
on conflict (key) do update set value = excluded.value;
insert into tests.results (name, expected, actual) values
  ('replaced by an upsert without a secret, the hook keeps the one it had, and takes the new key', 'true|anon-key-3',
   (select ((value->>'secret') = (select s from g_secret))::text || '|' || (value->>'key')
      from public.app_settings where key = 'push_hook'));
-- A secret that is not text counts as none.
update public.app_settings set value = value || '{"secret": 12345}' where key = 'push_hook';
insert into tests.results (name, expected, actual) values
  ('given a secret that is not text, the hook keeps the one it had', 'true|string',
   (select ((value->>'secret') = (select s from g_secret))::text || '|' || jsonb_typeof(value->'secret')
      from public.app_settings where key = 'push_hook'));
-- One written on purpose is kept as it is.
update public.app_settings set value = value || '{"secret": "s3cret-for-the-test"}' where key = 'push_hook';
insert into tests.results (name, expected, actual) values
  ('one written on purpose is kept', 's3cret-for-the-test',
   (select value->>'secret' from public.app_settings where key = 'push_hook'));
-- Made afresh, as on a new project, the hook gets a new one of its own.
delete from public.app_settings where key = 'push_hook';
insert into public.app_settings (key, value) values
  ('push_hook', '{"url": "https://example.test/functions/v1/push", "key": "anon-key"}');
insert into tests.results (name, expected, actual) values
  ('a hook made afresh gets a new secret of its own', 'true|false',
   (select ((value->>'secret') ~ '^[0-9a-f]{64}$')::text || '|' || ((value->>'secret') = (select s from g_secret))::text
      from public.app_settings where key = 'push_hook'));
-- Kept from the API: an admin reads the other settings, but not the hook.
insert into tests.results (name, expected, actual) values
  ('an admin reads the other settings, but not the push hook', 'default_invite_quota|0',
   tests.g_read('11111111-1111-1111-1111-111111111111', 'select key from public.app_settings where key = ''default_invite_quota''') || '|' ||
   tests.g_read('11111111-1111-1111-1111-111111111111', 'select count(*) from public.app_settings where key = ''push_hook''')),
  ('nor does a member', '0',
   tests.g_read(:'ben', 'select count(*) from public.app_settings where key = ''push_hook''')),
  ('nor a visitor', 'OK:0',
   tests.g_as(null, 'select 1 from public.app_settings where key = ''push_hook''')),
  ('push_hook() still reads it, as the database''s', 'true',
   ((public.push_hook()->>'secret') = (select value->>'secret' from public.app_settings where key = 'push_hook'))::text);
-- Nothing else in app_settings is touched.
insert into tests.results (name, expected, actual) values
  ('nothing else in app_settings is given a secret', '0',
   (select count(*)::text from public.app_settings where key <> 'push_hook' and value ? 'secret'));

-- With no secret at all (as before this file: the trigger off), push_event
-- sends what 0017 sent.
alter table public.app_settings disable trigger app_settings_push_hook_secret;
update public.app_settings set value = value - 'secret' where key = 'push_hook';
delete from g_calls;
\o /dev/null
select public.push_event('memories', null);
\o
alter table public.app_settings enable trigger app_settings_push_hook_secret;
insert into tests.results (name, expected, actual) values
  ('without a secret, the headers are as they were', 'Bearer anon-key|-',
   (select (headers->>'Authorization') || '|' || coalesce(headers->>'x-push-secret', '-') from g_calls order by seq desc limit 1));

update public.app_settings set value = value || '{"secret": "s3cret-for-the-test"}' where key = 'push_hook';

-- A notice sent with the secret: Ben writes to Ana again.
delete from g_calls;
insert into tests.results (name, expected, actual) values
  ('Ben writes to Ana again', 'OK:1',
   tests.g_as(:'ben', format('insert into public.messages (conversation_id, sender_id, body) values (%L, %L, ''hello?'')', :'t_ben', :'ben')));
insert into tests.results (name, expected, actual) values
  ('its notice asks the function with the secret too', 'activity|s3cret-for-the-test',
   coalesce((select string_agg(distinct (body->>'kind') || '|' || (headers->>'x-push-secret'), ',') from g_calls), 'none'));

-- ---------------------------------------------------------------------------
-- who may call what
-- ---------------------------------------------------------------------------
insert into tests.results (name, expected, actual) values
  ('the block check: in private, run as its owner with an empty search path, members only', 'true|true|true|false',
   (select p.prosecdef::text || '|' || (p.proconfig @> array['search_path=""'])::text
      from pg_proc p where p.oid = 'private.post_across_a_block(uuid)'::regprocedure) || '|' ||
   has_function_privilege('authenticated', 'private.post_across_a_block(uuid)', 'execute')::text || '|' ||
   has_function_privilege('anon', 'private.post_across_a_block(uuid)', 'execute')::text),
  ('the message notice: run by its trigger as its owner, nobody''s to call', 'true|true|false|false',
   (select p.prosecdef::text || '|' || (p.proconfig @> array['search_path=""'])::text
      from pg_proc p where p.oid = 'private.notify_message()'::regprocedure) || '|' ||
   has_function_privilege('authenticated', 'private.notify_message()', 'execute')::text || '|' ||
   has_function_privilege('anon', 'private.notify_message()', 'execute')::text),
  ('notify_like, notify_comment, notify_tag and push_event: nobody''s to call, as before', 'false,false,false,false,false,false,false,false',
   (select string_agg(has_function_privilege(r, f, 'execute')::text, ',' order by f, r)
      from unnest(array['public.notify_like()', 'public.notify_comment()', 'public.notify_tag()', 'public.push_event(text, uuid)']) f,
           unnest(array['authenticated', 'anon']) r)),
  ('block_member: members may call it, signed-out visitors may not, as before', 'true|false',
   has_function_privilege('authenticated', 'public.block_member(uuid)', 'execute')::text || '|' ||
   has_function_privilege('anon', 'public.block_member(uuid)', 'execute')::text),
  ('the two policies: restrictive, on insert, for members', 'comments:INSERT:RESTRICTIVE:{authenticated},likes:INSERT:RESTRICTIVE:{authenticated}',
   (select string_agg(tablename || ':' || cmd || ':' || permissive || ':' || roles::text, ',' order by tablename)
      from pg_policies where schemaname = 'public'
       and (tablename, policyname) in (('comments', 'comments: none across a block'), ('likes', 'likes: none across a block'))));

-- ---------------------------------------------------------------------------
-- the file run again
-- ---------------------------------------------------------------------------
\o /dev/null
\ir ../migrations/0040_blocks_messages_and_files.sql
\ir ../migrations/0040_blocks_messages_and_files.sql
\o
insert into tests.results (name, expected, actual) values
  ('run twice, it leaves one of each policy and trigger it makes', '1,1,1',
   (select count(*)::text from pg_policies where tablename = 'comments' and policyname = 'comments: none across a block') || ',' ||
   (select count(*)::text from pg_policies where tablename = 'likes' and policyname = 'likes: none across a block') || ',' ||
   (select count(*)::text from pg_trigger where tgrelid = 'public.messages'::regclass and tgname = 'messages_notify_trigger')),
  ('and still refuses Cara''s comment, and lets Ben''s through', 'DENIED,OK:1',
   tests.g_as(:'cara', format('insert into public.comments (post_id, author_id, body) values (%L, %L, ''again'')', :'p_ana', :'cara')) || ',' ||
   tests.g_as(:'ben', format('insert into public.comments (post_id, author_id, body) values (%L, %L, ''again'')', :'p_ana', :'ben'))),
  ('and the avatars bucket is as the first time', '2097152|{image/jpeg,image/png}',
   (select file_size_limit::text || '|' || allowed_mime_types::text from storage.buckets where id = 'avatars')),
  ('and the hook keeps its secret, with one trigger to keep it', 's3cret-for-the-test|1',
   (select value->>'secret' from public.app_settings where key = 'push_hook') || '|' ||
   (select count(*)::text from pg_trigger where tgrelid = 'public.app_settings'::regclass and tgname = 'app_settings_push_hook_secret'));

\pset border 2
select r.seq, r.name, r.expected, r.actual,
       case when r.expected = r.actual then 'pass' else 'FAIL' end as status
from tests.results r, g_start s
where r.seq > s.seq
order by r.seq;

do $verdict$
declare v_failed int;
begin
  select count(*) into v_failed from tests.results r, g_start s
   where r.seq > s.seq and r.expected is distinct from r.actual;
  if v_failed > 0 then
    raise exception '% block, message and file checks FAILED', v_failed;
  end if;
  raise notice 'block, message and file checks passed';
end
$verdict$;

rollback;
