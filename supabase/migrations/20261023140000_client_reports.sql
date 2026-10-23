-- Monthly reports: one per client per month, from X's public numbers.
--
--   * The team makes a report; making it again replaces that month's report.
--   * Code works out every number from the client's own original posts that month. Bil
--     only reads the numbers and posts to write the plain-words part. Post text is used
--     and dropped: only numbers and post IDs are stored.
--   * The team and that client may read a client's reports. Only the server writes them.
--   * A report run has its own spending cap: up to 100 post reads ($0.005 each) and one
--     Bil call.

insert into private.spend_limits (scope, cap_usd, note)
values ('report', 0.6000, 'One monthly client report: up to 100 X post reads and one Bil call.')
on conflict (scope) do nothing;

create table public.client_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  client_id uuid not null,
  month date not null check (extract(day from month) = 1),
  numbers jsonb not null,
  summary jsonb,
  posts_read integer not null default 0 check (posts_read between 0 and 100),
  cost_usd numeric(10, 4) not null default 0,
  made_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (client_id, month),
  foreign key (client_id, workspace_id) references public.clients (id, owner_id) on delete cascade
);
create index client_reports_workspace_idx on public.client_reports (workspace_id);
create index client_reports_made_by_idx on public.client_reports (made_by) where made_by is not null;

alter table public.client_reports enable row level security;
revoke all on public.client_reports from anon, authenticated;
grant select on public.client_reports to authenticated;
grant select, insert, update, delete on public.client_reports to service_role;

create policy client_reports_read on public.client_reports for select to authenticated
  using ((select private.can_use_client(client_id)));
