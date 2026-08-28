-- VINTAGE · seed data
-- Fictional members, photographs, follows, likes, comments, applications,
-- invites and one open report, so a fresh stack feels inhabited.
--
-- Every seeded account signs in with password: vintage-demo
--   admin:  admin@vintage.club  (role admin)
--   member: elena@vintage.club, tomas@vintage.club, …
--
-- Media uses picsum.photos placeholder URLs (the client passes absolute
-- URLs through untouched); real uploads land in Supabase Storage.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- auth users (trigger on auth.users creates the matching profiles)
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change, email_change_token_new)
select
  '00000000-0000-0000-0000-000000000000',
  u.id, 'authenticated', 'authenticated', u.email,
  crypt('vintage-demo', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username', u.username, 'full_name', u.full_name),
  now() - u.age, now() - u.age,
  '', '', '', ''
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'admin@vintage.club',  'vintage',          'VINTAGE',           interval '400 days'),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'elena@vintage.club',  'elena.marchetti',  'Elena Marchetti',   interval '380 days'),
  ('a0000000-0000-4000-8000-000000000003'::uuid, 'tomas@vintage.club',  'tomas.lindqvist',  'Tomas Lindqvist',   interval '360 days'),
  ('a0000000-0000-4000-8000-000000000004'::uuid, 'june@vintage.club',   'june.nakamura',    'June Nakamura',     interval '340 days'),
  ('a0000000-0000-4000-8000-000000000005'::uuid, 'arthur@vintage.club', 'arthur.beaumont',  'Arthur Beaumont',   interval '300 days'),
  ('a0000000-0000-4000-8000-000000000006'::uuid, 'clara@vintage.club',  'clara.reyes',      'Clara Reyes',       interval '260 days'),
  ('a0000000-0000-4000-8000-000000000007'::uuid, 'otis@vintage.club',   'otis.whitfield',   'Otis Whitfield',    interval '220 days'),
  ('a0000000-0000-4000-8000-000000000008'::uuid, 'margot@vintage.club', 'margot.dubois',    'Margot Dubois',     interval '180 days'),
  ('a0000000-0000-4000-8000-000000000009'::uuid, 'sam@vintage.club',    'sam.okafor',       'Sam Okafor',        interval '140 days'),
  ('a0000000-0000-4000-8000-00000000000a'::uuid, 'ines@vintage.club',   'ines.almeida',     'Inês Almeida',      interval '100 days'),
  ('a0000000-0000-4000-8000-00000000000b'::uuid, 'niko@vintage.club',   'niko.papadakis',   'Niko Papadakis',    interval '60 days'),
  ('a0000000-0000-4000-8000-00000000000c'::uuid, 'ruby@example.com',    'ruby.calloway',    'Ruby Calloway',     interval '3 days'),
  ('a0000000-0000-4000-8000-00000000000d'::uuid, 'dex@example.com',     'dex.morrow',       'Dex Morrow',        interval '1 day')
) as u(id, email, username, full_name, age);

insert into auth.identities
  (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email),
       'email', now(), now(), now()
from auth.users u
where u.id::text like 'a0000000-%';

-- ---------------------------------------------------------------------------
-- profiles: approve the members, decorate them
-- ---------------------------------------------------------------------------
update public.profiles set
  role = 'admin', status = 'approved', approved_at = now() - interval '400 days',
  bio = 'Keeper of the archive.', city = 'New York', invite_quota = 99,
  avatar_url = 'https://picsum.photos/seed/vintage-admin/400/400'
where id = 'a0000000-0000-4000-8000-000000000001';

update public.profiles set status = 'approved', approved_at = now() - interval '379 days',
  bio = 'Film first. 35mm, mostly Milan.', city = 'Milan', social_handle = '@elena.marchetti', invite_quota = 3,
  avatar_url = 'https://picsum.photos/seed/elena-face/400/400'
where id = 'a0000000-0000-4000-8000-000000000002';

update public.profiles set status = 'approved', approved_at = now() - interval '359 days',
  bio = 'North light. Quiet water.', city = 'Stockholm', social_handle = '@t.lindqvist', invite_quota = 3,
  avatar_url = 'https://picsum.photos/seed/tomas-face/400/400'
