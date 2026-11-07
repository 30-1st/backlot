-- Kris brings pitches on her own (K0).
--
--   * Once an hour, pg_cron wakes the worker with { "job": "kris_pitches" }, but only when
--     some client has an opening, so an idle project makes no requests.
--   * An opening is new trends from Rein in the last 3 days (since her last pitch), or
--     three or more drafts that have waited over a day (at most every 3 days).
--   * Never for clients on plain notices, never for adult niches, at most one a day.
--     Quiet hours and the client's daytime are checked in code, in their time zone.

create index if not exists campaign_posts_waiting_idx on public.campaign_posts (campaign_id) where status = 'ok' and review = 'pending';

create or replace function public.kris_pitch_candidates(p_limit integer default 20)
returns table (client_id uuid, workspace_id uuid, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select cl.id, cl.owner_id, p.last_pitch_at
      from public.clients cl
      left join public.kris_prefs p on p.client_id = cl.id
     where coalesce(p.plain, false) = false
       and coalesce((cl.profile ->> 'adultContent')::boolean, false) = false
       and (p.last_pitch_at is null or p.last_pitch_at < now() - interval '20 hours')
  )
  (select c.id, c.owner_id, 'trends'::text
     from c
    where exists (
      select 1 from public.client_briefs b
       where b.client_id = c.id
         and b.created_at > now() - interval '3 days'
         and b.created_at > coalesce(c.last_pitch_at, '-infinity'::timestamptz)
    ))
  union all
  (select c.id, c.owner_id, 'drafts'::text
     from c
    where (c.last_pitch_at is null or c.last_pitch_at < now() - interval '3 days')
      and (select count(*)
             from public.campaign_posts cp
             join public.campaigns ca on ca.id = cp.campaign_id
            where ca.client_id = c.id
              and cp.status = 'ok'
              and cp.review = 'pending'
              and cp.created_at < now() - interval '24 hours') >= 3)
  limit greatest(1, least(p_limit, 50));
$$;
revoke all on function public.kris_pitch_candidates(integer) from public, anon, authenticated;
grant execute on function public.kris_pitch_candidates(integer) to service_role;

create or replace function private.kris_pitch_due()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.kris_pitch_candidates(1));
$$;
revoke all on function private.kris_pitch_due() from public, anon, authenticated;

select cron.schedule(
  'kris-pitch-tick',
  '17 * * * *',
  $job$
  select net.http_post(
    url := (select value from public.internal_config where key = 'project_url') || '/functions/v1/bil-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-bil-token', (select value from public.internal_config where key = 'bil_worker_token')
    ),
    body := '{"job":"kris_pitches"}'::jsonb,
    timeout_milliseconds := 5000
  )
  where private.kris_pitch_due();
  $job$
);
