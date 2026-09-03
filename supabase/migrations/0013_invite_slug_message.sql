-- VINTAGE · 0013 · tell the truth about how short a suffix may be
--
-- 0012 lowered the floor from eight characters to three, so that a member
-- called "chai" gets /i/chai rather than a random token — but the message
-- shown when a suffix is refused still said eight. A member typing their
-- own four-letter name would have been told it was too short by an app
-- that would in fact have accepted it.
--
-- Only the wording changes. The rule, the check constraint and every
-- other function are exactly as 0012 left them.

create or replace function public.set_invite_slug(p_slug text)
returns text
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_slug   text := lower(trim(coalesce(p_slug, '')));
  v_status text;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_active_member(v_user) then
    raise exception 'Only approved members have invitations';
  end if;

  v_status := public.invite_slug_status(v_slug);
  if v_status = 'format' then
    raise exception 'A suffix is 3 to 64 letters, numbers or hyphens, and cannot begin or end with a hyphen.';
  elsif v_status = 'reserved' then
    raise exception 'That suffix is reserved.';
  elsif v_status = 'taken' then
    raise exception 'That suffix is already in use.';
  end if;

  insert into public.invite_links (owner_id, slug) values (v_user, v_slug)
  on conflict (owner_id) do update set slug = excluded.slug, updated_at = now();

  return v_slug;
end;
$$;

revoke execute on function public.set_invite_slug(text) from public, anon, authenticated;
grant  execute on function public.set_invite_slug(text) to authenticated;
