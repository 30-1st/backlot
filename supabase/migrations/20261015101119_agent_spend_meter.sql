-- Agent spending meter and hard caps.
--
-- Every paid call an agent makes (a Grok reply, an X lookup) is RESERVED here before it
-- runs, with an estimate, and SETTLED afterwards with the real cost. A reservation is
-- refused when it would push either limit over:
--   * the month's total across all agents (scope 'month')
--   * one run of that agent (scope = the agent's name, e.g. 'rein')
-- Limits live in a table, so raising them is one UPDATE, no code change.
--
-- Both tables sit in the private schema, which the browser API never exposes. Edge
-- functions reach them only through the three public functions at the bottom, and those
-- are callable by the service role alone.

create table private.spend_limits (
  scope text primary key,
  cap_usd numeric(10, 4) not null check (cap_usd >= 0),
  note text
);

alter table private.spend_limits enable row level security;

insert into private.spend_limits (scope, cap_usd, note) values
  ('month', 5.00, 'All agents together, per calendar month (UTC). Build-phase budget.'),
  ('rein', 0.50, 'One Rein trend fetch.'),
  ('bil', 0.25, 'One Bil campaign draft.'),
  ('check', 0.05, 'One agent-check setup run.');

create table private.spend_ledger (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  run_id uuid not null,
  agent text not null,
  kind text not null,
  status text not null default 'reserved' check (status in ('reserved', 'settled', 'released')),
  estimate_usd numeric(12, 6) not null check (estimate_usd >= 0),
  cost_usd numeric(12, 6) check (cost_usd >= 0),
  trace_id text,
  detail jsonb not null default '{}'::jsonb
);

alter table private.spend_ledger enable row level security;

create index spend_ledger_created_at_idx on private.spend_ledger (created_at);
create index spend_ledger_run_id_idx on private.spend_ledger (run_id);

-- What a row counts toward the limits: its real cost once settled, its estimate while
-- still reserved (a crashed call keeps counting, which errs on the safe side), nothing
-- once released.
create function private.spend_counted(p_status text, p_estimate numeric, p_cost numeric)
returns numeric
language sql immutable set search_path = ''
as $$
  select case p_status when 'released' then 0 when 'settled' then coalesce(p_cost, 0) else p_estimate end;
$$;

create function private.spend_reserve(
  p_run uuid, p_agent text, p_kind text, p_estimate numeric, p_trace text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  month_cap numeric;
  run_cap numeric;
  month_used numeric;
  run_used numeric;
  new_id bigint;
begin
  if p_run is null or coalesce(p_agent, '') = '' or coalesce(p_kind, '') = '' then
    raise exception 'run, agent and kind are required';
  end if;
  if p_estimate is null or p_estimate < 0 then
    raise exception 'estimate must be zero or more';
  end if;

  -- One reservation at a time, so two calls cannot both squeeze under a cap.
  perform pg_advisory_xact_lock(hashtext('backlot.spend'));

  select cap_usd into month_cap from private.spend_limits where scope = 'month';
  select cap_usd into run_cap from private.spend_limits where scope = p_agent;
  if month_cap is null or run_cap is null then
    return jsonb_build_object('ok', false, 'reason', 'no_limit', 'detail', 'No spending limit is set for ' || p_agent);
  end if;

  select coalesce(sum(private.spend_counted(status, estimate_usd, cost_usd)), 0) into month_used
  from private.spend_ledger
  where created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';

  select coalesce(sum(private.spend_counted(status, estimate_usd, cost_usd)), 0) into run_used
  from private.spend_ledger
  where run_id = p_run;

  if month_used + p_estimate > month_cap then
    return jsonb_build_object('ok', false, 'reason', 'month', 'used', month_used, 'cap', month_cap, 'estimate', p_estimate);
  end if;
  if run_used + p_estimate > run_cap then
    return jsonb_build_object('ok', false, 'reason', 'run', 'used', run_used, 'cap', run_cap, 'estimate', p_estimate);
  end if;

  insert into private.spend_ledger (run_id, agent, kind, estimate_usd, trace_id)
  values (p_run, p_agent, p_kind, p_estimate, p_trace)
  returning id into new_id;

  return jsonb_build_object(
    'ok', true, 'id', new_id,
    'month_used', month_used + p_estimate, 'month_cap', month_cap,
    'run_used', run_used + p_estimate, 'run_cap', run_cap
  );
end;
$$;

-- Settle a reservation with what the call really cost. A null cost means the call was
-- never charged (it failed before reaching the provider), so the reservation is released.
create function private.spend_settle(p_id bigint, p_cost numeric, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_cost is not null and p_cost < 0 then
    raise exception 'cost must be zero or more';
  end if;
  update private.spend_ledger
  set status = case when p_cost is null then 'released' else 'settled' end,
      cost_usd = p_cost,
      detail = detail || coalesce(p_detail, '{}'::jsonb)
  where id = p_id and status = 'reserved';
  if not found then
    raise exception 'reservation % is not open', p_id;
  end if;
end;
$$;

create function private.spend_summary()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with month_rows as (
    select agent, private.spend_counted(status, estimate_usd, cost_usd) as counted
    from private.spend_ledger
    where created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
  )
  select jsonb_build_object(
    'month_used', (select coalesce(sum(counted), 0) from month_rows),
    'month_cap', (select cap_usd from private.spend_limits where scope = 'month'),
    'by_agent', (select coalesce(jsonb_object_agg(agent, total), '{}'::jsonb)
                 from (select agent, sum(counted) as total from month_rows group by agent) a),
    'limits', (select jsonb_object_agg(scope, cap_usd) from private.spend_limits)
  );
$$;

-- Public doors for edge functions. Service role only.
create function public.agent_spend_reserve(run uuid, agent text, kind text, estimate numeric, trace text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.spend_reserve(run, agent, kind, estimate, trace); $$;

create function public.agent_spend_settle(reservation bigint, cost numeric, detail jsonb default '{}'::jsonb)
returns void language sql security invoker set search_path = ''
as $$ select private.spend_settle(reservation, cost, detail); $$;

create function public.agent_spend_summary()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.spend_summary(); $$;

revoke all on function public.agent_spend_reserve(uuid, text, text, numeric, text) from public, anon, authenticated;
revoke all on function public.agent_spend_settle(bigint, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.agent_spend_summary() from public, anon, authenticated;
revoke all on function private.spend_reserve(uuid, text, text, numeric, text) from public, anon, authenticated;
revoke all on function private.spend_settle(bigint, numeric, jsonb) from public, anon, authenticated;
revoke all on function private.spend_summary() from public, anon, authenticated;
revoke all on function private.spend_counted(text, numeric, numeric) from public, anon, authenticated;

grant usage on schema private to service_role;
grant execute on function public.agent_spend_reserve(uuid, text, text, numeric, text) to service_role;
grant execute on function public.agent_spend_settle(bigint, numeric, jsonb) to service_role;
grant execute on function public.agent_spend_summary() to service_role;
grant execute on function private.spend_reserve(uuid, text, text, numeric, text) to service_role;
grant execute on function private.spend_settle(bigint, numeric, jsonb) to service_role;
grant execute on function private.spend_summary() to service_role;
grant execute on function private.spend_counted(text, numeric, numeric) to service_role;
