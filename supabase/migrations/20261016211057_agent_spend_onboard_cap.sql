-- Cap for one client onboarding run: Bil reads up to 50 of the client's own X posts
-- ($0.005 each with Backlot's app token) to learn their voice. Approved 2026-10-16.
insert into private.spend_limits (scope, cap_usd, note)
values ('onboard', 0.25, 'One client onboarding: up to 50 X post reads to learn their voice.')
on conflict (scope) do update set cap_usd = excluded.cap_usd, note = excluded.note;
