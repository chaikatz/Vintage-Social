-- VINTAGE · production · invitation links (applies migration 0012)
--
-- Replaces the one-shot code with a durable link per member, and moves the
-- moment an invitation is spent from sending to joining.
--
-- Safe to run on a live database. It only adds a table and functions; the
-- old `invites` table and its create_invite/redeem_invite are left exactly
-- as they are, so nothing already issued is lost. Nothing calls them after
-- this.
--
-- Paste supabase/migrations/0012_invite_links.sql into the SQL Editor.
-- Then check it took:

select
  (select count(*) from public.invite_links)                       as links_so_far,
  (select count(*) from pg_policies
     where schemaname='public' and tablename='invite_links')       as policies,
  has_function_privilege('anon',          'public.invite_link_owner(text)',  'EXECUTE') as page_can_read_owner,
  has_function_privilege('anon',          'public.join_with_invite(text)',   'EXECUTE') as anon_can_join_should_be_false,
  has_function_privilege('authenticated', 'public.ensure_invite_link()',     'EXECUTE') as members_have_links,
  has_function_privilege('authenticated', 'public.join_with_invite(text)',   'EXECUTE') as members_can_join;
