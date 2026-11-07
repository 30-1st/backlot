-- Indexes for foreign keys added in November that had none (performance advisor).
create index if not exists client_wins_client_workspace_idx on public.client_wins (client_id, workspace_id);
create index if not exists x_oauth_states_client_idx on public.x_oauth_states (client_id);
create index if not exists xev_leads_thread_idx on public.xev_leads (thread_id);
