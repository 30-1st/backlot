-- Warm handoffs and responsible spending (Khma, Oct 24, 2026).
--   * A Kris reply can be a "handoff": a warm route to the client's links when a visitor
--     shows buying intent, or steers toward sexual talk.
--   * Taps right after a handoff are counted on their own, so we can see whether
--     handoffs turn into clicks.
--   * A visit is marked when a visitor shows money trouble; selling stops for that visit.
alter table public.room_messages drop constraint room_messages_source_check;
alter table public.room_messages add constraint room_messages_source_check
  check (source in ('visitor', 'ai', 'faq', 'fixed', 'redirect', 'handoff'));

alter table public.room_visits add column spending boolean not null default false;

alter table public.room_counts
  add column handoffs integer not null default 0,
  add column handoff_taps integer not null default 0;

create or replace function public.room_count(p_client uuid, p_field text, p_n integer default 1)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  if p_field not in ('visits', 'chats', 'ai_replies', 'faq_taps', 'link_taps', 'redirects', 'handoffs', 'handoff_taps') or p_n not between 1 and 100 then
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
$$;
revoke all on function public.room_count(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.room_count(uuid, text, integer) to service_role;
