-- "Check messages now" can read up to 3 pages of 20 DMs (about $0.20 each on the first read of a
-- UTC day) and then sort them, all as one run. The old $0.25 run cap stopped it after the first
-- page. Raised to $0.75 for one run; the whole-workspace monthly cap still applies.
update private.spend_limits set cap_usd = 0.75 where scope = 'inbox';
