-- VINTAGE · founder bootstrap — RUN ONCE, AFTER SUBMITTING THE APPLICATION
--
-- Turns the application you submitted through the app into member no. 1.
-- It creates nothing: the account and profile already exist, made by the
-- app's own sign-up and the on_auth_user_created trigger. This only
-- promotes what is already there.
--
-- EDIT ONE LINE: v_username, below.
--
-- The whole thing is a single DO block, which is a single statement, which
-- Postgres runs atomically: if any line raises, every write in it is rolled
-- back and the project is exactly as it was.
--
-- WHY THE CHECKS COME BEFORE THE WORK
--
-- A sequence is deliberately not transactional — nextval() sticks even
-- when the surrounding transaction rolls back, because two sessions must
-- never be handed the same number. So if this block drew a number and then
-- failed its assertion, the rollback would undo the profile write but
-- leave the counter advanced: number 1 would be gone for good and a retry
-- would issue 2. Every precondition is therefore checked *before* the
-- number is drawn. The assertion at the end is a second line of defence
-- that should never fire.

do $$
declare
  -- ▼▼▼ THE ONLY LINE TO EDIT ▼▼▼
  v_username constant text := 'your.username';
  -- ▲▲▲ exactly the username you typed in the app ▲▲▲

  v_user       uuid;
  v_member_no  integer;
  v_role       text;
  v_status     text;
  v_app_count  integer;
  v_app_status text;
  v_seq_last   bigint;
  v_seq_used   boolean;
  v_numbered   integer;
  v_apps       integer;
  v_no         integer;
begin
  -- 1. Find the profile the app created. Never create one here.
  select id, member_no, role, status
    into v_user, v_member_no, v_role, v_status
  from public.profiles
  where username = lower(trim(v_username));

  if v_user is null then
    raise exception
      'No profile with username "%". Submit your application in the app first, then run this. (Usernames are lower-case.)',
      v_username;
  end if;

  -- 2. Refuse to run on anything but a fresh project.
  select count(*) into v_numbered from public.profiles where member_no is not null;
  if v_numbered > 0 then
    raise exception
      '% member(s) already numbered. This is not a fresh project — stop and investigate before bootstrapping a founder.',
      v_numbered;
  end if;

  -- 3. Check the counter before drawing from it (see the note above).
  select last_value, is_called into v_seq_last, v_seq_used from public.member_no_seq;
  if v_seq_used or v_seq_last <> 1 then
    raise exception
      'The membership counter has already advanced — the next number would be %. Number 1 is no longer available.',
      case when v_seq_used then v_seq_last + 1 else v_seq_last end;
  end if;

  -- 4. Require the account to be exactly what the app leaves behind: a
  --    fresh applicant with one application still waiting on a decision.
  --    All of this is checked before the first write and before the number
  --    is drawn, so a surprise here costs nothing.
  if v_member_no is not null then
    raise exception
      'Profile "%" already holds membership number %. Nothing to bootstrap.',
      v_username, v_member_no;
  end if;

  if v_role = 'admin' or v_status = 'approved' then
    raise exception
      'Profile "%" is already role=% status=%. Expected a fresh applicant; refusing to bootstrap over it.',
      v_username, v_role, v_status;
  end if;

  select count(*) into v_app_count
  from public.applications where user_id = v_user;

  if v_app_count <> 1 then
    raise exception
      'Expected exactly one application for "%", found %. Sort that out before bootstrapping the founder.',
      v_username, v_app_count;
  end if;

  select status into v_app_status
  from public.applications where user_id = v_user;

  if v_app_status <> 'pending' then
    raise exception
      'The application for "%" is "%", not "pending". Expected one still waiting on a decision.',
      v_username, v_app_status;
  end if;

  -- 5. Promote. 50 nominations for the founding cohort; everyone approved
  --    after this gets default_invite_quota(), which is 3.
  update public.profiles
  set role         = 'admin',
      status       = 'approved',
      approved_at  = coalesce(approved_at, now()),
      invite_quota = 50
  where id = v_user;

  -- 6. Settle the application so the admin queue cannot still show the
  --    founder waiting. Every row for this user, not only the newest.
  update public.applications
  set status     = 'approved',
      decided_by = v_user,
      decided_at = now()
  where user_id = v_user and status <> 'approved';
  get diagnostics v_apps = row_count;

  -- 7. Issue the number through the protected function — the same one
  --    decide_application and redeem_invite call. Nothing here touches the
  --    sequence directly, and no grant is changed.
  v_no := public.assign_member_no(v_user);

  -- 8. The assertion. Anything but 1 rolls the entire block back.
  if v_no <> 1 then
    raise exception
      'Issued number was %, not 1. Everything has been rolled back — but the counter has advanced, so tell someone before retrying.',
      v_no;
  end if;

  raise notice 'VINTAGE founder bootstrapped.';
  raise notice '  % is FOUNDING MEMBER  NO. %', v_username, lpad(v_no::text, 5, '0');
  raise notice '  application rows settled: %', v_apps;
  raise notice '  nominations: 50';
end $$;

-- Confirmation. Read-only; run it in the same go.
select
  p.username,
  case when p.member_no <= public.founding_member_limit()
       then 'FOUNDING MEMBER' else 'MEMBER' end          as designation,
  'NO. ' || lpad(p.member_no::text, 5, '0')              as membership_number,
  p.role,
  p.status,
  p.invite_quota                                          as nominations,
  (select count(*) from public.applications a
    where a.user_id = p.id and a.status <> 'approved')    as applications_still_open,
  (select count(*) from public.profiles)                  as members_total
from public.profiles p
where p.member_no is not null;
