-- Nov 7, 2026: a quality gate run now replays DM drafts on the strong model (about 5 cents each),
-- so 30 cases need more than $0.40. Raised to $1.00 per run, within the approved $50 month.
update private.spend_limits set cap_usd = 1.00, note = 'One eval run: a judge scoring each output (about $0.002) plus each replayed chat turn, DMs on the strong model included (about $0.05). Raised from $0.40 on Nov 7, 2026 with the chat rebuild.' where scope = 'eval';
