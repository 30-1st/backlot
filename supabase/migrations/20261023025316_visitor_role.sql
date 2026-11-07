-- Visitors: anyone may make a login to save their own narrations in the Playground.
--
--   * A visitor joins the workspace with role 'visitor'. They get no client data, no
--     Bil, no team tools: every client rule checks for owner, team or that client.
--   * Their own accounts, narrations and media folder work like everyone else's.
--   * Chats, contacts, groups and sharing stay with the team and clients: visitors
--     cannot see or start them.
--   * Visitors are not kept forever: the daily cleanup removes a visitor login after
--     60 days without opening Backlot, like any other idle login (purge-inactive).
--   * Sign-up without an invite code makes a visitor (signup function), with its own
--     rate limit so open sign-ups can never crowd out invites.

alter table public.workspace_members drop constraint workspace_members_role_check;
alter table public.workspace_members
  add constraint workspace_members_role_check check (role in ('owner', 'team', 'client', 'visitor'));

-- True for owner, team and client: the people chats and sharing are for.
create or replace function private.in_team_space()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
     where m.user_id = (select auth.uid()) and m.role in ('owner', 'team', 'client')
  );
$$;
revoke all on function private.in_team_space() from public, anon;
grant execute on function private.in_team_space() to authenticated;

-- Chats, contacts, blocks and sharing: workspace people except visitors.
do $$
declare t text;
begin
  foreach t in array array['contacts', 'blocks', 'conversations', 'conversation_members', 'messages', 'narration_shares'] loop
    execute format(
      'alter policy %I on public.%I using ((select private.in_team_space())) with check ((select private.in_team_space()))',
      t || '_workspace_only', t);
  end loop;
end;
$$;

-- Open sign-ups are counted apart from invite sign-ups.
alter table public.signup_log add column kind text not null default 'invite' check (kind in ('invite', 'visitor'));
create index signup_log_kind_created_at_idx on public.signup_log (kind, created_at);