where id = 'a0000000-0000-4000-8000-000000000003';

update public.profiles set status = 'approved', approved_at = now() - interval '339 days',
  bio = 'Gardens, trains, breakfast.', city = 'Kyoto', social_handle = '@june.naka', invite_quota = 3,
  avatar_url = 'https://picsum.photos/seed/june-face/400/400'
where id = 'a0000000-0000-4000-8000-000000000004';

update public.profiles set status = 'approved', approved_at = now() - interval '299 days',
  bio = 'Old cafés and older stone.', city = 'Paris', social_handle = '@a.beaumont', invite_quota = 3,
  avatar_url = 'https://picsum.photos/seed/arthur-face/400/400'
where id = 'a0000000-0000-4000-8000-000000000005';

update public.profiles set status = 'approved', approved_at = now() - interval '259 days',
  bio = 'Color, but gently.', city = 'Mexico City', social_handle = '@clara.rys', invite_quota = 3,
  avatar_url = 'https://picsum.photos/seed/clara-face/400/400'
where id = 'a0000000-0000-4000-8000-000000000006';

update public.profiles set status = 'approved', approved_at = now() - interval '219 days',
  bio = 'Brass bands and porch light.', city = 'New Orleans', social_handle = '@otis.w', invite_quota = 3,
  avatar_url = 'https://picsum.photos/seed/otis-face/400/400'
where id = 'a0000000-0000-4000-8000-000000000007';

update public.profiles set status = 'approved', approved_at = now() - interval '179 days',
  bio = 'Markets before eight.', city = 'Lyon', social_handle = '@margot.db', invite_quota = 3,
  avatar_url = 'https://picsum.photos/seed/margot-face/400/400'
where id = 'a0000000-0000-4000-8000-000000000008';

update public.profiles set status = 'approved', approved_at = now() - interval '139 days',
  bio = 'Streets, faces, weather.', city = 'Lagos', social_handle = '@sam.okf', invite_quota = 3,
  avatar_url = 'https://picsum.photos/seed/sam-face/400/400'
where id = 'a0000000-0000-4000-8000-000000000009';

update public.profiles set status = 'approved', approved_at = now() - interval '99 days',
  bio = 'Tiles and tide.', city = 'Lisbon', social_handle = '@ines.alm', invite_quota = 3,
  avatar_url = 'https://picsum.photos/seed/ines-face/400/400'
where id = 'a0000000-0000-4000-8000-00000000000a';

update public.profiles set status = 'approved', approved_at = now() - interval '59 days',
  bio = 'Islands off-season.', city = 'Athens', social_handle = '@niko.pap', invite_quota = 3,
  avatar_url = 'https://picsum.photos/seed/niko-face/400/400'
where id = 'a0000000-0000-4000-8000-00000000000b';

-- ruby & dex stay in 'applied' status: they populate the admin queue.

-- ---------------------------------------------------------------------------
-- membership applications
-- ---------------------------------------------------------------------------
insert into public.applications
  (user_id, full_name, desired_username, avatar_url, social_handle, city, inviter, reason, status, created_at)
values
  ('a0000000-0000-4000-8000-00000000000c', 'Ruby Calloway', 'ruby.calloway',
   'https://picsum.photos/seed/ruby-face/400/400', '@rubyshoots', 'Portland', 'elena.marchetti',
   'I shoot medium format landscapes and my grandmother''s garden every Sunday. I miss when sharing photos felt like showing someone a print.', 'pending',
   now() - interval '3 days'),
  ('a0000000-0000-4000-8000-00000000000d', 'Dex Morrow', 'dex.morrow',
   null, '@dexmorrow', 'Chicago', null,
   'Mostly night photography on expired film stock. Looking for a smaller room to share it in.', 'pending',
   now() - interval '1 day');

-- ---------------------------------------------------------------------------
-- invites
-- ---------------------------------------------------------------------------
insert into public.invites (code, created_by, used_by, created_at, used_at) values
  ('ELNA-M4RC', 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000b',
   now() - interval '70 days', now() - interval '59 days'),
  ('QUET-R2OM', 'a0000000-0000-4000-8000-000000000002', null, now() - interval '20 days', null),
  ('JNKA-K7YT', 'a0000000-0000-4000-8000-000000000004', null, now() - interval '12 days', null);

