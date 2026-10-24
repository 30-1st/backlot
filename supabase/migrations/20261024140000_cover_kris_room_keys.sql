-- Covering indexes for the client and workspace keys on Kris's and the rooms' tables
-- (flagged by Supabase's advisor), so removing a client never scans these tables.
create index if not exists kris_messages_client_workspace_idx on public.kris_messages (client_id, workspace_id);
create index if not exists kris_prefs_client_workspace_idx on public.kris_prefs (client_id, workspace_id);
create index if not exists rooms_client_workspace_idx on public.rooms (client_id, workspace_id);
