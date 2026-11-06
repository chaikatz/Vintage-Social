-- VINTAGE · 0035 · a member's own photograph files, whatever their membership
--
-- Delete my account removes a member's files through the Storage API
-- before it closes the account (src/api/account.ts): it lists their
-- folder in the media, thumbnails and avatars buckets and removes what it
-- finds, because the database's own backstop (delete_my_account, 0018)
-- deletes only the rows of files still there, not the bytes, and the
-- buckets are public by address.
--
-- Storage lists through a read of storage.objects, and removes with a
-- delete that must first see the rows, so both go through the read
-- policies. "media: read own folder" (0009, 0023) asked that the reader
-- be an active member. A suspended member, who is offered Delete my
-- account on the waiting screen, listed their own media and thumbnails
-- folders as empty and removed nothing: the deletion went on, the rows
-- went with the account, and the photographs' bytes stayed in the public
-- buckets for good. The Privacy Policy says deleting an account removes
-- its photographs, suspended or not.
--
-- So a member reads the rows of their own folder in those two buckets
-- whatever their membership, as they already do in avatars (0009, an
-- applicant's own picture). Their own folder only, never another
-- member's, never a listing of the bucket. Nothing else changes: putting
-- a file there or changing one still needs an active member ("media:
-- upload own folder", "media: update own folder"), so a suspended member
-- cannot publish or overwrite anything, an upsert included (it is refused
-- by those policies, not this one); removing their own files was always
-- allowed ("media: delete own folder"), it only could not find them.
-- What it shows was never secret: the files are public by address, and
-- these are the member's own.
--
-- The caller is read once a statement, as 0023 made every policy do.
--
-- 0023's rollback (supabase/tests/0023_rollback.sql) puts this policy
-- back as 0009 made it, with the membership check. If 0023 is ever
-- rolled back, apply this file again after it.
--
-- lock_timeout, as in 0023. One policy replaced; nothing else changes.
-- No begin or commit of its own. Idempotent.
--
-- Rollback (as 0023 left it):
--   drop policy if exists "media: read own folder" on storage.objects;
--   create policy "media: read own folder" on storage.objects
--     for select to authenticated
--     using (
--       bucket_id in ('media', 'thumbnails')
--       and (storage.foldername(name))[1] = (select auth.uid())::text
--       and (select public.is_active_member((select auth.uid())))
--     );

set local lock_timeout = '5s';

drop policy if exists "media: read own folder" on storage.objects;
create policy "media: read own folder" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('media', 'thumbnails')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
