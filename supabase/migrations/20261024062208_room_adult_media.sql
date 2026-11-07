-- Adult rooms may show one photo or video too (Khma, Oct 24, 2026), but only one the team
-- confirms shows no nudity or sexual activity. Who confirmed it, and when, is kept.
alter table public.rooms
  add column hero_clean_by uuid references auth.users (id) on delete set null,
  add column hero_clean_at timestamptz;
create index rooms_hero_clean_by_idx on public.rooms (hero_clean_by) where hero_clean_by is not null;

drop function public.room_set(uuid, text, text, text, text, text, jsonb, uuid);

create function public.room_set(
  p_client uuid,
  p_slug text,
  p_status text,
  p_preset text,
  p_accent text,
  p_greeting text,
  p_buttons jsonb,
  p_hero uuid,
  p_hero_clean boolean default false
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
  v_old_hero uuid;
  v_old_by uuid;
  v_old_at timestamptz;
  b jsonb;
begin
  select c.profile into v_profile from public.clients c where c.id = p_client and c.owner_id = v_ws;
  if v_ws is null or v_profile is null then
    raise exception 'Only the team can set up a client''s room' using errcode = '42501';
  end if;
  v_adult := coalesce((v_profile ->> 'adultContent')::boolean, false);
  v_links := coalesce(jsonb_array_length(case when jsonb_typeof(v_profile -> 'links') = 'array' then v_profile -> 'links' end), 0);
  select r.hero_id, r.hero_clean_by, r.hero_clean_at into v_old_hero, v_old_by, v_old_at from public.rooms r where r.client_id = p_client;

  if v_slug !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'Use 3 to 30 letters, numbers or underscores for the room name' using errcode = '22023';
  end if;
  if private.room_slug_reserved(v_slug) then
    raise exception 'That room name is reserved. Pick another' using errcode = '22023';
  end if;
  if exists (select 1 from public.rooms r where r.slug = v_slug and r.client_id <> p_client) then
    raise exception 'That room name is taken. Pick another' using errcode = '23505';
  end if;
  if p_status not in ('draft', 'preview', 'open', 'closed') then
    raise exception 'No such status' using errcode = '22023';
  end if;
  if p_preset not in ('creator', 'creator_adult') then
    raise exception 'No such look' using errcode = '22023';
  end if;
  if v_adult and p_preset <> 'creator_adult' then
    raise exception 'Adult niches use the 18+ look' using errcode = '22023';
  end if;
  -- A new file in an adult room needs the team's word that it is not explicit. The same
  -- file kept from before keeps its earlier confirmation.
  if v_adult and p_hero is not null and not coalesce(p_hero_clean, false)
     and not (p_hero = v_old_hero and v_old_by is not null) then
    raise exception 'Confirm the photo or video shows no nudity or sexual activity' using errcode = '22023';
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
  if p_status = 'open' and jsonb_array_length(p_buttons) = 0 then
    raise exception 'Add at least one button before opening the room' using errcode = '22023';
  end if;
  if p_hero is not null and not exists (
    select 1 from public.library_items l
     where l.id = p_hero and l.client_id = p_client and l.kris_ok and l.status <> 'retired' and l.removed_at is null
  ) then
    raise exception 'Pick a file marked OK for Kris' using errcode = '22023';
  end if;

  insert into public.rooms (client_id, workspace_id, slug, status, preset, accent, greeting, buttons, hero_id, hero_clean_by, hero_clean_at, updated_by, updated_at)
  values (
    p_client, v_ws, v_slug, p_status, p_preset, p_accent, btrim(coalesce(p_greeting, '')), p_buttons, p_hero,
    case when p_hero is null then null when p_hero = v_old_hero and not coalesce(p_hero_clean, false) then v_old_by when coalesce(p_hero_clean, false) then (select auth.uid()) end,
    case when p_hero is null then null when p_hero = v_old_hero and not coalesce(p_hero_clean, false) then v_old_at when coalesce(p_hero_clean, false) then now() end,
    (select auth.uid()), now()
  )
  on conflict (client_id) do update
    set slug = excluded.slug, status = excluded.status, preset = excluded.preset, accent = excluded.accent,
        greeting = excluded.greeting, buttons = excluded.buttons, hero_id = excluded.hero_id,
        hero_clean_by = excluded.hero_clean_by, hero_clean_at = excluded.hero_clean_at,
        updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke all on function public.room_set(uuid, text, text, text, text, text, jsonb, uuid, boolean) from public, anon;
grant execute on function public.room_set(uuid, text, text, text, text, text, jsonb, uuid, boolean) to authenticated;
