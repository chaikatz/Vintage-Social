-- VINTAGE · 0009 · let a member read back their own storage rows
--
-- Publishing failed with "new row violates row-level security policy" even
-- for an approved member uploading into their own folder.
--
-- The write policies in 0004 were correct. What was missing was a SELECT
-- policy. The client uploads with `upsert`, which the storage API turns
-- into
--
--   insert into storage.objects (...) values (...)
--   on conflict (bucket_id, name) do update set ...
--
-- and PostgreSQL applies the SELECT policy to an ON CONFLICT DO UPDATE,
-- because the statement has to look at the conflicting row. With no SELECT
-- policy on storage.objects at all, that lookup is invisible to the caller
-- and the whole statement is refused — before any conflict actually
-- happens, so even the very first upload of a brand-new key fails. A plain
-- insert of the identical row passes, which is what made this look like a
-- policy-expression bug rather than a missing policy.
--
-- Avatars genuinely need the upsert: the path is {uid}/avatar.jpg, so
-- changing your picture overwrites it.
--
-- The grant is the narrowest thing that works: you may read the rows for
-- files in your own folder. Not another member's folder, not a listing of
-- the bucket. Downloads are unaffected either way — the buckets are
-- public-read and served without consulting this table.

-- Applicants upload an avatar before they are approved, so reading their
-- own avatar row only requires authentication — the same condition as the
-- matching insert policy in 0004.
drop policy if exists "avatars: read own folder" on storage.objects;
create policy "avatars: read own folder" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Post media mirrors its insert policy exactly, membership check included,
-- so a suspended member cannot overwrite their media either.
drop policy if exists "media: read own folder" on storage.objects;
create policy "media: read own folder" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('media', 'thumbnails')
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_active_member(auth.uid())
  );
