-- K2: Kris talks in the rooms, and the spending meter gets faster.
--
-- 1. Spending meter, version 2. Running monthly totals replace adding up the whole month
--    on every reservation, and the one global lock is gone. Each reservation now locks
--    only its own run (for the per-run cap) and updates the totals it counts toward, in
--    one step that refuses past a cap. The ledger stays the record of every call.
-- 2. Kris's money: each client's $3 a month, of which $0.50 is kept for the client's own
--    chat with Kris in Backlot (rooms stop at $2.50); Kris's $10 overall; a separate $1 a
--    month for test chats (all approved by Khma, Oct 24, 2026).
-- 3. Visitor chats: visits and messages, kept 30 days, readable by the team only (for
--    safety review). The client sees daily counts.
-- 4. Rooms get a Kris chat switch (off until the 50 test chats pass) and six archetype looks.

-- ---------- 1. the meter ----------

create table private.spend_totals (
  scope text not null,
  month date not null,
  used numeric(12, 6) not null default 0,
  primary key (scope, month)
);
alter table private.spend_totals enable row level security;
revoke all on private.spend_totals from public, anon, authenticated;

-- Which totals each ledger row counts toward, so settling adjusts the same ones.
alter table private.spend_ledger add column scopes text[] not null default '{all}';
create index spend_ledger_run_agent_idx on private.spend_ledger (run_id, agent);

insert into private.spend_limits (scope, cap_usd, note) values
  ('kris_client_keep', 0.5000, 'Of each client''s Kris allowance, kept for their own chat with Kris in Backlot. Rooms stop short of it.'),
  ('kris_test', 0.0200, 'One test-chat reply.'),
  ('kris_test_month', 1.0000, 'Kris test chats, per calendar month (UTC).')
on conflict (scope) do nothing;

create or replace function private.month_start()
returns date
language sql
stable
set search_path = ''
as $$ select (date_trunc('month', now() at time zone 'utc'))::date; $$;

-- This month's totals, from the ledger, for the scopes we track.
insert into private.spend_totals (scope, month, used)
select 'all', private.month_start(), coalesce(sum(private.spend_counted(status, estimate_usd, cost_usd)), 0)
  from private.spend_ledger
 where created_at >= private.month_start()::timestamp at time zone 'utc'
on conflict (scope, month) do update set used = excluded.used;

insert into private.spend_totals (scope, month, used)
select 'kris', private.month_start(), coalesce(sum(private.spend_counted(status, estimate_usd, cost_usd)), 0)
  from private.spend_ledger
 where agent = 'kris' and created_at >= private.month_start()::timestamp at time zone 'utc'
on conflict (scope, month) do update set used = excluded.used;

insert into private.spend_totals (scope, month, used)
select 'kris:' || client_id::text, private.month_start(), sum(private.spend_counted(status, estimate_usd, cost_usd))
  from private.spend_ledger
 where agent = 'kris' and client_id is not null and created_at >= private.month_start()::timestamp at time zone 'utc'
 group by client_id
on conflict (scope, month) do update set used = excluded.used;

update private.spend_ledger
   set scopes = case when agent = 'kris' and client_id is not null then array['all', 'kris', 'kris:' || client_id::text]
                     when agent = 'kris' then array['all', 'kris']
                     else array['all'] end;

-- Adds an amount to one total if it stays within the cap. Raises 'cap:<reason>' if not,
-- so the caller's block rolls back every total it already raised.
create or replace function private.spend_add(p_scope text, p_amount numeric, p_cap numeric, p_reason text)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v numeric;
begin
  insert into private.spend_totals (scope, month, used) values (p_scope, private.month_start(), 0)
  on conflict (scope, month) do nothing;
  update private.spend_totals
     set used = used + p_amount
   where scope = p_scope and month = private.month_start() and (p_cap is null or used + p_amount <= p_cap)
  returning used into v;
  if v is null then
    raise exception 'cap:%', p_reason;
  end if;
  return v;
end;
$$;
revoke all on function private.spend_add(text, numeric, numeric, text) from public, anon, authenticated;

