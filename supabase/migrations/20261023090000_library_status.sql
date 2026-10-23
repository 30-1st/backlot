-- Media status: each file is new, approved or retired, and may be marked OK for Kris.
--   new       just added; Bil may plan with it once it is tagged
--   approved  the client or team said it is good to use
--   retired   kept, but Bil never plans with it again
-- "Used" is not stored: the app sees it from the posts a file went into.
-- kris_ok: only files with this on may ever appear on the client's Kris page.
alter table public.library_items
  add column status text not null default 'new' check (status in ('new', 'approved', 'retired')),
  add column kris_ok boolean not null default false;

create or replace function public.library_status(p_id uuid, p_status text, p_kris_ok boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('new', 'approved', 'retired') then
    raise exception 'No such status' using errcode = '22023';
  end if;
  update public.library_items i
     set status = p_status,
         -- A retired file is never shown by Kris.
         kris_ok = coalesce(p_kris_ok, false) and p_status <> 'retired'
   where i.id = p_id
     and i.removed_at is null
     and (select private.can_use_client(i.client_id));
  if not found then
    raise exception 'No such file in a Library you can use' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.library_status(uuid, text, boolean) from public, anon;
grant execute on function public.library_status(uuid, text, boolean) to authenticated;
