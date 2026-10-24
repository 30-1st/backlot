-- K0, Kris for clients: one chat per client between Kris (the client's publicist), the
-- client and the team.
--
--   * kris_messages: the chat. Only the server writes it. The team and that client may
--     read it; visitors never can. Messages go after 30 days (approved Oct 23).
--   * kris_prefs: plain notices instead of pitches, and quiet hours. Set by the team or
--     the client through kris_set_prefs.
--   * Kris's AI time is metered per client: $3 a month per client and $10 a month for
--     Kris in total (approved Oct 23), on top of the month cap for all agents.

-- ---------- per-client spend ----------

alter table private.spend_ledger add column client_id uuid;
create index spend_ledger_client_idx on private.spend_ledger (client_id, created_at) where client_id is not null;

insert into private.spend_limits (scope, cap_usd, note) values
  ('kris', 0.0200, 'One Kris reply.'),
  ('kris_client', 3.0000, 'Kris, per client, per calendar month (UTC).'),
  ('kris_month', 10.0000, 'Kris for all clients together, per calendar month (UTC).')
on conflict (scope) do nothing;

-- Checks the client's and Kris's monthly caps, then makes the usual reservation and tags
-- it with the client. The advisory lock is the same one spend_reserve takes, so the two
-- checks and the insert happen as one.
create function private.spend_reserve_client(
  p_run uuid, p_agent text, p_kind text, p_estimate numeric, p_trace text, p_client uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_client_cap numeric;
  v_agent_cap numeric;
  v_client_used numeric;
  v_agent_used numeric;
  v_out jsonb;
begin
  if p_client is null then
    raise exception 'client is required';
  end if;
  perform pg_advisory_xact_lock(hashtext('backlot.spend'));

  select cap_usd into v_client_cap from private.spend_limits where scope = p_agent || '_client';
  select cap_usd into v_agent_cap from private.spend_limits where scope = p_agent || '_month';
  if v_client_cap is null or v_agent_cap is null then
    return jsonb_build_object('ok', false, 'reason', 'no_limit', 'detail', 'No per-client limit is set for ' || p_agent);
  end if;

  select coalesce(sum(private.spend_counted(status, estimate_usd, cost_usd)), 0) into v_client_used
    from private.spend_ledger
   where client_id = p_client and agent = p_agent and created_at >= v_start;
  if v_client_used + p_estimate > v_client_cap then
    return jsonb_build_object('ok', false, 'reason', 'client', 'used', v_client_used, 'cap', v_client_cap, 'estimate', p_estimate);
  end if;

  select coalesce(sum(private.spend_counted(status, estimate_usd, cost_usd)), 0) into v_agent_used
    from private.spend_ledger
   where agent = p_agent and created_at >= v_start;
  if v_agent_used + p_estimate > v_agent_cap then
    return jsonb_build_object('ok', false, 'reason', 'agent_month', 'used', v_agent_used, 'cap', v_agent_cap, 'estimate', p_estimate);
  end if;

  v_out := private.spend_reserve(p_run, p_agent, p_kind, p_estimate, p_trace);
  if (v_out ->> 'ok')::boolean then
    update private.spend_ledger set client_id = p_client where id = (v_out ->> 'id')::bigint;
  end if;
  return v_out;
end;
$$;

create function public.agent_spend_reserve_client(run uuid, agent text, kind text, estimate numeric, trace text, client uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.spend_reserve_client(run, agent, kind, estimate, trace, client); $$;

revoke all on function private.spend_reserve_client(uuid, text, text, numeric, text, uuid) from public, anon, authenticated;
revoke all on function public.agent_spend_reserve_client(uuid, text, text, numeric, text, uuid) from public, anon, authenticated;
grant execute on function private.spend_reserve_client(uuid, text, text, numeric, text, uuid) to service_role;
grant execute on function public.agent_spend_reserve_client(uuid, text, text, numeric, text, uuid) to service_role;

-- ---------- the chat ----------

create table public.kris_messages (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  client_id uuid not null,
  role text not null check (role in ('kris', 'client', 'team')),
  author_id uuid references auth.users (id) on delete set null,
  kind text not null default 'chat' check (kind in ('chat', 'note', 'pitch')),
  body text not null check (char_length(body) between 1 and 2000),
  -- Drafts shown as cards: [{ "campaignId": uuid, "slot": int }], at most 3.
  cards jsonb check (cards is null or (jsonb_typeof(cards) = 'array' and jsonb_array_length(cards) <= 3)),
  -- Where a note points in the app, like "reports" or "campaigns.<id>".
  link text check (char_length(link) <= 80),
  -- One proactive note per event, like "campaign:<id>:ready".
  ref text check (char_length(ref) <= 120),
  created_at timestamptz not null default now(),
  foreign key (client_id, workspace_id) references public.clients (id, owner_id) on delete cascade
);
create index kris_messages_client_idx on public.kris_messages (client_id, id desc);
create index kris_messages_workspace_idx on public.kris_messages (workspace_id);
create index kris_messages_author_idx on public.kris_messages (author_id) where author_id is not null;
create index kris_messages_created_idx on public.kris_messages (created_at);
create unique index kris_messages_ref_idx on public.kris_messages (client_id, ref) where ref is not null;

alter table public.kris_messages enable row level security;
revoke all on public.kris_messages from anon, authenticated;
grant select on public.kris_messages to authenticated;
grant select, insert, delete on public.kris_messages to service_role;
create policy kris_messages_read on public.kris_messages for select to authenticated
  using ((select private.can_use_client(client_id)));

-- ---------- preferences ----------

create table public.kris_prefs (
  client_id uuid primary key,
  workspace_id uuid not null,
  plain boolean not null default false,
  quiet_from smallint not null default 21 check (quiet_from between 0 and 23),
  quiet_to smallint not null default 9 check (quiet_to between 0 and 23),
  last_pitch_at timestamptz,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (client_id, workspace_id) references public.clients (id, owner_id) on delete cascade
);
create index kris_prefs_workspace_idx on public.kris_prefs (workspace_id);
create index kris_prefs_updated_by_idx on public.kris_prefs (updated_by) where updated_by is not null;

alter table public.kris_prefs enable row level security;
revoke all on public.kris_prefs from anon, authenticated;
grant select on public.kris_prefs to authenticated;
grant select, insert, update on public.kris_prefs to service_role;
create policy kris_prefs_read on public.kris_prefs for select to authenticated
  using ((select private.can_use_client(client_id)));

create or replace function public.kris_set_prefs(p_client uuid, p_plain boolean, p_quiet_from integer, p_quiet_to integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  if not (select private.can_use_client(p_client)) then
    raise exception 'Not your client' using errcode = '42501';
  end if;
  if p_quiet_from not between 0 and 23 or p_quiet_to not between 0 and 23 then
    raise exception 'Quiet hours run from 0 to 23' using errcode = '22023';
  end if;
  select owner_id into v_ws from public.clients where id = p_client;
  insert into public.kris_prefs (client_id, workspace_id, plain, quiet_from, quiet_to, updated_by, updated_at)
  values (p_client, v_ws, p_plain, p_quiet_from, p_quiet_to, (select auth.uid()), now())
  on conflict (client_id) do update
    set plain = excluded.plain, quiet_from = excluded.quiet_from, quiet_to = excluded.quiet_to,
        updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke all on function public.kris_set_prefs(uuid, boolean, integer, integer) from public, anon;
grant execute on function public.kris_set_prefs(uuid, boolean, integer, integer) to authenticated;

-- ---------- 30-day retention ----------

create or replace function private.clear_old_kris_messages()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.kris_messages where created_at < now() - interval '30 days' returning 1
  )
  select count(*)::integer from gone;
$$;
revoke all on function private.clear_old_kris_messages() from public, anon, authenticated;

select cron.schedule('clear-old-kris-messages', '23 4 * * *', $$select private.clear_old_kris_messages()$$);
