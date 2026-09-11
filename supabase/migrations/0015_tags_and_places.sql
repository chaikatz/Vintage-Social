-- ---------------------------------------------------------------------------
-- Tagging members in a photograph, and the place a post names as a point.
--
-- post_tags: the author names the members who were there. A tag is an
-- invitation, not a fact about the tagged member: it sits `pending` until
-- they accept it, and only an accepted tag puts the photograph on their
-- own profile. They can decline, or remove themselves later; the author
-- can take a tag back. Everyone else sees only accepted tags.
--
-- posts.lat / posts.lng: where the post says it was taken, as a point, so
-- a profile can be read as a map. It is derived on the phone from the
-- place the author *typed* — never from the camera's GPS, which VINTAGE
-- does not read — and is null when nothing was typed or nothing matched.
--
-- Additive only: new table, new nullable columns, one more activity type.
-- No rows touched, no existing policy weakened.
-- ---------------------------------------------------------------------------

alter table public.posts
  add column lat double precision,
  add column lng double precision,
  add constraint posts_lat_lng_together check (
    (lat is null and lng is null) or (lat is not null and lng is not null)
  ),
  add constraint posts_lat_range check (lat is null or (lat >= -90 and lat <= 90)),
  add constraint posts_lng_range check (lng is null or (lng >= -180 and lng <= 180));

create table public.post_tags (
  post_id     uuid not null references public.posts (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  tagged_by   uuid not null references public.profiles (id) on delete cascade,
  status      text not null default 'pending'
              check (status in ('pending', 'accepted', 'declined')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  primary key (post_id, user_id),
  check (user_id <> tagged_by)
);

create index post_tags_user_idx on public.post_tags (user_id, status, created_at desc);

alter table public.post_tags enable row level security;

-- Accepted tags are public to members (subject to the post itself being
-- readable — RLS on posts still applies to any join). The two parties to a
-- tag see it in every state.
create policy "post_tags: members read accepted" on public.post_tags
  for select using (
    public.is_active_member(auth.uid())
    and (status = 'accepted' or user_id = auth.uid() or tagged_by = auth.uid())
  );

-- Only the post's author tags, only on their own live post, only members.
create policy "post_tags: author tags" on public.post_tags
  for insert with check (
    tagged_by = auth.uid()
    and public.is_active_member(auth.uid())
    and status = 'pending'
    and exists (
      select 1 from public.posts p
      where p.id = post_id and p.author_id = auth.uid() and p.removed_at is null
    )
    and exists (
      select 1 from public.profiles t
      where t.id = user_id and t.status = 'approved'
    )
  );

-- The tagged member decides, once, and may change their mind later.
create policy "post_tags: tagged decides" on public.post_tags
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and status in ('accepted', 'declined'));

-- Either party can end it: the author takes the tag back, or the member
-- takes themselves out of the picture.
create policy "post_tags: either party removes" on public.post_tags
  for delete using (user_id = auth.uid() or tagged_by = auth.uid());

-- A tag is its own kind of notice, with something to act on.
alter table public.activity
  drop constraint if exists activity_type_check;
alter table public.activity
  add constraint activity_type_check check (type in
    ('like', 'comment', 'follow', 'follow_request', 'moderation', 'message', 'tag'));

create or replace function public.notify_tag()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity (recipient_id, actor_id, type, post_id)
  values (new.user_id, new.tagged_by, 'tag', new.post_id);
  return new;
end;
$$;

create trigger post_tags_activity_trigger
  after insert on public.post_tags
  for each row execute function public.notify_tag();
