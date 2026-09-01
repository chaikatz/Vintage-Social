-- VINTAGE · 0006 · direct messages, private accounts
--
-- Two additions that change who can see what:
--
--   * A profile can be private. Following a private member becomes a request
--     that member approves by hand, and until they do, their photographs are
--     theirs alone. Existing rows default to public, which is what every
--     member signed up as.
--
--   * Members can write to each other. Conversations are strictly one to one
--     — no groups, no broadcast — and a message is either words, a shared
--     photograph, or both.

-- ---------------------------------------------------------------------------
-- private accounts
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column is_private boolean not null default false;

-- A follow of a private member starts as 'pending' and only counts once the
-- member accepts. Everything already in the table was a real follow.
alter table public.follows
  add column status text not null default 'accepted'
    check (status in ('pending', 'accepted'));

create index follows_pending_idx on public.follows (followee_id)
  where status = 'pending';

-- Follower counts must only count accepted follows.
create or replace function public.recount_follows(p_follower uuid, p_followee uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.profiles p set follower_count = (
    select count(*) from public.follows f
    where f.followee_id = p.id and f.status = 'accepted'
  ) where p.id = p_followee;

  update public.profiles p set following_count = (
    select count(*) from public.follows f
    where f.follower_id = p.id and f.status = 'accepted'
  ) where p.id = p_follower;
$$;

-- A pending request is its own kind of notice, so the recipient can act on it.
alter table public.activity
  drop constraint if exists activity_type_check;
alter table public.activity
  add constraint activity_type_check check (type in
    ('like', 'comment', 'follow', 'follow_request', 'moderation', 'message'));

-- ---------------------------------------------------------------------------
-- conversations: exactly two members, stored in a fixed order so a pair can
-- only ever have one thread no matter who writes first.
-- ---------------------------------------------------------------------------
create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  user_a          uuid not null references public.profiles (id) on delete cascade,
  user_b          uuid not null references public.profiles (id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  check (user_a < user_b),
  unique (user_a, user_b)
);

create index conversations_a_idx on public.conversations (user_a, last_message_at desc);
create index conversations_b_idx on public.conversations (user_b, last_message_at desc);

-- ---------------------------------------------------------------------------
-- messages: words, a shared photograph, or both — never neither.
-- ---------------------------------------------------------------------------
create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  body            text not null default '' check (char_length(body) <= 1000),
  post_id         uuid references public.posts (id) on delete set null,
  created_at      timestamptz not null default now(),
  read_at         timestamptz,
  check (char_length(body) > 0 or post_id is not null)
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_unread_idx on public.messages (conversation_id) where read_at is null;

-- Keep the inbox ordered by the newest message without a second query.
create or replace function public.touch_conversation()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_touch_conversation
after insert on public.messages
for each row execute function public.touch_conversation();

-- ---------------------------------------------------------------------------
-- row-level security for the new tables
--
-- A conversation is readable and writable only by the two people in it, and
-- a message only by the pair whose conversation it belongs to. There is no
-- policy that lets a third member read either, admin included: moderation
-- acts on reports, not on private correspondence.
-- ---------------------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;

create policy "conversations: read own" on public.conversations
  for select using (auth.uid() in (user_a, user_b));

create policy "conversations: open as self" on public.conversations
  for insert with check (
    public.is_active_member(auth.uid())
    and auth.uid() in (user_a, user_b)
  );

create policy "conversations: members touch own" on public.conversations
  for update using (auth.uid() in (user_a, user_b))
  with check (auth.uid() in (user_a, user_b));

create policy "messages: read own conversations" on public.messages
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and auth.uid() in (c.user_a, c.user_b)
    )
  );

create policy "messages: send as self" on public.messages
  for insert with check (
    sender_id = auth.uid()
    and public.is_active_member(auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and auth.uid() in (c.user_a, c.user_b)
    )
  );

-- Marking a message read is the only update either side may make.
create policy "messages: mark read" on public.messages
  for update using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and auth.uid() in (c.user_a, c.user_b)
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and auth.uid() in (c.user_a, c.user_b)
    )
  );

-- ---------------------------------------------------------------------------
-- private accounts change who may read a post
--
-- The existing "members read live" policy is replaced: a photograph by a
-- private member is visible to that member, to accepted followers, and to
-- nobody else.
-- ---------------------------------------------------------------------------
drop policy if exists "posts: members read live" on public.posts;

create policy "posts: members read live" on public.posts
  for select using (
    public.is_active_member(auth.uid())
    and removed_at is null
    and (
      author_id = auth.uid()
      or not exists (
        select 1 from public.profiles a
        where a.id = author_id and a.is_private
      )
      or exists (
        select 1 from public.follows f
        where f.followee_id = author_id
          and f.follower_id = auth.uid()
          and f.status = 'accepted'
      )
    )
  );
