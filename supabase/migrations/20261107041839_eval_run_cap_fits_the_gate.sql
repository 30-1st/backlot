-- The eval gate replays every active test chat as one run. Its $0.04 cap was for the whole run,
-- so after 2 or 3 cases the rest were refused and scored "No answer" (a false warning on Nov 7).
-- About $0.03 a case; $0.40 fits up to about 12 cases. Each call is still capped at $0.04 in code,
-- and the whole-workspace monthly cap still applies.
update private.spend_limits set cap_usd = 0.40 where scope = 'eval';
