-- VINTAGE · production · verify publishing works, without publishing anything
--
-- Read-only in effect: every write below happens inside a block that always
-- raises at the end, so the whole thing rolls back. No post is created, no
-- object is stored, no membership number is drawn.
--
-- Replace the uuid below with the member you want to test as:
--   select id, username, status from public.profiles order by member_no;

do $verify$
declare
  v_user uuid := '00000000-0000-0000-0000-000000000000';  -- <<< EDIT THIS
  v_uid  text;
  r      text := '';
begin
  if not exists (select 1 from public.profiles where id = v_user) then
    raise exception 'No profile with id %. Edit v_user first.', v_user;
  end if;
  v_uid := v_user::text;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('media', v_uid || '/verify.jpg', v_uid)
    on conflict (bucket_id, name) do update set owner_id = excluded.owner_id;
    r := r || 'media upload: OK; ';
  exception when others then r := r || 'media upload: FAILED (' || sqlerrm || '); ';
  end;

  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('thumbnails', v_uid || '/verify.jpg', v_uid)
    on conflict (bucket_id, name) do update set owner_id = excluded.owner_id;
    r := r || 'thumbnail upload: OK; ';
  exception when others then r := r || 'thumbnail upload: FAILED (' || sqlerrm || '); ';
  end;

  begin
    insert into public.posts (author_id, media_type, media_path, thumb_path, filter_id)
    values (v_user, 'photo', v_uid || '/verify.jpg', v_uid || '/verify.jpg', 'kodachrome');
    r := r || 'post insert: OK; ';
  exception when others then r := r || 'post insert: FAILED (' || sqlerrm || '); ';
  end;

  -- Still refused, as it must be.
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('media', '00000000-0000-0000-0000-000000000009/x.jpg', v_uid)
    on conflict (bucket_id, name) do update set owner_id = excluded.owner_id;
    r := r || 'another member''s folder: ALLOWED — STOP, THIS IS WRONG; ';
  exception when others then r := r || 'another member''s folder: correctly denied; ';
  end;

  execute 'reset role';
  raise exception E'\n\nRESULT (all changes rolled back): %\n', r;
end
$verify$;