-- ---------------------------------------------------------------------------
-- follows (a dense little village; triggers maintain counters + activity)
-- ---------------------------------------------------------------------------
insert into public.follows (follower_id, followee_id, created_at)
select f.follower, f.followee, now() - (random() * interval '90 days')
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'a0000000-0000-4000-8000-000000000002'::uuid),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003'),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004'),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000005'),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000006'),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000007'),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000008'),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000009'),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a'),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000b'),
  ('a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003'),
  ('a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000004'),
  ('a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000005'),
  ('a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000008'),
  ('a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000b'),
  ('a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004'),
  ('a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000009'),
  ('a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000003'),
  ('a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000006'),
  ('a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-00000000000a'),
  ('a0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000008'),
  ('a0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000007'),
  ('a0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000009'),
  ('a0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000006'),
  ('a0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000009'),
  ('a0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000005'),
  ('a0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-00000000000a'),
  ('a0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000003'),
  ('a0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000006'),
  ('a0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000007'),
  ('a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000004'),
  ('a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000008'),
  ('a0000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-00000000000a'),
  ('a0000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-000000000005')
) as f(follower, followee);

-- ---------------------------------------------------------------------------
-- posts (picsum placeholders; filter mix across all eight)
-- ---------------------------------------------------------------------------
insert into public.posts
  (id, author_id, media_type, media_path, thumb_path, width, height, filter_id, show_date_stamp, caption, created_at)
