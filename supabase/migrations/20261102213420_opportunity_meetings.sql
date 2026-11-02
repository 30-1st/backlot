-- Rein's Opportunity Meeting (Rein Roadmap, phase R1, Nov 2, 2026).
--
-- opportunity_markets: shared market research, reused for up to 6 months by anyone who asks
--   about the same market in the same region. Server only; fees and rules are re-checked in
--   every meeting anyway.
-- opportunity_meetings: one row per meeting. Readable by whoever asked for it and, for a
--   client's meeting, by everyone who may see that client. Written by server code only.
-- opportunity_work: a meeting's private scratch space between stages (research notes, X
--   numbers). Server only; deleted when the meeting finishes.
--
-- Who gets what (checked in server code):
--   client   1 free meeting per calendar month (UTC); the unique index below makes a second
--            free one impossible, and a failed meeting gives it back
--   team     may run one for a client they are granted, as a recommendation
--   owner    unlimited
--   visitor  paid per meeting, once payments open

create table public.opportunity_markets (
  id uuid primary key default gen_random_uuid(),
  market_key text not null check (char_length(market_key) between 2 and 200),
  region text not null check (region in ('us', 'uk', 'canada')),
  market text not null check (char_length(market) <= 400),
  research jsonb not null,
  cost_usd numeric(10, 4) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now(),
  reuse_until timestamptz not null default (now() + interval '6 months')
);
create index opportunity_markets_lookup_idx on public.opportunity_markets (market_key, region, reuse_until desc);
alter table public.opportunity_markets enable row level security;
revoke all on public.opportunity_markets from anon, authenticated;

create table public.opportunity_meetings (
  id uuid primary key,
  workspace_id uuid not null,
  requested_by uuid references public.members (id) on delete set null,
  client_id uuid references public.clients (id) on delete cascade,
  kind text not null check (kind in ('free', 'owner', 'recommendation', 'paid')),
  free_month date,
  market_input text not null check (char_length(market_input) between 2 and 200),
  region text not null check (region in ('us', 'uk', 'canada')),
  market text check (char_length(market) <= 400),
  market_name text check (char_length(market_name) <= 80),
  market_id uuid references public.opportunity_markets (id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'working', 'ready', 'failed')),
  stage text not null default 'define',
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  meeting jsonb,
  cost_usd numeric(10, 4) not null default 0 check (cost_usd >= 0),
  error text check (char_length(error) <= 300),
  attempts integer not null default 0,
  claim_id uuid,
  lease_until timestamptz,
  next_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  constraint opportunity_free_has_month check ((kind = 'free') = (free_month is not null)),
  constraint opportunity_client_kinds check (kind not in ('free', 'recommendation') or client_id is not null)
);
-- One free meeting per client per month. A failed one does not count, so it is given back.
create unique index opportunity_one_free_a_month on public.opportunity_meetings (client_id, free_month)
  where kind = 'free' and status <> 'failed';
create index opportunity_meetings_waiting_idx on public.opportunity_meetings (next_at) where status in ('queued', 'working');
create index opportunity_meetings_client_idx on public.opportunity_meetings (client_id, created_at desc);
create index opportunity_meetings_requested_by_idx on public.opportunity_meetings (requested_by, created_at desc);
create index opportunity_meetings_workspace_idx on public.opportunity_meetings (workspace_id);
create index opportunity_meetings_market_idx on public.opportunity_meetings (market_id);
alter table public.opportunity_meetings enable row level security;
revoke insert, update, delete, truncate on public.opportunity_meetings from anon, authenticated;
grant select on public.opportunity_meetings to authenticated;
create policy opportunity_meetings_read on public.opportunity_meetings for select to authenticated
  using (
    requested_by = (select auth.uid())
    or (client_id is not null and (select private.can_use_client(client_id)))
  );

create table public.opportunity_work (
  meeting_id uuid primary key references public.opportunity_meetings (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.opportunity_work enable row level security;
revoke all on public.opportunity_work from anon, authenticated;

-- ---------- the worker's queue ----------

-- Claims the next meeting stage that is due. A stage that has failed p_max_attempts times
-- in a row fails the meeting (which also gives back a free one). The lease is longer than a
-- worker can live, so a live worker's stage is never claimed twice.
create function public.opportunity_claim(p_claim uuid, p_lease_seconds integer, p_max_attempts integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  m public.opportunity_meetings;
begin
  update public.opportunity_meetings
     set status = 'failed', lease_until = null, claim_id = null,
         error = left(coalesce(error, 'Stopped after ' || attempts || ' tries'), 300)
   where status in ('queued', 'working')
     and attempts >= p_max_attempts
     and next_at <= now()
     and (lease_until is null or lease_until < now());

  select * into m
    from public.opportunity_meetings
   where status in ('queued', 'working')
     and next_at <= now()
     and (lease_until is null or lease_until < now())
   order by next_at
   limit 1
   for update skip locked;
  if not found then
    return null;
  end if;

  update public.opportunity_meetings
     set status = 'working', claim_id = p_claim, attempts = attempts + 1,
         lease_until = now() + make_interval(secs => p_lease_seconds)
   where id = m.id
  returning * into m;

  return jsonb_build_object('id', m.id, 'stage', m.stage, 'attempts', m.attempts);
end;
$$;
revoke all on function public.opportunity_claim(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.opportunity_claim(uuid, integer, integer) to service_role;

create function private.opportunity_waiting()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.opportunity_meetings
     where status in ('queued', 'working')
       and next_at <= now()
       and (lease_until is null or lease_until < now())
  );
$$;
revoke all on function private.opportunity_waiting() from public, anon, authenticated;

-- Every 10 seconds, wake the worker, only while a meeting stage is waiting.
select cron.schedule(
  'opportunity-tick',
  '10 seconds',
  $job$
  select net.http_post(
    url := (select value from public.internal_config where key = 'project_url') || '/functions/v1/bil-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-bil-token', (select value from public.internal_config where key = 'bil_worker_token')
    ),
    body := '{"job":"opportunity"}'::jsonb,
    timeout_milliseconds := 5000
  )
  where private.opportunity_waiting();
  $job$
);

-- Daily: drop market research a month past its reuse window, and scratch space left behind.
select cron.schedule(
  'opportunity-cleanup',
  '17 4 * * *',
  $job$
  delete from public.opportunity_markets where reuse_until < now() - interval '30 days';
  delete from public.opportunity_work w
   using public.opportunity_meetings m
   where m.id = w.meeting_id and m.status in ('ready', 'failed');
  $job$
);

-- ---------- spend caps ----------

insert into private.spend_limits (scope, cap_usd, note)
values
  ('opportunity', 2.50, 'One Opportunity Meeting, all its stages: Rein''s market definition, X post counts, up to three web research calls and the write-up. A Rein trend brief, when one is needed, runs under the rein cap. To be reset from the R3 test meetings.'),
  ('opportunity_month', 10, 'Opportunity Meetings for everyone together, per calendar month (UTC), checked from opportunity_meetings. To be reset from the R3 test meetings.')
on conflict (scope) do update set cap_usd = excluded.cap_usd, note = excluded.note;
