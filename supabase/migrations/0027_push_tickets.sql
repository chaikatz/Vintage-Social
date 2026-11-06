-- VINTAGE · 0027 · which devices are gone, from Expo's receipts
--
-- When the push function hands Expo a notice, Expo answers with a ticket:
-- it has taken the notice, nothing more. Whether Apple or Google could
-- deliver it comes later, in a receipt, and that is where a phone that has
-- been wiped, or had the app deleted, is first reported
-- (DeviceNotRegistered). Expo keeps receipts for a day and suggests asking
-- for them fifteen minutes on. The function deleted a token only when a
-- ticket said the device was gone, which Expo says only once it already
-- knows; nothing read the receipts, so most tokens of phones that had gone
-- away were never let go, and every notice to their owner was sent to
-- them again, for good.
--
-- So each notice Expo takes is noted here, its ticket and the token it was
-- for; once a day, after the memories (supabase/functions/push), the
-- function asks Expo for the receipts of what was sent since the last
-- run, deletes the tokens of devices that are gone, and deletes the
-- tickets. The table holds about a day of notices, never more than one
-- row per notice, and nothing else.
--
-- Only the push function, with the service role, reads or writes it.
-- Row-level security is on with no policy, and members and signed-out
-- visitors hold no privilege on it, so the API answers nobody else. A
-- ticket goes with its token: deleting a token (a member signing out,
-- deleting their account, or a device found gone) deletes its tickets.
--
-- lock_timeout, as in 0023 (the foreign key takes a brief lock on
-- push_tokens). One table and its indexes; nothing else is touched. No
-- begin or commit of its own, like the other migrations. Idempotent.
--
-- Rollback:
--   drop table if exists public.push_tickets;

set local lock_timeout = '5s';

create table if not exists public.push_tickets (
  id          text primary key,
  token       text not null references public.push_tokens (token) on delete cascade,
  created_at  timestamptz not null default now()
);

-- The foreign key's own lookup (a token deleted), and the daily sweep.
create index if not exists push_tickets_token_idx on public.push_tickets (token);
create index if not exists push_tickets_created_idx on public.push_tickets (created_at);

alter table public.push_tickets enable row level security;

-- Supabase gives every new table in public to anon and authenticated by
-- default; this one is the service role's alone.
revoke all on public.push_tickets from public, anon, authenticated;
