-- Covering indexes for the (client_id, workspace_id) foreign keys added on Oct 23, so
-- removing a client never scans these tables (Supabase advisor: unindexed foreign keys).
create index if not exists approval_log_client_workspace_idx on public.approval_log (client_id, workspace_id);
create index if not exists client_billing_client_workspace_idx on public.client_billing (client_id, workspace_id);
create index if not exists client_briefs_client_workspace_idx on public.client_briefs (client_id, workspace_id);
create index if not exists client_reports_client_workspace_idx on public.client_reports (client_id, workspace_id);
create index if not exists desk_items_client_workspace_idx on public.desk_items (client_id, workspace_id);
create index if not exists inspiration_items_client_workspace_idx on public.inspiration_items (client_id, workspace_id);
create index if not exists tiktok_notes_client_workspace_idx on public.tiktok_notes (client_id, workspace_id);
