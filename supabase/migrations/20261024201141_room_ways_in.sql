-- K3, ways in: daily counts of room opens by the way people came in. Plain numbers per
-- client per day, never who visited. The room site sends the way once per browser
-- session, so reloads do not inflate it.

alter table public.room_counts
  add column if not exists way_bio integer not null default 0,
  add column if not exists way_pinned integer not null default 0,
  add column if not exists way_post integer not null default 0,
  add column if not exists way_reply integer not null default 0,
  add column if not exists way_dm integer not null default 0,
  add column if not exists way_qr integer not null default 0,
  add column if not exists way_other integer not null default 0,
  add column if not exists way_direct integer not null default 0;

create or replace function public.room_count(p_client uuid, p_field text, p_n integer default 1)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ws uuid;
begin
  if p_field not in ('visits', 'chats', 'ai_replies', 'faq_taps', 'link_taps', 'redirects', 'handoffs', 'handoff_taps',
                     'way_bio', 'way_pinned', 'way_post', 'way_reply', 'way_dm', 'way_qr', 'way_other', 'way_direct')
     or p_n not between 1 and 100 then
    raise exception 'bad count';
  end if;
  select owner_id into v_ws from public.clients where id = p_client;
  if v_ws is null then
    return;
  end if;
  execute format(
    'insert into public.room_counts (client_id, workspace_id, day, %1$I) values ($1, $2, (now() at time zone ''utc'')::date, $3)
     on conflict (client_id, day) do update set %1$I = public.room_counts.%1$I + excluded.%1$I', p_field)
  using p_client, v_ws, p_n;
end;
$function$;

-- Clients see the Ways in guides only once the team has tried them on a real account.
insert into public.internal_config (key, value) values ('k3_guides_ready', 'no') on conflict (key) do nothing;

create or replace function public.ways_guides_ready()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((select value from public.internal_config where key = 'k3_guides_ready'), 'no') = 'yes';
$$;
revoke all on function public.ways_guides_ready() from public, anon;
grant execute on function public.ways_guides_ready() to authenticated;
