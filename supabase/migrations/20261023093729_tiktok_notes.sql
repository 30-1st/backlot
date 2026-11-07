-- Rein's TikTok side, by hand. TikTok offers no API for trend data to businesses (its
-- Research API is for non-profit academics only), and Backlot never scrapes. So the team
-- or client looks at TikTok Creative Center themselves and notes what fits here: a
-- hashtag, a song or a format, with why. Never creators or other people.
--
--   * Bil reads notes from the last 14 days when he plans, as ideas and angles for X.
--   * The team and that client may add and remove a client's notes. Visitors never can.
--   * Removed notes go after 7 days with the daily cleanup; others after 90 days.

create table public.tiktok_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  client_id uuid not null,
  kind text not null check (kind in ('hashtag', 'song', 'format')),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  note text check (char_length(note) <= 280),
  region text not null default 'us' check (region in ('us', 'uk', 'canada', 'worldwide', 'other')),
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  foreign key (client_id, workspace_id) references public.clients (id, owner_id) on delete cascade
);
create index tiktok_notes_client_idx on public.tiktok_notes (client_id, created_at desc) where removed_at is null;
create index tiktok_notes_workspace_idx on public.tiktok_notes (workspace_id);
create index tiktok_notes_added_by_idx on public.tiktok_notes (added_by) where added_by is not null;

alter table public.tiktok_notes enable row level security;
revoke all on public.tiktok_notes from anon, authenticated;
grant select on public.tiktok_notes to authenticated;
grant select, insert, update, delete on public.tiktok_notes to service_role;
create policy tiktok_notes_read on public.tiktok_notes for select to authenticated
  using ((select private.can_use_client(client_id)));

create or replace function public.tiktok_note_add(p_client uuid, p_kind text, p_name text, p_note text, p_region text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_id uuid;
begin
  if not (select private.can_use_client(p_client)) then
    raise exception 'No such client you work with' using errcode = '42501';
  end if;
  if (select count(*) from public.tiktok_notes t where t.client_id = p_client and t.removed_at is null and t.created_at > now() - interval '14 days') >= 40 then
    raise exception 'That is plenty for two weeks. Remove a few first.' using errcode = '54000';
  end if;
  select c.owner_id into v_ws from public.clients c where c.id = p_client;
  insert into public.tiktok_notes (workspace_id, client_id, kind, name, note, region, added_by)
  values (v_ws, p_client, p_kind, btrim(p_name), nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_region, 'us'), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.tiktok_note_remove(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tiktok_notes t
     set removed_at = now()
   where t.id = p_id
     and t.removed_at is null
     and (select private.can_use_client(t.client_id));
  if not found then
    raise exception 'No such note you can remove' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.tiktok_note_add(uuid, text, text, text, text), public.tiktok_note_remove(uuid) from public, anon;
grant execute on function public.tiktok_note_add(uuid, text, text, text, text), public.tiktok_note_remove(uuid) to authenticated;
