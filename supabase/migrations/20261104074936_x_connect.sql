-- Connect X and Xev's inbox (approved Nov 4, 2026).
--
-- A client (or their team) connects the client's X account through X's own OAuth 2.0 sign-in
-- with the scopes tweet.read, users.read, dm.read and offline.access. Backlot can read DMs and
-- nothing else; it cannot send, post, like or follow.
--
-- Security:
--   * Every table here is server only: RLS on, no policies, no grants to anon or authenticated.
--     The app reads them through the bil function, which checks access first.
--   * Tokens live only in Supabase Vault (encrypted at rest). The table keeps the Vault id.
--     Only service_role may call the token functions, and the trigger deletes the Vault
--     secret whenever a connection row goes away (disconnect or the client being deleted).
--   * Message text is never stored. A lead keeps the conversation id, an intent, a short
--     private summary (300 characters at most) and timestamps, and is deleted 30 days after
--     its last update.
--   * Sign-in states are single use and expire after 10 minutes.

create table public.x_connections (
  client_id uuid primary key references public.clients(id) on delete cascade,
  workspace_id uuid not null,
  x_user_id text not null,
  x_username text not null,
  scopes text not null,
  token_secret_id uuid,
  expires_at timestamptz,
  connected_by uuid not null,
  connected_at timestamptz not null default now(),
  checked_at timestamptz,
  seen_event_id text,
  status text not null default 'active' check (status in ('active', 'error', 'revoked')),
  error text check (char_length(error) <= 300)
);
alter table public.x_connections enable row level security;
revoke all on public.x_connections from anon, authenticated;

create table public.x_oauth_states (
  state text primary key check (char_length(state) between 32 and 128),
  verifier text not null check (char_length(verifier) between 43 and 128),
  client_id uuid not null references public.clients(id) on delete cascade,
  workspace_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.x_oauth_states enable row level security;
revoke all on public.x_oauth_states from anon, authenticated;

create table public.xev_leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  workspace_id uuid not null,
  conversation_id text not null check (char_length(conversation_id) <= 64),
  intent text not null check (intent in ('buying', 'question', 'booking')),
  summary text not null check (char_length(summary) <= 300),
  last_event_id text not null,
  last_at timestamptz not null,
  status text not null default 'new' check (status in ('new', 'seen', 'dismissed', 'closed')),
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, conversation_id)
);
create index xev_leads_client on public.xev_leads (client_id, updated_at desc);
alter table public.xev_leads enable row level security;
revoke all on public.xev_leads from anon, authenticated;

-- ---------- tokens in Vault ----------

create or replace function public.x_token_put(p_client uuid, p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  select token_secret_id into sid from public.x_connections where client_id = p_client;
  if not found then raise exception 'no X connection for this client'; end if;
  if sid is not null and exists (select 1 from vault.secrets where id = sid) then
    perform vault.update_secret(sid, p_token);
  else
    delete from vault.secrets where name = 'x_token_' || p_client::text;
    sid := vault.create_secret(p_token, 'x_token_' || p_client::text, 'X sign-in tokens for one Backlot client');
    update public.x_connections set token_secret_id = sid where client_id = p_client;
  end if;
end $$;

create or replace function public.x_token_get(p_client uuid)
returns text language sql security definer set search_path = '' stable as $$
  select s.decrypted_secret
    from public.x_connections c
    join vault.decrypted_secrets s on s.id = c.token_secret_id
   where c.client_id = p_client;
$$;

create or replace function public.x_token_drop(p_client uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where id = (select token_secret_id from public.x_connections where client_id = p_client);
  delete from vault.secrets where name = 'x_token_' || p_client::text;
  update public.x_connections set token_secret_id = null where client_id = p_client;
end $$;

revoke all on function public.x_token_put(uuid, text) from public, anon, authenticated;
revoke all on function public.x_token_get(uuid) from public, anon, authenticated;
revoke all on function public.x_token_drop(uuid) from public, anon, authenticated;
grant execute on function public.x_token_put(uuid, text) to service_role;
grant execute on function public.x_token_get(uuid) to service_role;
grant execute on function public.x_token_drop(uuid) to service_role;

-- A deleted connection never leaves its tokens behind.
create or replace function private.x_connection_gone()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where id = old.token_secret_id;
  delete from vault.secrets where name = 'x_token_' || old.client_id::text;
  return old;
end $$;
revoke all on function private.x_connection_gone() from public, anon, authenticated;
create trigger x_connection_gone after delete on public.x_connections
  for each row execute function private.x_connection_gone();

-- ---------- spending ----------

insert into private.spend_limits (scope, cap_usd, note) values
  ('inbox', 0.05, 'Xev checks a connected inbox: one X DM read plus a light-model triage of new messages. Approved by Khma on 2026-11-04.')
on conflict (scope) do update set cap_usd = excluded.cap_usd, note = excluded.note;

-- ---------- clean-up and the inbox check ----------

create or replace function private.clear_x_leftovers()
returns void language sql security definer set search_path = '' as $$
  delete from public.x_oauth_states where created_at < now() - interval '10 minutes';
  delete from public.xev_leads where updated_at < now() - interval '30 days';
$$;
revoke all on function private.clear_x_leftovers() from public, anon, authenticated;

select cron.schedule('clear-x-leftovers', '*/10 * * * *', 'select private.clear_x_leftovers()');

-- Every 15 minutes, only while some account is connected.
select cron.schedule('xev-inbox-tick', '*/15 * * * *', $cron$
  select net.http_post(
    url := (select value from public.internal_config where key = 'project_url') || '/functions/v1/bil-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-bil-token', (select value from public.internal_config where key = 'bil_worker_token')
    ),
    body := '{"job":"xev_inbox"}'::jsonb,
    timeout_milliseconds := 5000
  )
  where exists (select 1 from public.x_connections where status = 'active');
$cron$);
