-- Toolbox data: clients, voice cards, post-type libraries, Rein's briefs and their
-- evidence, Bil's reviews, and campaigns.
--
-- Access rules:
--   * Client data belongs to the Backlot account that created it (owner_id). Each
--     table's policies let only that account read or change it. Child tables carry
--     owner_id too, tied to the client's owner by a composite foreign key, so the
--     policy is a plain indexed equality check.
--   * Niche briefs are about public topics only, never about clients, so any signed-in
--     account may read them. Only the server writes them.
--   * Stored X excerpts are cleared 24 hours after they are saved (our rule: IDs and
--     short excerpts only). Post IDs stay, so the official X embed still works.

-- ---------- helpers ----------

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------- clients ----------

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  x_handle text not null check (x_handle ~ '^[A-Za-z0-9_]{1,15}$'),
  -- Looked up once at intake. X user IDs never change, so this is paid for once.
  x_user_id text check (x_user_id ~ '^[0-9]{1,25}$'),
  profile jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);
create unique index clients_owner_handle_key on public.clients (owner_id, lower(x_handle));
create trigger clients_touch before update on public.clients
  for each row execute function private.touch_updated_at();

-- ---------- voice cards and post-type libraries (one per client) ----------

create table public.voice_cards (
  client_id uuid primary key,
  owner_id uuid not null,
  version integer not null default 1 check (version >= 1),
  card jsonb not null,
  approved_by_client boolean not null default false,
  updated_at timestamptz not null default now(),
  foreign key (client_id, owner_id) references public.clients (id, owner_id) on delete cascade
);
create index voice_cards_owner_idx on public.voice_cards (owner_id);
create trigger voice_cards_touch before update on public.voice_cards
  for each row execute function private.touch_updated_at();

create table public.post_type_libraries (
  client_id uuid primary key,
  owner_id uuid not null,
  library jsonb not null,
  updated_at timestamptz not null default now(),
  foreign key (client_id, owner_id) references public.clients (id, owner_id) on delete cascade
);
create index post_type_libraries_owner_idx on public.post_type_libraries (owner_id);
create trigger post_type_libraries_touch before update on public.post_type_libraries
  for each row execute function private.touch_updated_at();

-- ---------- Rein's niche briefs (shared, public topics only) ----------

create table public.niche_briefs (
  id uuid primary key default gen_random_uuid(),
  -- Normalized niche (lowercase, single spaces), so the same niche reuses one brief.
  niche_key text not null check (niche_key = lower(regexp_replace(btrim(niche_key), '\s+', ' ', 'g'))),
  brief jsonb not null,
  created_at timestamptz not null default now(),
  -- Reused for 6 hours, well inside the 24 to 48 hour window a trend stays useful.
  reuse_until timestamptz not null default now() + interval '6 hours'
);
create index niche_briefs_lookup_idx on public.niche_briefs (niche_key, reuse_until desc);

create table public.brief_evidence (
  brief_id uuid not null references public.niche_briefs (id) on delete cascade,
  trend_index smallint not null check (trend_index between 0 and 9),
  post_id text not null check (post_id ~ '^[0-9]{1,25}$'),
  excerpt text check (char_length(excerpt) <= 120),
  excerpt_expires_at timestamptz not null default now() + interval '24 hours',
  primary key (brief_id, trend_index, post_id)
);
create index brief_evidence_expiry_idx on public.brief_evidence (excerpt_expires_at)
  where excerpt is not null;

-- ---------- Bil's reviews and campaigns ----------

create table public.brief_reviews (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.niche_briefs (id) on delete cascade,
  client_id uuid not null,
  owner_id uuid not null,
  review jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (client_id, owner_id) references public.clients (id, owner_id) on delete cascade
);
create index brief_reviews_brief_idx on public.brief_reviews (brief_id);
create index brief_reviews_client_idx on public.brief_reviews (client_id, owner_id);
create index brief_reviews_owner_idx on public.brief_reviews (owner_id);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  owner_id uuid not null,
  status text not null default 'planning'
    check (status in ('planning', 'drafting', 'ready', 'approved', 'blocked', 'failed')),
  plan jsonb,
  campaign jsonb,
  posts_total integer not null default 0 check (posts_total >= 0),
  posts_done integer not null default 0 check (posts_done >= 0 and posts_done <= posts_total),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (client_id, owner_id) references public.clients (id, owner_id) on delete cascade
);
create index campaigns_client_idx on public.campaigns (client_id, owner_id);
create index campaigns_owner_idx on public.campaigns (owner_id, created_at desc);
create trigger campaigns_touch before update on public.campaigns
  for each row execute function private.touch_updated_at();

-- ---------- privileges and row level security ----------

revoke all on public.clients, public.voice_cards, public.post_type_libraries, public.niche_briefs,
  public.brief_evidence, public.brief_reviews, public.campaigns from anon;

alter table public.clients enable row level security;
alter table public.voice_cards enable row level security;
alter table public.post_type_libraries enable row level security;
alter table public.niche_briefs enable row level security;
alter table public.brief_evidence enable row level security;
alter table public.brief_reviews enable row level security;
alter table public.campaigns enable row level security;

-- Owner-only tables: one policy each for read, add, change, remove.
do $$
declare t text;
begin
  foreach t in array array['clients', 'voice_cards', 'post_type_libraries', 'brief_reviews', 'campaigns'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = owner_id)', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = owner_id)', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = owner_id)', t || '_delete_own', t);
  end loop;
end;
$$;

-- Shared briefs: any signed-in account reads; only the server (service role) writes.
create policy niche_briefs_read on public.niche_briefs for select to authenticated using (true);
create policy brief_evidence_read on public.brief_evidence for select to authenticated using (true);
revoke insert, update, delete on public.niche_briefs, public.brief_evidence from authenticated;

-- ---------- excerpt expiry ----------

create or replace function private.clear_expired_excerpts()
returns integer
language sql
security definer
set search_path = ''
as $$
  with cleared as (
    update public.brief_evidence
       set excerpt = null
     where excerpt is not null
       and excerpt_expires_at <= now()
    returning 1
  )
  select count(*)::integer from cleared;
$$;
revoke all on function private.clear_expired_excerpts() from public, anon, authenticated;

select cron.schedule('clear-expired-x-excerpts', '7 * * * *', $$select private.clear_expired_excerpts()$$);

-- ---------- spend caps ----------

insert into private.spend_limits (scope, cap_usd, note)
values ('campaign', 1.00, 'One whole campaign: the plan plus every drafting batch. Each Bil call is also held to the bil cap.')
on conflict (scope) do update set cap_usd = excluded.cap_usd, note = excluded.note;
