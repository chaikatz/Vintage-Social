-- VINTAGE · 0030 · a photograph or comment is removed once, and its author told once
--
-- admin_remove_post and admin_remove_comment (0002) mark the photograph or
-- comment removed only where it is not removed already, but then write a
-- moderation record whatever that update did, and admin_remove_post sends
-- its author a removal notice whatever it did. The reports screen now
-- closes the other open reports on the same photograph and never removes
-- twice from one screen, but two admins, or one admin on two screens or
-- two days, can still remove the same photograph twice: two records of
-- one removal, and its author told twice. On production in November 2026
-- no target has been reported more than once, so it has not happened yet.
--
-- Each function, as 0002 left it, stops right after the update when the
-- update changed nothing: removed already, so no second record and no
-- second notice. Called on something that was never there it still says
-- "Post not found" / "Comment not found", as before. A removal that does
-- happen is exactly as before.
--
-- No table, column or policy changes. The functions keep their grants
-- (0008: members may call them; they refuse anyone not an admin). No
-- begin or commit of its own. Idempotent.
--
-- Rollback: the two functions as 0002 defined them (copy them from
-- supabase/migrations/0002_functions.sql and run them).

create or replace function public.admin_remove_post(p_post_id uuid, p_note text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_author uuid;
begin
  if not public.is_admin(v_admin) then
    raise exception 'Admins only';
  end if;
  select author_id into v_author from public.posts where id = p_post_id;
  if not found then
    raise exception 'Post not found';
  end if;

  update public.posts set removed_at = now(), removed_by = v_admin
  where id = p_post_id and removed_at is null;
  if not found then
    -- Removed already: no second record, no second notice to its author.
    return;
  end if;

  insert into public.moderation_actions (admin_id, target_profile_id, action, post_id, note)
  values (v_admin, v_author, 'post_removal', p_post_id, p_note);
  insert into public.activity (recipient_id, actor_id, type, message)
  values (v_author, null, 'moderation', 'One of your posts was removed by the admins: ' || p_note);
end;
$$;

create or replace function public.admin_remove_comment(p_comment_id uuid, p_note text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_author uuid;
begin
  if not public.is_admin(v_admin) then
    raise exception 'Admins only';
  end if;
  select author_id into v_author from public.comments where id = p_comment_id;
  if not found then
    raise exception 'Comment not found';
  end if;

  update public.comments set removed_at = now(), removed_by = v_admin
  where id = p_comment_id and removed_at is null;
  if not found then
    -- Removed already: no second record.
    return;
  end if;

  insert into public.moderation_actions (admin_id, target_profile_id, action, comment_id, note)
  values (v_admin, v_author, 'comment_removal', p_comment_id, p_note);
end;
$$;
