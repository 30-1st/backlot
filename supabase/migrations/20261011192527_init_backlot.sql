-- Backlot: logins, accounts, narrations, media, and housekeeping.
--
-- Shape of the data:
--   auth.users  ->  members (one per login, holds the username)
--               ->  accounts (one per social profile, any number per platform)
--                     ->  narrations (one or more tellings of that profile)
--   storage: bucket "media", one folder per login
--
-- Every table here has row level security on. A signed-in creator can reach
-- only their own rows. Signed-out visitors can reach nothing.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Members: one row per login.
-- ---------------------------------------------------------------------------
create table public.members (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  -- Stamped whenever the creator opens Backlot. Logins idle for 60 days are removed.
  last_active_at timestamptz not null default now(),
  constraint members_username_format check (username ~ '^[a-z0-9._]{3,24}$')
);

create unique index members_username_key on public.members (username);
create index members_last_active_at_idx on public.members (last_active_at);

alter table public.members enable row level security;

create policy "Members read their own row"
  on public.members for select to authenticated
  using ((select auth.uid()) = id);

create policy "Members stamp their own activity"
  on public.members for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- An update may only move the activity stamp, and only to "now".
create function private.members_stamp_activity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.id := old.id;
  new.username := old.username;
  new.created_at := old.created_at;
  new.last_active_at := now();
  return new;
end;
$$;

create trigger members_stamp_activity
  before update on public.members
  for each row execute function private.members_stamp_activity();

grant select on public.members to authenticated;
grant update (last_active_at) on public.members to authenticated;
grant select, insert, update, delete on public.members to service_role;

-- ---------------------------------------------------------------------------
-- Accounts: one social profile on one platform.
-- ---------------------------------------------------------------------------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  platform text not null,
  created_at timestamptz not null default now(),
  constraint accounts_platform_known check (platform in ('instagram', 'tiktok', 'x'))
);

create index accounts_user_platform_idx on public.accounts (user_id, platform, created_at);

alter table public.accounts enable row level security;

create policy "Creators read their own accounts"
  on public.accounts for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Creators add their own accounts"
  on public.accounts for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Creators change their own accounts"
  on public.accounts for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Creators delete their own accounts"
  on public.accounts for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.accounts to authenticated;
grant select, insert, update, delete on public.accounts to service_role;

-- ---------------------------------------------------------------------------
-- Narrations: one telling of an account. Holds the whole profile as JSON,
-- its save point, and a few facts copied out so lists load without the JSON.
-- ---------------------------------------------------------------------------
create table public.narrations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  sandbox jsonb not null,
  save_point jsonb,
  username text not null default '',
  avatar jsonb,
  posts integer not null default 0,
  is_example boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint narrations_name_length check (char_length(name) between 1 and 60),
  -- A guard against someone using a narration as bulk storage.
  constraint narrations_sandbox_size check (pg_column_size(sandbox) < 3000000),
  constraint narrations_save_point_size check (save_point is null or pg_column_size(save_point) < 3000000)
);

create index narrations_account_id_idx on public.narrations (account_id, created_at);
create index narrations_user_id_idx on public.narrations (user_id);

alter table public.narrations enable row level security;

create policy "Creators read their own narrations"
  on public.narrations for select to authenticated
  using ((select auth.uid()) = user_id);

-- A narration must sit on an account the same creator owns.
create policy "Creators add narrations to their own accounts"
  on public.narrations for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.accounts a
      where a.id = account_id and a.user_id = (select auth.uid())
    )
  );

create policy "Creators change their own narrations"
  on public.narrations for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.accounts a
      where a.id = account_id and a.user_id = (select auth.uid())
    )
  );

create policy "Creators delete their own narrations"
  on public.narrations for delete to authenticated
  using ((select auth.uid()) = user_id);

create function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger narrations_touch_updated_at
  before update on public.narrations
  for each row execute function private.touch_updated_at();

grant select, insert, update, delete on public.narrations to authenticated;
grant select, insert, update, delete on public.narrations to service_role;

-- ---------------------------------------------------------------------------
-- Media: a private bucket. Each login may only touch files inside the folder
-- named after its own id, for example  media/<user id>/<media id>.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 52428800, array['image/*', 'video/*']);

create policy "Media: creators read their own files"
  on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Media: creators add their own files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Media: creators replace their own files"
  on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Media: creators delete their own files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- Housekeeping, reachable only by the server-side functions (service role).
-- Row level security is on with no policies, and no public role is granted
-- anything, so neither signed-in nor signed-out callers can touch these.
-- ---------------------------------------------------------------------------

-- One row per sign-up attempt, used to slow down bulk sign-ups from one address.
create table public.signup_log (
  id bigint generated always as identity primary key,
  ip text not null,
  created_at timestamptz not null default now()
);
create index signup_log_ip_created_at_idx on public.signup_log (ip, created_at);
alter table public.signup_log enable row level security;
grant select, insert, delete on public.signup_log to service_role;

-- Small server-side settings, such as the token the daily cleanup job presents.
create table public.internal_config (
  key text primary key,
  value text not null
);
alter table public.internal_config enable row level security;
grant select on public.internal_config to service_role;

-- ---------------------------------------------------------------------------
-- Scheduling: pg_cron runs the daily cleanup, pg_net makes its HTTP call.
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
