-- VINTAGE · staging · does it all actually work?
--
-- Read-only. Checks what the app will show before you go looking for it on
-- a phone, and reads it the way the app does — as an ordinary approved
-- member, through row-level security, not as the owner.
--
-- Run after the house seed, the founder bootstrap and the videos.

do $verify$
declare
  v_me          uuid;
  r             record;
  v_feed        int;
  v_explore     int;
  v_search      int;
  v_video       int;
  v_liked       int;
  v_commented   int;
  v_private     int;
  out_lines     text := '';
  function_ok   boolean;
begin
  select id into v_me from public.profiles
   where not is_house and status = 'approved' order by member_no limit 1;
  if v_me is null then
    raise exception 'No approved human member yet — run 01_bootstrap_founder.sql first.';
  end if;

  -- Everything below runs as that member, so what it counts is exactly what
  -- their app would be able to load.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_me::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- Feed: your own posts plus the accounts you follow. A brand new member
  -- follows nobody, so an empty feed here is correct, not a fault — Explore
  -- is the surface that should be full.
  select count(*) into v_feed from public.posts
   where author_id = v_me or author_id in (
     select followee_id from public.follows where follower_id = v_me and status = 'accepted');

  select count(*) into v_explore from public.posts where author_id <> v_me and removed_at is null;
  select count(*) into v_search  from public.profiles where status = 'approved';
  select count(*) into v_video   from public.posts where media_type = 'video';
  select count(*) into v_liked   from public.posts where like_count > 0;
  select count(*) into v_commented from public.posts where comment_count > 0;
  select count(*) into v_private from public.posts p
    join public.profiles a on a.id = p.author_id
   where a.is_private and a.id <> v_me;

  execute 'reset role';

  raise notice ' ';
  raise notice 'Read as an ordinary member, through RLS:';
  raise notice '  feed (own + followed)     %', v_feed;
  raise notice '  explore (everyone else)   %', v_explore;
  raise notice '  searchable members        %', v_search;
  raise notice '  video posts               %', v_video;
  raise notice '  posts with likes          %', v_liked;
  raise notice '  posts with comments       %', v_commented;
  raise notice '  private accounts'' posts   % (must be 0)', v_private;
end
$verify$;

-- Membership numbering: the thing that must not have gone wrong.
select
  (select count(*) from public.profiles where is_house)                            as house_accounts,
  (select count(*) from public.profiles where is_house and member_no is not null)  as house_with_numbers,
  (select count(*) from public.profiles where not is_house)                        as real_accounts,
  (select string_agg(username || ' = no. ' || lpad(member_no::text, 5, '0'), ', ' order by member_no)
     from public.profiles where not is_house and member_no is not null)            as real_members,
  -- last_value alone is ambiguous: it reads 1 both before the first number
  -- is drawn and just after. is_called is what tells the two apart.
  (select case when is_called then last_value + 1 else last_value end
     from public.member_no_seq)                                                    as next_number_will_be;

-- Content, for a sense of whether it will look alive.
select
  (select count(*) from public.posts)                          as posts,
  (select count(*) from public.posts where media_type='video') as videos,
  (select count(*) from public.follows)                        as follows,
  (select count(*) from public.likes)                          as likes,
  (select count(*) from public.comments)                       as comments,
  (select count(*) from public.profiles where is_private)      as private_accounts,
  (select round(avg(post_count), 1) from public.profiles where is_house) as avg_posts_per_account;

-- Nobody can sign in as a house account: no password, no identity row.
select count(*) filter (where encrypted_password is not null) as house_with_passwords,
       count(*)                                               as house_auth_rows
from auth.users where raw_app_meta_data->>'provider' = 'house';
