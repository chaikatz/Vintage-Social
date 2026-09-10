-- ---------------------------------------------------------------------------
-- Whether a video carries its film in its pixels.
--
-- Photographs have always been baked at publish time: the filter is applied
-- on the phone and the uploaded JPEG already wears it. Video was not, so the
-- app overlaid the look at play time — and the overlay was unreliable on
-- iOS. Video is now baked on the phone too, where the build can do it.
--
-- `filter_baked` says which it was for this post. True: play the file as it
-- is. False: the file is the original footage and the filter still has to
-- be applied on screen — which is every video posted before this column
-- existed, and any posted from a platform that cannot bake.
--
-- Additive only: a defaulted column, no rows touched, no policy changed.
-- ---------------------------------------------------------------------------
alter table public.posts
  add column filter_baked boolean not null default false;
