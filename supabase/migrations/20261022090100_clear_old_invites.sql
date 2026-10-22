-- Expired and used invite codes are of no use after a month. Daily at 04:41 UTC.
-- Kept apart from the workspace migration because it contains a DELETE; run it by hand
-- in the SQL Editor (the same way as the scheduler-history trim).
select cron.schedule(
  'backlot-clear-old-invites', '41 4 * * *',
  $$delete from private.invites where expires_at < now() - interval '30 days'$$
);
