-- The approvals log: one line per decision on a client's work, kept as a record.
--
--   * Post decisions (approved, changes asked, posted, undone), voice card approvals, and
--     brand kit saves, suggestions and reviews.
--   * Only the server writes it, after the decision itself is saved. Nobody edits or
--     deletes a line from the app; it goes only when the client is removed.
--   * The team and that client may read a client's log. Visitors never can.
--   * subject keeps a short snapshot (a post's first line, say) so a line still reads
--     after the campaign changes.

create table public.approval_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  client_id uuid not null,
  kind text not null check (kind in ('post', 'voice', 'brand')),
  decision text not null check (decision in ('approved', 'changes', 'posted', 'undone', 'saved', 'suggested', 'dropped')),
  campaign_id uuid references public.campaigns (id) on delete set null,
  slot integer check (slot between 1 and 60),
  subject text check (char_length(subject) <= 160),
  note text check (char_length(note) <= 500),
  actor_id uuid references auth.users (id) on delete set null,
  actor_role text not null check (actor_role in ('team', 'client')),
  created_at timestamptz not null default now(),
  foreign key (client_id, workspace_id) references public.clients (id, owner_id) on delete cascade
);
create index approval_log_client_idx on public.approval_log (client_id, created_at desc);
create index approval_log_workspace_idx on public.approval_log (workspace_id);
create index approval_log_campaign_idx on public.approval_log (campaign_id) where campaign_id is not null;
create index approval_log_actor_idx on public.approval_log (actor_id) where actor_id is not null;

alter table public.approval_log enable row level security;
revoke all on public.approval_log from anon, authenticated;
grant select on public.approval_log to authenticated;
grant select, insert on public.approval_log to service_role;

create policy approval_log_read on public.approval_log for select to authenticated
  using ((select private.can_use_client(client_id)));

-- Decisions made before the log existed: one line each, from what the posts still show.
insert into public.approval_log (workspace_id, client_id, kind, decision, campaign_id, slot, subject, note, actor_id, actor_role, created_at)
select c.owner_id, c.client_id, 'post', p.review, p.campaign_id, p.slot,
       left(coalesce(p.post ->> 'hook', p.post ->> 'idea', ''), 160),
       p.review_note,
       p.reviewed_by,
       case when exists (select 1 from public.workspace_members m where m.user_id = p.reviewed_by and m.role = 'client') then 'client' else 'team' end,
       p.reviewed_at
  from public.campaign_posts p
  join public.campaigns c on c.id = p.campaign_id
 where p.reviewed_at is not null and p.review in ('approved', 'changes', 'posted');
