-- Cover the composite (client_id, owner_id) foreign keys flagged by the performance advisor,
-- so deleting a client cascades by index instead of a table scan.
create index voice_cards_client_owner_idx on public.voice_cards (client_id, owner_id);
create index post_type_libraries_client_owner_idx on public.post_type_libraries (client_id, owner_id);
