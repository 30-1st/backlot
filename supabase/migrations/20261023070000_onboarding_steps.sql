-- Onboarding checklist: the steps of setting up a client that only a person can confirm.
-- Steps Backlot can see for itself (voice drafted, voice approved, first media) are worked
-- out from the data in the app and are not stored here.
--
--   delegate    the client gave the team access on X (Delegate). The client or the team ticks it.
--   first_call  the first call happened. The team ticks it.
--   contract    the agreement is signed. The team ticks it.

create table public.onboarding_steps (
  client_id uuid not null,
  workspace_id uuid not null,
  step text not null check (step in ('delegate', 'first_call', 'contract')),
  done_at timestamptz not null default now(),
  done_by uuid references auth.users (id) on delete set null,
  primary key (client_id, step),
  foreign key (client_id, workspace_id) references public.clients (id, owner_id) on delete cascade
);
create index onboarding_steps_workspace_idx on public.onboarding_steps (workspace_id);
create index onboarding_steps_done_by_idx on public.onboarding_steps (done_by);
create index onboarding_steps_client_workspace_idx on public.onboarding_steps (client_id, workspace_id);

alter table public.onboarding_steps enable row level security;
revoke all on public.onboarding_steps from anon, authenticated;
grant select on public.onboarding_steps to authenticated;
grant select, insert, update, delete on public.onboarding_steps to service_role;

create policy onboarding_steps_read on public.onboarding_steps for select to authenticated
  using ((select private.can_use_client(client_id)));

-- Tick or untick one step. The team may tick any step; a client only their own delegate step.
create or replace function public.onboarding_mark(p_client uuid, p_step text, p_done boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_team boolean := (select private.my_team_workspace()) is not null;
begin
  if not (select private.can_use_client(p_client)) then
    raise exception 'You cannot change this client''s checklist' using errcode = '42501';
  end if;
  if p_step not in ('delegate', 'first_call', 'contract') then
    raise exception 'No such step' using errcode = '22023';
  end if;
  if not v_team and p_step <> 'delegate' then
    raise exception 'Only your Backlot team can tick that step' using errcode = '42501';
  end if;
  select c.owner_id into v_workspace from public.clients c where c.id = p_client;
  if p_done then
    insert into public.onboarding_steps (client_id, workspace_id, step, done_by)
    values (p_client, v_workspace, p_step, (select auth.uid()))
    on conflict (client_id, step) do nothing;
  else
    delete from public.onboarding_steps s where s.client_id = p_client and s.step = p_step;
  end if;
end;
$$;

revoke all on function public.onboarding_mark(uuid, text, boolean) from public, anon;
grant execute on function public.onboarding_mark(uuid, text, boolean) to authenticated;
