-- VINTAGE · 0004 · storage buckets and policies
--
-- Three public-read buckets. Object paths are namespaced by user id
-- ({user_id}/filename), and every write policy checks that the first path
-- segment is the caller's uid — no member can touch another member's files.
--
-- Note: bucket contents are public-read (paths contain unguessable UUIDs).
-- If fully private media is required later, flip `public` to false and move
-- the client to signed URLs.

insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('media', 'media', true),
  ('thumbnails', 'thumbnails', true)
on conflict (id) do nothing;

-- Applicants upload an avatar before they are approved, so avatar writes
-- only require authentication. Post media requires active membership.

create policy "avatars: upload own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars: update own folder" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "media: upload own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('media', 'thumbnails')
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_active_member(auth.uid())
  );

create policy "media: update own folder" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('media', 'thumbnails')
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_active_member(auth.uid())
  )
  with check (
    bucket_id in ('media', 'thumbnails')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "media: delete own folder" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('media', 'thumbnails')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
