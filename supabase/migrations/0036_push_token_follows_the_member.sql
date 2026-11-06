-- VINTAGE · 0036 · a phone's push token belongs to whoever signed in on it last
--
-- A phone has one push token, and push_tokens keys its rows by it (0017).
-- The app filed it with an upsert on the token, under the policy
-- "push_tokens: own" (a member's own rows only). When the row was still
-- under the member who used the phone before (their sign-out could not
-- remove it: no signal, or the app was deleted and installed again), the
-- upsert met that row and Postgres refused the update under the policy
-- (42501, "new row violates row-level security policy (USING
-- expression)"); a delete of it removed nothing, without an error. So the
-- member who signed in never had their notices on that phone, and the
-- phone went on being sent the last member's likes and messages.
--
-- claim_push_token files the phone's token under the member calling it,
-- moving the row from whoever held it. Nothing else of the row's owner is
-- read or touched, and it answers nothing: a member learns nothing about
-- who held the token, or whether anyone did. The token is the phone's
-- own, given to the app on that phone by Apple's or Google's push service
-- through Expo; nobody else's rows can be read (the policy above), so a
-- member can only claim a token their own phone gave them.
--
-- SECURITY DEFINER, so it can move a row the caller cannot see, with an
-- empty search_path and every name qualified. It refuses a caller who is
-- not signed in, and a token or platform the table would not take. Members
-- only: signed-out visitors may not call it. The push function, which
-- reads the tokens with the service role, is unchanged.
--
-- No table or policy changes. No begin or commit of its own. Idempotent.
--
-- Rollback (the app then files with an upsert again, refused as above
-- when the row is another member's):
--   drop function if exists public.claim_push_token(text, text, text);

create or replace function public.claim_push_token(p_token text, p_platform text, p_device text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_token is null or length(p_token) = 0 or length(p_token) > 512 then
    raise exception 'Not a push token' using errcode = '22023';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android', 'web') then
    raise exception 'Not a platform' using errcode = '22023';
  end if;

  insert into public.push_tokens (token, user_id, platform, device, updated_at, invalid_at)
  values (p_token, v_me, p_platform, left(p_device, 200), now(), null)
  on conflict (token) do update
    set user_id    = excluded.user_id,
        platform   = excluded.platform,
        device     = excluded.device,
        updated_at = excluded.updated_at,
        -- A token that came back to life is live again.
        invalid_at = null;
end
$$;

revoke execute on function public.claim_push_token(text, text, text) from public, anon;
grant execute on function public.claim_push_token(text, text, text) to authenticated;
