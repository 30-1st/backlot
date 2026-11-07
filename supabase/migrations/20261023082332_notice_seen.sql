-- In-app notices: when each person last looked at what is new, so Today can mark the rest.
-- The notices themselves are worked out from data the person can already read (the
-- approvals log, Media, the board, campaigns). Only this one moment is stored.

create table public.notice_seen (
  user_id uuid primary key references auth.users (id) on delete cascade,
  seen_at timestamptz not null default now()
);

alter table public.notice_seen enable row level security;
revoke all on public.notice_seen from anon, authenticated;
grant select on public.notice_seen to authenticated;
grant select, insert, update, delete on public.notice_seen to service_role;

create policy notice_seen_read on public.notice_seen for select to authenticated
  using (user_id = (select auth.uid()));

-- Marks everything up to now as seen, for the person asking.
create or replace function public.notices_seen()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  insert into public.notice_seen (user_id, seen_at) values ((select auth.uid()), v_now)
  on conflict (user_id) do update set seen_at = excluded.seen_at;
  return v_now;
end;
$$;

revoke all on function public.notices_seen() from public, anon;
grant execute on function public.notices_seen() to authenticated;
