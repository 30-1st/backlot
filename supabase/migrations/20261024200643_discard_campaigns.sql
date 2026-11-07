-- Discard and restore campaigns, and approve all posts at once (team and clients).
-- A discarded campaign keeps its posts, so it can be restored; it simply drops out of
-- the schedule, Today, Kris's drafts and pitches, and any drafting still queued stops.

alter table public.campaigns
  add column if not exists discarded_at timestamptz,
  add column if not exists discarded_by uuid;

comment on column public.campaigns.discarded_at is 'When someone discarded this campaign. Null means it is live. Restoring clears it.';

-- The approvals log records discards, restores and bulk approvals too.
alter table public.approval_log drop constraint if exists approval_log_kind_check;
alter table public.approval_log add constraint approval_log_kind_check check (kind = any (array['post', 'voice', 'brand', 'campaign']));
alter table public.approval_log drop constraint if exists approval_log_decision_check;
alter table public.approval_log add constraint approval_log_decision_check
  check (decision = any (array['approved', 'changes', 'posted', 'undone', 'saved', 'suggested', 'dropped', 'discarded', 'restored']));

-- Kris never pitches drafts from a discarded campaign.
create or replace function public.kris_pitch_candidates(p_limit integer default 20)
returns table(client_id uuid, workspace_id uuid, reason text)
language sql
stable security definer
set search_path to ''
as $function$
  with c as (
    select cl.id, cl.owner_id, p.last_pitch_at
      from public.clients cl
      left join public.kris_prefs p on p.client_id = cl.id
     where coalesce(p.plain, false) = false
       and coalesce((cl.profile ->> 'adultContent')::boolean, false) = false
       and (p.last_pitch_at is null or p.last_pitch_at < now() - interval '20 hours')
  )
  (select c.id, c.owner_id, 'trends'::text
     from c
    where exists (
      select 1 from public.client_briefs b
       where b.client_id = c.id
         and b.created_at > now() - interval '3 days'
         and b.created_at > coalesce(c.last_pitch_at, '-infinity'::timestamptz)
    ))
  union all
  (select c.id, c.owner_id, 'drafts'::text
     from c
    where (c.last_pitch_at is null or c.last_pitch_at < now() - interval '3 days')
      and (select count(*)
             from public.campaign_posts cp
             join public.campaigns ca on ca.id = cp.campaign_id
            where ca.client_id = c.id
              and ca.discarded_at is null
              and cp.status = 'ok'
              and cp.review = 'pending'
              and cp.created_at < now() - interval '24 hours') >= 3)
  limit greatest(1, least(p_limit, 50));
$function$;
revoke all on function public.kris_pitch_candidates(integer) from public, anon, authenticated;
grant execute on function public.kris_pitch_candidates(integer) to service_role;

