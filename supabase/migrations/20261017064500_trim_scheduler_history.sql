-- pg_cron never trims its own run history (Supabase Cron docs). At one run every 10
-- seconds that is 8,640 rows a day, so keep one day. Finished Bil steps are kept a week.
-- Run by hand in the SQL editor on 2026-10-17 (job 4), because the agent connector
-- refuses statements that delete rows.
select cron.schedule(
  'backlot-trim-history',
  '23 4 * * *',
  $job$
  delete from cron.job_run_details where end_time < now() - interval '1 day';
  delete from private.bil_steps where status in ('done', 'failed') and finished_at < now() - interval '7 days';
  $job$
);
