-- Extra monthly credits the executive grants a client, on top of the defaults, until payments
-- open: next_extra adds Up next posts (40 a month by default), plan_extra adds plans Bil builds
-- from the team chat (8 a month by default). Set only by the server for the executive; no
-- direct client or team writes (the clients table grants no UPDATE to authenticated).
alter table public.clients
  add column if not exists next_extra integer not null default 0 check (next_extra between 0 and 1000),
  add column if not exists plan_extra integer not null default 0 check (plan_extra between 0 and 1000);
