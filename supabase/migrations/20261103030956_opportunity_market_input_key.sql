-- Reuse also matches on what the user typed, not only on the name Rein gives the market
-- (her wording can differ between meetings: "online fitness programs" vs "online fitness
-- coaching programs"). Backfilled from the meeting that made each market.
alter table public.opportunity_markets add column input_key text check (input_key is null or char_length(input_key) between 2 and 200);
update public.opportunity_markets om
   set input_key = lower(regexp_replace(btrim(m.market_input), '\s+', ' ', 'g'))
  from public.opportunity_meetings m
 where m.market_id = om.id and om.input_key is null;
create index opportunity_markets_input_idx on public.opportunity_markets (input_key, region, reuse_until desc);
