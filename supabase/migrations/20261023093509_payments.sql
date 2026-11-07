-- PARKED (Oct 23): payments wait until the rest of Backlot is done, and may use a
-- processor other than Stripe. These tables and functions are in the database but
-- nothing in the app or the functions uses them. The Stripe-shaped columns (cus_, sub_
-- IDs) get reworked when a processor is chosen.
--
-- Payments through Stripe. Everything here stays unused until Stripe's keys are set as
-- function secrets; until then the app says payments open soon.
--
--   * client_billing: each agency client's monthly price, set by the team, and where
--     their Stripe subscription stands. Clients pay through Stripe Checkout and manage
--     their card in Stripe's own customer portal. Backlot never sees card details.
--   * rein_access: paid Rein searches for clients and Playground logins. $5 buys one
--     search credit; $15 a month buys unlimited searches while it is paid.
--   * private.stripe_events: each Stripe event handled once, so a retried event never
--     counts twice.
--   * Only the server's Stripe webhook writes Stripe's fields. The team sets prices
--     through billing_set_price, which checks they are on the team.

create table public.client_billing (
  client_id uuid primary key,
  workspace_id uuid not null,
  monthly_usd numeric(10, 2) check (monthly_usd is null or monthly_usd between 1 and 100000),
  stripe_customer_id text check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_subscription_id text check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  status text not null default 'none'
    check (status in ('none', 'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused')),
  current_period_end timestamptz,
  price_set_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (client_id, workspace_id) references public.clients (id, owner_id) on delete cascade
);
create index client_billing_workspace_idx on public.client_billing (workspace_id);
create index client_billing_price_set_by_idx on public.client_billing (price_set_by) where price_set_by is not null;
create unique index client_billing_customer_idx on public.client_billing (stripe_customer_id) where stripe_customer_id is not null;

alter table public.client_billing enable row level security;
revoke all on public.client_billing from anon, authenticated;
grant select on public.client_billing to authenticated;
grant select, insert, update, delete on public.client_billing to service_role;
create policy client_billing_read on public.client_billing for select to authenticated
  using ((select private.can_use_client(client_id)));

create table public.rein_access (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_subscription_id text check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  monthly_status text not null default 'none'
    check (monthly_status in ('none', 'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused')),
  monthly_until timestamptz,
  credits integer not null default 0 check (credits between 0 and 1000),
  updated_at timestamptz not null default now()
);
create unique index rein_access_customer_idx on public.rein_access (stripe_customer_id) where stripe_customer_id is not null;

alter table public.rein_access enable row level security;
revoke all on public.rein_access from anon, authenticated;
grant select on public.rein_access to authenticated;
grant select, insert, update, delete on public.rein_access to service_role;
create policy rein_access_read on public.rein_access for select to authenticated
  using (user_id = (select auth.uid()));

create table private.stripe_events (
  id text primary key check (id ~ '^evt_[A-Za-z0-9]+$'),
  type text not null,
  received_at timestamptz not null default now()
);
alter table private.stripe_events enable row level security;
revoke all on private.stripe_events from public, anon, authenticated;

-- Records a Stripe event once. True the first time, false for a repeat.
create or replace function public.stripe_event_once(p_id text, p_type text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.stripe_events (id, type) values (p_id, left(p_type, 100));
  return true;
exception when unique_violation then
  return false;
end;
$$;
revoke all on function public.stripe_event_once(text, text) from public, anon, authenticated;
grant execute on function public.stripe_event_once(text, text) to service_role;

-- The team sets (or clears, with null) a client's monthly price.
create or replace function public.billing_set_price(p_client uuid, p_usd numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid := (select private.my_team_workspace());
begin
  if v_ws is null or not exists (select 1 from public.clients c where c.id = p_client and c.owner_id = v_ws) then
    raise exception 'Only the team can set a client''s price' using errcode = '42501';
  end if;
  if p_usd is not null and (p_usd < 1 or p_usd > 100000) then
    raise exception 'Use a monthly price between $1 and $100,000' using errcode = '22023';
  end if;
  insert into public.client_billing (client_id, workspace_id, monthly_usd, price_set_by, updated_at)
  values (p_client, v_ws, round(p_usd, 2), (select auth.uid()), now())
  on conflict (client_id) do update
    set monthly_usd = excluded.monthly_usd, price_set_by = excluded.price_set_by, updated_at = now();
end;
$$;
revoke all on function public.billing_set_price(uuid, numeric) from public, anon;
grant execute on function public.billing_set_price(uuid, numeric) to authenticated;

-- A paid Rein search for someone past their 3 free ones: allowed while their monthly
-- plan is paid, or by spending one credit. Returns the search row, or null to ask for payment.
create or replace function public.rein_claim_paid(p_user uuid, p_workspace uuid, p_niche text, p_region text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('rein-paid:' || p_user::text, 0));
  if exists (
    select 1 from public.rein_access a
     where a.user_id = p_user and a.monthly_status in ('active', 'trialing') and a.monthly_until > now()
  ) then
    null;
  elsif exists (select 1 from public.rein_access a where a.user_id = p_user and a.credits > 0) then
    update public.rein_access set credits = credits - 1, updated_at = now() where user_id = p_user;
  else
    return null;
  end if;
  insert into public.rein_searches (user_id, workspace_id, niche, region, free)
  values (p_user, p_workspace, p_niche, p_region, false)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.rein_claim_paid(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.rein_claim_paid(uuid, uuid, text, text) to service_role;

-- Gives back a credit when a paid search found nothing or Rein failed.
create or replace function public.rein_refund_credit(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.rein_access
     set credits = least(credits + 1, 1000), updated_at = now()
   where user_id = p_user
     and not (monthly_status in ('active', 'trialing') and monthly_until > now());
$$;
revoke all on function public.rein_refund_credit(uuid) from public, anon, authenticated;
grant execute on function public.rein_refund_credit(uuid) to service_role;

-- A paid $5 search: records the Stripe event and adds the credit in one step, so a
-- retried event never adds a second credit.
create or replace function public.rein_add_credit_once(p_event text, p_user uuid, p_customer text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.stripe_events (id, type) values (p_event, 'checkout.session.completed:rein_one')
  on conflict (id) do nothing;
  if not found then
    return false;
  end if;
  insert into public.rein_access (user_id, stripe_customer_id, credits, updated_at)
  values (p_user, p_customer, 1, now())
  on conflict (user_id) do update
    set credits = least(public.rein_access.credits + 1, 1000),
        stripe_customer_id = coalesce(public.rein_access.stripe_customer_id, excluded.stripe_customer_id),
        updated_at = now();
  return true;
end;
$$;
revoke all on function public.rein_add_credit_once(text, uuid, text) from public, anon, authenticated;
grant execute on function public.rein_add_credit_once(text, uuid, text) to service_role;
