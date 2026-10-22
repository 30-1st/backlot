-- The Library: each client's real photos and videos, tagged so Bil can plan around them.
--
--   * Files live in a private bucket, "library", at <workspace id>/<client id>/<file name>.
--     Nothing in it is ever public; the app shows files through short-lived signed links.
--   * The team sees and adds to every client's Library in its workspace. A client sees and
--     adds to their own only.
--   * Nobody writes the table directly. Adding, tagging, removing and restoring go through
--     the functions below, which check who is asking first.
--   * Removing hides a file at once. It can be restored for 7 days; after that the daily
--     cleanup job (purge-inactive) deletes the file and its row for good.
--   * Bil only ever reads the tags and notes, never the images.

-- ---------- who is asking ----------

-- The workspace the signed-in person belongs to, in any role, or null.
create or replace function private.my_workspace()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid());
$$;

-- True when the signed-in person may see and add to this client's Library.
create or replace function private.can_use_client(p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.clients c
     where c.id = p_client
       and (c.owner_id = (select private.my_team_workspace()) or c.id = (select private.my_client()))
  );
$$;

-- True when a storage path is <workspace>/<client>/<file> for a client this person may use.
create or replace function private.library_path_ok(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.clients c
     where c.id::text = (storage.foldername(p_name))[2]
       and c.owner_id::text = (storage.foldername(p_name))[1]
       and array_length(storage.foldername(p_name), 1) = 2
       and (c.owner_id = (select private.my_team_workspace()) or c.id = (select private.my_client()))
  );
$$;

revoke all on function private.my_workspace(), private.can_use_client(uuid), private.library_path_ok(text) from public, anon;
grant execute on function private.my_workspace(), private.can_use_client(uuid), private.library_path_ok(text) to authenticated;

-- ---------- the table ----------

create table public.library_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  client_id uuid not null,
  path text not null unique,
  kind text not null check (kind in ('photo', 'video')),
  mime text not null check (char_length(mime) between 3 and 100),
  bytes bigint not null check (bytes > 0 and bytes <= 52428800),
  width integer check (width between 1 and 20000),
  height integer check (height between 1 and 20000),
  duration_s numeric(8, 2) check (duration_s >= 0 and duration_s < 86400),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  note text check (char_length(note) <= 300),
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  foreign key (client_id, workspace_id) references public.clients (id, owner_id) on delete cascade
);
create index library_items_client_idx on public.library_items (client_id, created_at desc) where removed_at is null;
create index library_items_workspace_idx on public.library_items (workspace_id);
create index library_items_removed_idx on public.library_items (removed_at) where removed_at is not null;
create index library_items_added_by_idx on public.library_items (added_by);

alter table public.library_items enable row level security;
revoke all on public.library_items from anon, authenticated;
grant select on public.library_items to authenticated;
grant select, insert, update, delete on public.library_items to service_role;

create policy library_items_read on public.library_items for select to authenticated
  using ((select private.can_use_client(client_id)));

-- ---------- the private bucket ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('library', 'library', false, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;

create policy "Library: read files of clients you work with" on storage.objects
  for select to authenticated
  using (bucket_id = 'library' and (select private.library_path_ok(name)));

create policy "Library: add files for clients you work with" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'library' and (select private.library_path_ok(name)));

-- No update or delete rules: files are never replaced from the app, and only the
-- server's cleanup job deletes them.

-- ---------- tags ----------

-- Lowercase, trimmed, single spaces, letters, digits, spaces and dashes, 32 characters
-- at most, no duplicates, 20 at most. Anything else is dropped.
create or replace function private.clean_tags(p_tags text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(t order by first), '{}')
    from (
      select t, min(ord) as first
        from (
          select regexp_replace(lower(btrim(x)), '\s+', ' ', 'g') as t, ord
            from unnest(coalesce(p_tags, '{}')) with ordinality as u(x, ord)
        ) s
       where t ~ '^[a-z0-9][a-z0-9 -]{0,31}$'
       group by t
       order by min(ord)
       limit 20
    ) d;
$$;

-- ---------- what the app may do ----------

-- Record a file the person just uploaded. The upload itself is checked by the bucket rules.
create or replace function public.library_add(
  p_client uuid,
  p_path text,
  p_kind text,
  p_mime text,
  p_bytes bigint,
  p_width integer default null,
  p_height integer default null,
  p_duration numeric default null,
  p_tags text[] default '{}',
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_id uuid;
begin
  if not (select private.can_use_client(p_client)) then
    raise exception 'You cannot add files for this client' using errcode = '42501';
  end if;
  select c.owner_id into v_workspace from public.clients c where c.id = p_client;
  if p_path is null or p_path not like v_workspace::text || '/' || p_client::text || '/%' or not (select private.library_path_ok(p_path)) then
    raise exception 'That file is not in this client''s Library folder' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'library' and o.name = p_path and o.owner_id = (select auth.uid())::text) then
    raise exception 'Upload the file first' using errcode = '22023';
  end if;
  insert into public.library_items (workspace_id, client_id, path, kind, mime, bytes, width, height, duration_s, tags, note, added_by)
  values (v_workspace, p_client, p_path, p_kind, p_mime, p_bytes, p_width, p_height, p_duration,
          private.clean_tags(p_tags), nullif(left(btrim(coalesce(p_note, '')), 300), ''), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- Change a file's tags and note.
create or replace function public.library_set(p_id uuid, p_tags text[], p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.library_items i
     set tags = private.clean_tags(p_tags),
         note = nullif(left(btrim(coalesce(p_note, '')), 300), '')
   where i.id = p_id
     and i.removed_at is null
     and (select private.can_use_client(i.client_id));
  if not found then
    raise exception 'No such file in a Library you can use' using errcode = '42501';
  end if;
end;
$$;

-- Hide a file. It can be restored for 7 days.
create or replace function public.library_remove(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.library_items i
     set removed_at = now()
   where i.id = p_id
     and i.removed_at is null
     and (select private.can_use_client(i.client_id));
  if not found then
    raise exception 'No such file in a Library you can use' using errcode = '42501';
  end if;
end;
$$;

-- Bring back a file removed in the last 7 days.
create or replace function public.library_restore(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.library_items i
     set removed_at = null
   where i.id = p_id
     and i.removed_at > now() - interval '7 days'
     and (select private.can_use_client(i.client_id));
  if not found then
    raise exception 'That file can no longer be restored' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.library_add(uuid, text, text, text, bigint, integer, integer, numeric, text[], text),
  public.library_set(uuid, text[], text), public.library_remove(uuid), public.library_restore(uuid),
  private.clean_tags(text[]) from public, anon;
grant execute on function public.library_add(uuid, text, text, text, bigint, integer, integer, numeric, text[], text),
  public.library_set(uuid, text[], text), public.library_remove(uuid), public.library_restore(uuid) to authenticated;
grant execute on function private.clean_tags(text[]) to authenticated, service_role;
