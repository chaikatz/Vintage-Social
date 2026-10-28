-- VINTAGE · 0021 · a message outlives the photograph it carried
--
-- A photograph that had been sent to someone without a note could not be
-- deleted. messages.post_id is ON DELETE SET NULL (0006), so deleting a
-- post rewrites every message that carried it to post_id = null. The
-- table's CHECK (char_length(body) > 0 or post_id is not null), "words, a
-- shared photograph, or both — never neither", then refused the message
-- that had only the photograph: 23514, and the whole DELETE rolled back.
-- Production holds six such posts, one with six failed attempts by its
-- owner in the logs. delete_my_account stopped on the same row whenever
-- someone other than the member had sent the member's photograph with no
-- note, after the app had already removed the member's files.
--
-- The rule was written for what members send, not for a photograph that
-- leaves afterwards. So it moves from the table to a BEFORE INSERT OR
-- UPDATE OF body trigger. A new message, and any change to a message's
-- words, still needs words or a photograph, and is refused with the same
-- SQLSTATE and constraint name as before. The SET NULL that a deletion
-- performs names only post_id, so the trigger does not fire for it and
-- the deletion goes through. The message keeps its place in the thread
-- with neither; the app says the photograph is no longer available.
--
-- The trigger alone would let a member do by hand what a deletion does
-- (update messages set post_id = null on a photograph someone sent them)
-- and would leave what was already possible before this file: rewriting
-- the other person's words. The "messages: mark read" policy (0006) lets
-- either member of a conversation UPDATE any of its messages, and the
-- default grant covers every column. Members only ever mark messages
-- read: markConversationRead sets read_at, and nothing else in the app,
-- the edge functions or any SQL function in these migrations updates a
-- message. So the UPDATE grant is narrowed to that one column. The
-- foreign key's SET NULL runs as the table's owner and is not affected.
-- No policy is changed.
--
-- One transaction. Idempotent: create or replace, drop ... if exists, and
-- a revoke and grant that end in the same state however often they run.
--
-- Rollback, while no message has neither words nor a photograph (once a
-- deletion has gone through there will be some, and the CHECK cannot be
-- added back until they are deleted):
--
--   begin;
--   grant update on public.messages to anon, authenticated;
--   drop trigger if exists messages_not_empty on public.messages;
--   drop function if exists public.check_message_not_empty();
--   alter table public.messages
--     add constraint messages_check check (char_length(body) > 0 or post_id is not null);
--   commit;

begin;

-- ---------------------------------------------------------------------------
-- words, a photograph, or both: when a message is written
-- ---------------------------------------------------------------------------
create or replace function public.check_message_not_empty()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if char_length(coalesce(new.body, '')) = 0 and new.post_id is null then
    raise exception 'A message needs words or a photograph.'
      using errcode = 'check_violation', constraint = 'messages_check',
            schema = 'public', table = 'messages';
  end if;
  return new;
end;
$$;

-- "update of body" fires only when body is in the statement's SET list.
-- The foreign key's action sets post_id alone, so it never fires for it.
drop trigger if exists messages_not_empty on public.messages;
create trigger messages_not_empty
before insert or update of body on public.messages
for each row execute function public.check_message_not_empty();

-- A trigger function runs when a row changes; nobody calls it (as 0018).
revoke execute on function public.check_message_not_empty() from public, anon, authenticated;

alter table public.messages drop constraint if exists messages_check;

-- ---------------------------------------------------------------------------
-- members change one thing on a message: when it was read
-- ---------------------------------------------------------------------------
-- Revoking the table's UPDATE takes its column grants with it, so the
-- grant after it is the whole of what is left, on every run.
revoke update on public.messages from anon, authenticated;
grant update (read_at) on public.messages to authenticated;

commit;
