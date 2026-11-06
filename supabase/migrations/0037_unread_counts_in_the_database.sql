-- VINTAGE · 0037 · unread messages counted in the database
--
-- The inbox (fetchConversations) and the dot on the messages button
-- (fetchUnreadMessageCount) counted a member's unread messages by
-- downloading them: every unread message others had sent in their
-- threads, a row each, a hundred threads a request, only to count the
-- rows. PostgREST stops a read at max_rows (1,000) without saying so, so
-- past a thousand unread messages in a batch of threads the count fell
-- short, and every unread message crossed the network each time the dot
-- was refreshed.
--
-- unread_message_counts() answers with one row a thread that has unread
-- messages: the thread and how many of the other member's messages in it
-- are unread. The member's own threads only, newest thread first (the
-- inbox's order, so that the threads a member sees first are the first
-- answered, should the answer ever reach max_rows threads).
--
-- SECURITY INVOKER: it reads as the member, through the same policies as
-- the reads it replaces ("conversations: read own", "messages: read own
-- conversations", "messages: not between blocked"), so it counts exactly
-- what the member could have downloaded, and nothing of anyone else's.
-- It also asks for the member's own threads itself, so the policies are
-- never the only thing between a member and another thread. STABLE, read
-- only. Members only: signed-out visitors may not call it (they would get
-- nothing anyway).
--
-- The threads come from conversations_a_idx and conversations_b_idx
-- (0006), and their unread messages from messages_unread_idx (0006, the
-- unread messages of a thread); planned at scale in
-- supabase/tests/16_launch_data_0035_0037.sql.
--
-- No table or policy changes. No begin or commit of its own. Idempotent.
--
-- Rollback (the app reads the unread messages as before):
--   drop function if exists public.unread_message_counts();

create or replace function public.unread_message_counts()
returns table (conversation_id uuid, unread bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.conversation_id, count(*)::bigint as unread
  from public.conversations c
  join public.messages m on m.conversation_id = c.id
  where (c.user_a = (select auth.uid()) or c.user_b = (select auth.uid()))
    and m.read_at is null
    and m.sender_id <> (select auth.uid())
  group by m.conversation_id, c.last_message_at
  order by c.last_message_at desc, m.conversation_id
$$;

revoke execute on function public.unread_message_counts() from public, anon;
grant execute on function public.unread_message_counts() to authenticated;
