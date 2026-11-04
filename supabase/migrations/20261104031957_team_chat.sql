-- The team chat (approved Nov 3, 2026): Kris's chat becomes one group chat per client with
-- the client, their human team and all four agents. Kris's notes, pitches and draft cards
-- stay as they are; Rein, Bil and Xev can now speak in it too.
--
--   role  adds rein, bil and xev.
--   kind  adds read (Xev's answer to screenshots) and briefing (Bil's weekly briefing).
--   turn  the id of the person's message an agent is answering, so a turn's chime-ins
--         can be counted and capped.
--   data  structured content for a card: Xev's stage, why, moves and coach note. Never the
--         screenshots, and never the prospect's details.

alter table public.kris_messages drop constraint if exists kris_messages_role_check;
alter table public.kris_messages add constraint kris_messages_role_check
  check (role in ('kris', 'rein', 'bil', 'xev', 'client', 'team'));

alter table public.kris_messages drop constraint if exists kris_messages_kind_check;
alter table public.kris_messages add constraint kris_messages_kind_check
  check (kind in ('chat', 'note', 'pitch', 'read', 'briefing'));

alter table public.kris_messages add column if not exists turn bigint;
alter table public.kris_messages add column if not exists data jsonb
  check (data is null or (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 8000));

create index if not exists kris_messages_turn_idx on public.kris_messages (turn) where turn is not null;
