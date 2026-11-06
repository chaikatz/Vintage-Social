-- VINTAGE · 0034 · the house photographs' grid squares at a grid's size
--
-- Data only, two parts: the Wikimedia photographs, and the picsum ones.
--
-- Wikimedia. 229 of the house accounts' photographs (the seed, from
-- Wikimedia Commons) have the full-size picture as their thumbnail
-- (thumb_path = media_path): 176 are Wikimedia's 1920-pixel rendering
-- (thumb.wikimedia.org/.../1920px-<name>) and 53 the original file
-- (upload.wikimedia.org/wikipedia/commons/<a>/<ab>/<name>, 1400 pixels
-- wide or more). Every grid square, Activity row, message preview and
-- gallery stand-in that shows one downloads that whole picture: a few
-- hundred kilobytes to a few megabytes for a square about 130 points
-- wide. The seed asked Wikimedia for 480-pixel thumbnails, but Wikimedia
-- now serves only its standard widths and the seed's rewrite never
-- matched, so the thumbnail was left as the full picture.
--
-- Wikimedia's standard thumbnail widths are 20, 40, 60, 120, 250, 330,
-- 500, 960, 1280, 1920 and 3840 pixels (https://w.wiki/GHai); any other
-- width is refused (HTTP 400, "Use thumbnail sizes listed on
-- https://w.wiki/GHai"), as 400, 480, 501, 640, 800 and 1024 were when
-- checked on 6 November 2026. 500 is the standard width nearest the
-- other house thumbnails' 480, and was served for every seed URL tried
-- (thumb.wikimedia.org and upload.wikimedia.org, JPEG and PNG), 55 to 105
-- KB a JPEG where the 1920-pixel picture is several times that.
--
-- So each such thumbnail becomes the 500-pixel rendering of the same
-- file: on thumb.wikimedia.org, /1920px- becomes /500px-; an original
-- upload.wikimedia.org/wikipedia/commons/<a>/<ab>/<name> becomes
-- upload.wikimedia.org/wikipedia/commons/thumb/<a>/<ab>/<name>/500px-<name>
-- (Wikimedia's thumbnail address for that file; PNGs stay PNG). The
-- photograph itself (media_path) is not touched.
--
-- Picsum. The other 679 house photographs (picsum.photos, 1200 pixels
-- wide and 800 to 1500 high on production) have thumbnails 480 pixels
-- wide: 480 by 320 for three in four of them. A grid square is about 436
-- pixels on a 3x phone and shows the middle of the picture at the
-- square's size, so it is the short side that fills it, and a short side
-- of 320 was drawn 1.36 times larger than it was: soft, beside the
-- members' own photographs. The app cuts a member's thumbnail with its
-- short side at 540 pixels and its long side following the shape, up to
-- twice the short side (src/uploads/thumbSize.ts, THUMB_SHORT and
-- THUMB_LONG_MAX). picsum.photos serves a photograph at any size asked
-- for in its address (/id/<picture>/<width>/<height>), cut from the
-- middle of it, so each such thumbnail is asked for at that size instead:
-- the same picture and the same shape as the photograph it stands for
-- (its size read from the photograph's own address), 810 by 540 for a
-- 1200 by 800 photograph, 540 by 675 for 1200 by 1500. Never larger than
-- the photograph: one whose short side is under 540 pixels is left as
-- it is. About 40 KB a thumbnail where it was 20, when checked on 6
-- November 2026; the photograph itself is still a separate, larger file.
--
-- Only house accounts' photographs, only addresses of exactly these
-- shapes, and for picsum only where the thumbnail is the same picture as
-- the photograph: a member's own photographs and any other row are never
-- changed. Idempotent: run again, nothing matches (a Wikimedia thumbnail
-- is no longer the photograph; a picsum one is already at its size). On
-- a project whose house photographs are seeded after the migrations
-- (supabase/production/08_house_accounts.sql), run this file again after
-- the seed.
--
-- No table, column or policy changes. No begin or commit of its own.
--
-- Rollback (the thumbnail back to the full picture, for the Wikimedia
-- rows this changed; the picsum ones back to 480 pixels wide, within a
-- pixel of their old height):
--   update public.posts p set thumb_path = p.media_path
--   from public.profiles a
--   where a.id = p.author_id and a.is_house
--     and p.thumb_path <> p.media_path
--     and p.media_path ~ '^https://(thumb|upload)\.wikimedia\.org/wikipedia/commons/'
--     and p.thumb_path ~ '/500px-[^/]+$';
--   update public.posts p
--   set thumb_path = regexp_replace(p.media_path, '/([0-9]+)/([0-9]+)$', '')
--     || '/480/' || round(480.0 * split_part(p.media_path, '/', 7)::int / split_part(p.media_path, '/', 6)::int)
--   from public.profiles a
--   where a.id = p.author_id and a.is_house
--     and p.media_path ~ '^https://picsum\.photos/id/[0-9]+/[0-9]+/[0-9]+$'
--     and p.thumb_path ~ '^https://picsum\.photos/id/[0-9]+/[0-9]+/[0-9]+$';

-- thumb.wikimedia.org's 1920-pixel renderings.
update public.posts p
set thumb_path = regexp_replace(p.media_path, '/1920px-([^/]+)$', '/500px-\1')
from public.profiles a
where a.id = p.author_id
  and a.is_house
  and p.thumb_path = p.media_path
  and p.media_path ~ '^https://thumb\.wikimedia\.org/wikipedia/commons/thumb/[0-9a-f]/[0-9a-f]{2}/[^/]+/1920px-[^/]+$';

-- upload.wikimedia.org's originals.
update public.posts p
set thumb_path = regexp_replace(
  p.media_path,
  '^https://upload\.wikimedia\.org/wikipedia/commons/([0-9a-f])/([0-9a-f]{2})/([^/]+)$',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/\1/\2/\3/500px-\3')
from public.profiles a
where a.id = p.author_id
  and a.is_house
  and p.thumb_path = p.media_path
  and p.media_path ~ '^https://upload\.wikimedia\.org/wikipedia/commons/[0-9a-f]/[0-9a-f]{2}/[^/]+$';

-- picsum.photos's thumbnails, at the size the app cuts a member's: the
-- short side at 540 pixels, the long side following the photograph's
-- shape up to 1080 (src/uploads/thumbSize.ts). Sizes are read from the
-- photograph's own address, /id/<picture>/<width>/<height>.
with picsum as (
  select p.id, m[1] as picture, m[2]::int as w, m[3]::int as h
  from public.posts p
  join public.profiles a on a.id = p.author_id
  cross join lateral regexp_match(p.media_path, '^https://picsum\.photos/id/([0-9]+)/([0-9]+)/([0-9]+)$') m
  where a.is_house
    and m is not null
    and p.thumb_path ~ '^https://picsum\.photos/id/[0-9]+/[0-9]+/[0-9]+$'
    and split_part(p.thumb_path, '/', 5) = m[1]
),
sized as (
  select id, picture, w, h,
         least(1080, ceil(540.0 * greatest(w, h) / least(w, h)))::int as long_side
  from picsum
  where least(w, h) >= 540
),
asked as (
  select id,
         'https://picsum.photos/id/' || picture || '/' ||
         case when w >= h
              then long_side || '/' || (case when long_side < 1080 then 540 else round(1080.0 * h / w)::int end)
              else (case when long_side < 1080 then 540 else round(1080.0 * w / h)::int end) || '/' || long_side
         end as thumb
  from sized
)
update public.posts p
set thumb_path = asked.thumb
from asked
where p.id = asked.id
  and p.thumb_path is distinct from asked.thumb;
