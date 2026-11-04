-- Xev looks when it matters (approved Nov 4, 2026): no fixed 15-minute timer. Each new post
-- plans a few DM checks after it, sooner and in more waves for bigger accounts and for posts
-- taking off; a peek at the client's own posts every 2 hours (and 5 minutes after a post is
-- marked posted) finds new posts; a quiet day still gets one check. pg_cron wakes the worker
-- only when a check or a peek is due, so idle accounts make no calls at all.
alter table public.x_connections
  add column check_at timestamptz[] not null default '{}',
  add column next_check_at timestamptz,
  add column next_peek_at timestamptz,
  add column last_post_id text check (char_length(last_post_id) <= 25);
create index x_connections_due on public.x_connections (next_check_at, next_peek_at) where status = 'active';

update public.x_connections set next_check_at = now(), next_peek_at = now(), check_at = array[now()] where status = 'active';

select cron.unschedule('xev-inbox-tick');
select cron.schedule('xev-inbox-tick', '*/5 * * * *', $cron$
  select net.http_post(
    url := (select value from public.internal_config where key = 'project_url') || '/functions/v1/bil-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-bil-token', (select value from public.internal_config where key = 'bil_worker_token')
    ),
    body := '{"job":"xev_inbox"}'::jsonb,
    timeout_milliseconds := 5000
  )
  where exists (
    select 1 from public.x_connections
     where status = 'active' and (next_check_at <= now() or next_peek_at <= now())
  );
$cron$);
