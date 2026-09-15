-- VINTAGE · production · the App Review account
--
-- Apple must be able to walk through a membership-gated app without waiting
-- for an invitation or an approval. This creates one approved account for
-- them — a guest of the club, not a member of the founding run (no
-- membership number is issued) — following the twelve most-published house
-- accounts so the feed has something in it, and holding an invitation code
-- (`applereview`) they can hand to a second account to test the door.
--
-- Nothing about membership security changes for anyone else. There is no
-- special role, flag, or bypass: the reviewer is an ordinary approved
-- member whose password was set here instead of at sign-up.
--
-- Applied to production on 2026-09-15. To rotate the password, run the
-- UPDATE at the bottom with a new value. The password itself is not in this
-- repository; it lives in App Store Connect → App Review Information.

-- ---------------------------------------------------------------------------
-- create (run once; raises if the account exists)
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid := gen_random_uuid();
  v_email text := 'appreview@vintagesocial.app';
  v_pass text := :'password';   -- psql variable; paste the value when running by hand
  v_house uuid;
begin
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'reviewer already exists';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(v_pass, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('username', 'app_review', 'full_name', 'App Review'),
    now(), now(), '', '', '', '', '', '', '', '', false, false);
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id::text, v_id,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now());

  update public.profiles
    set status = 'approved', bio = 'Reviewing VINTAGE for the App Store.', city = 'Cupertino', invite_quota = 5
    where id = v_id;

  for v_house in select id from public.profiles where is_house and status = 'approved' order by post_count desc limit 12 loop
    insert into public.follows (follower_id, followee_id, status) values (v_id, v_house, 'accepted') on conflict do nothing;
    perform public.recount_follows(v_id, v_house);
  end loop;

  insert into public.invite_links (owner_id, slug) values (v_id, 'applereview')
    on conflict (owner_id) do update set slug = 'applereview';
end $$;

-- ---------------------------------------------------------------------------
-- rotate the password
-- ---------------------------------------------------------------------------
-- update auth.users
--   set encrypted_password = extensions.crypt('NEW-PASSWORD', extensions.gen_salt('bf')), updated_at = now()
--   where email = 'appreview@vintagesocial.app';

-- ---------------------------------------------------------------------------
-- remove the account after approval, if wanted
-- ---------------------------------------------------------------------------
-- delete from auth.users where email = 'appreview@vintagesocial.app';
