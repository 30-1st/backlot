-- Brand kit: a client's suggested changes wait here until the team takes or drops them.
-- Only the server writes these columns (bil function, brand_save and brand_review).
alter table public.clients
  add column profile_pending jsonb,
  add column profile_pending_by uuid references auth.users (id) on delete set null,
  add column profile_pending_at timestamptz;
create index clients_profile_pending_by_idx on public.clients (profile_pending_by);
