-- One team chat reply may reserve up to $0.04 (was $0.02): Bil's knowledge pack plus a full
-- brand kit can reserve about $0.023 before the cache kicks in. Kris's monthly caps
-- ($3 per client, $10 in all) are unchanged.
update private.spend_limits set cap_usd = 0.04, note = 'One team chat reply (Rein, Bil, Kris or Xev), or one Kris pitch. Raised from $0.02 on 2026-11-04: Bil''s pack can reserve about $0.023 before caching. Monthly caps unchanged.' where scope = 'kris';
