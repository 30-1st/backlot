-- X bills each resource once per UTC day ("All resources are deduplicated within a
-- 24-hour UTC day window", docs.x.com/x-api/getting-started/pricing). Looking up the
-- same profile twice in one UTC day costs $0.01 once.
--
-- Settling may now name the resource it read in detail.resource (e.g. 'x_user:xdevelopers').
-- When that resource of the same kind was already billed earlier in the same UTC day,
-- the read settles at $0 and is marked deduped. Same signature as before, so this is a
-- plain replace.

create or replace function private.spend_settle(p_id bigint, p_cost numeric, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  row_kind text;
  row_day timestamptz;
  final_cost numeric := p_cost;
  extra jsonb := coalesce(p_detail, '{}'::jsonb);
  resource text := coalesce(p_detail, '{}'::jsonb)->>'resource';
begin
  if p_cost is not null and p_cost < 0 then
    raise exception 'cost must be zero or more';
  end if;

  -- Same lock as reserving, so two reads of one resource cannot both be billed.
  perform pg_advisory_xact_lock(hashtext('backlot.spend'));

  select kind, date_trunc('day', created_at at time zone 'utc') at time zone 'utc'
    into row_kind, row_day
  from private.spend_ledger where id = p_id and status = 'reserved';
  if not found then
    raise exception 'reservation % is not open', p_id;
  end if;

  if resource is not null and p_cost is not null and p_cost > 0 and exists (
    select 1 from private.spend_ledger
    where id <> p_id
      and kind = row_kind
      and status = 'settled'
      and cost_usd > 0
      and detail->>'resource' = resource
      and created_at >= row_day
      and created_at < row_day + interval '1 day'
  ) then
    final_cost := 0;
    extra := extra || jsonb_build_object('deduped', true);
  end if;

  update private.spend_ledger
  set status = case when final_cost is null then 'released' else 'settled' end,
      cost_usd = final_cost,
      detail = detail || extra
  where id = p_id;
end;
$$;
