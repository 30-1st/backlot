-- Access grants and client stages (Big Patch Plan, Phase 3, Oct 30, 2026).
--
-- client_access: which team members may see which clients. Only the executive (the
-- workspace owner) grants. The default is none: a team member sees no client's info or
-- media until granted. The executive sees every client.
--
-- clients.stage: onboarding, active or paused. New clients start in onboarding and move to
-- active by themselves once every checklist step is done; the executive can set any stage.
-- Paused locks the client's portal to Home. Existing clients start active.

create table public.client_access (
  member_id uuid not null references public.members (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  workspace_id uuid not null,
  granted_by uuid references public.members (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (member_id, client_id)
);
create index client_access_client_idx on public.client_access (client_id);
create index client_access_workspace_idx on public.client_access (workspace_id);
create index client_access_granted_by_idx on public.client_access (granted_by);
alter table public.client_access enable row level security;
revoke insert, update, delete, truncate on public.client_access from authenticated, anon;

create or replace function private.is_owner()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.workspace_members m where m.user_id = (select auth.uid()) and m.role = 'owner');
$$;

-- The executive reads every grant in the workspace; a team member reads their own.
create policy client_access_read on public.client_access for select to authenticated
  using (member_id = (select auth.uid()) or (workspace_id = (select private.my_team_workspace()) and (select private.is_owner())));

-- True when the signed-in team member may see this client: the executive always, others when granted.
create or replace function private.team_sees(p_client uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.clients c
     where c.id = p_client
       and c.owner_id = (select private.my_team_workspace())
       and ((select private.is_owner())
            or exists (select 1 from public.client_access a where a.client_id = c.id and a.member_id = (select auth.uid())))
  );
$$;

create or replace function private.can_use_client(p_client uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select private.team_sees(p_client)) or p_client = (select private.my_client());
$$;

create or replace function private.library_path_ok(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.clients c
     where c.id::text = (storage.foldername(p_name))[2]
       and c.owner_id::text = (storage.foldername(p_name))[1]
       and array_length(storage.foldername(p_name), 1) = 2
       and (select private.can_use_client(c.id))
  );
$$;

revoke all on function private.is_owner(), private.team_sees(uuid) from public, anon;
grant execute on function private.is_owner(), private.team_sees(uuid) to authenticated;

-- Policies that let any team member read every client now go through the grant check.
drop policy clients_read on public.clients;
create policy clients_read on public.clients for select to authenticated using ((select private.can_use_client(id)));

drop policy campaigns_read on public.campaigns;
create policy campaigns_read on public.campaigns for select to authenticated using ((select private.can_use_client(client_id)));

drop policy campaign_posts_read on public.campaign_posts;
create policy campaign_posts_read on public.campaign_posts for select to authenticated
  using (campaign_id in (select c.id from public.campaigns c where (select private.can_use_client(c.client_id))));

drop policy post_type_libraries_read on public.post_type_libraries;
create policy post_type_libraries_read on public.post_type_libraries for select to authenticated using ((select private.can_use_client(client_id)));

drop policy voice_cards_read on public.voice_cards;
create policy voice_cards_read on public.voice_cards for select to authenticated using ((select private.can_use_client(client_id)));

drop policy room_visits_team on public.room_visits;
create policy room_visits_team on public.room_visits for select to authenticated
  using (workspace_id = (select private.my_team_workspace()) and (select private.team_sees(client_id)));

drop policy room_messages_team on public.room_messages;
create policy room_messages_team on public.room_messages for select to authenticated
  using (exists (select 1 from public.room_visits v where v.id = room_messages.visit_id and v.workspace_id = (select private.my_team_workspace()) and (select private.team_sees(v.client_id))));

drop policy brief_reviews_read on public.brief_reviews;
create policy brief_reviews_read on public.brief_reviews for select to authenticated
  using (owner_id = (select private.my_team_workspace()) and (client_id is null or (select private.team_sees(client_id))));

-- Client stages
alter table public.clients
  add column stage text not null default 'onboarding' check (stage in ('onboarding', 'active', 'paused')),
  add column stage_note text check (char_length(stage_note) <= 300),
  add column stage_at timestamptz not null default now();
update public.clients set stage = 'active';

-- Moves a client from onboarding to active once every checklist step is done.
create or replace function private.promote_when_ready(p_client uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.clients c
     set stage = 'active', stage_at = now()
   where c.id = p_client
     and c.stage = 'onboarding'
     and exists (select 1 from public.voice_cards v where v.client_id = c.id and v.approved_by_client)
     and exists (select 1 from public.library_items l where l.client_id = c.id and l.removed_at is null)
     and (select count(distinct s.step) from public.onboarding_steps s where s.client_id = c.id and s.step in ('delegate', 'first_call', 'contract')) = 3;
$$;
revoke all on function private.promote_when_ready(uuid) from public, anon, authenticated;

create or replace function private.promote_trigger()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.promote_when_ready(new.client_id);
  return new;
end;
$$;
revoke all on function private.promote_trigger() from public, anon, authenticated;

create trigger promote_on_step after insert on public.onboarding_steps for each row execute function private.promote_trigger();
create trigger promote_on_voice after insert or update of approved_by_client on public.voice_cards for each row execute function private.promote_trigger();
create trigger promote_on_media after insert on public.library_items for each row execute function private.promote_trigger();
