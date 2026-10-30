-- Posting outcomes for the one-post-at-a-time schedule (Oct 30, 2026).
--
-- A past post now ends one of three ways, set by the client or a granted team member:
--   * posted as drafted   (review 'posted', posted_as 'as_drafted')
--   * posted with changes (review 'posted', posted_as 'changed')
--   * not posted          (review 'not_posted')
-- The X link stays in x_post_id. Backlot never posts; these are notes from people.

alter table public.campaign_posts drop constraint campaign_posts_review_check;
alter table public.campaign_posts
  add constraint campaign_posts_review_check check (review in ('pending', 'approved', 'changes', 'posted', 'not_posted')),
  add column posted_as text check (posted_as in ('as_drafted', 'changed'));

alter table public.approval_log drop constraint approval_log_decision_check;
alter table public.approval_log
  add constraint approval_log_decision_check check (decision in ('approved', 'changes', 'posted', 'not_posted', 'undone', 'saved', 'suggested', 'dropped', 'discarded', 'restored'));
