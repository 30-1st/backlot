-- Phone notifications (approved by Khma, Nov 7, 2026): Web Push to the installed app.
--
-- * push_devices: one row per phone or browser that turned notifications on. Only the server
--   reads it (no policies): the endpoint is a private address for that device.
-- * push_prefs: each person's switch and quiet hours (9 PM to 9 AM by default, their time).
-- * push_queue: what is waiting to go out. One notice per thing (unique ref), at most one
--   push every 15 minutes per person (the rest are combined), held in quiet hours except a
--   buyer who is ready to buy or book. Sent rows are cleared after 7 days.
-- * The VAPID key pair is made by the server on first use and kept in Vault; the private
--   half never leaves the database and the server.

create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) between 20 and 200),
  auth text not null check (length(auth) between 8 and 100),
  label text check (length(label) <= 80),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  fails smallint not null default 0
);
create index push_devices_user_idx on public.push_devices (user_id);
alter table public.push_devices enable row level security;
revoke all on public.push_devices from anon, authenticated;

create table public.push_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  quiet_from smallint not null default 21 check (quiet_from between 0 and 23),
  quiet_to smallint not null default 9 check (quiet_to between 0 and 23),
  timezone text not null default 'America/New_York' check (length(timezone) between 3 and 64),
  updated_at timestamptz not null default now()
);
alter table public.push_prefs enable row level security;
revoke all on public.push_prefs from anon, authenticated;

create table public.push_queue (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  kind text not null check (kind in ('plan_ready', 'next_ready', 'needs_detail', 'buyer', 'due_soon', 'client_review', 'test')),
  title text not null check (length(title) between 1 and 80),
  body text not null check (length(body) between 1 and 240),
  path text not null default 'today' check (path ~ '^[A-Za-z0-9._-]{0,160}$'),
  ref text not null check (length(ref) between 1 and 160),
  urgent boolean not null default false,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (user_id, ref)
);
create index push_queue_waiting_idx on public.push_queue (user_id) where sent_at is null;
create index push_queue_client_idx on public.push_queue (client_id);
alter table public.push_queue enable row level security;
revoke all on public.push_queue from anon, authenticated;

-- ---------- the VAPID key pair in Vault ----------

create or replace function public.push_vapid_get()
returns jsonb language sql security definer set search_path = '' stable as $$
  select s.decrypted_secret::jsonb from vault.decrypted_secrets s where s.name = 'push_vapid' limit 1;
$$;

-- Saves the pair only if none exists yet, and returns whichever pair is stored, so two
-- workers starting at once still agree on one key.
create or replace function public.push_vapid_init(p_pair jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('push_vapid'));
  if not exists (select 1 from vault.secrets where name = 'push_vapid') then
    perform vault.create_secret(p_pair::text, 'push_vapid', 'Backlot Web Push key pair (VAPID)');
  end if;
  return (select s.decrypted_secret::jsonb from vault.decrypted_secrets s where s.name = 'push_vapid' limit 1);
end $$;

revoke all on function public.push_vapid_get() from public, anon, authenticated;
revoke all on function public.push_vapid_init(jsonb) from public, anon, authenticated;
grant execute on function public.push_vapid_get() to service_role;
grant execute on function public.push_vapid_init(jsonb) to service_role;

-- ---------- the push tick ----------

-- Every 5 minutes while anything waits to go out; and every 15 minutes regardless, for the
-- "a post is due within the hour" check.
create or replace function private.push_due() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.push_queue where sent_at is null)
      or extract(minute from now())::int % 15 < 5;
$$;
revoke all on function private.push_due() from public, anon, authenticated;

create or replace function private.push_trim() returns void language sql security definer set search_path = '' as $$
  delete from public.push_queue where sent_at < now() - interval '7 days';
  delete from public.push_queue where sent_at is null and created_at < now() - interval '2 days';
  delete from public.push_devices where fails >= 5;
$$;
revoke all on function private.push_trim() from public, anon, authenticated;

select cron.schedule(
  'push-tick',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := (select value from public.internal_config where key = 'project_url') || '/functions/v1/bil-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-bil-token', (select value from public.internal_config where key = 'bil_worker_token')
    ),
    body := '{"job":"push"}'::jsonb,
    timeout_milliseconds := 5000
  )
  where private.push_due();
  select private.push_trim();
  $job$
);
