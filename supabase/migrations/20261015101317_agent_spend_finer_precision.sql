-- Keep agent costs to 8 decimal places: single Grok calls cost fractions of a cent
-- (e.g. $0.0015956) and rounding each to 6 places drifts over thousands of calls.
alter table private.spend_ledger
  alter column estimate_usd type numeric(16, 8),
  alter column cost_usd type numeric(16, 8);
