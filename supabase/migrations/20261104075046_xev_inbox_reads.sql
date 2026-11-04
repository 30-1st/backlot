-- Xev's inbox reads use the live conversation, not screenshots, so a read may have 0 images.
-- A lead remembers the Xev thread its reads continue.
alter table public.xev_reads drop constraint if exists xev_reads_images_check;
alter table public.xev_reads add constraint xev_reads_images_check check (images between 0 and 3);
alter table public.xev_leads add column thread_id uuid references public.xev_threads(id) on delete set null;

-- One inbox run holds an X DM read of up to 20 events plus the triage call.
update private.spend_limits set cap_usd = 0.25, note = 'One Xev inbox run: one X DM read of up to 20 events (estimated at $0.01 each until the X console price is confirmed; X bills a resource once per UTC day) plus one light-model triage, or one lead''s live conversation fetch. Approved by Khma on 2026-11-04.' where scope = 'inbox';
