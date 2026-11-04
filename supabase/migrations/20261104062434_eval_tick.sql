-- The eval tick runs every 5 minutes while an eval run is going (a gate replays up to 30
-- cases, more than one worker's 150 seconds), and once an hour otherwise.
create or replace function private.eval_due() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.eval_runs where status = 'running')
      or extract(minute from now()) between 40 and 44;
$$;
revoke all on function private.eval_due() from public, anon, authenticated;

select cron.unschedule('eval-tick');
select cron.schedule(
  'eval-tick',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := (select value from public.internal_config where key = 'project_url') || '/functions/v1/bil-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-bil-token', (select value from public.internal_config where key = 'bil_worker_token')
    ),
    body := '{"job":"eval"}'::jsonb,
    timeout_milliseconds := 5000
  )
  where private.eval_due();
  select private.eval_trim();
  $job$
);
