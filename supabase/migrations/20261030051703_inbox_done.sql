-- Today's feed (Oct 30, 2026): what each person checked off. A checked item leaves their
-- feed and the badge on every device. Each person sees and changes only their own rows.
-- Rows older than 60 days are cleared (the feed only looks back 14 days).

create table public.inbox_done (
  user_id uuid not null references public.members (id) on delete cascade,
  item_key text not null check (char_length(item_key) <= 200),
  done_at timestamptz not null default now(),
  primary key (user_id, item_key)
);
alter table public.inbox_done enable row level security;
grant select, insert, delete on public.inbox_done to authenticated;
revoke update, truncate on public.inbox_done from authenticated, anon;
create policy inbox_done_own_read on public.inbox_done for select to authenticated using (user_id = (select auth.uid()));
create policy inbox_done_own_add on public.inbox_done for insert to authenticated with check (user_id = (select auth.uid()));
create policy inbox_done_own_remove on public.inbox_done for delete to authenticated using (user_id = (select auth.uid()));

create or replace function private.clear_old_inbox_done()
returns integer
language sql security definer set search_path = ''
as $$
  with gone as (delete from public.inbox_done where done_at < now() - interval '60 days' returning 1)
  select count(*)::integer from gone;
$$;
revoke all on function private.clear_old_inbox_done() from public, anon, authenticated;
select cron.schedule('clear-old-inbox-done', '39 4 * * *', $$select private.clear_old_inbox_done()$$);
