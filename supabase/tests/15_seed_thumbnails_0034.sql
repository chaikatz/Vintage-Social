-- 0034 over the house seed (supabase/production/08_house_accounts.sql,
-- which the runner applies after the migrations, as production had it
-- before 0034): the 229 house photographs whose thumbnail is the full
-- picture get Wikimedia's 500-pixel rendering instead, and nothing else
-- changes. Runs in one transaction and rolls back.

begin;

create temp table thumbs_start as select coalesce(max(seq), 0) as seq from tests.results;

-- A member's own photograph whose thumbnail is its picture, at a
-- Wikimedia address: not a house account's, so never touched.
insert into public.posts (id, author_id, media_type, media_path, thumb_path, filter_id) values
  ('f5000000-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'photo',
   'https://upload.wikimedia.org/wikipedia/commons/a/ab/A_member%27s_own.jpg',
   'https://upload.wikimedia.org/wikipedia/commons/a/ab/A_member%27s_own.jpg', 'kodachrome');

create temp table thumbs_before as
select p.id, p.media_path, p.thumb_path, a.is_house from public.posts p join public.profiles a on a.id = p.author_id;

\o /dev/null
\ir ../migrations/0034_seed_thumbnails_at_a_standard_width.sql
\o

create temp table thumbs_changed as
select b.id, b.is_house, b.media_path, b.thumb_path as old_thumb, p.thumb_path as new_thumb, p.media_path as media_now
from thumbs_before b join public.posts p using (id)
where p.thumb_path is distinct from b.thumb_path;

insert into tests.results (name, expected, actual) values
  ('0034: the 229 house photographs whose thumbnail was the full picture get a thumbnail', '229',
   (select count(*)::text from thumbs_changed)),
  ('0034: all of them house photographs, none a member''s', '229,0',
   (select count(*) filter (where is_house)::text || ',' || count(*) filter (where not is_house)::text from thumbs_changed)),
  ('0034: the photograph itself is not touched', '0',
   (select count(*)::text from thumbs_changed where media_now is distinct from media_path)),
  ('0034: each was the full picture, and is now Wikimedia''s 500-pixel rendering of it', '229',
   (select count(*)::text from thumbs_changed
     where old_thumb = media_path
       and new_thumb ~ '^https://(thumb|upload)\.wikimedia\.org/wikipedia/commons/thumb/[0-9a-f]/[0-9a-f]{2}/[^/]+/500px-[^/]+$')),
  ('0034: 176 from thumb.wikimedia.org''s 1920-pixel rendering, 53 from originals', '176,53',
   (select count(*) filter (where media_path ~ '/1920px-')::text || ',' ||
           count(*) filter (where media_path ~ '^https://upload\.wikimedia\.org/wikipedia/commons/[0-9a-f]/')::text
      from thumbs_changed)),
  ('0034: the same file, only its width changed', '0',
   (select count(*)::text from thumbs_changed
     where split_part(new_thumb, '/500px-', 2) <> regexp_replace(media_path, '^.*/(1920px-)?', ''))),
  ('0034: one rendering, as Wikimedia addresses it', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/20/Vintage_Bentley_at_the_car_show%2C_Boscawen_Street%2C_Truro%2C_Cornwall_-_July_2024.jpg/500px-Vintage_Bentley_at_the_car_show%2C_Boscawen_Street%2C_Truro%2C_Cornwall_-_July_2024.jpg',
   coalesce((select new_thumb from thumbs_changed where id = '00000001-0000-4000-8001-000000000002'), '<unchanged>')),
  ('0034: and one original''s', 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Texas_%26_Pacific%2C_Maintenance_of_Way_Flat_Car_No._X-943_%2821272131504%29.jpg/500px-Texas_%26_Pacific%2C_Maintenance_of_Way_Flat_Car_No._X-943_%2821272131504%29.jpg',
   coalesce((select new_thumb from thumbs_changed where id = '00000001-0000-4000-8001-000000000001'), '<unchanged>')),
  ('0034: no house photograph is left with its full picture as its thumbnail', '0',
   (select count(*)::text from public.posts p join public.profiles a on a.id = p.author_id
     where a.is_house and p.thumb_path = p.media_path and p.media_path ~ '^https://(thumb|upload)\.wikimedia\.org/')),
  ('0034: the member''s own photograph is as it was', 'true',
   (select (thumb_path = media_path)::text from public.posts where id = 'f5000000-0000-4000-8000-000000000001'));

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
