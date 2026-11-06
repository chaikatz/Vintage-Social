-- 0034 over the house seed (supabase/production/08_house_accounts.sql,
-- which the runner applies after the migrations, as production had it
-- before 0034): the 229 house photographs whose thumbnail is the full
-- picture get Wikimedia's 960-pixel rendering instead, the picsum ones a
-- thumbnail cut as the app cuts a member's (short side 540, the
-- photograph's shape), and nothing else changes. Runs in one transaction
-- and rolls back.

begin;

create temp table thumbs_start as select coalesce(max(seq), 0) as seq from tests.results;

-- Two members' own photographs whose thumbnail is their picture, at a
-- Wikimedia address of each shape 0034 rewrites (an original, and
-- thumb.wikimedia.org's 1920-pixel rendering): not a house account's, so
-- never touched, by either of its two updates.
insert into public.posts (id, author_id, media_type, media_path, thumb_path, filter_id) values
  ('f5000000-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'photo',
   'https://upload.wikimedia.org/wikipedia/commons/a/ab/A_member%27s_own.jpg',
   'https://upload.wikimedia.org/wikipedia/commons/a/ab/A_member%27s_own.jpg', 'kodachrome'),
  ('f5000000-0000-4000-8000-000000000002', '22222222-2222-2222-2222-222222222222', 'photo',
   'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cd/A_member%27s_rendering.jpg/1920px-A_member%27s_rendering.jpg',
   'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cd/A_member%27s_rendering.jpg/1920px-A_member%27s_rendering.jpg',
   'kodachrome');

-- A member's own photograph at picsum, with a 480-pixel thumbnail: not a
-- house account's, never touched. And three house photographs the picsum
-- part must think about: a panorama (its long side stops at 1080), one
-- smaller than the standard size (left as it is, never enlarged), and one
-- whose thumbnail is another picture (left as it is).
insert into public.posts (id, author_id, media_type, media_path, thumb_path, width, height, filter_id) values
  ('f5000000-0000-4000-8000-000000000003', '22222222-2222-2222-2222-222222222222', 'photo',
   'https://picsum.photos/id/10/1200/800', 'https://picsum.photos/id/10/480/320', 1200, 800, 'kodachrome'),
  ('f5000000-0000-4000-8000-000000000004', '00000001-0000-4000-8000-000000000000', 'photo',
   'https://picsum.photos/id/11/1800/600', 'https://picsum.photos/id/11/480/160', 1800, 600, 'kodachrome'),
  ('f5000000-0000-4000-8000-000000000005', '00000001-0000-4000-8000-000000000000', 'photo',
   'https://picsum.photos/id/12/800/500', 'https://picsum.photos/id/12/480/300', 800, 500, 'kodachrome'),
  ('f5000000-0000-4000-8000-000000000006', '00000001-0000-4000-8000-000000000000', 'photo',
   'https://picsum.photos/id/13/1200/800', 'https://picsum.photos/id/14/480/320', 1200, 800, 'kodachrome');

create temp table thumbs_before as
select p.id, p.media_path, p.thumb_path, a.is_house from public.posts p join public.profiles a on a.id = p.author_id;

\o /dev/null
\ir ../migrations/0034_seed_thumbnails_at_a_standard_width.sql
\o

create temp table thumbs_changed as
select b.id, b.is_house, b.media_path, b.thumb_path as old_thumb, p.thumb_path as new_thumb, p.media_path as media_now
from thumbs_before b join public.posts p using (id)
where p.thumb_path is distinct from b.thumb_path;

create temp table wiki_changed as
select * from thumbs_changed where media_path ~ '^https://(thumb|upload)\.wikimedia\.org/';
create temp table picsum_changed as
select c.*,
       split_part(new_thumb, '/', 6)::int as tw, split_part(new_thumb, '/', 7)::int as th,
       split_part(media_path, '/', 6)::int as mw, split_part(media_path, '/', 7)::int as mh
from thumbs_changed c where media_path ~ '^https://picsum\.photos/';

insert into tests.results (name, expected, actual) values
  ('0034: every row it changes is a Wikimedia or a picsum photograph''s', '0',
   (select count(*)::text from thumbs_changed
     where media_path !~ '^https://(thumb|upload)\.wikimedia\.org/' and media_path !~ '^https://picsum\.photos/')),
  ('0034: the 229 house photographs whose thumbnail was the full picture get a thumbnail', '229',
   (select count(*)::text from wiki_changed)),
  ('0034: all of them house photographs, none a member''s', '229,0',
   (select count(*) filter (where is_house)::text || ',' || count(*) filter (where not is_house)::text from wiki_changed)),
  ('0034: the photograph itself is not touched', '0',
   (select count(*)::text from thumbs_changed where media_now is distinct from media_path)),
  ('0034: each was the full picture, and is now Wikimedia''s 960-pixel rendering of it', '229',
   (select count(*)::text from wiki_changed
     where old_thumb = media_path
       and new_thumb ~ '^https://(thumb|upload)\.wikimedia\.org/wikipedia/commons/thumb/[0-9a-f]/[0-9a-f]{2}/[^/]+/960px-[^/]+$')),
  ('0034: 176 from thumb.wikimedia.org''s 1920-pixel rendering, 53 from originals', '176,53',
   (select count(*) filter (where media_path ~ '/1920px-')::text || ',' ||
           count(*) filter (where media_path ~ '^https://upload\.wikimedia\.org/wikipedia/commons/[0-9a-f]/')::text
      from wiki_changed)),
  ('0034: the same file, only its width changed', '0',
   (select count(*)::text from wiki_changed
     where split_part(new_thumb, '/960px-', 2) <> regexp_replace(media_path, '^.*/(1920px-)?', ''))),
  ('0034: one rendering, as Wikimedia addresses it', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/20/Vintage_Bentley_at_the_car_show%2C_Boscawen_Street%2C_Truro%2C_Cornwall_-_July_2024.jpg/960px-Vintage_Bentley_at_the_car_show%2C_Boscawen_Street%2C_Truro%2C_Cornwall_-_July_2024.jpg',
   coalesce((select new_thumb from thumbs_changed where id = '00000001-0000-4000-8001-000000000002'), '<unchanged>')),
  ('0034: and one original''s', 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Texas_%26_Pacific%2C_Maintenance_of_Way_Flat_Car_No._X-943_%2821272131504%29.jpg/960px-Texas_%26_Pacific%2C_Maintenance_of_Way_Flat_Car_No._X-943_%2821272131504%29.jpg',
   coalesce((select new_thumb from thumbs_changed where id = '00000001-0000-4000-8001-000000000001'), '<unchanged>')),
  ('0034: no house photograph is left with its full picture as its thumbnail', '0',
   (select count(*)::text from public.posts p join public.profiles a on a.id = p.author_id
     where a.is_house and p.thumb_path = p.media_path and p.media_path ~ '^https://(thumb|upload)\.wikimedia\.org/')),
  ('0034: the members'' own photographs are as they were, an original''s and a rendering''s', 'true,true',
   (select string_agg((thumb_path = media_path)::text, ',' order by id) from public.posts
     where id in ('f5000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000002'))),
  -- picsum
  ('0034: the house picsum photographs, every one, get a new thumbnail, none a member''s',
   (select count(*)::text from thumbs_before where is_house and media_path ~ '^https://picsum\.photos/id/[0-9]+/[0-9]+/[0-9]+$'
      and split_part(thumb_path, '/', 5) = split_part(media_path, '/', 5) and least(split_part(media_path, '/', 6)::int, split_part(media_path, '/', 7)::int) >= 540) || ',0',
   (select count(*) filter (where is_house)::text || ',' || count(*) filter (where not is_house)::text from picsum_changed)),
  ('0034: the seed''s picsum photographs are most of the house''s (as on production, 679)', 'true',
   ((select count(*) from picsum_changed) > 500)::text),
  ('0034: each picsum thumbnail''s short side is 540 pixels, its long side under 1080 bar a panorama''s', '0',
   (select count(*)::text from picsum_changed
     where least(tw, th) <> 540 and id <> 'f5000000-0000-4000-8000-000000000004')),
  ('0034: the same picture, at the photograph''s own shape (within a pixel)', '0',
   (select count(*)::text from picsum_changed
     where split_part(new_thumb, '/', 5) <> split_part(media_path, '/', 5)
        or abs(tw::numeric * mh - th::numeric * mw) > greatest(mw, mh))),
  ('0034: never larger than the photograph', '0',
   (select count(*)::text from picsum_changed where tw > mw or th > mh)),
  ('0034: a 1200 by 800 photograph''s thumbnail is 810 by 540, a 1200 by 1500 one''s 540 by 675', '810/540,540/675',
   (select string_agg(distinct tw || '/' || th, ',' order by tw || '/' || th desc) from picsum_changed
     where (mw, mh) in ((1200, 800), (1200, 1500)))),
  ('0034: one, as picsum addresses it', 'https://picsum.photos/id/764/720/540',
   coalesce((select new_thumb from picsum_changed where id = '00000001-0000-4000-8001-000000000000'), '<unchanged>')),
  ('0034: a panorama''s long side stops at 1080, its short side follows the shape', 'https://picsum.photos/id/11/1080/360',
   (select thumb_path from public.posts where id = 'f5000000-0000-4000-8000-000000000004')),
  ('0034: one smaller than the standard size, and one whose thumbnail is another picture, are left as they were',
   'https://picsum.photos/id/12/480/300,https://picsum.photos/id/14/480/320',
   (select string_agg(thumb_path, ',' order by id) from public.posts
     where id in ('f5000000-0000-4000-8000-000000000005', 'f5000000-0000-4000-8000-000000000006'))),
  ('0034: the member''s own picsum photograph keeps its thumbnail', 'https://picsum.photos/id/10/480/320',
   (select thumb_path from public.posts where id = 'f5000000-0000-4000-8000-000000000003')),
  ('0034: no house picsum thumbnail is left under the standard size', '0',
   (select count(*)::text from public.posts p join public.profiles a on a.id = p.author_id
     where a.is_house and p.thumb_path ~ '^https://picsum\.photos/id/[0-9]+/[0-9]+/[0-9]+$'
       and least(split_part(p.thumb_path, '/', 6)::int, split_part(p.thumb_path, '/', 7)::int) < 540
       and least(split_part(p.media_path, '/', 6)::int, split_part(p.media_path, '/', 7)::int) >= 540
       and split_part(p.thumb_path, '/', 5) = split_part(p.media_path, '/', 5)
       and p.id <> 'f5000000-0000-4000-8000-000000000004'));

create temp table thumbs_once as select id, thumb_path from public.posts;
\o /dev/null
\ir ../migrations/0034_seed_thumbnails_at_a_standard_width.sql
\o
insert into tests.results (name, expected, actual) values
  ('0034: applied again, it changes nothing', '0',
   (select count(*)::text from public.posts p join thumbs_once o using (id) where p.thumb_path is distinct from o.thumb_path));

\pset border 2
select r.seq, r.name, r.expected, r.actual,
       case when r.expected = r.actual then 'pass' else 'FAIL' end as status
from tests.results r, thumbs_start s
where r.seq > s.seq
order by r.seq;

do $verdict$
declare v_failed int;
begin
  select count(*) into v_failed from tests.results r, thumbs_start s
   where r.seq > s.seq and r.expected is distinct from r.actual;
  if v_failed > 0 then
    raise exception '% seed thumbnail checks FAILED', v_failed;
  end if;
  raise notice 'seed thumbnail checks passed';
end
$verdict$;

rollback;
