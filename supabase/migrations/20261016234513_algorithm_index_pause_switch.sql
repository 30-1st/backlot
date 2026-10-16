-- Emergency pause for the algorithm index: when enabled, every upload of new pieces fails
-- and the GitHub job stops and records why. Off by default.
--   Pause:  alter table public.algo_chunks enable trigger algo_chunks_pause;
--   Resume: alter table public.algo_chunks disable trigger algo_chunks_pause;
create or replace function private.algo_chunks_paused()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'algorithm index uploads are paused';
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'algo_chunks_pause' and tgrelid = 'public.algo_chunks'::regclass) then
    create trigger algo_chunks_pause before insert on public.algo_chunks
      for each row execute function private.algo_chunks_paused();
  end if;
end;
$$;

alter table public.algo_chunks disable trigger algo_chunks_pause;
