-- VINTAGE · production · the share-media server key
--
-- The picture behind a share link (/s/<token>/media) is streamed by our
-- Vercel function, which asks the database for the file through
-- shared_post_media(token, key). The function answers only when the key's
-- SHA-256 matches this row. The key itself lives in one place besides
-- your head: the Vercel environment variable SHARE_MEDIA_KEY (server-only;
-- no EXPO_PUBLIC_ prefix, so it is never in any app or web bundle).
--
-- Once, per project (staging, then production):
--   1. Make a key on your Mac:        openssl rand -hex 32
--   2. Vercel → project → Settings → Environment Variables →
--      SHARE_MEDIA_KEY = <the key>, Production (and Preview), then redeploy.
--   3. Paste the same key below in place of PASTE_KEY_HERE and run this
--      file in the Supabase SQL editor. Only the hash is stored.
--
-- Rotating: repeat 1–3 with a new key. Nothing else changes.
-- Never commit this file with a real key in it.

insert into public.app_settings (key, value, updated_at)
values (
  'share_media_key',
  jsonb_build_object('sha256', encode(sha256(convert_to('PASTE_KEY_HERE', 'UTF8')), 'hex')),
  now()
)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Check: one row, a 64-character hash, and no key anywhere.
select key, length(value ->> 'sha256') as hash_length, updated_at
from public.app_settings where key = 'share_media_key';
