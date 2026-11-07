-- Rein per client: which of Rein's niche briefs belong to which client, newest first.
--
--   * A line is added when the team taps Update on a client's trends, and when a
--     campaign's brief step gets a brief from Rein.
--   * The brief itself stays in niche_briefs, shared by every client in the same niche;
--     this table only says "this client's trends, as of then".
--   * The team and that client may read a client's lines. Only the server writes them.

create table public.client_briefs (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  client_id uuid not null,
  brief_id uuid not null references public.niche_briefs (id) on delete cascade,
  region text not null check (region in ('worldwide', 'us', 'uk', 'canada')),
  source text not null check (source in ('update', 'campaign')),
  reused boolean not null default false,
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (client_id, workspace_id) references public.clients (id, owner_id) on delete cascade
);
create index client_briefs_client_idx on public.client_briefs (client_id, created_at desc);
create index client_briefs_workspace_idx on public.client_briefs (workspace_id);
create index client_briefs_brief_idx on public.client_briefs (brief_id);
create index client_briefs_added_by_idx on public.client_briefs (added_by) where added_by is not null;

alter table public.client_briefs enable row level security;
revoke all on public.client_briefs from anon, authenticated;
grant select on public.client_briefs to authenticated;
grant select, insert, delete on public.client_briefs to service_role;

create policy client_briefs_read on public.client_briefs for select to authenticated
  using ((select private.can_use_client(client_id)));
