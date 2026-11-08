-- Nov 7, 2026: a client onboarding step, "Backlot on your phone": ticked by the server the
-- first time the client's login turns on notifications on a device (never by hand).
alter table public.onboarding_steps drop constraint onboarding_steps_step_check;
alter table public.onboarding_steps add constraint onboarding_steps_step_check check (step in ('delegate', 'first_call', 'contract', 'phone'));
