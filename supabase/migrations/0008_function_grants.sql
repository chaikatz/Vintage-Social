-- VINTAGE · 0008 · lock down the RPC surface
--
-- PostgREST publishes every function in `public` as an endpoint at
-- /rest/v1/rpc/<name>, and PostgreSQL grants EXECUTE to PUBLIC by default.
-- Together that means every helper written for internal use was reachable
-- by anyone holding the anon key.
--
-- Most of them are harmless or self-guarding. One was not:
--
--   assign_member_no(uuid) is SECURITY DEFINER and has no guard of its own,
--   because it was only ever meant to be called from inside
--   decide_application and redeem_invite. Exposed, it let any caller burn
--   membership numbers, or hand one to an account that was never approved.
--
-- So: revoke everything, then grant back exactly what the client calls.
--
-- Two things must keep their grants or the app stops working:
--
--   * is_admin and is_active_member are called from inside row-level
--     security policies. Policy expressions are evaluated as the querying
--     role, and a function call in one needs EXECUTE — revoke these and
--     every policy that uses them fails with "permission denied".
--   * username_available is called before sign-up, when the caller is
--     still anon.
--
-- Trigger functions need no grant: EXECUTE is checked when the trigger is
-- created, not each time it fires.

revoke execute on all functions in schema public from public, anon, authenticated;

-- Needed by the policies themselves, for both roles.
grant execute on function public.is_admin(uuid) to anon, authenticated;
grant execute on function public.is_active_member(uuid) to anon, authenticated;

-- Called before the caller has an account.
grant execute on function public.username_available(text) to anon, authenticated;

-- Called by a signed-in member. Each one guards itself: create_invite
-- checks active membership and the nomination quota, redeem_invite checks
-- the code, and every admin_* function raises unless is_admin passes.
grant execute on function public.create_invite() to authenticated;
grant execute on function public.redeem_invite(text) to authenticated;
grant execute on function public.decide_application(uuid, text) to authenticated;
grant execute on function public.admin_warn_member(uuid, text) to authenticated;
grant execute on function public.admin_set_suspension(uuid, boolean, text) to authenticated;
grant execute on function public.admin_remove_post(uuid, text) to authenticated;
grant execute on function public.admin_remove_comment(uuid, text) to authenticated;
grant execute on function public.resolve_report(uuid, text, text) to authenticated;

-- Everything else stays revoked, including assign_member_no and
-- recount_follows: they are internal, and the definer functions that call
-- them run as the owner, so they need no grant of their own.

-- Pin the search_path on the two constant functions that lacked one. They
-- read nothing, so this is tidiness rather than a hole — but an unpinned
-- search_path on a function is a habit worth not having.
create or replace function public.default_invite_quota()
returns integer language sql immutable set search_path = public as $$ select 3 $$;

create or replace function public.founding_member_limit()
returns integer language sql immutable set search_path = public as $$ select 10000 $$;