values
  -- Elena · Milan film
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'photo',
   'https://picsum.photos/seed/milan-tram/1200/1500', 'https://picsum.photos/seed/milan-tram/480/600',
   1200, 1500, 'chrome-64', false, 'The 19 tram, before anyone was awake.', now() - interval '2 hours'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'photo',
   'https://picsum.photos/seed/milan-cortile/1200/1200', 'https://picsum.photos/seed/milan-cortile/480/480',
   1200, 1200, 'seventy', false, 'Nonna''s courtyard. Nothing has moved since 1974.', now() - interval '2 days'),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 'photo',
   'https://picsum.photos/seed/milan-nebbia/1200/1500', 'https://picsum.photos/seed/milan-nebbia/480/600',
   1200, 1500, 'archive-bw', false, 'Fog on the Naviglio.', now() - interval '6 days'),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000002', 'photo',
   'https://picsum.photos/seed/milan-mercato/1200/960', 'https://picsum.photos/seed/milan-mercato/480/384',
   1200, 960, 'ninety-eight', true, 'Saturday market, closing time.', now() - interval '12 days'),

  -- Tomas · Stockholm
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000003', 'photo',
   'https://picsum.photos/seed/sthlm-ferry/1200/1500', 'https://picsum.photos/seed/sthlm-ferry/480/600',
   1200, 1500, 'alpine', false, 'Last ferry of the evening.', now() - interval '5 hours'),
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000003', 'photo',
   'https://picsum.photos/seed/sthlm-ice/1200/1200', 'https://picsum.photos/seed/sthlm-ice/480/480',
   1200, 1200, 'alpine', false, 'The bay decided to be a mirror today.', now() - interval '3 days'),
  ('b0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000003', 'photo',
   'https://picsum.photos/seed/sthlm-cabin/1200/1500', 'https://picsum.photos/seed/sthlm-cabin/480/600',
   1200, 1500, 'neutral-aged', false, 'Grandfather''s cabin, opened for the season.', now() - interval '9 days'),

  -- June · Kyoto
  ('b0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000004', 'photo',
   'https://picsum.photos/seed/kyoto-moss/1200/1500', 'https://picsum.photos/seed/kyoto-moss/480/600',
   1200, 1500, 'instant', false, 'Moss garden after the rain.', now() - interval '8 hours'),
  ('b0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000004', 'photo',
   'https://picsum.photos/seed/kyoto-train/1200/960', 'https://picsum.photos/seed/kyoto-train/480/384',
   1200, 960, 'ninety-eight', true, 'The slow line home.', now() - interval '4 days'),
  ('b0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000004', 'photo',
   'https://picsum.photos/seed/kyoto-breakfast/1200/1200', 'https://picsum.photos/seed/kyoto-breakfast/480/480',
   1200, 1200, 'seventy', false, 'Breakfast for one, table for four.', now() - interval '11 days'),
  ('b0000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-000000000004', 'video',
   'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
   'https://picsum.photos/seed/kyoto-video/480/480',
   1280, 720, 'neutral-aged', false, 'Wind through the bamboo, fifteen seconds of it.', now() - interval '7 days'),

  -- Arthur · Paris
  ('b0000000-0000-4000-8000-00000000000c', 'a0000000-0000-4000-8000-000000000005', 'photo',
   'https://picsum.photos/seed/paris-cafe/1200/1500', 'https://picsum.photos/seed/paris-cafe/480/600',
   1200, 1500, 'seventy', false, 'The waiter has worked here forty years. It shows, kindly.', now() - interval '26 hours'),
  ('b0000000-0000-4000-8000-00000000000d', 'a0000000-0000-4000-8000-000000000005', 'photo',
   'https://picsum.photos/seed/paris-stone/1200/1200', 'https://picsum.photos/seed/paris-stone/480/480',
   1200, 1200, 'archive-bw', false, 'Rue des Barres, seven in the morning.', now() - interval '5 days'),
  ('b0000000-0000-4000-8000-00000000000e', 'a0000000-0000-4000-8000-000000000005', 'photo',
   'https://picsum.photos/seed/paris-seine/1200/960', 'https://picsum.photos/seed/paris-seine/480/384',
   1200, 960, 'chrome-64', false, 'The Seine doing its usual impression of a painting.', now() - interval '14 days'),

  -- Clara · Mexico City
  ('b0000000-0000-4000-8000-00000000000f', 'a0000000-0000-4000-8000-000000000006', 'photo',
   'https://picsum.photos/seed/cdmx-wall/1200/1500', 'https://picsum.photos/seed/cdmx-wall/480/600',
   1200, 1500, 'riviera', true, 'A wall that has been three colors and remembers all of them.', now() - interval '10 hours'),
  ('b0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000006', 'photo',
   'https://picsum.photos/seed/cdmx-market/1200/1200', 'https://picsum.photos/seed/cdmx-market/480/480',
   1200, 1200, 'chrome-64', false, 'Marigold season at the mercado.', now() - interval '4 days'),
  ('b0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000006', 'photo',
   'https://picsum.photos/seed/cdmx-plaza/1200/1500', 'https://picsum.photos/seed/cdmx-plaza/480/600',
   1200, 1500, 'instant', false, 'Sunday, the plaza, everyone''s grandfather.', now() - interval '13 days'),

  -- Otis · New Orleans
  ('b0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000007', 'photo',
   'https://picsum.photos/seed/nola-porch/1200/1500', 'https://picsum.photos/seed/nola-porch/480/600',
   1200, 1500, 'seventy', true, 'Porch light hour.', now() - interval '18 hours'),
  ('b0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000007', 'photo',
   'https://picsum.photos/seed/nola-brass/1200/960', 'https://picsum.photos/seed/nola-brass/480/384',
   1200, 960, 'ninety-eight', false, 'Second line on Frenchmen. You could hear this photo.', now() - interval '6 days'),
  ('b0000000-0000-4000-8000-000000000014', 'a0000000-0000-4000-8000-000000000007', 'video',
   'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
   'https://picsum.photos/seed/nola-video/480/480',
   1280, 720, 'ninety-eight', false, 'Streetcar passing, thirty seconds of bell.', now() - interval '10 days'),

  -- Margot · Lyon
  ('b0000000-0000-4000-8000-000000000015', 'a0000000-0000-4000-8000-000000000008', 'photo',
   'https://picsum.photos/seed/lyon-market/1200/1500', 'https://picsum.photos/seed/lyon-market/480/600',
   1200, 1500, 'neutral-aged', false, 'The cheese man saves me the good one.', now() - interval '30 hours'),
  ('b0000000-0000-4000-8000-000000000016', 'a0000000-0000-4000-8000-000000000008', 'photo',
   'https://picsum.photos/seed/lyon-traboule/1200/1200', 'https://picsum.photos/seed/lyon-traboule/480/480',
   1200, 1200, 'archive-bw', false, 'Traboules before the tours arrive.', now() - interval '8 days'),

  -- Sam · Lagos
  ('b0000000-0000-4000-8000-000000000017', 'a0000000-0000-4000-8000-000000000009', 'photo',
   'https://picsum.photos/seed/lagos-street/1200/1500', 'https://picsum.photos/seed/lagos-street/480/600',
   1200, 1500, 'chrome-64', false, 'Yaba, golden hour, everything moving except this man.', now() - interval '3 hours'),
  ('b0000000-0000-4000-8000-000000000018', 'a0000000-0000-4000-8000-000000000009', 'photo',
   'https://picsum.photos/seed/lagos-rain/1200/1200', 'https://picsum.photos/seed/lagos-rain/480/480',
   1200, 1200, 'ninety-eight', true, 'First rain of the season.', now() - interval '5 days'),
  ('b0000000-0000-4000-8000-000000000019', 'a0000000-0000-4000-8000-000000000009', 'photo',
   'https://picsum.photos/seed/lagos-tailor/1200/1500', 'https://picsum.photos/seed/lagos-tailor/480/600',
   1200, 1500, 'seventy', false, 'My tailor, mid-argument, winning.', now() - interval '15 days'),

  -- Inês · Lisbon
  ('b0000000-0000-4000-8000-00000000001a', 'a0000000-0000-4000-8000-00000000000a', 'photo',
   'https://picsum.photos/seed/lisboa-tiles/1200/1500', 'https://picsum.photos/seed/lisboa-tiles/480/600',
   1200, 1500, 'riviera', true, 'Azulejos doing their quiet blue thing.', now() - interval '22 hours'),
  ('b0000000-0000-4000-8000-00000000001b', 'a0000000-0000-4000-8000-00000000000a', 'photo',
   'https://picsum.photos/seed/lisboa-tram/1200/1200', 'https://picsum.photos/seed/lisboa-tram/480/480',
   1200, 1200, 'seventy', false, 'The 28, empty for once.', now() - interval '7 days'),
  ('b0000000-0000-4000-8000-00000000001c', 'a0000000-0000-4000-8000-00000000000a', 'photo',
   'https://picsum.photos/seed/lisboa-praia/1200/960', 'https://picsum.photos/seed/lisboa-praia/480/384',
   1200, 960, 'riviera', false, 'Off-season Atlantic.', now() - interval '16 days'),

  -- Niko · Athens
  ('b0000000-0000-4000-8000-00000000001d', 'a0000000-0000-4000-8000-00000000000b', 'photo',
   'https://picsum.photos/seed/athens-cats/1200/1500', 'https://picsum.photos/seed/athens-cats/480/600',
   1200, 1500, 'riviera', false, 'The committee that runs this neighborhood.', now() - interval '14 hours'),
  ('b0000000-0000-4000-8000-00000000001e', 'a0000000-0000-4000-8000-00000000000b', 'photo',
   'https://picsum.photos/seed/athens-ferry/1200/1200', 'https://picsum.photos/seed/athens-ferry/480/480',
   1200, 1200, 'alpine', false, 'Ferry to nowhere in particular.', now() - interval '6 days'),
  ('b0000000-0000-4000-8000-00000000001f', 'a0000000-0000-4000-8000-00000000000b', 'photo',
   'https://picsum.photos/seed/athens-october/1200/1500', 'https://picsum.photos/seed/athens-october/480/600',
   1200, 1500, 'instant', true, 'October light is the honest one.', now() - interval '18 days');

