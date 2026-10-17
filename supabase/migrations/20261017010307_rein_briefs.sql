-- Rein: briefs reused per niche AND region, a lock so one niche is fetched once at a time,
-- and Rein's per-brief cap. Nothing is removed or rewritten.

-- ---------- region-aware reuse ----------

-- X location IDs (WOEIDs): 1 worldwide, 23424977 US, 23424975 UK, 23424775 Canada.
alter table public.niche_briefs
  add column region integer not null default 1
    check (region in (1, 23424977, 23424975, 23424775)),
  -- A brief made without watching videos is not reused when Bil asks for video.
  add column with_video boolean not null default false;

create index niche_briefs_reuse_idx on public.niche_briefs (niche_key, region, reuse_until desc);

-- ---------- one fetch per niche at a time ----------

-- Private: reached only through the two functions below, which only the server role can run.
create table private.rein_locks (
  niche_key text not null,
  region integer not null,
  run_id uuid not null,
  -- Longer than any function can live (150 s), so a crashed run's lock simply lapses.
  expires_at timestamptz not null,
  primary key (niche_key, region)
);
alter table private.rein_locks enable row level security;
revoke all on private.rein_locks from public, anon, authenticated;

-- Claims the lock, or takes over one that has lapsed. True when this run holds it.
create function public.rein_lock_claim(p_niche_key text, p_region integer, p_run uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.rein_locks (niche_key, region, run_id, expires_at)
  values (p_niche_key, p_region, p_run, now() + interval '3 minutes')
  on conflict (niche_key, region) do update
    set run_id = excluded.run_id, expires_at = excluded.expires_at
    where private.rein_locks.expires_at < now();
  return found;
end;
$$;

-- Releases the lock, only if this run still holds it.
create function public.rein_lock_release(p_niche_key text, p_region integer, p_run uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.rein_locks
  where niche_key = p_niche_key and region = p_region and run_id = p_run;
$$;

revoke all on function public.rein_lock_claim(text, integer, uuid) from public, anon, authenticated;
revoke all on function public.rein_lock_release(text, integer, uuid) from public, anon, authenticated;
grant execute on function public.rein_lock_claim(text, integer, uuid) to service_role;
grant execute on function public.rein_lock_release(text, integer, uuid) to service_role;
grant select, insert, update, delete on private.rein_locks to service_role;

-- ---------- Rein's cap ----------

update private.spend_limits
   set cap_usd = 0.30,
       note = 'One Rein brief: X search, the trending list and post counts.'
 where scope = 'rein';
