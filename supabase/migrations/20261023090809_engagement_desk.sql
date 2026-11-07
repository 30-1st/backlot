-- The engagement desk: posts worth answering or joining, for a person to act on by hand.
--
--   * "reply": someone replied to or mentioned the client in the last 2 days. Read from X
--     when the team taps Check (about $0.005 a post, 25 at most).
--   * "conversation": a post behind one of Rein's rising topics for the client. Free: it
--     comes from Rein's saved brief. Never for adult niches.
--   * Only the post ID and a short excerpt (120 characters, cleared after 24 hours) are
--     kept, never who wrote it. Items go after 7 days.
--   * Backlot never replies or likes. A person opens the post on X and acts by hand
--     through X Delegate, then marks it done or skipped.
--   * The team and that client may read a client's desk and mark items.

insert into private.spend_limits (scope, cap_usd, note)
values ('desk', 0.2000, 'One engagement desk check: up to 25 X post reads.')
on conflict (scope) do nothing;

create table public.desk_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  client_id uuid not null,
  kind text not null check (kind in ('reply', 'conversation')),
  post_id text not null check (post_id ~ '^[0-9]{1,25}$'),
  excerpt text check (char_length(excerpt) <= 120),
  excerpt_expires_at timestamptz not null default now() + interval '24 hours',
  topic text check (char_length(topic) <= 120),
  posted_at timestamptz,
  status text not null default 'open' check (status in ('open', 'done', 'skipped')),
  acted_by uuid references auth.users (id) on delete set null,
  acted_at timestamptz,
  found_at timestamptz not null default now(),
  unique (client_id, post_id),
  foreign key (client_id, workspace_id) references public.clients (id, owner_id) on delete cascade
);
create index desk_items_client_idx on public.desk_items (client_id, found_at desc);
create index desk_items_workspace_idx on public.desk_items (workspace_id);
create index desk_items_acted_by_idx on public.desk_items (acted_by) where acted_by is not null;
create index desk_items_expiry_idx on public.desk_items (excerpt_expires_at) where excerpt is not null;

alter table public.desk_items enable row level security;
revoke all on public.desk_items from anon, authenticated;
grant select on public.desk_items to authenticated;
grant select, insert, update, delete on public.desk_items to service_role;

create policy desk_items_read on public.desk_items for select to authenticated
  using ((select private.can_use_client(client_id)));

-- Mark an item done, skipped, or open again.
create or replace function public.desk_mark(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('open', 'done', 'skipped') then
    raise exception 'No such status' using errcode = '22023';
  end if;
  update public.desk_items d
     set status = p_status,
         acted_by = case when p_status = 'open' then null else (select auth.uid()) end,
         acted_at = case when p_status = 'open' then null else now() end
   where d.id = p_id
     and (select private.can_use_client(d.client_id));
  if not found then
    raise exception 'No such item on a desk you can use' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.desk_mark(uuid, text) from public, anon;
grant execute on function public.desk_mark(uuid, text) to authenticated;

-- The hourly excerpt job now clears desk excerpts too, and drops desk items after 7 days.
create or replace function private.clear_expired_excerpts()
returns integer
language sql
security definer
set search_path = ''
as $$
  with cleared as (
    update public.brief_evidence
       set excerpt = null
     where excerpt is not null
       and excerpt_expires_at <= now()
    returning 1
  ), desk as (
    update public.desk_items
       set excerpt = null
     where excerpt is not null
       and excerpt_expires_at <= now()
    returning 1
  ), old as (
    delete from public.desk_items
     where found_at < now() - interval '7 days'
    returning 1
  )
  select ((select count(*) from cleared) + (select count(*) from desk) + (select count(*) from old))::integer;
$$;
revoke all on function private.clear_expired_excerpts() from public, anon, authenticated;
