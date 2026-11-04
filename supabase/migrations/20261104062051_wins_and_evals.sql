-- Wins and the eval pipeline (approved by Khma, Nov 4, 2026).
--
-- client_wins   A sale, a booked call, a new subscriber or another win the client or team
--               logs with one tap. The only way Backlot sees the money, so Bil's briefing and
--               the executive's Quality screen can measure against the client's goals.
-- eval_*        Test cases from real work (only for clients who consented), the runs that
--               score them, and each score. Private: only the server reads them, and the
--               executive sees them through an owner-only action.

-- ---------- wins ----------

create table public.client_wins (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  client_id uuid not null,
  kind text not null check (kind in ('sale', 'call', 'subscriber', 'other')),
  amount_usd numeric(10, 2) check (amount_usd is null or (amount_usd >= 0 and amount_usd <= 1000000)),
  note text check (char_length(note) <= 200),
  logged_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (client_id, workspace_id) references public.clients (id, owner_id) on delete cascade
);
create index client_wins_client_idx on public.client_wins (client_id, created_at desc);
create index client_wins_workspace_idx on public.client_wins (workspace_id);
create index client_wins_logged_by_idx on public.client_wins (logged_by) where logged_by is not null;

alter table public.client_wins enable row level security;
revoke all on public.client_wins from anon, authenticated;
grant select on public.client_wins to authenticated;
grant select, insert, delete on public.client_wins to service_role;
create policy client_wins_read on public.client_wins for select to authenticated
  using ((select private.can_use_client(client_id)));

-- ---------- consent for test cases ----------

alter table public.clients add column if not exists eval_consent boolean not null default false;

-- ---------- the eval pipeline (server only: row rules on, no grants to signed-in users) ----------

create table public.eval_cases (
  id uuid primary key default gen_random_uuid(),
  agent text not null check (agent in ('chat', 'plan', 'xev', 'rein')),
  client_id uuid references public.clients (id) on delete cascade,
  -- Where it came from, like "turn:123", so one moment is saved once.
  source text not null check (char_length(source) <= 120),
  -- Everything the agent saw: the message and the context it was built from.
  input jsonb not null check (pg_column_size(input) <= 200000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (agent, source)
);
create index eval_cases_client_idx on public.eval_cases (client_id);

create table public.eval_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('gate', 'daily')),
  -- The knowledge versions in use, so a change to any of them triggers a gate run.
  versions jsonb not null default '{}'::jsonb,
  status text not null default 'running' check (status in ('running', 'passed', 'failed', 'warned', 'error')),
  summary jsonb not null default '{}'::jsonb,
  cost_usd numeric(10, 6) not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index eval_runs_started_idx on public.eval_runs (kind, started_at desc);

create table public.eval_scores (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.eval_runs (id) on delete cascade,
  case_id uuid references public.eval_cases (id) on delete set null,
  agent text not null,
  -- A short label for the moment scored, like "turn 123, Bil".
  label text not null check (char_length(label) <= 160),
  rule_fails text[] not null default '{}',
  judge_score smallint check (judge_score between 1 and 5),
  judge_why text check (char_length(judge_why) <= 400),
  -- The output that was scored, cut short, for the executive to read.
  output text check (char_length(output) <= 2000),
  created_at timestamptz not null default now()
);
create index eval_scores_run_idx on public.eval_scores (run_id);
create index eval_scores_case_idx on public.eval_scores (case_id) where case_id is not null;

alter table public.eval_cases enable row level security;
alter table public.eval_runs enable row level security;
alter table public.eval_scores enable row level security;
revoke all on public.eval_cases, public.eval_runs, public.eval_scores from public, anon, authenticated;
grant select, insert, update, delete on public.eval_cases, public.eval_runs, public.eval_scores to service_role;
grant usage, select on sequence public.eval_scores_id_seq to service_role;

-- Old runs go after 90 days; cases stay until turned off.
create or replace function private.eval_trim() returns void language sql security definer set search_path = '' as $$
  delete from public.eval_runs where started_at < now() - interval '90 days';
$$;
revoke all on function private.eval_trim() from public, anon, authenticated;

-- ---------- the judge's spend cap ----------

insert into private.spend_limits (scope, cap_usd, note) values
  ('eval', 0.04, 'One eval call: a judge scoring one output against a rubric (about $0.002), or one replayed chat answer in a gate run (Bil''s pack can reserve about $0.023). Approved by Khma on 2026-11-04.')
on conflict (scope) do update set cap_usd = excluded.cap_usd, note = excluded.note;

-- ---------- the hourly check ----------

-- Once an hour: the worker runs a gate when any agent's knowledge version changed since the
-- last gate, and the daily sample once a day.
select cron.schedule(
  'eval-tick',
  '41 * * * *',
  $job$
  select net.http_post(
    url := (select value from public.internal_config where key = 'project_url') || '/functions/v1/bil-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-bil-token', (select value from public.internal_config where key = 'bil_worker_token')
    ),
    body := '{"job":"eval"}'::jsonb,
    timeout_milliseconds := 5000
  );
  select private.eval_trim();
  $job$
);

-- Khma manages @litax333 and @litaxluv himself and agreed to use their real work as test cases.
update public.clients set eval_consent = true where x_handle in ('litax333', 'litaxluv');
