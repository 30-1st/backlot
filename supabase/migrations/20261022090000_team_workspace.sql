-- Team workspace: Backlot becomes a private app for one small team and its clients.
--
-- How it fits on what is already built:
--   * A workspace is identified by its owner's login ID. Every client row already carries
--     owner_id, so owner_id now means "the workspace this client belongs to". Nothing
--     existing has to move: the one workspace is the login that created @litax333.
--   * workspace_members says who is in the workspace and as what:
--       owner   the founder (exactly one per workspace, never removable through the app)
--       team    sees every client, runs Bil and Rein, makes invites, resets passwords
--       client  sees only their own client's voice, results and posts, approves posts
--   * New logins can only be made with a one-time invite code (private.invites).
--   * Users still cannot write client data directly; the server does, scoped to the
--     workspace it verified. These policies only widen who can READ.

-- ---------- membership ----------

create table public.workspace_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  workspace_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'team', 'client')),
  client_id uuid,
  created_at timestamptz not null default now(),
  constraint workspace_members_client_role check ((role = 'client') = (client_id is not null)),
  constraint workspace_members_owner_self check (role <> 'owner' or user_id = workspace_id),
  foreign key (client_id, workspace_id) references public.clients (id, owner_id) on delete cascade
);
create index workspace_members_workspace_idx on public.workspace_members (workspace_id);
create index workspace_members_client_idx on public.workspace_members (client_id) where client_id is not null;

alter table public.workspace_members enable row level security;
revoke all on public.workspace_members from anon, authenticated;
grant select on public.workspace_members to authenticated;
grant select, insert, update, delete on public.workspace_members to service_role;

-- Each person can read their own membership. The team's people list comes from the server.
create policy workspace_members_read_own on public.workspace_members
  for select to authenticated using ((select auth.uid()) = user_id);

-- The founder's login owns the existing client data, so it becomes the workspace owner.
insert into public.workspace_members (user_id, workspace_id, role)
select distinct c.owner_id, c.owner_id, 'owner' from public.clients c
on conflict (user_id) do nothing;

-- ---------- forced password change after a team reset ----------

alter table public.members add column must_change_password boolean not null default false;

-- ---------- helpers for the read rules (evaluated once per query) ----------

-- The workspace the signed-in person works in as owner or team, or null.
create or replace function private.my_team_workspace()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id
    from public.workspace_members m
   where m.user_id = (select auth.uid())
     and m.role in ('owner', 'team');
$$;

-- The one client the signed-in person is, when they are a client, or null.
create or replace function private.my_client()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.client_id
    from public.workspace_members m
   where m.user_id = (select auth.uid())
     and m.role = 'client';
$$;

revoke all on function private.my_team_workspace(), private.my_client() from public, anon;
grant execute on function private.my_team_workspace(), private.my_client() to authenticated;

-- ---------- read rules on client data ----------

-- Old rules allowed only the creating login. Writes were already revoked from users
-- (20261017032537), so the insert and update rules are dead weight: drop them too.
drop policy clients_select_own on public.clients;
drop policy clients_insert_own on public.clients;
drop policy clients_update_own on public.clients;
drop policy clients_delete_own on public.clients;
drop policy voice_cards_select_own on public.voice_cards;
drop policy voice_cards_insert_own on public.voice_cards;
drop policy voice_cards_update_own on public.voice_cards;
drop policy voice_cards_delete_own on public.voice_cards;
drop policy post_type_libraries_select_own on public.post_type_libraries;
drop policy post_type_libraries_insert_own on public.post_type_libraries;
drop policy post_type_libraries_update_own on public.post_type_libraries;
drop policy post_type_libraries_delete_own on public.post_type_libraries;
drop policy brief_reviews_select_own on public.brief_reviews;
drop policy brief_reviews_insert_own on public.brief_reviews;
drop policy brief_reviews_update_own on public.brief_reviews;
drop policy brief_reviews_delete_own on public.brief_reviews;
drop policy campaigns_select_own on public.campaigns;
drop policy campaigns_insert_own on public.campaigns;
drop policy campaigns_update_own on public.campaigns;
drop policy campaigns_delete_own on public.campaigns;
drop policy campaign_posts_select_own on public.campaign_posts;
drop policy campaign_posts_delete_own on public.campaign_posts;

