-- The activity-stamp rule is there to stop a signed-in creator from editing
-- their own member row. Server-side code (no user session) must still be able
-- to maintain the table, so the rule now applies only when a user is signed in.
create or replace function private.members_stamp_activity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  new.id := old.id;
  new.username := old.username;
  new.created_at := old.created_at;
  new.last_active_at := now();
  return new;
end;
$$;
