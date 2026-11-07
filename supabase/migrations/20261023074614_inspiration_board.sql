-- The inspiration board: posts and looks the client or team want more of, or less of.
--
--   * Each item is an X link or a screenshot, marked "more like this" or "not this", with a
--     short note saying what about it. Bil reads the verdict and the note, never the image
--     and never the link's page.
--   * Items fade after 28 days unless pinned: they stay on the board, dimmed, but Bil stops
--     reading them. The daily cleanup job deletes unpinned items 90 days old, and removed
--     items after 7 days, files included.
--   * Screenshots live in a private bucket, "board", at <workspace id>/<client id>/<file>,
--     with the same who-can-see rules as the Library.
--   * The team and that client may use a client's board. Visitors never can.

create table public.inspiration_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  client_id uuid not null,
  kind text not null check (kind in ('link', 'shot')),
  url text check (url is null or (char_length(url) <= 500 and url ~ '^https://(www\.|mobile\.)?(x|twitter)\.com/[A-Za-z0-9_]{1,15}/status/[0-9]{1,25}(\?[^\s]*)?$')),
  path text unique,
  verdict text not null check (verdict in ('more', 'not')),
  note text not null check (char_length(btrim(note)) between 3 and 280),
  pinned boolean not null default false,
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  check ((kind = 'link' and url is not null and path is null) or (kind = 'shot' and path is not null and url is null)),
  foreign key (client_id, workspace_id) references public.clients (id, owner_id) on delete cascade
);
create index inspiration_items_client_idx on public.inspiration_items (client_id, created_at desc) where removed_at is null;
create index inspiration_items_workspace_idx on public.inspiration_items (workspace_id);
create index inspiration_items_removed_idx on public.inspiration_items (removed_at) where removed_at is not null;
create index inspiration_items_added_by_idx on public.inspiration_items (added_by);

alter table public.inspiration_items enable row level security;
revoke all on public.inspiration_items from anon, authenticated;
grant select on public.inspiration_items to authenticated;
grant select, insert, update, delete on public.inspiration_items to service_role;

create policy inspiration_items_read on public.inspiration_items for select to authenticated
  using ((select private.can_use_client(client_id)));

-- ---------- the private bucket for screenshots ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('board', 'board', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif'])
on conflict (id) do nothing;

create policy "Board: read screenshots of clients you work with" on storage.objects
  for select to authenticated
  using (bucket_id = 'board' and (select private.library_path_ok(name)));

create policy "Board: add screenshots for clients you work with" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'board' and (select private.library_path_ok(name)));

-- ---------- what the app may do ----------

create or replace function public.board_add(p_client uuid, p_kind text, p_url text, p_path text, p_verdict text, p_note text)
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
  select c.owner_id into v_ws from public.clients c where c.id = p_client;
  if (select count(*) from public.inspiration_items i where i.client_id = p_client and i.removed_at is null) >= 150 then
    raise exception 'The board is full. Remove a few old items first.' using errcode = '54000';
  end if;
  if p_kind = 'shot' and (p_path is null or split_part(p_path, '/', 1) <> v_ws::text or split_part(p_path, '/', 2) <> p_client::text
      or not exists (select 1 from storage.objects o where o.bucket_id = 'board' and o.name = p_path)) then
    raise exception 'That screenshot was not uploaded' using errcode = '22023';
  end if;
  insert into public.inspiration_items (workspace_id, client_id, kind, url, path, verdict, note, added_by)
  values (v_ws, p_client, p_kind,
          case when p_kind = 'link' then btrim(p_url) end,
          case when p_kind = 'shot' then p_path end,
          p_verdict, btrim(p_note), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.board_set(p_id uuid, p_verdict text, p_note text, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.inspiration_items i
     set verdict = p_verdict,
         note = btrim(p_note),
         pinned = coalesce(p_pinned, false)
   where i.id = p_id
     and i.removed_at is null
     and (select private.can_use_client(i.client_id));
  if not found then
    raise exception 'No such item on a board you can use' using errcode = '42501';
  end if;
end;
$$;

-- Remove an item (p_removed true) or bring it back within 7 days (false).
create or replace function public.board_remove(p_id uuid, p_removed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.inspiration_items i
     set removed_at = case when p_removed then now() end
   where i.id = p_id
     and (select private.can_use_client(i.client_id))
     and case when p_removed then i.removed_at is null else i.removed_at > now() - interval '7 days' end;
  if not found then
    raise exception 'That item can no longer be changed' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.board_add(uuid, text, text, text, text, text), public.board_set(uuid, text, text, boolean),
  public.board_remove(uuid, boolean) from public, anon;
grant execute on function public.board_add(uuid, text, text, text, text, text), public.board_set(uuid, text, text, boolean),
  public.board_remove(uuid, boolean) to authenticated;
