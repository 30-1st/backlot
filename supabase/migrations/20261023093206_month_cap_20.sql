-- The monthly AI budget for all agents together goes from $5 to $20 (Khma, 2026-10-23).
update private.spend_limits
   set cap_usd = 20.0000,
       note = 'All agents together, per calendar month (UTC). Raised from $5 to $20 on 2026-10-23 at Khma''s request.'
 where scope = 'month';
