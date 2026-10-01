-- ---------------------------------------------------------------------------
-- 0020: every photograph posted so far was baked.
--
-- `filter_baked` (0014) was added for video and defaulted to false, which
-- was right for clips: every one posted before it existed carried its
-- film at play time. Photographs were different — the darkroom has always
-- baked the filter into a photograph's pixels before upload — but their
-- rows kept the default, so they read as unbaked too. That did not matter
-- while nothing looked at the column for photographs.
--
-- The compose screen can now post a photograph *unbaked* when the filter
-- renderer fails on the phone, rather than refusing the post, and marks
-- it filter_baked = false so the film is applied on screen. For that to
-- mean anything, the photographs that were baked must say so. This sets
-- them straight. Safe to re-run: it only touches rows that still read
-- false, and there is nothing to undo — the pixels of those files have
-- always carried their film.
-- ---------------------------------------------------------------------------
update public.posts
   set filter_baked = true
 where media_type = 'photo'
   and filter_baked = false;
