-- Networking lane (Big Patch Plan, Phase 5, Oct 30, 2026).
--
-- network_accounts: the client's own list of mutuals and viral pages in their niche (up to 20,
-- enforced by the server). Bil reads these accounts only when the client taps Find quotes now;
-- never on a schedule (X's developer terms on tracking named accounts).
-- quote_drafts: Bil's quote posts, written for one client in their voice. The quoted post's
-- excerpt is cleared after 24 hours; the post ID stays for X's own link.
-- quote_pushes: one row per push, for the $3 a month allowance per client.

create table public.network_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  workspace_id uuid not null,
  handle text not null check (handle ~ '^[A-Za-z0-9_]{1,15}$'),
  kind text not null check (kind in ('mutual', 'viral')),
  added_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index network_accounts_unique on public.network_accounts (client_id, lower(handle));
create index network_accounts_workspace_idx on public.network_accounts (workspace_id);
create index network_accounts_added_by_idx on public.network_accounts (added_by);
alter table public.network_accounts enable row level security;
revoke insert, update, delete, truncate on public.network_accounts from authenticated, anon;
create policy network_accounts_read on public.network_accounts for select to authenticated using ((select private.can_use_client(client_id)));

create table public.quote_drafts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  workspace_id uuid not null,
  push_id uuid not null,
  post_id text not null check (post_id ~ '^[0-9]{1,25}$'),
  handle text check (handle ~ '^[A-Za-z0-9_]{1,15}$'),
  excerpt text check (char_length(excerpt) <= 140),
  draft text not null check (char_length(draft) <= 600),
  why text check (char_length(why) <= 300),
  status text not null default 'ready' check (status in ('ready', 'quoted', 'skipped')),
  quote_post_id text check (quote_post_id ~ '^[0-9]{1,25}$'),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  details_expire_at timestamptz not null default now() + interval '24 hours'
);
create index quote_drafts_client_idx on public.quote_drafts (client_id, created_at desc);
create index quote_drafts_post_idx on public.quote_drafts (post_id, created_at desc);
create index quote_drafts_workspace_idx on public.quote_drafts (workspace_id);
alter table public.quote_drafts enable row level security;
revoke insert, update, delete, truncate on public.quote_drafts from authenticated, anon;
create policy quote_drafts_read on public.quote_drafts for select to authenticated using ((select private.can_use_client(client_id)));

create table public.quote_pushes (
  id uuid primary key,
  client_id uuid not null references public.clients (id) on delete cascade,
  workspace_id uuid not null,
  pushed_by uuid references public.members (id) on delete set null,
  posts_read integer not null default 0,
  drafts integer not null default 0,
  cost_usd numeric(10, 4) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now()
);
create index quote_pushes_client_idx on public.quote_pushes (client_id, created_at desc);
create index quote_pushes_workspace_idx on public.quote_pushes (workspace_id);
create index quote_pushes_pushed_by_idx on public.quote_pushes (pushed_by);
alter table public.quote_pushes enable row level security;
revoke insert, update, delete, truncate on public.quote_pushes from authenticated, anon;
create policy quote_pushes_read on public.quote_pushes for select to authenticated using ((select private.can_use_client(client_id)));

create or replace function private.clear_expired_quote_excerpts()
returns integer
language sql security definer set search_path = ''
as $$
  with cleared as (
    update public.quote_drafts set excerpt = null
     where excerpt is not null and details_expire_at <= now()
    returning 1
  )
  select count(*)::integer from cleared;
$$;
revoke all on function private.clear_expired_quote_excerpts() from public, anon, authenticated;
select cron.schedule('clear-expired-quote-excerpts', '19 * * * *', $$select private.clear_expired_quote_excerpts()$$);

insert into private.spend_limits (scope, cap_usd, note)
values ('quotes', 0.30, 'One Find quotes now push: one X search of up to 25 posts from the client''s own Network list, and one Bil call for the drafts.')
on conflict (scope) do update set cap_usd = excluded.cap_usd, note = excluded.note;
