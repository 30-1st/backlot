-- Dial upgrades 3 and 5.
--
--   * The separate dial check has its own meter per campaign (scope 'dials'), so it never
--     eats into the $1 drafting cap. About $0.002 a post; $0.25 covers 60 posts plus redos.
--   * "I posted this" can carry the X post's link, so reports know which draft became
--     which post. Only the post's number is kept. One X post maps to one draft.

insert into private.spend_limits (scope, cap_usd, note)
values ('dials', 0.2500, 'The dial check for one campaign: every draft scored on the nine dials.')
on conflict (scope) do nothing;

alter table public.campaign_posts
  add column x_post_id text check (x_post_id ~ '^[0-9]{1,25}$');

create unique index campaign_posts_x_post_idx on public.campaign_posts (owner_id, x_post_id) where x_post_id is not null;
