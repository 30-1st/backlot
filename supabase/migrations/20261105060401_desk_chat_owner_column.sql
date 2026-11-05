-- Each person may read the owner column of their own desk rows (it is their own id), so the
-- row policy works the same whichever way Postgres checks column rights.
grant select (user_id) on public.desk_messages to authenticated;
