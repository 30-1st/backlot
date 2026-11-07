-- K1: each client's room, and the locks around it.
--
--   * rooms: one per client. The team sets it up; the team and that client may read it.
--     Visitors never read this table: the public "room" function is their only door,
--     and it returns only what a room shows.
--   * Rooms start as private previews (draft, preview or closed). Opening came the same day
--     (see rooms_open). Chat with Kris waits for K2.
--   * Adult niches always use the 18+ look and show no photos or videos.
--   * Visitors are counted for limits by a hash of their address mixed with a secret that
--     changes every day. Raw addresses are never stored; counts and secrets go after 2 days.
--   * Preview links and visit tickets are signed with a server-only key made here.

-- ---------- the room ----------

create table public.rooms (
  client_id uuid primary key,
  workspace_id uuid not null,
  slug text not null check (slug ~ '^[a-z0-9_]{3,30}$'),
  status text not null default 'draft' check (status in ('draft', 'preview', 'closed')),
  preset text not null default 'creator' check (preset in ('creator', 'creator_adult')),
  accent text not null default '#c9a45a' check (accent ~ '^#[0-9a-f]{6}$'),
  greeting text not null default '' check (char_length(greeting) <= 280),
  -- [{ "label": text, "link": index into the brand kit's approved links }], at most 4.
  buttons jsonb not null default '[]'::jsonb check (jsonb_typeof(buttons) = 'array' and jsonb_array_length(buttons) <= 4),
  hero_id uuid references public.library_items (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (client_id, workspace_id) references public.clients (id, owner_id) on delete cascade
);
create unique index rooms_slug_key on public.rooms (slug);
create index rooms_workspace_idx on public.rooms (workspace_id);
create index rooms_hero_idx on public.rooms (hero_id) where hero_id is not null;
create index rooms_updated_by_idx on public.rooms (updated_by) where updated_by is not null;

alter table public.rooms enable row level security;
revoke all on public.rooms from anon, authenticated;
grant select on public.rooms to authenticated;
grant select, insert, update, delete on public.rooms to service_role;
create policy rooms_read on public.rooms for select to authenticated
  using ((select private.can_use_client(client_id)));

-- Names that could be mistaken for Backlot's own pages.
create or replace function private.room_slug_reserved(p_slug text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_slug in ('admin', 'api', 'app', 'assets', 'backlot', 'help', 'kris', 'login', 'privacy',
                    'safety', 'static', 'support', 'terms', 'www', 'room', 'rooms', 'about', 'official');
$$;

-- The team saves a client's room. Checks every field, forces the 18+ look and no media
-- for adult niches, and only accepts a hero file marked OK for Kris.
create or replace function public.room_set(
  p_client uuid,
  p_slug text,
  p_status text,
  p_preset text,
  p_accent text,
  p_greeting text,
  p_buttons jsonb,
  p_hero uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid := (select private.my_team_workspace());
  v_profile jsonb;
  v_links integer;
  v_adult boolean;
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  b jsonb;
begin
  select c.profile into v_profile from public.clients c where c.id = p_client and c.owner_id = v_ws;
  if v_ws is null or v_profile is null then
    raise exception 'Only the team can set up a client''s room' using errcode = '42501';
  end if;
  v_adult := coalesce((v_profile ->> 'adultContent')::boolean, false);
  v_links := coalesce(jsonb_array_length(case when jsonb_typeof(v_profile -> 'links') = 'array' then v_profile -> 'links' end), 0);

  if v_slug !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'Use 3 to 30 letters, numbers or underscores for the room name' using errcode = '22023';
  end if;
  if private.room_slug_reserved(v_slug) then
    raise exception 'That room name is reserved. Pick another' using errcode = '22023';
  end if;
  if exists (select 1 from public.rooms r where r.slug = v_slug and r.client_id <> p_client) then
    raise exception 'That room name is taken. Pick another' using errcode = '23505';
  end if;
  if p_status not in ('draft', 'preview', 'closed') then
    raise exception 'Rooms stay private until chat is ready' using errcode = '22023';
  end if;
  if p_preset not in ('creator', 'creator_adult') then
    raise exception 'No such look' using errcode = '22023';
  end if;
  if v_adult and p_preset <> 'creator_adult' then
    raise exception 'Adult niches use the 18+ look' using errcode = '22023';
  end if;
  if v_adult and p_hero is not null then
    raise exception 'Rooms for adult niches show no photos or videos' using errcode = '22023';
  end if;
  if coalesce(p_accent, '') !~ '^#[0-9a-f]{6}$' then
    raise exception 'Pick an accent color' using errcode = '22023';
  end if;
  if char_length(coalesce(p_greeting, '')) > 280 then
    raise exception 'Keep the greeting to 280 characters' using errcode = '22023';
  end if;
  if jsonb_typeof(p_buttons) <> 'array' or jsonb_array_length(p_buttons) > 4 then
    raise exception 'Up to four buttons' using errcode = '22023';
  end if;
  for b in select * from jsonb_array_elements(p_buttons) loop
    if jsonb_typeof(b) <> 'object'
       or jsonb_typeof(b -> 'label') <> 'string'
       or char_length(btrim(b ->> 'label')) not between 1 and 40
       or jsonb_typeof(b -> 'link') <> 'number'
       or (b ->> 'link')::numeric <> floor((b ->> 'link')::numeric)
       or (b ->> 'link')::integer not between 0 and v_links - 1
       or (select count(*) from jsonb_object_keys(b)) <> 2 then
      raise exception 'Each button needs a label of up to 40 characters and one of the client''s approved links' using errcode = '22023';
    end if;
  end loop;
  if p_hero is not null and not exists (
    select 1 from public.library_items l
     where l.id = p_hero and l.client_id = p_client and l.kris_ok and l.status <> 'retired' and l.removed_at is null
  ) then
    raise exception 'Pick a file marked OK for Kris' using errcode = '22023';
  end if;

  insert into public.rooms (client_id, workspace_id, slug, status, preset, accent, greeting, buttons, hero_id, updated_by, updated_at)
  values (p_client, v_ws, v_slug, p_status, p_preset, p_accent, btrim(coalesce(p_greeting, '')), p_buttons, p_hero, (select auth.uid()), now())
  on conflict (client_id) do update
    set slug = excluded.slug, status = excluded.status, preset = excluded.preset, accent = excluded.accent,
        greeting = excluded.greeting, buttons = excluded.buttons, hero_id = excluded.hero_id,
        updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke all on function public.room_set(uuid, text, text, text, text, text, jsonb, uuid) from public, anon;
grant execute on function public.room_set(uuid, text, text, text, text, text, jsonb, uuid) to authenticated;

-- ---------- limits ----------

create table private.room_salts (
  day date primary key,
  salt text not null
);
alter table private.room_salts enable row level security;
revoke all on private.room_salts from public, anon, authenticated;

create table private.room_hits (
  key text not null check (char_length(key) <= 200),
  window_start timestamptz not null,
  hits integer not null default 1,
  primary key (key, window_start)
);
create index room_hits_window_idx on private.room_hits (window_start);
alter table private.room_hits enable row level security;
revoke all on private.room_hits from public, anon, authenticated;

-- Today's secret for hashing visitor addresses (UTC day), made the first time it is asked for.
create or replace function public.room_salt()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text;
begin
  insert into private.room_salts (day, salt)
  values ((now() at time zone 'utc')::date, encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (day) do nothing;
  select salt into v from private.room_salts where day = (now() at time zone 'utc')::date;
  return v;
end;
$$;
revoke all on function public.room_salt() from public, anon, authenticated;
grant execute on function public.room_salt() to service_role;

-- Counts one call against several limits at once: [{ "key": text, "window": seconds, "limit": n }].
-- Every count goes up; the answer is true only if none is past its limit.
create or replace function public.room_hit(p_limits jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  l jsonb;
  v_window integer;
  v_start timestamptz;
  v_hits integer;
  v_ok boolean := true;
begin
  if jsonb_typeof(p_limits) <> 'array' or jsonb_array_length(p_limits) > 6 then
    raise exception 'limits must be a short array';
  end if;
  for l in select * from jsonb_array_elements(p_limits) loop
    v_window := greatest(1, least((l ->> 'window')::integer, 86400));
    v_start := to_timestamp(floor(extract(epoch from now()) / v_window) * v_window);
    insert into private.room_hits as h (key, window_start, hits)
    values (left(l ->> 'key', 200), v_start, 1)
    on conflict (key, window_start) do update set hits = h.hits + 1
    returning hits into v_hits;
    if v_hits > (l ->> 'limit')::integer then
      v_ok := false;
    end if;
  end loop;
  return v_ok;
end;
$$;
revoke all on function public.room_hit(jsonb) from public, anon, authenticated;
grant execute on function public.room_hit(jsonb) to service_role;

-- The server-only key that signs preview links and visit tickets.
insert into public.internal_config (key, value)
values ('room_key', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

-- Counts and secrets go after 2 days.
create or replace function private.clear_room_counts()
returns integer
language sql
security definer
set search_path = ''
as $$
  with h as (delete from private.room_hits where window_start < now() - interval '2 days' returning 1),
       s as (delete from private.room_salts where day < (now() at time zone 'utc')::date - 1 returning 1)
  select (select count(*) from h)::integer + (select count(*) from s)::integer;
$$;
revoke all on function private.clear_room_counts() from public, anon, authenticated;

select cron.schedule('clear-room-counts', '41 * * * *', $$select private.clear_room_counts()$$);
