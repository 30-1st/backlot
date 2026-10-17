-- Bil's campaign pipeline: one row per drafted post, a private queue of steps, and a
-- scheduler that wakes the bil-worker function only when a step is waiting.
--
-- How a campaign runs:
--   brief (Rein) -> review (Bil) -> plan (Bil) -> batch, batch, ... (Bil)
-- Each step is one row in private.bil_steps. A worker claims a step with an expiring
-- lease, runs it, and in one transaction marks it done and queues the next one. Only one
-- step per campaign is ever queued or running, so steps never race each other. A worker
-- that dies mid-step simply lets its lease expire and the step is claimed again.
--
-- Access: signed-in users may READ their own clients, cards, libraries, reviews,
-- campaigns and posts, and DELETE them. Every write goes through Bil's functions, which
-- check the login and the shape of the data first, so nobody can forge an approval or
-- store a malformed card by writing to the tables directly.

-- ---------- caps ----------

-- Onboarding: profile lookup ($0.01) + up to 48 post reads ($0.24) + one Grok call (about $0.09).
update private.spend_limits
   set cap_usd = 0.35,
       note = 'One client onboarding: profile lookup, up to 48 X post reads, and the voice card call.'
 where scope = 'onboard';

-- ---------- campaigns: request, idempotency, hold ----------

alter table public.campaigns
  add column request jsonb,
  -- The browser sends one ID per request, so a double click or retry never starts two campaigns.
  add column request_id uuid unique,
  -- What the campaign is doing now, for the test page (e.g. "drafting posts 6 to 10").
  add column step text,
  -- Why a campaign is paused without being failed. Kept apart from status so the
  -- existing status rule never has to change.
  add column hold text check (hold in ('month_budget')),
  add constraint campaigns_id_owner_key unique (id, owner_id);

-- ---------- one row per drafted post ----------

create table public.campaign_posts (
  campaign_id uuid not null,
  owner_id uuid not null,
  slot integer not null check (slot between 1 and 60),
  status text not null check (status in ('ok', 'blocked')),
  post jsonb not null,
  created_at timestamptz not null default now(),
  primary key (campaign_id, slot),
  foreign key (campaign_id, owner_id) references public.campaigns (id, owner_id) on delete cascade
);
create index campaign_posts_owner_idx on public.campaign_posts (owner_id);

alter table public.campaign_posts enable row level security;
revoke all on public.campaign_posts from anon, authenticated;
grant select, delete on public.campaign_posts to authenticated;
grant all on public.campaign_posts to service_role;
create policy campaign_posts_select_own on public.campaign_posts
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy campaign_posts_delete_own on public.campaign_posts
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- ---------- users read and delete; Bil writes ----------

revoke insert, update on public.clients, public.voice_cards, public.post_type_libraries,
  public.brief_reviews, public.campaigns from authenticated;

-- ---------- the step queue ----------

create table private.bil_steps (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  kind text not null check (kind in ('brief', 'review', 'plan', 'batch')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'held', 'done', 'failed')),
  attempts integer not null default 0,
  run_after timestamptz not null default now(),
  lease_until timestamptz,
  claim_id uuid,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table private.bil_steps enable row level security;

-- One live step per campaign.
create unique index bil_steps_one_live_idx on private.bil_steps (campaign_id)
  where status in ('queued', 'running', 'held');
create index bil_steps_ready_idx on private.bil_steps (run_after) where status = 'queued';
create index bil_steps_lease_idx on private.bil_steps (lease_until) where status = 'running';
create index bil_steps_finished_idx on private.bil_steps (finished_at) where status in ('done', 'failed');

/** True when a step is ready, or a running step's lease ran out. The scheduler calls the worker only then. */
create function private.bil_work_waiting()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from private.bil_steps where status = 'queued' and run_after <= now())
      or exists (select 1 from private.bil_steps where status = 'running' and lease_until < now());
$$;

-- Queue the first step of a campaign.
create function public.bil_step_enqueue(p_campaign uuid, p_kind text, p_payload jsonb default '{}'::jsonb)
returns bigint
language sql security definer set search_path = ''
as $$
  insert into private.bil_steps (campaign_id, kind, payload)
  values (p_campaign, p_kind, coalesce(p_payload, '{}'::jsonb))
  returning id;
$$;

