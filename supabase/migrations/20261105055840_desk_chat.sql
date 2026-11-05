-- The desk chat (approved Nov 5, 2026): each person on the Backlot side (the executive and
-- every team member) gets their own chat with Rein, Bil, Kris and Xev. It covers every client
-- they may see: all of them and the whole team for the executive, and only the clients the
-- executive granted for a team member. Each person reads only their own desk; only the
-- server writes. Messages clear after 30 days.
create table public.desk_messages (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('me', 'rein', 'bil', 'kris', 'xev')),
  body text not null check (char_length(body) between 1 and 2000),
  turn bigint,
  created_at timestamptz not null default now()
);
create index desk_messages_user on public.desk_messages (user_id, id desc);
alter table public.desk_messages enable row level security;
revoke all on public.desk_messages from anon, authenticated;
grant select (id, role, body, turn, created_at) on public.desk_messages to authenticated;
create policy desk_messages_own on public.desk_messages for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function private.clear_old_desk_messages()
returns void language sql security definer set search_path = '' as $$
  delete from public.desk_messages where created_at < now() - interval '30 days';
$$;
revoke all on function private.clear_old_desk_messages() from public, anon, authenticated;
select cron.schedule('clear-old-desk-messages', '33 4 * * *', 'select private.clear_old_desk_messages()');
