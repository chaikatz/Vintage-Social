-- VINTAGE · staging · a few video posts
--
-- The house seed is photographs only, so without this there is nothing in
-- staging to check video playback against: autoplay of the visible card,
-- the sound button, the poster frame underneath, and the filter being
-- applied live rather than baked.
--
-- Staging only, and deliberately not part of the production seed. These
-- clips are Google's public sample files — the same ones the demo fixtures
-- use. They are fine for a private test environment and are not something
-- to ship to real members.
--
-- Run after the house seed. Safe to re-run.

insert into public.posts
  (id, author_id, media_type, media_path, thumb_path, width, height,
   duration_seconds, filter_id, show_date_stamp, caption, location, created_at)
select (lpad(to_hex(v.n), 8, '0') || '-0000-4000-8002-000000000000')::uuid,
       (lpad(to_hex(v.n), 8, '0') || '-0000-4000-8000-000000000000')::uuid,
       'video',
       'https://storage.googleapis.com/gtv-videos-bucket/sample/' || v.clip || '.mp4',
       'https://picsum.photos/id/' || v.poster || '/480/320',
       1280, 720, v.seconds, v.filter, v.stamp, v.caption, v.place,
       now() - (v.n || ' hours')::interval
from (values
  (1, 'ForBiggerEscapes',   '1015', 15, 'seventy',    true,  'Kept the sound on for this one.', null),
  (2, 'ForBiggerJoyrides',  '1016', 25, 'chrome-64',  false, 'Thirty seconds of a good afternoon.', null),
  (3, 'ForBiggerBlazes',    '1018', 15, 'ember',      false, 'Turn it up.', null),
  (4, 'ForBiggerMeltdowns', '1019', 30, 'cassette',   true,  'Wind ruined the audio. Posting anyway.', null),
  (5, 'ForBiggerFun',       '1021', 60, 'peach',      false, 'One take.', null),
  (6, 'ElephantsDream',     '1024', 45, 'archive-bw', false, 'Found on an old card.', null)
) as v(n, clip, poster, seconds, filter, stamp, caption, place)
where exists (
  select 1 from public.profiles p
  where p.id = (lpad(to_hex(v.n), 8, '0') || '-0000-4000-8000-000000000000')::uuid
    and p.is_house
)
on conflict (id) do nothing;

select count(*) as video_posts from public.posts where media_type = 'video';
