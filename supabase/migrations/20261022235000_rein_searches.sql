-- Rein on her own: anyone in the workspace can search what is rising in a niche.
--
--   * Each search is one row here. A search that reuses a brief made in the last 6 hours
--     costs nothing and never counts.
--   * Clients get 3 free searches. After that, a search will cost $5, or $15 a month.
--     Payments are not wired yet, so the server simply stops at 3 for clients. The team
--     searches without a limit, inside the workspace's AI budget.
--   * Bil reads the same briefs (public.niche_briefs) when he plans, so nothing is lost.
--   * People read only their own rows. Only the server writes them.

create table public.rein_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references auth.users (id) on delete cascade,
  niche text not null check (char_length(niche) between 2 and 200),
  region text not null check (region in ('worldwide', 'us', 'uk', 'canada')),
  brief_id uuid,
  reused boolean not null default false,
  free boolean not null default false,
  created_at timestamptz not null default now()
);
create index rein_searches_user_idx on public.rein_searches (user_id, created_at desc);
create index rein_searches_workspace_idx on public.rein_searches (workspace_id);

alter table public.rein_searches enable row level security;
revoke all on public.rein_searches from anon, authenticated;
grant select on public.rein_searches to authenticated;
grant select, insert, update, delete on public.rein_searches to service_role;

create policy rein_searches_read_own on public.rein_searches for select to authenticated
  using ((select auth.uid()) = user_id);

-- Claim one of a client's 3 free searches, atomically, so two taps at once cannot
-- make a fourth. Returns the new row's id, or null when the free searches are used up.
create or replace function public.rein_claim_free(p_user uuid, p_workspace uuid, p_niche text, p_region text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used integer;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('rein-free:' || p_user::text, 0));
  select count(*) into v_used from public.rein_searches s where s.user_id = p_user and s.free and not s.reused;
  if v_used >= 3 then
    return null;
  end if;
  insert into public.rein_searches (user_id, workspace_id, niche, region, free)
  values (p_user, p_workspace, p_niche, p_region, true)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.rein_claim_free(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.rein_claim_free(uuid, uuid, text, text) to service_role;