-- ---------------------------------------------------------------------------
-- likes (triggers bump counters and write activity)
-- ---------------------------------------------------------------------------
insert into public.likes (post_id, user_id, created_at)
select l.post, l.who, now() - (random() * interval '24 hours')
from (values
  ('b0000000-0000-4000-8000-000000000001'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004'),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000005'),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000008'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000005'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a'),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003'),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000008'),
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000002'),
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000009'),
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000002'),
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000004'),
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-00000000000b'),
  ('b0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000002'),
  ('b0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-00000000000a'),
  ('b0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000003'),
  ('b0000000-0000-4000-8000-00000000000c', 'a0000000-0000-4000-8000-000000000002'),
  ('b0000000-0000-4000-8000-00000000000c', 'a0000000-0000-4000-8000-000000000008'),
  ('b0000000-0000-4000-8000-00000000000f', 'a0000000-0000-4000-8000-000000000004'),
  ('b0000000-0000-4000-8000-00000000000f', 'a0000000-0000-4000-8000-000000000007'),
  ('b0000000-0000-4000-8000-00000000000f', 'a0000000-0000-4000-8000-000000000009'),
  ('b0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000006'),
  ('b0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000009'),
  ('b0000000-0000-4000-8000-000000000015', 'a0000000-0000-4000-8000-000000000005'),
  ('b0000000-0000-4000-8000-000000000015', 'a0000000-0000-4000-8000-000000000002'),
  ('b0000000-0000-4000-8000-000000000017', 'a0000000-0000-4000-8000-000000000003'),
  ('b0000000-0000-4000-8000-000000000017', 'a0000000-0000-4000-8000-000000000006'),
  ('b0000000-0000-4000-8000-000000000017', 'a0000000-0000-4000-8000-000000000007'),
  ('b0000000-0000-4000-8000-00000000001a', 'a0000000-0000-4000-8000-000000000004'),
  ('b0000000-0000-4000-8000-00000000001a', 'a0000000-0000-4000-8000-000000000008'),
  ('b0000000-0000-4000-8000-00000000001a', 'a0000000-0000-4000-8000-00000000000b'),
  ('b0000000-0000-4000-8000-00000000001d', 'a0000000-0000-4000-8000-000000000002'),
  ('b0000000-0000-4000-8000-00000000001d', 'a0000000-0000-4000-8000-00000000000a')
) as l(post, who);

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------
insert into public.comments (post_id, author_id, body, created_at) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000005',
   'That light. Milan forgives everything at this hour.', now() - interval '100 minutes'),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003',
   'The emptiness makes it.', now() - interval '80 minutes'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a',
   'Please never let anyone renovate this.', now() - interval '40 hours'),
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000002',
   'Alpine was made for your city.', now() - interval '4 hours'),
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000004',
   'The stillness travels. Thank you for this.', now() - interval '2 days'),
  ('b0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000002',
   'I can smell the rain from here.', now() - interval '6 hours'),
  ('b0000000-0000-4000-8000-00000000000c', 'a0000000-0000-4000-8000-000000000008',
   'Forty years and he still carries four cups at once, I hope.', now() - interval '20 hours'),
  ('b0000000-0000-4000-8000-00000000000f', 'a0000000-0000-4000-8000-000000000007',
   'Walls with memory. My kind of subject.', now() - interval '8 hours'),
  ('b0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000006',
   'You CAN hear it. Wonderful.', now() - interval '5 days'),
  ('b0000000-0000-4000-8000-000000000015', 'a0000000-0000-4000-8000-000000000005',
   'The good one is worth the wait.', now() - interval '24 hours'),
  ('b0000000-0000-4000-8000-000000000017', 'a0000000-0000-4000-8000-000000000003',
   'The stillness in the rush — you found it again.', now() - interval '2 hours'),
  ('b0000000-0000-4000-8000-00000000001a', 'a0000000-0000-4000-8000-000000000004',
   'Blue and blue and blue. Lovely.', now() - interval '18 hours'),
  ('b0000000-0000-4000-8000-00000000001d', 'a0000000-0000-4000-8000-00000000000a',
   'Give the committee my regards.', now() - interval '10 hours');

-- ---------------------------------------------------------------------------
-- one open report, so the moderation queue isn't empty
-- ---------------------------------------------------------------------------
insert into public.reports (reporter_id, target_type, post_id, reason, details, created_at)
values
  ('a0000000-0000-4000-8000-000000000008', 'post', 'b0000000-0000-4000-8000-000000000014',
   'Promotional or engagement-bait content',
   'The caption feels like an ad for a tour company. Might be nothing.',
   now() - interval '20 hours');
