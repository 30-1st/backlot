-- Nov 8, 2026: Bil can read a client's page again and rewrite the voice. The card from before
-- is kept, so one tap brings it back, and the log records both.
alter table public.voice_cards add column if not exists previous_card jsonb;
alter table public.approval_log drop constraint approval_log_decision_check;
alter table public.approval_log add constraint approval_log_decision_check check (decision in ('approved', 'changes', 'posted', 'not_posted', 'undone', 'saved', 'suggested', 'dropped', 'discarded', 'restored', 'redo', 'undo'));
