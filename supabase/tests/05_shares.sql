-- Sharing a photograph beyond the club (migration 0019): who may mint a
-- link, what the public functions give away, and — the one that matters —
-- that turning a link off, removing or deleting the post, or losing one's
-- membership stops the picture as well as the page.

\set founder   '11111111-1111-1111-1111-111111111111'
\set second    '22222222-2222-2222-2222-222222222222'
\set pending   '33333333-3333-3333-3333-333333333333'
\set suspended '55555555-5555-5555-5555-555555555555'

-- Posts to share. Inserted as the owner: the point here is the sharing
-- functions, not the publishing policies (02 covers those).
insert into public.posts (id, author_id, media_type, media_path, thumb_path, width, height, filter_id, location) values
  ('a0000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'photo', 'founder/secret/IMG_0001.jpg', null, 1200, 1500, 'none', 'Paris'),
  ('a0000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'photo', 'founder/secret/IMG_0002.jpg', null, 1200, 1500, 'none', null),
  ('a0000000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111', 'video', 'founder/secret/clip.mp4', 'founder/secret/clip.jpg', 1920, 1080, 'none', null),
  ('a0000000-0000-4000-8000-000000000004', '22222222-2222-2222-2222-222222222222', 'photo', 'second/IMG_0004.jpg', null, 1000, 1000, 'none', null),
  ('a0000000-0000-4000-8000-000000000005', '11111111-1111-1111-1111-111111111111', 'photo', 'founder/secret/IMG_0005.jpg', null, 1000, 1000, 'none', null);

\o /dev/null

-- ---------------------------------------------------------------------------
-- who may mint a link
-- ---------------------------------------------------------------------------
select tests.run('the author mints a link for their own post', :'founder', 'OK',
  $q$ select public.create_post_share('a0000000-0000-4000-8000-000000000001', 'story', 'paper') $q$);
select tests.run('another member cannot mint a link for it', :'second', 'ERROR:P0001',
  $q$ select public.create_post_share('a0000000-0000-4000-8000-000000000001', 'story', 'paper') $q$);
select tests.run('a pending applicant cannot mint a link', :'pending', 'ERROR:P0001',
  $q$ select public.create_post_share('a0000000-0000-4000-8000-000000000001', 'story', 'paper') $q$);
select tests.run('a signed-out visitor cannot mint a link', null, 'DENIED',
  $q$ select public.create_post_share('a0000000-0000-4000-8000-000000000001', 'story', 'paper') $q$);
select tests.run('an unknown print shape is refused', :'founder', 'ERROR:P0001',
  $q$ select public.create_post_share('a0000000-0000-4000-8000-000000000001', 'poster', 'paper') $q$);
select tests.run('a signed-out visitor cannot write to the ledger directly', null, 'DENIED',
  $q$ insert into public.share_events (kind) values ('page_opened') $q$);
select tests.run('a member cannot write the page''s events directly', :'founder', 'DENIED',
  $q$ insert into public.share_events (kind, actor_id) values ('page_opened', '11111111-1111-1111-1111-111111111111') $q$);
select tests.run('a member may note their own share', :'founder', 'OK',
  $q$ insert into public.share_events (kind, actor_id, post_id, format, theme)
      values ('share_started', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-4000-8000-000000000001', 'story', 'paper') $q$);
select tests.run('a member cannot note a share as somebody else', :'second', 'DENIED',
  $q$ insert into public.share_events (kind, actor_id) values ('share_started', '11111111-1111-1111-1111-111111111111') $q$);

\o

do $checks$
declare
  v_live     text;   -- post 1, stays live
  v_off      text;   -- post 2, turned off
  v_film     text;   -- post 3, a film
  v_second   text;   -- post 4, whose author is then suspended
  v_deleted  text;   -- post 5, deleted outright
  v_n        int;
  v_path     text;
  v_row      jsonb;
  v_views    int;
begin
  -- Mint, as the authors.
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  v_live    := public.create_post_share('a0000000-0000-4000-8000-000000000001', 'story', 'paper');
  v_off     := public.create_post_share('a0000000-0000-4000-8000-000000000002', 'story', 'darkroom');
  v_film    := public.create_post_share('a0000000-0000-4000-8000-000000000003', 'print', 'paper');
  v_deleted := public.create_post_share('a0000000-0000-4000-8000-000000000005', 'story', 'paper');
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  v_second  := public.create_post_share('a0000000-0000-4000-8000-000000000004', 'story', 'paper');
  reset role;

  insert into tests.results (name, expected, actual) values
    ('a token is 32 hex characters', 'true', (v_live ~ '^[a-f0-9]{32}$')::text),
    ('every post gets its own token', '5', (select count(distinct t) from unnest(array[v_live, v_off, v_film, v_second, v_deleted]) t)::text);

  -- Minting again hands back the same live token.
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  insert into tests.results (name, expected, actual) values
    ('minting again reuses the live token', 'true',
     (public.create_post_share('a0000000-0000-4000-8000-000000000001', 'print', 'darkroom') = v_live)::text);
  select count(*) into v_n from public.post_shares;
  reset role;
  insert into tests.results (name, expected, actual) values
    ('a member sees only their own share rows', '4', v_n::text);

  -- -------------------------------------------------------------------------
  -- the public functions, as the page's server calls them: anon
  -- -------------------------------------------------------------------------
  set local role anon;
  perform set_config('request.jwt.claims', '', true);

  -- valid token: the media function hands the server the file
  select media_path into v_path from public.shared_post_media(v_live);
  insert into tests.results (name, expected, actual) values
    ('a live token retrieves the file', 'founder/secret/IMG_0001.jpg', coalesce(v_path, '<none>'));
  select to_jsonb(s) into v_row from public.shared_post(v_live) s;
  insert into tests.results (name, expected, actual) values
    ('the page function names the author', 'founder', coalesce(v_row->>'username', '<none>')),
    ('the page function names the place', 'Paris', coalesce(v_row->>'location', '<none>')),
    ('the page function never carries the file path', 'false', (v_row ? 'media_path' or v_row ? 'thumb_path')::text),
    ('a film reports its poster', 'true', coalesce((select has_poster::text from public.shared_post(v_film)), '<none>'));
  select thumb_path into v_path from public.shared_post_media(v_film);
  insert into tests.results (name, expected, actual) values
    ('a film''s poster is retrievable', 'founder/secret/clip.jpg', coalesce(v_path, '<none>'));

  -- invalid tokens: nothing, and no error
  insert into tests.results (name, expected, actual) values
    ('a malformed token retrieves nothing', '0', (select count(*) from public.shared_post_media('not-a-token'))::text),
    ('an upper-case token retrieves nothing', '0', (select count(*) from public.shared_post_media(upper(v_live)))::text),
    ('an unknown token retrieves nothing', '0', (select count(*) from public.shared_post_media(repeat('0', 32)))::text),
    ('an unknown token opens no page', '0', (select count(*) from public.shared_post(repeat('0', 32)))::text),
    ('a null token retrieves nothing', '0', (select count(*) from public.shared_post_media(null))::text);

  -- the tables themselves are never public
  select count(*) into v_n from public.post_shares;
  insert into tests.results (name, expected, actual) values ('a signed-out visitor reads no share rows', '0', v_n::text);
  select count(*) into v_n from public.share_events;
  insert into tests.results (name, expected, actual) values ('a signed-out visitor reads no ledger rows', '0', v_n::text);
  reset role;

  -- -------------------------------------------------------------------------
  -- turning off
  -- -------------------------------------------------------------------------
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  insert into tests.results (name, expected, actual) values
    ('before turning off, the file is retrievable', '1', (select count(*) from public.shared_post_media(v_off))::text);
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  perform public.revoke_post_share('a0000000-0000-4000-8000-000000000002');   -- not theirs: no effect
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  insert into tests.results (name, expected, actual) values
    ('another member cannot turn a share off', '1', (select count(*) from public.shared_post_media(v_off))::text);
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  perform public.revoke_post_share('a0000000-0000-4000-8000-000000000002');
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  insert into tests.results (name, expected, actual) values
    ('a turned-off token retrieves no file', '0', (select count(*) from public.shared_post_media(v_off))::text),
    ('a turned-off token opens no page', '0', (select count(*) from public.shared_post(v_off))::text),
    ('a turned-off token counts no request to join', '0',
     (select count(*) from (select public.record_share_event(v_off, 'membership_requested')) r,
                           public.share_events e where e.token = v_off and e.kind = 'membership_requested')::text);
  reset role;

  -- Minting afresh after turning off gives a new token; the old stays dead.
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  insert into tests.results (name, expected, actual) values
    ('sharing again after turning off mints a new token', 'true',
     (public.create_post_share('a0000000-0000-4000-8000-000000000002', 'story', 'paper') <> v_off)::text);
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  insert into tests.results (name, expected, actual) values
    ('the old token stays dead', '0', (select count(*) from public.shared_post_media(v_off))::text);
  reset role;

  -- -------------------------------------------------------------------------
  -- the post goes: removed by moderation, or deleted outright
  -- -------------------------------------------------------------------------
  update public.posts set removed_at = now(), removed_by = '11111111-1111-1111-1111-111111111111'
   where id = 'a0000000-0000-4000-8000-000000000001';
  delete from public.posts where id = 'a0000000-0000-4000-8000-000000000005';
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  insert into tests.results (name, expected, actual) values
    ('a removed post''s token retrieves no file', '0', (select count(*) from public.shared_post_media(v_live))::text),
    ('a removed post''s token opens no page', '0', (select count(*) from public.shared_post(v_live))::text),
    ('a deleted post''s token retrieves no file', '0', (select count(*) from public.shared_post_media(v_deleted))::text),
    ('a deleted post''s token opens no page', '0', (select count(*) from public.shared_post(v_deleted))::text);
  reset role;
  insert into tests.results (name, expected, actual) values
    ('a deleted post takes its share row with it', '0', (select count(*) from public.post_shares where token = v_deleted)::text);
  -- Restoring the removed post restores the link: it was never turned off.
  update public.posts set removed_at = null, removed_by = null where id = 'a0000000-0000-4000-8000-000000000001';

  -- -------------------------------------------------------------------------
  -- the author goes: suspended, then reinstated
  -- -------------------------------------------------------------------------
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  insert into tests.results (name, expected, actual) values
    ('before suspension, the second member''s file is retrievable', '1', (select count(*) from public.shared_post_media(v_second))::text);
  reset role;
  update public.profiles set status = 'suspended' where id = '22222222-2222-2222-2222-222222222222';
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  insert into tests.results (name, expected, actual) values
    ('a suspended author''s token retrieves no file', '0', (select count(*) from public.shared_post_media(v_second))::text),
    ('a suspended author''s token opens no page', '0', (select count(*) from public.shared_post(v_second))::text);
  reset role;
  update public.profiles set status = 'applied' where id = '22222222-2222-2222-2222-222222222222';
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  insert into tests.results (name, expected, actual) values
    ('an unapproved author''s token retrieves no file', '0', (select count(*) from public.shared_post_media(v_second))::text);
  reset role;
  update public.profiles set status = 'approved' where id = '22222222-2222-2222-2222-222222222222';

  -- -------------------------------------------------------------------------
  -- the ledger
  -- -------------------------------------------------------------------------
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  perform public.shared_post(v_film);
  perform public.shared_post(v_film);
  perform public.shared_post_media(v_film);          -- fetching the file is not a visit
  perform public.record_share_event(v_film, 'membership_requested');
  perform public.record_share_event(v_film, 'page_opened');   -- the page may not say this
  perform public.record_share_event(v_film, 'share_started'); -- nor this
  reset role;
  -- Three visits in all: the poster check above opened the page once too.
  select view_count into v_views from public.post_shares where token = v_film;
  insert into tests.results (name, expected, actual) values
    ('each page visit is counted, the file is not', '3', v_views::text),
    ('the ledger keeps three visits and one request to join',
     'page_opened,page_opened,page_opened,membership_requested',
     (select string_agg(kind, ',' order by created_at) from public.share_events where token = v_film));
end
$checks$;

\pset border 2
select seq, name, expected, actual,
       case when expected = actual then 'pass' else 'FAIL' end as status
from tests.results where name like '%token%' or name like '%mint%' or name like '%share%' or name like '%ledger%'
   or name like '%file%' or name like '%page%' or name like '%turn%' or name like '%author%' or name like '%poster%' or name like '%place%'
order by seq;

do $verdict$
declare v_failed int;
begin
  select count(*) into v_failed from tests.results where expected <> actual;
  if v_failed > 0 then
    raise exception '% share-link checks FAILED', v_failed;
  end if;
  raise notice 'share link checks passed';
end
$verdict$;