-- Shared core: per-run cap (locking only this run), then each total in turn.
create or replace function private.spend_reserve_core(
  p_run uuid, p_agent text, p_kind text, p_estimate numeric, p_trace text, p_client uuid,
  p_run_scope text, p_totals jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_cap numeric;
  v_run_used numeric;
  v_scopes text[] := '{}';
  t jsonb;
  v_id bigint;
begin
  if p_run is null or coalesce(p_agent, '') = '' or coalesce(p_kind, '') = '' then
    raise exception 'run, agent and kind are required';
  end if;
  if p_estimate is null or p_estimate < 0 then
    raise exception 'estimate must be zero or more';
  end if;
  select cap_usd into v_run_cap from private.spend_limits where scope = p_run_scope;
  if v_run_cap is null then
    return jsonb_build_object('ok', false, 'reason', 'no_limit', 'detail', 'No spending limit is set for ' || p_run_scope);
  end if;

  -- Only calls in the same run wait for each other.
  perform pg_advisory_xact_lock(hashtextextended('backlot.spend.run:' || p_run::text, 0));
  select coalesce(sum(private.spend_counted(status, estimate_usd, cost_usd)), 0) into v_run_used
    from private.spend_ledger where run_id = p_run;
  if v_run_used + p_estimate > v_run_cap then
    return jsonb_build_object('ok', false, 'reason', 'run', 'used', v_run_used, 'cap', v_run_cap, 'estimate', p_estimate);
  end if;

  begin
    for t in select * from jsonb_array_elements(p_totals) loop
      perform private.spend_add(t ->> 'scope', p_estimate, (t ->> 'cap')::numeric, t ->> 'reason');
      v_scopes := v_scopes || (t ->> 'scope');
    end loop;
  exception when raise_exception then
    if sqlerrm like 'cap:%' then
      return jsonb_build_object('ok', false, 'reason', substr(sqlerrm, 5), 'estimate', p_estimate);
    end if;
    raise;
  end;

  insert into private.spend_ledger (run_id, agent, kind, estimate_usd, trace_id, client_id, scopes)
  values (p_run, p_agent, p_kind, p_estimate, p_trace, p_client, v_scopes)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'run_used', v_run_used + p_estimate, 'run_cap', v_run_cap);
end;
$$;
revoke all on function private.spend_reserve_core(uuid, text, text, numeric, text, uuid, text, jsonb) from public, anon, authenticated;

-- Every agent: per-run cap plus the month cap for all agents together.
create or replace function private.spend_reserve(p_run uuid, p_agent text, p_kind text, p_estimate numeric, p_trace text default null)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.spend_reserve_core(
    p_run, p_agent, p_kind, p_estimate, p_trace, null, p_agent,
    jsonb_build_array(jsonb_build_object('scope', 'all', 'cap', (select cap_usd from private.spend_limits where scope = 'month'), 'reason', 'month'))
  );
$$;

