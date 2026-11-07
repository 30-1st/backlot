-- Chats are for the team and clients. The four chat functions (add_contact, open_direct,
-- create_group, add_to_group) run with elevated rights and only asked for a member row,
-- so a Playground login could send contact requests to anyone and learn which usernames
-- exist. They all start with require_member(), so it now also requires owner, team or
-- client. Nothing else calls it.
create or replace function private.require_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null or not exists (select 1 from public.members m where m.id = me) then
    raise exception 'Sign in to do that.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workspace_members w where w.user_id = me and w.role in ('owner', 'team', 'client')) then
    raise exception 'Chats are for your Backlot team and clients.' using errcode = '42501';
  end if;
  return me;
end;
$$;
