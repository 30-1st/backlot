-- Cover the composite foreign keys the advisor flagged, so deleting a client or campaign
-- never scans these tables.
create index if not exists invites_client_workspace_idx on private.invites (client_id, workspace_id) where client_id is not null;
create index if not exists campaign_posts_campaign_owner_idx on public.campaign_posts (campaign_id, owner_id);
create index if not exists workspace_members_client_workspace_idx on public.workspace_members (client_id, workspace_id) where client_id is not null;
