-- VINTAGE · staging · make yourself an approved admin
--
-- Staging only. Production's founder is bootstrapped by
-- supabase/production/04_bootstrap_founder.sql, which is far stricter
-- because there the number is permanent and the account is real.
--
-- Before running this: open the app pointed at staging (npm run use:staging)
-- and sign up through it — "Apply for membership" or a nomination code,
-- either is fine. Sign-up is the only thing that can create the auth user,
-- and it means your staging password is yours and is never typed into a
-- file or a chat window.
--
-- Then edit the username below and run this once.

do $bootstrap$
declare
  v_username text := 'your.username';   -- <<< EDIT THIS
  v_user     uuid;
  v_house    boolean;
  v_no       integer;
begin
  select id, is_house into v_user, v_house
  from public.profiles where username = lower(v_username);

  if v_user is null then
    raise exception
      'No profile called "%". Sign up through the app first, pointed at staging.', v_username;
  end if;
  if v_house then
    raise exception
      '"%" is a house account. Use the username you signed up with, not a seeded one.', v_username;
  end if;

  update public.profiles
  set role         = 'admin',
      status       = 'approved',
      approved_at  = coalesce(approved_at, now()),
      invite_quota = 50
  where id = v_user;

  -- Any application you left behind is marked decided, so the admin queue
  -- is not showing your own name back at you.
  update public.applications
  set status = 'approved', decided_by = v_user, decided_at = now()
  where user_id = v_user and status = 'pending';

  -- House accounts never draw a number, so this is 1 on a fresh staging
  -- database no matter how many of them are seeded — which is the whole
  -- behaviour worth checking here before it matters in production.
  v_no := public.assign_member_no(v_user);

  raise notice 'Done. % is now an approved admin, member no. %', v_username, lpad(v_no::text, 5, '0');
end
$bootstrap$;

select username, role, status, member_no, is_house, invite_quota
from public.profiles
where not is_house
order by member_no;
