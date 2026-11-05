-- VINTAGE · 0024 · nobody can ask who has blocked whom
--
-- blocked_between(a, b) and blocked_by(me, other) (0018) are granted to
-- every member, because the policies that call them run as the member
-- asking. But PostgREST publishes every function a role may execute, so
-- any member could also call them directly, through /rest/v1/rpc, with
-- any two ids - and every member's id is on their profile. That answers
-- "has Ana blocked Ben?" for any Ana and any Ben: a private fact about two
-- other people, one request each.
--
-- Now each answers only about the member asking. blocked_between answers
-- only when the caller is one of the two; blocked_by only when the caller
-- is the one who might be blocked. Asked about anyone else, both say
-- false, which is what they already said for a signed-out caller.
--
-- No policy changes what it allows. The policies call them in two ways:
--   * with the caller as one of the pair (comments, posts, likes and the
--     rest, before 0023 read the block list once instead): the caller is
--     one of the two, so the answer is the true one;
--   * with two columns of the row (a conversation's pair, who follows or
--     tags whom, a message's conversation): every one of those sits beside
--     a permissive policy that only passes when the caller is one of that
--     pair (conversations: read own / open as self; follows: follow as
--     self; post_tags: author tags; messages: send as self), so a row
--     about two other members is refused either way.
-- supabase/tests/08_policy_rewrite.sql asks every table everything with
-- these functions as they were before 0023 and as they are now, and gets
-- the same answers; 11_block_privacy.sql asks them about other people.
--
-- Signatures, SECURITY DEFINER, search_path and grants are unchanged
-- (create or replace keeps grants). No begin or commit of its own, like
-- the other migrations. Idempotent.
--
-- Rollback (the functions as 0018 wrote them):
--
--   create or replace function public.blocked_between(p_a uuid, p_b uuid)
--   returns boolean language sql stable security definer set search_path = public as $$
--     select p_a is not null and p_b is not null and exists (
--       select 1 from public.blocks
--       where (blocker_id = p_a and blocked_id = p_b) or (blocker_id = p_b and blocked_id = p_a))
--   $$;
--   create or replace function public.blocked_by(p_me uuid, p_other uuid)
--   returns boolean language sql stable security definer set search_path = public as $$
--     select p_me is not null and p_other is not null and exists (
--       select 1 from public.blocks where blocker_id = p_other and blocked_id = p_me)
--   $$;

/** True when either of the two has blocked the other - asked by one of them. */
create or replace function public.blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_a is not null and p_b is not null
     and auth.uid() in (p_a, p_b)
     and exists (
       select 1 from public.blocks
       where (blocker_id = p_a and blocked_id = p_b)
          or (blocker_id = p_b and blocked_id = p_a)
     )
$$;

/** True when p_other has blocked p_me - asked by p_me. */
create or replace function public.blocked_by(p_me uuid, p_other uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_me is not null and p_other is not null
     and p_me = auth.uid()
     and exists (
       select 1 from public.blocks where blocker_id = p_other and blocked_id = p_me
     )
$$;
