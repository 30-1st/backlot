-- Once a day, ask the purge-inactive function to remove logins that have not
-- opened Backlot for 60 days. The project address and the token the function
-- expects both live in public.internal_config, so nothing secret is written here.
--
-- Those two rows are data, not schema, so they are set once per project:
--   insert into public.internal_config (key, value) values
--     ('purge_token', encode(extensions.gen_random_bytes(32), 'hex')),
--     ('project_url', 'https://<project ref>.supabase.co');
select cron.schedule(
  'backlot-purge-inactive',
  '17 8 * * *',
  $job$
  select net.http_post(
    url := (select value from public.internal_config where key = 'project_url') || '/functions/v1/purge-inactive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-purge-token', (select value from public.internal_config where key = 'purge_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
