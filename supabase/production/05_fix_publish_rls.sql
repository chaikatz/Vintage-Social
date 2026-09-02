-- VINTAGE · production · fix publishing (applies migration 0009)
--
-- Symptom: an approved member taps "Share to VINTAGE" and gets
--   "Couldn't publish — new row violates row-level security policy"
--
-- Cause: the client uploads with `upsert`, which the storage API turns into
-- `insert ... on conflict (bucket_id, name) do update`. PostgreSQL applies
-- the SELECT policy to that statement because it has to look at the
-- conflicting row — and storage.objects had no SELECT policy at all, so the
-- statement was refused before any conflict could even occur.
--
-- This is the exact contents of supabase/migrations/0009_storage_read_own.sql.
-- It only ADDS two read policies. It revokes nothing, relaxes no existing
-- policy, and touches no data. Safe to re-run.
--
-- Paste into the Supabase SQL Editor and run. Then run 06_verify_publish.sql.

drop policy if exists "avatars: read own folder" on storage.objects;
create policy "avatars: read own folder" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "media: read own folder" on storage.objects;
create policy "media: read own folder" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('media', 'thumbnails')
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_active_member(auth.uid())
  );
