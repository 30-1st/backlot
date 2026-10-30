-- Xev, the conversation coach (Xev Roadmap, Oct 30, 2026).
--
-- xev_threads: one per sales conversation the client brings to Xev. Holds only her short
-- summary (stage, the prospect's stated budget and limits, products bought, red flags; no
-- names, no kinks) and the stage history. Deleted 30 days after the last read.
-- xev_reads: one row per read (cost, stage, whether the safety stop fired, whether a reply
-- was used). No images and no chat text, ever.
-- clients.xev_extra: extra reads the executive grants past the 3 free, until payments open.

create table public.xev_threads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  workspace_id uuid not null,
  label text not null default '' check (char_length(label) <= 60),
  summary text not null default '' check (char_length(summary) <= 1200),
  stage text check (stage in ('first_contact', 'intrigue', 'value', 'debate', 'decision', 'afterthought', 'loyalty')),
  stages jsonb not null default '[]'::jsonb check (jsonb_typeof(stages) = 'array'),
  outcome text check (outcome in ('closed', 'not_closed')),
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index xev_threads_client_idx on public.xev_threads (client_id, updated_at desc);
create index xev_threads_workspace_idx on public.xev_threads (workspace_id);
create index xev_threads_created_by_idx on public.xev_threads (created_by);
alter table public.xev_threads enable row level security;
revoke insert, update, delete, truncate on public.xev_threads from authenticated, anon;
create policy xev_threads_read on public.xev_threads for select to authenticated using ((select private.can_use_client(client_id)));

create table public.xev_reads (
  id uuid primary key,
  client_id uuid not null references public.clients (id) on delete cascade,
  workspace_id uuid not null,
  thread_id uuid references public.xev_threads (id) on delete set null,
  read_by uuid references public.members (id) on delete set null,
  images smallint not null check (images between 1 and 3),
  stage text check (stage in ('first_contact', 'intrigue', 'value', 'debate', 'decision', 'afterthought', 'loyalty')),
  stopped boolean not null default false,
  used boolean not null default false,
  cost_usd numeric(10, 4) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now()
);
create index xev_reads_client_idx on public.xev_reads (client_id, created_at desc);
create index xev_reads_workspace_idx on public.xev_reads (workspace_id);
create index xev_reads_thread_idx on public.xev_reads (thread_id);
create index xev_reads_read_by_idx on public.xev_reads (read_by);
alter table public.xev_reads enable row level security;
revoke insert, update, delete, truncate on public.xev_reads from authenticated, anon;
create policy xev_reads_read on public.xev_reads for select to authenticated using ((select private.can_use_client(client_id)));

alter table public.clients add column xev_extra integer not null default 0 check (xev_extra between 0 and 1000);

create or replace function private.clear_old_xev_threads()
returns integer
language sql security definer set search_path = ''
as $$
  with gone as (delete from public.xev_threads where updated_at < now() - interval '30 days' returning 1)
  select count(*)::integer from gone;
$$;
revoke all on function private.clear_old_xev_threads() from public, anon, authenticated;
select cron.schedule('clear-old-xev-threads', '29 3 * * *', $$select private.clear_old_xev_threads()$$);

insert into private.spend_limits (scope, cap_usd, note) values
  ('xev', 0.05, 'One Xev read: one Grok 4.3 call with up to 3 screenshots. Set at about 3 times the expected cost until measured.'),
  ('xev_month', 10.00, 'Xev for all clients together, per calendar month (UTC), checked from xev_reads.')
on conflict (scope) do update set cap_usd = excluded.cap_usd, note = excluded.note;
