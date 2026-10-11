-- This project still hands every new public table to anon, authenticated and
-- service_role in full. Take that back and grant only what each role needs.
-- Row level security already guards the rows; this narrows the doors as well.

revoke all on public.members, public.accounts, public.narrations, public.signup_log, public.internal_config
  from anon, authenticated, service_role;

-- Signed-in creators.
grant select on public.members to authenticated;
grant update (last_active_at) on public.members to authenticated;
grant select, insert, update, delete on public.accounts to authenticated;
grant select, insert, update, delete on public.narrations to authenticated;

-- Server-side functions.
grant select, insert, update, delete on public.members to service_role;
grant select, insert, update, delete on public.accounts to service_role;
grant select, insert, update, delete on public.narrations to service_role;
grant select, insert, delete on public.signup_log to service_role;
grant select on public.internal_config to service_role;