-- Deleting client data goes through the server too, so a client can never erase
-- their own campaign by accident and nobody deletes outside the workspace.
revoke delete on public.clients, public.voice_cards, public.post_type_libraries,
  public.brief_reviews, public.campaigns, public.campaign_posts from authenticated;

create policy clients_read on public.clients for select to authenticated
  using (owner_id = (select private.my_team_workspace()) or id = (select private.my_client()));

create policy voice_cards_read on public.voice_cards for select to authenticated
  using (owner_id = (select private.my_team_workspace()) or client_id = (select private.my_client()));

create policy post_type_libraries_read on public.post_type_libraries for select to authenticated
  using (owner_id = (select private.my_team_workspace()) or client_id = (select private.my_client()));

-- Bil's internal reviews of Rein's briefs are team working notes.
create policy brief_reviews_read on public.brief_reviews for select to authenticated
  using (owner_id = (select private.my_team_workspace()));

create policy campaigns_read on public.campaigns for select to authenticated
  using (owner_id = (select private.my_team_workspace()) or client_id = (select private.my_client()));

create policy campaign_posts_read on public.campaign_posts for select to authenticated
  using (
    owner_id = (select private.my_team_workspace())
    or campaign_id in (select c.id from public.campaigns c where c.client_id = (select private.my_client()))
  );

-- ---------- post review ----------

alter table public.campaign_posts
  add column review text not null default 'pending'
    check (review in ('pending', 'approved', 'changes', 'posted')),
  add column review_note text check (char_length(review_note) <= 500),
  add column reviewed_by uuid references auth.users (id) on delete set null,
  add column reviewed_at timestamptz;
create index campaign_posts_reviewed_by_idx on public.campaign_posts (reviewed_by) where reviewed_by is not null;

-- ---------- invites ----------

create table private.invites (
  id uuid primary key default gen_random_uuid(),
  -- SHA-256 of the code. The code itself is shown once and never stored.
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  workspace_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('team', 'client')),
  client_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  constraint invites_client_role check ((role = 'client') = (client_id is not null)),
  foreign key (client_id, workspace_id) references public.clients (id, owner_id) on delete cascade
);
create index invites_workspace_idx on private.invites (workspace_id);
create index invites_client_idx on private.invites (client_id) where client_id is not null;
create index invites_created_by_idx on private.invites (created_by);
create index invites_used_by_idx on private.invites (used_by) where used_by is not null;
alter table private.invites enable row level security;
revoke all on private.invites from public, anon, authenticated;

-- Server-only doors to the private invite table.
create or replace function public.invite_create(
  p_code_hash text, p_workspace uuid, p_role text, p_client uuid, p_created_by uuid
) returns timestamptz
language sql
security definer
set search_path = ''
as $$
  insert into private.invites (code_hash, workspace_id, role, client_id, created_by)
  values (p_code_hash, p_workspace, p_role, p_client, p_created_by)
  returning expires_at;
$$;

-- Claims an unused, unexpired code in one step, so two people can never use one code.
create or replace function public.invite_claim(p_code_hash text)
returns table (invite_id uuid, workspace_id uuid, role text, client_id uuid)
language sql
security definer
set search_path = ''
as $$
  update private.invites i
     set used_at = now()
   where i.code_hash = p_code_hash
     and i.used_at is null
     and i.expires_at > now()
  returning i.id, i.workspace_id, i.role, i.client_id;
$$;

-- Records who used a claimed code, or hands the code back if making the login failed.
create or replace function public.invite_finish(p_invite uuid, p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.invites
     set used_by = p_user,
         used_at = case when p_user is null then null else used_at end
   where id = p_invite;
$$;

revoke all on function public.invite_create(text, uuid, text, uuid, uuid),
  public.invite_claim(text), public.invite_finish(uuid, uuid) from public, anon, authenticated;
grant execute on function public.invite_create(text, uuid, text, uuid, uuid),
  public.invite_claim(text), public.invite_finish(uuid, uuid) to service_role;