-- Claim one ready step (or one whose lease expired). Steps that have used up their
-- attempts are failed here, along with their campaign, so a broken step never loops.
create function public.bil_step_claim(p_claim uuid, p_kinds text[], p_lease_seconds integer, p_max_attempts integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s private.bil_steps;
begin
  with dead as (
    update private.bil_steps
       set status = 'failed', finished_at = now(), lease_until = null,
           error = coalesce(error, 'Stopped after ' || attempts || ' tries')
     where attempts >= p_max_attempts
       and ((status = 'queued' and run_after <= now()) or (status = 'running' and lease_until < now()))
    returning campaign_id, error
  )
  update public.campaigns c
     set status = 'failed', step = null, error = left(d.error, 500)
    from dead d
   where c.id = d.campaign_id;

  select * into s
    from private.bil_steps
   where kind = any (p_kinds)
     and ((status = 'queued' and run_after <= now()) or (status = 'running' and lease_until < now()))
   order by run_after
   limit 1
   for update skip locked;
  if not found then
    return null;
  end if;

  update private.bil_steps
     set status = 'running', claim_id = p_claim, attempts = attempts + 1,
         lease_until = now() + make_interval(secs => p_lease_seconds)
   where id = s.id
  returning * into s;

  return jsonb_build_object('id', s.id, 'campaignId', s.campaign_id, 'kind', s.kind,
                            'payload', s.payload, 'attempts', s.attempts);
end;
$$;

-- Finish a step and, in the same transaction, queue the next one (or none at the end).
-- Returns false when this worker no longer holds the step (its lease ran out and someone
-- else claimed it); the caller then throws its result away.
create function public.bil_step_finish(
  p_id bigint, p_claim uuid, p_next_kind text default null, p_next_payload jsonb default null,
  p_delay_seconds integer default 0
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_campaign uuid;
begin
  update private.bil_steps
     set status = 'done', finished_at = now(), lease_until = null
   where id = p_id and claim_id = p_claim and status = 'running'
  returning campaign_id into v_campaign;
  if not found then
    return false;
  end if;
  if p_next_kind is not null then
    insert into private.bil_steps (campaign_id, kind, payload, run_after)
    values (v_campaign, p_next_kind, coalesce(p_next_payload, '{}'::jsonb), now() + make_interval(secs => p_delay_seconds));
  end if;
  return true;
end;
$$;

-- Put a step back in the queue to try again later (Rein busy, a timeout).
create function public.bil_step_retry(p_id bigint, p_claim uuid, p_delay_seconds integer, p_error text)
returns boolean
language sql security definer set search_path = ''
as $$
  with r as (
    update private.bil_steps
       set status = 'queued', lease_until = null, claim_id = null, error = left(p_error, 500),
           run_after = now() + make_interval(secs => p_delay_seconds)
     where id = p_id and claim_id = p_claim and status = 'running'
    returning 1
  )
  select exists (select 1 from r);
$$;

-- Fail a step and its campaign.
create function public.bil_step_fail(p_id bigint, p_claim uuid, p_error text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_campaign uuid;
begin
  update private.bil_steps
     set status = 'failed', finished_at = now(), lease_until = null, error = left(p_error, 500)
   where id = p_id and claim_id = p_claim and status = 'running'
  returning campaign_id into v_campaign;
  if not found then
    return false;
  end if;
  update public.campaigns set status = 'failed', step = null, error = left(p_error, 500) where id = v_campaign;
  return true;
end;
$$;

-- Pause a step because the month's budget is spent. Finished posts are kept.
create function public.bil_step_hold(p_id bigint, p_claim uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_campaign uuid;
begin
  update private.bil_steps
     set status = 'held', lease_until = null, claim_id = null
   where id = p_id and claim_id = p_claim and status = 'running'
  returning campaign_id into v_campaign;
  if not found then
    return false;
  end if;
  update public.campaigns set hold = p_reason where id = v_campaign;
  return true;
end;
$$;

-- Resume a paused campaign (the bil function checks the owner first).
create function public.bil_step_resume(p_campaign uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update private.bil_steps
     set status = 'queued', run_after = now(), attempts = 0
   where campaign_id = p_campaign and status = 'held';
  if not found then
    return false;
  end if;
  update public.campaigns set hold = null where id = p_campaign;
  return true;
end;
$$;

revoke all on function private.bil_work_waiting() from public, anon, authenticated;
revoke all on function public.bil_step_enqueue(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.bil_step_claim(uuid, text[], integer, integer) from public, anon, authenticated;
revoke all on function public.bil_step_finish(bigint, uuid, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.bil_step_retry(bigint, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.bil_step_fail(bigint, uuid, text) from public, anon, authenticated;
revoke all on function public.bil_step_hold(bigint, uuid, text) from public, anon, authenticated;
revoke all on function public.bil_step_resume(uuid) from public, anon, authenticated;
grant execute on function public.bil_step_enqueue(uuid, text, jsonb) to service_role;
grant execute on function public.bil_step_claim(uuid, text[], integer, integer) to service_role;
grant execute on function public.bil_step_finish(bigint, uuid, text, jsonb, integer) to service_role;
grant execute on function public.bil_step_retry(bigint, uuid, integer, text) to service_role;
grant execute on function public.bil_step_fail(bigint, uuid, text) to service_role;
grant execute on function public.bil_step_hold(bigint, uuid, text) to service_role;
grant execute on function public.bil_step_resume(uuid) to service_role;

-- ---------- the worker's token and the scheduler ----------

-- A random token only server code can read (same pattern as the cleanup job). The value
-- is made here in the database and never appears in this file.
insert into public.internal_config (key, value)
values ('bil_worker_token', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

-- Every 10 seconds, wake the worker, but only when a step is waiting. An idle project
-- makes no requests at all.
select cron.schedule(
  'bil-worker-tick',
  '10 seconds',
  $job$
  select net.http_post(
    url := (select value from public.internal_config where key = 'project_url') || '/functions/v1/bil-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-bil-token', (select value from public.internal_config where key = 'bil_worker_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  )
  where private.bil_work_waiting();
  $job$
);

