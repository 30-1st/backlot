-- Rooms may open to the public now (Khma, Oct 23, 2026), including adult niches behind the
-- 18+ step; Khma takes on the legal review. Open rooms need no preview ticket. Chat with
-- Kris still waits for K2.
alter table public.rooms drop constraint rooms_status_check;
alter table public.rooms add constraint rooms_status_check check (status in ('draft', 'preview', 'open', 'closed'));

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
  if p_status not in ('draft', 'preview', 'open', 'closed') then
    raise exception 'No such status' using errcode = '22023';
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
  if p_status = 'open' and jsonb_array_length(p_buttons) = 0 then
    raise exception 'Add at least one button before opening the room' using errcode = '22023';
  end if;
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
