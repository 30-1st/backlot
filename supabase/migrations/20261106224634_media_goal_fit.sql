-- Up next (approved Nov 6, 2026): Bil scores how well each tagged photo or video fits the
-- goal a post is for (green fits, yellow somewhat, red not at all), from its tags and note
-- only, never the picture. Scores are kept per file and goal so the same pick costs nothing
-- twice, and go when the file's tags change or the file is deleted. Server only.
create table public.media_fit (
  item_id uuid not null references public.library_items(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  goal_key text not null check (char_length(goal_key) = 64),
  tags_key text not null check (char_length(tags_key) = 64),
  fit text not null check (fit in ('green', 'yellow', 'red')),
  why text not null check (char_length(why) <= 160),
  created_at timestamptz not null default now(),
  primary key (item_id, goal_key)
);
create index media_fit_client on public.media_fit (client_id);
alter table public.media_fit enable row level security;
revoke all on public.media_fit from anon, authenticated;

insert into private.spend_limits (scope, cap_usd, note) values
  ('fit', 0.03, 'Bil scores up to 60 tagged files against one goal from their tags (Grok 4.3, no pictures). About a third of a cent. Approved by Khma on 2026-11-06.')
on conflict (scope) do update set cap_usd = excluded.cap_usd, note = excluded.note;

-- Scores older than 90 days are dropped; they are cheap to make again.
select cron.schedule('clear-old-media-fit', '37 4 * * *', $$delete from public.media_fit where created_at < now() - interval '90 days'$$);
