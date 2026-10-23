-- Cover the client and workspace foreign key so deleting a client stays fast.
create index if not exists library_items_client_workspace_idx on public.library_items (client_id, workspace_id);
