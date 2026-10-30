-- Game Plan (Big Patch Plan, Phase 4, Oct 30, 2026).
--
-- game_plans: what the client sells and to whom, and their goals. Free and unlimited to edit,
-- by the client or a team member granted that client. Bil reads it in every meeting.
-- game_plan_meetings: Bil's opportunity meetings, the paid unit. One free every 14 days per
-- client; more are requested and the executive runs them (until payments open, then $50).

create table public.game_plans (
  client_id uuid primary key references public.clients (id) on delete cascade,
  workspace_id uuid not null,
  sells_to text not null default '' check (char_length(sells_to) <= 1000),
  appeals_to text not null default '' check (char_length(appeals_to) <= 1000),
  products jsonb not null default '[]'::jsonb check (jsonb_typeof(products) = 'array' and jsonb_array_length(products) <= 20),
  goals text not null default '' check (char_length(goals) <= 1000),
  updated_by uuid references public.members (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index game_plans_workspace_idx on public.game_plans (workspace_id);
create index game_plans_updated_by_idx on public.game_plans (updated_by);
alter table public.game_plans enable row level security;
revoke insert, update, delete, truncate on public.game_plans from authenticated, anon;
create policy game_plans_read on public.game_plans for select to authenticated using ((select private.can_use_client(client_id)));

create table public.game_plan_meetings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  workspace_id uuid not null,
  kind text not null check (kind in ('free', 'extra')),
  status text not null check (status in ('requested', 'ready', 'failed', 'declined')),
  meeting jsonb,
  brief_id uuid,
  cost_usd numeric(10, 4) not null default 0 check (cost_usd >= 0),
  requested_by uuid references public.members (id) on delete set null,
  run_by uuid references public.members (id) on delete set null,
  error text check (char_length(error) <= 300),
  created_at timestamptz not null default now(),
  ready_at timestamptz
);
create index game_plan_meetings_client_idx on public.game_plan_meetings (client_id, created_at desc);
create index game_plan_meetings_workspace_idx on public.game_plan_meetings (workspace_id);
create index game_plan_meetings_requested_by_idx on public.game_plan_meetings (requested_by);
create index game_plan_meetings_run_by_idx on public.game_plan_meetings (run_by);
alter table public.game_plan_meetings enable row level security;
revoke insert, update, delete, truncate on public.game_plan_meetings from authenticated, anon;
create policy game_plan_meetings_read on public.game_plan_meetings for select to authenticated using ((select private.can_use_client(client_id)));

insert into private.spend_limits (scope, cap_usd, note)
values ('game_plan', 1.50, 'One Game Plan meeting: one Bil call on the strong model (a Rein brief, when one is needed, runs under its own cap).')
on conflict (scope) do update set cap_usd = excluded.cap_usd, note = excluded.note;
