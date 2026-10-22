-- Defence in depth for the private workspace, and signing someone out everywhere.
--
-- 1. Workspace only. Sign-up already needs an invite code, but if Supabase's own public
--    sign-up were ever left switched on, a stranger could make a login straight from the
--    published key and use the narration, media and chat features. These RESTRICTIVE
--    rules sit on top of the existing ones (both must pass), so only people in the
--    workspace can touch those tables or the media bucket. Nothing existing is dropped.
--
-- 2. revoke_sessions. After a team password reset, any phone still signed in to that
--    login is signed out at its next refresh (within the hour the current access token
--    lasts), so a reset really locks out whoever had the old password.

create or replace function private.in_workspace()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.workspace_members m where m.user_id = (select auth.uid()));
$$;
revoke all on function private.in_workspace() from public, anon;
grant execute on function private.in_workspace() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['accounts', 'narrations', 'members', 'contacts', 'blocks', 'conversations',
                           'conversation_members', 'messages', 'narration_shares'] loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using ((select private.in_workspace())) with check ((select private.in_workspace()))',
      t || '_workspace_only', t);
  end loop;
end;
$$;

create policy media_workspace_only on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'media' or (select private.in_workspace()))
  with check (bucket_id <> 'media' or (select private.in_workspace()));

-- Server only. Removing the sessions also removes their refresh tokens.
create or replace function public.revoke_sessions(p_user uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (delete from auth.sessions where user_id = p_user returning 1)
  select count(*)::integer from gone;
$$;
revoke all on function public.revoke_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_sessions(uuid) to service_role;
