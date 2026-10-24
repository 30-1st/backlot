-- Drafting stops when a campaign is discarded: its queued or running steps are parked
-- (status held, marked Discarded), and come back if the campaign is restored.
create or replace function public.bil_steps_park(p_campaign uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare n integer;
begin
  update private.bil_steps
     set status = 'held', claim_id = null, lease_until = null, error = 'Discarded'
   where campaign_id = p_campaign and status in ('queued', 'running');
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.bil_steps_unpark(p_campaign uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  update private.bil_steps
     set status = 'queued', run_after = now(), attempts = 0, error = null
   where campaign_id = p_campaign and status = 'held' and error = 'Discarded';
  return found;
end;
$$;
revoke all on function public.bil_steps_park(uuid) from public, anon, authenticated;
revoke all on function public.bil_steps_unpark(uuid) from public, anon, authenticated;
grant execute on function public.bil_steps_park(uuid) to service_role;
grant execute on function public.bil_steps_unpark(uuid) to service_role;