-- Kris: per-reply cap, then the client's allowance (rooms stop $0.50 short), Kris's
-- overall cap and the month cap. Test chats use their own $1 instead of a client's.
create or replace function private.kris_reserve(p_run uuid, p_kind text, p_estimate numeric, p_trace text, p_client uuid, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap_client numeric := (select cap_usd from private.spend_limits where scope = 'kris_client');
  v_keep numeric := (select cap_usd from private.spend_limits where scope = 'kris_client_keep');
  v_cap_kris numeric := (select cap_usd from private.spend_limits where scope = 'kris_month');
  v_cap_test numeric := (select cap_usd from private.spend_limits where scope = 'kris_test_month');
  v_cap_month numeric := (select cap_usd from private.spend_limits where scope = 'month');
begin
  if p_mode not in ('client', 'room', 'test') then
    raise exception 'mode must be client, room or test';
  end if;
  if p_mode = 'test' then
    return private.spend_reserve_core(p_run, 'kris', p_kind, p_estimate, p_trace, p_client, 'kris_test', jsonb_build_array(
      jsonb_build_object('scope', 'kris_test', 'cap', v_cap_test, 'reason', 'test_month'),
      jsonb_build_object('scope', 'all', 'cap', v_cap_month, 'reason', 'month')));
  end if;
  if p_client is null then
    raise exception 'client is required';
  end if;
  return private.spend_reserve_core(p_run, 'kris', p_kind, p_estimate, p_trace, p_client, 'kris', jsonb_build_array(
    jsonb_build_object('scope', 'kris:' || p_client::text, 'cap', case when p_mode = 'room' then v_cap_client - v_keep else v_cap_client end, 'reason', 'client'),
    jsonb_build_object('scope', 'kris', 'cap', v_cap_kris, 'reason', 'agent_month'),
    jsonb_build_object('scope', 'all', 'cap', v_cap_month, 'reason', 'month')));
end;
$$;
revoke all on function private.kris_reserve(uuid, text, numeric, text, uuid, text) from public, anon, authenticated;

create or replace function public.kris_spend_reserve(run uuid, kind text, estimate numeric, trace text, client uuid, mode text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.kris_reserve(run, kind, estimate, trace, client, mode); $$;
revoke all on function public.kris_spend_reserve(uuid, text, numeric, text, uuid, text) from public, anon, authenticated;
grant execute on function public.kris_spend_reserve(uuid, text, numeric, text, uuid, text) to service_role;
grant execute on function private.kris_reserve(uuid, text, numeric, text, uuid, text) to service_role;

-- K0's door now goes through the same Kris meter, as the client's own chat.
create or replace function private.spend_reserve_client(p_run uuid, p_agent text, p_kind text, p_estimate numeric, p_trace text, p_client uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.kris_reserve(p_run, p_kind, p_estimate, p_trace, p_client, 'client'); $$;

-- Settling moves each total by the difference between what was reserved and what it cost.
create or replace function private.spend_settle(p_id bigint, p_cost numeric, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row private.spend_ledger;
  v_delta numeric;
  v_month date;
begin
  if p_cost is not null and p_cost < 0 then
    raise exception 'cost must be zero or more';
  end if;
  update private.spend_ledger
     set status = case when p_cost is null then 'released' else 'settled' end,
         cost_usd = p_cost,
         detail = detail || coalesce(p_detail, '{}'::jsonb)
   where id = p_id and status = 'reserved'
  returning * into v_row;
  if v_row.id is null then
    raise exception 'reservation % is not open', p_id;
  end if;
  v_delta := coalesce(p_cost, 0) - v_row.estimate_usd;
  v_month := (date_trunc('month', v_row.created_at at time zone 'utc'))::date;
  if v_delta <> 0 then
    update private.spend_totals set used = greatest(0, used + v_delta)
     where month = v_month and scope = any (v_row.scopes);
  end if;
end;
$$;

grant execute on function private.spend_add(text, numeric, numeric, text) to service_role;
grant execute on function private.spend_reserve_core(uuid, text, text, numeric, text, uuid, text, jsonb) to service_role;
grant execute on function private.month_start() to service_role;

-- ---------- 3. visitor chats ----------

create table public.room_visits (
  id uuid primary key,
  client_id uuid not null,
  workspace_id uuid not null,
  started_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  ai_replies integer not null default 0 check (ai_replies >= 0),
  minor boolean not null default false,
  crisis boolean not null default false,
  test boolean not null default false,
  foreign key (client_id, workspace_id) references public.clients (id, owner_id) on delete cascade
);
create index room_visits_client_idx on public.room_visits (client_id, started_at desc);
create index room_visits_client_workspace_idx on public.room_visits (client_id, workspace_id);
create index room_visits_workspace_idx on public.room_visits (workspace_id);
create index room_visits_started_idx on public.room_visits (started_at);

create table public.room_messages (
  id bigint generated always as identity primary key,
  visit_id uuid not null references public.room_visits (id) on delete cascade,
  seq integer not null check (seq >= 1),
  role text not null check (role in ('visitor', 'kris')),
  body text not null check (char_length(body) between 1 and 1200),
  links smallint[] not null default '{}' check (cardinality(links) <= 3),
  source text not null default 'ai' check (source in ('visitor', 'ai', 'faq', 'fixed', 'redirect')),
  created_at timestamptz not null default now(),
  unique (visit_id, seq)
);

alter table public.room_visits enable row level security;
alter table public.room_messages enable row level security;
revoke all on public.room_visits, public.room_messages from anon, authenticated;
grant select on public.room_visits, public.room_messages to authenticated;
grant select, insert, update, delete on public.room_visits, public.room_messages to service_role;

-- The team only: chats are kept for safety review, never shown to the client.
create policy room_visits_team on public.room_visits for select to authenticated
  using (workspace_id = (select private.my_team_workspace()));
create policy room_messages_team on public.room_messages for select to authenticated
  using (exists (select 1 from public.room_visits v where v.id = visit_id and v.workspace_id = (select private.my_team_workspace())));

create or replace function public.room_visit_delete(p_visit uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.room_visits v where v.id = p_visit and v.workspace_id = (select private.my_team_workspace());
  if not found then
    raise exception 'Only the team can delete a visitor chat' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.room_visit_delete(uuid) from public, anon;
grant execute on function public.room_visit_delete(uuid) to authenticated;

-- Daily counts the client and team can see.
create table public.room_counts (
  client_id uuid not null,
  workspace_id uuid not null,
  day date not null,
  visits integer not null default 0,
  chats integer not null default 0,
  ai_replies integer not null default 0,
  faq_taps integer not null default 0,
  link_taps integer not null default 0,
  redirects integer not null default 0,
  primary key (client_id, day),
  foreign key (client_id, workspace_id) references public.clients (id, owner_id) on delete cascade
);
create index room_counts_client_workspace_idx on public.room_counts (client_id, workspace_id);
create index room_counts_workspace_idx on public.room_counts (workspace_id);
alter table public.room_counts enable row level security;
revoke all on public.room_counts from anon, authenticated;
grant select on public.room_counts to authenticated;
grant select, insert, update on public.room_counts to service_role;
create policy room_counts_read on public.room_counts for select to authenticated
  using ((select private.can_use_client(client_id)));

create or replace function public.room_count(p_client uuid, p_field text, p_n integer default 1)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  if p_field not in ('visits', 'chats', 'ai_replies', 'faq_taps', 'link_taps', 'redirects') or p_n not between 1 and 100 then
    raise exception 'bad count';
  end if;
  select owner_id into v_ws from public.clients where id = p_client;
  if v_ws is null then
    return;
  end if;
  execute format(
    'insert into public.room_counts (client_id, workspace_id, day, %1$I) values ($1, $2, (now() at time zone ''utc'')::date, $3)
     on conflict (client_id, day) do update set %1$I = public.room_counts.%1$I + excluded.%1$I', p_field)
  using p_client, v_ws, p_n;
end;
$$;
revoke all on function public.room_count(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.room_count(uuid, text, integer) to service_role;

-- Chats go after 30 days (messages go with their visit). Counts stay.
create or replace function private.clear_old_room_chats()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (delete from public.room_visits where started_at < now() - interval '30 days' returning 1)
  select count(*)::integer from gone;
$$;
revoke all on function private.clear_old_room_chats() from public, anon, authenticated;
select cron.schedule('clear-old-room-chats', '29 4 * * *', $$select private.clear_old_room_chats()$$);

-- ---------- 4. rooms: chat switch and archetype looks ----------

alter table public.rooms add column chat_on boolean not null default false;
alter table public.rooms drop constraint rooms_preset_check;
update public.rooms set preset = case when preset = 'creator_adult' then 'ruler' else 'creator' end
 where preset in ('creator', 'creator_adult');
alter table public.rooms add constraint rooms_preset_check check (preset in ('ruler', 'creator', 'jester', 'rebel', 'sage', 'lover'));
alter table public.rooms alter column preset set default 'creator';

-- Chat can only be switched on once the 50 test chats have passed (set by Backlot, not the app).
insert into public.internal_config (key, value) values ('kris_rooms_ready', 'no')
on conflict (key) do nothing;

drop function public.room_set(uuid, text, text, text, text, text, jsonb, uuid, boolean);

create function public.room_set(
  p_client uuid,
  p_slug text,
  p_status text,
  p_preset text,
  p_accent text,
  p_greeting text,
  p_buttons jsonb,
  p_hero uuid,
  p_hero_clean boolean default false,
  p_chat_on boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid := (select private.my_team_workspace());
  v_profile jsonb;
  v_links integer;
  v_adult boolean;
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_old_hero uuid;
  v_old_by uuid;
  v_old_at timestamptz;
  b jsonb;
begin
  select c.profile into v_profile from public.clients c where c.id = p_client and c.owner_id = v_ws;
  if v_ws is null or v_profile is null then
    raise exception 'Only the team can set up a client''s room' using errcode = '42501';
  end if;
  v_adult := coalesce((v_profile ->> 'adultContent')::boolean, false);
  v_links := coalesce(jsonb_array_length(case when jsonb_typeof(v_profile -> 'links') = 'array' then v_profile -> 'links' end), 0);
  select r.hero_id, r.hero_clean_by, r.hero_clean_at into v_old_hero, v_old_by, v_old_at from public.rooms r where r.client_id = p_client;

  if v_slug !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'Use 3 to 30 letters, numbers or underscores for the room name' using errcode = '22023';
  end if;
  if private.room_slug_reserved(v_slug) then
    raise exception 'That room name is reserved. Pick another' using errcode = '22023';
  end if;
  if exists (select 1 from public.rooms r where r.slug = v_slug and r.client_id <> p_client) then
    raise exception 'That room name is taken. Pick another' using errcode = '23505';
  end if;
  if p_status not in ('draft', 'preview', 'open', 'closed') then
    raise exception 'No such status' using errcode = '22023';
  end if;
  if p_preset not in ('ruler', 'creator', 'jester', 'rebel', 'sage', 'lover') then
    raise exception 'No such look' using errcode = '22023';
  end if;
  if coalesce(p_chat_on, false) and coalesce((select value from public.internal_config where key = 'kris_rooms_ready'), 'no') <> 'yes' then
    raise exception 'Kris chat turns on after the 50 test chats pass' using errcode = '22023';
  end if;
  -- A new file in an adult room needs the team's word that it is not explicit. The same
  -- file kept from before keeps its earlier confirmation.
  if v_adult and p_hero is not null and not coalesce(p_hero_clean, false)
     and not (p_hero = v_old_hero and v_old_by is not null) then
    raise exception 'Confirm the photo or video shows no nudity or sexual activity' using errcode = '22023';
  end if;
  if coalesce(p_accent, '') !~ '^#[0-9a-f]{6}$' then
    raise exception 'Pick an accent color' using errcode = '22023';
  end if;
  if char_length(coalesce(p_greeting, '')) > 280 then
    raise exception 'Keep the greeting to 280 characters' using errcode = '22023';
  end if;
  if jsonb_typeof(p_buttons) <> 'array' or jsonb_array_length(p_buttons) > 4 then
    raise exception 'Up to four buttons' using errcode = '22023';
  end if;
  for b in select * from jsonb_array_elements(p_buttons) loop
    if jsonb_typeof(b) <> 'object'
       or jsonb_typeof(b -> 'label') <> 'string'
       or char_length(btrim(b ->> 'label')) not between 1 and 40
       or jsonb_typeof(b -> 'link') <> 'number'
       or (b ->> 'link')::numeric <> floor((b ->> 'link')::numeric)
       or (b ->> 'link')::integer not between 0 and v_links - 1
       or (select count(*) from jsonb_object_keys(b)) <> 2 then
      raise exception 'Each button needs a label of up to 40 characters and one of the client''s approved links' using errcode = '22023';
    end if;
  end loop;
  if p_status = 'open' and jsonb_array_length(p_buttons) = 0 then
    raise exception 'Add at least one button before opening the room' using errcode = '22023';
  end if;
  if p_hero is not null and not exists (
    select 1 from public.library_items l
     where l.id = p_hero and l.client_id = p_client and l.kris_ok and l.status <> 'retired' and l.removed_at is null
  ) then
    raise exception 'Pick a file marked OK for Kris' using errcode = '22023';
  end if;

  insert into public.rooms (client_id, workspace_id, slug, status, preset, accent, greeting, buttons, hero_id, hero_clean_by, hero_clean_at, chat_on, updated_by, updated_at)
  values (
    p_client, v_ws, v_slug, p_status, p_preset, p_accent, btrim(coalesce(p_greeting, '')), p_buttons, p_hero,
    case when p_hero is null then null when p_hero = v_old_hero and not coalesce(p_hero_clean, false) then v_old_by when coalesce(p_hero_clean, false) then (select auth.uid()) end,
    case when p_hero is null then null when p_hero = v_old_hero and not coalesce(p_hero_clean, false) then v_old_at when coalesce(p_hero_clean, false) then now() end,
    coalesce(p_chat_on, false), (select auth.uid()), now()
  )
  on conflict (client_id) do update
    set slug = excluded.slug, status = excluded.status, preset = excluded.preset, accent = excluded.accent,
        greeting = excluded.greeting, buttons = excluded.buttons, hero_id = excluded.hero_id,
        hero_clean_by = excluded.hero_clean_by, hero_clean_at = excluded.hero_clean_at,
        chat_on = excluded.chat_on, updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke all on function public.room_set(uuid, text, text, text, text, text, jsonb, uuid, boolean, boolean) from public, anon;
grant execute on function public.room_set(uuid, text, text, text, text, text, jsonb, uuid, boolean, boolean) to authenticated;
