-- Rein's two-step search (Oct 29, 2026).
--
-- brief_posts: what the app shows about each post in a brief's viral section (the account's
-- handle, name and follower count, and a short excerpt). Kept 24 hours, then cleared by the
-- hourly job; the post and account IDs stay so X's official embed keeps working. The brief
-- itself (niche_briefs) holds IDs and numbers only.
--
-- clients.x_followers: the client's own follower count, read from their public profile at
-- most once a day, so Rein can show "accounts like yours" (a third to three times their size).
--
-- Rein's cap per brief goes from $0.30 to $1.25: two X searches of up to 100 posts ($0.50
-- each at $0.005 a post), the trending list, topic counts and three small Grok steps.

create table public.brief_posts (
  brief_id uuid not null references public.niche_briefs (id) on delete cascade,
  post_id text not null check (post_id ~ '^[0-9]{1,25}$'),
  author_id text not null check (author_id ~ '^[0-9]{1,25}$'),
  handle text check (handle ~ '^[A-Za-z0-9_]{1,15}$'),
  name text check (char_length(name) <= 100),
  followers integer check (followers >= 0),
  excerpt text check (char_length(excerpt) <= 120),
  details_expire_at timestamptz not null default now() + interval '24 hours',
  primary key (brief_id, post_id)
);
create index brief_posts_expiry_idx on public.brief_posts (details_expire_at)
  where handle is not null or excerpt is not null;

alter table public.brief_posts enable row level security;
-- Like the briefs: any signed-in account reads; only the server (service role) writes.
create policy brief_posts_read on public.brief_posts for select to authenticated using (true);
revoke insert, update, delete on public.brief_posts from authenticated, anon;

create or replace function private.clear_expired_brief_posts()
returns integer
language sql
security definer
set search_path = ''
as $$
  with cleared as (
    update public.brief_posts
       set handle = null, name = null, followers = null, excerpt = null
     where (handle is not null or excerpt is not null)
       and details_expire_at <= now()
    returning 1
  )
  select count(*)::integer from cleared;
$$;
revoke all on function private.clear_expired_brief_posts() from public, anon, authenticated;

select cron.schedule('clear-expired-brief-posts', '9 * * * *', $$select private.clear_expired_brief_posts()$$);

alter table public.clients
  add column x_followers integer check (x_followers >= 0),
  add column x_followers_at timestamptz;

update private.spend_limits
   set cap_usd = 1.25,
       note = 'One Rein brief: two X searches of up to 100 posts, the trending list, topic counts and three small Grok steps. Raised from $0.30 on 2026-10-29 for the two-step search.'
 where scope = 'rein';
