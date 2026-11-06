-- VINTAGE · 0034 · the house photographs' grid squares at a grid's size
--
-- Data only. 229 of the house accounts' photographs (the seed, from
-- Wikimedia Commons) have the full-size picture as their thumbnail
-- (thumb_path = media_path): 176 are Wikimedia's 1920-pixel rendering
-- (thumb.wikimedia.org/.../1920px-<name>) and 53 the original file
-- (upload.wikimedia.org/wikipedia/commons/<a>/<ab>/<name>, 1400 pixels
-- wide or more). Every grid square, Activity row, message preview and
-- gallery stand-in that shows one downloads that whole picture: a few
-- hundred kilobytes to a few megabytes for a square about 130 points
-- wide. The seed asked Wikimedia for 480-pixel thumbnails, but Wikimedia
-- now serves only its standard widths and the seed's rewrite never
-- matched, so the thumbnail was left as the full picture. The other
-- house photographs (picsum.photos) have 480-pixel thumbnails already.
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
-- Only house accounts' photographs, only where the thumbnail is the
-- full picture, only URLs of exactly these two shapes: a member's own
-- photographs and any other row are never changed. Idempotent: run again,
-- nothing matches (the thumbnail is no longer the photograph). On a
-- project whose house photographs are seeded after the migrations
-- (supabase/production/08_house_accounts.sql), run this file again after
-- the seed.
--
-- No table, column or policy changes. No begin or commit of its own.
--
-- Rollback (the thumbnail back to the full picture, for the rows this
-- changed):
--   update public.posts p set thumb_path = p.media_path
--   from public.profiles a
--   where a.id = p.author_id and a.is_house
--     and p.thumb_path <> p.media_path
--     and p.media_path ~ '^https://(thumb|upload)\.wikimedia\.org/wikipedia/commons/'
--     and p.thumb_path ~ '/500px-[^/]+$';

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
