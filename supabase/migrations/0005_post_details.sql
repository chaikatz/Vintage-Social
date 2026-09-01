-- ---------------------------------------------------------------------------
-- Post details: when the photograph was taken, and where.
--
-- `taken_at` is the capture date read from the file's EXIF at publish time,
-- not the moment the post was made. It is what the amber date stamp shows —
-- a stamp that read "today" on a photograph from last summer was a lie. Null
-- when the source carried no capture date (screenshots, most videos, files
-- stripped of metadata); the stamp falls back to `created_at` then.
--
-- `location` is free text the author types, not a coordinate. VINTAGE does
-- not read your GPS, place you on a map, or make a place searchable — it is
-- a caption line, the way you would write a town on the back of a print.
-- ---------------------------------------------------------------------------
alter table public.posts
  add column taken_at timestamptz,
  add column location text check (location is null or char_length(location) <= 80);
