-- Algorithm index: X's open-source ranking code (xai-org/x-algorithm, Apache-2.0),
-- split into pieces Bil can search by keyword and by meaning, plus the published
-- default settings from home-mixer/params/param.rs and a log of every change.
--
-- Written only by the algo-ingest function (service role), which accepts uploads from
-- this repo's GitHub workflow alone. Readable by signed-in accounts: it is public code.
--
-- Vector search is exact (no vector index). At ~7,000 pieces an exact scan takes a few
-- milliseconds and never misses a match; add an HNSW index past ~50,000 pieces.

create extension if not exists vector with schema extensions;

-- ---------- files and pieces ----------

create table public.algo_files (
  path text primary key,
  blob_sha text not null check (blob_sha ~ '^[0-9a-f]{40}$'),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  chunk_count integer not null check (chunk_count >= 0),
  -- False while a file's pieces are still uploading; a half-uploaded file is redone next run.
  complete boolean not null default false,
  indexed_at timestamptz not null default now()
);

create table public.algo_chunks (
  id bigint generated always as identity primary key,
  path text not null references public.algo_files (path) on delete cascade,
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  start_line integer not null check (start_line >= 1),
  end_line integer not null check (end_line >= start_line),
  content text not null,
  -- content plus code names split into words ("FavoriteWeight" -> "favorite weight"),
  -- so plain-English keyword searches find code identifiers.
  search_text text not null,
  fts tsvector generated always as (to_tsvector('simple', search_text)) stored,
  embedding extensions.vector(384) not null
);
create index algo_chunks_path_idx on public.algo_chunks (path);
create index algo_chunks_fts_idx on public.algo_chunks using gin (fts);

-- ---------- published default settings ----------

create table public.algo_params (
  name text primary key,
  value_type text not null,
  switch_key text not null,
  value text not null,
  num_value double precision,
  line integer not null check (line >= 1),
  file text not null,
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  updated_at timestamptz not null default now()
);

create table public.algo_param_changes (
  id bigint generated always as identity primary key,
  name text not null,
  old_value text,
  new_value text,
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  changed_at timestamptz not null default now()
);
create index algo_param_changes_name_idx on public.algo_param_changes (name, changed_at desc);

-- ---------- index status (one row) ----------

create table public.algo_index_status (
  id smallint primary key default 1 check (id = 1),
  commit_sha text,
  commit_date timestamptz,
  defaults_synced_at timestamptz,
  model_repo text,
  model_revision text,
  model_file text,
  probe_cosine double precision,
  -- False when the job's vectors and Supabase's built-in model stop matching; search
  -- then falls back to keyword only and says so.
  semantic_ok boolean not null default false,
  files integer not null default 0,
  chunks integer not null default 0,
  last_run_status text not null default 'never' check (last_run_status in ('never', 'running', 'ok', 'failed')),
  last_error text,
  started_at timestamptz,
  finished_at timestamptz
);
insert into public.algo_index_status (id) values (1);

-- ---------- access ----------

alter table public.algo_files enable row level security;
alter table public.algo_chunks enable row level security;
alter table public.algo_params enable row level security;
alter table public.algo_param_changes enable row level security;
alter table public.algo_index_status enable row level security;

revoke all on public.algo_files, public.algo_chunks, public.algo_params, public.algo_param_changes,
  public.algo_index_status from anon;
revoke insert, update, delete, truncate on public.algo_files, public.algo_chunks, public.algo_params,
  public.algo_param_changes, public.algo_index_status from authenticated;

create policy algo_files_read on public.algo_files for select to authenticated using (true);
create policy algo_chunks_read on public.algo_chunks for select to authenticated using (true);
create policy algo_params_read on public.algo_params for select to authenticated using (true);
create policy algo_param_changes_read on public.algo_param_changes for select to authenticated using (true);
create policy algo_index_status_read on public.algo_index_status for select to authenticated using (true);

-- ---------- search ----------

-- Keyword and meaning search merged by reciprocal rank fusion (Supabase's hybrid search
-- pattern). query_tsquery is an OR-joined term list built by the caller (e.g.
-- 'lower | reach | post'), because natural-language questions AND-ed together rarely
-- match code. Pass use_semantic = false (and a null embedding) for keyword only.
create or replace function public.algo_hybrid_search(
  query_tsquery text,
  query_embedding extensions.vector(384),
  match_count integer,
  use_semantic boolean default true,
  full_text_weight double precision default 1,
  semantic_weight double precision default 1,
  rrf_k integer default 50
)
returns table (
  id bigint,
  path text,
  commit_sha text,
  start_line integer,
  end_line integer,
  content text,
  score double precision
)
language sql
stable
set search_path = public, extensions
as $$
  with params as (
    select least(greatest(match_count, 1), 30) as k
  ),
  full_text as (
    select c.id,
           row_number() over (order by ts_rank_cd(c.fts, to_tsquery('simple', query_tsquery)) desc) as rank_ix
      from algo_chunks c
     where query_tsquery <> ''
       and c.fts @@ to_tsquery('simple', query_tsquery)
     order by rank_ix
     limit (select k * 2 from params)
  ),
  semantic as (
    select c.id,
           row_number() over (order by c.embedding <#> query_embedding) as rank_ix
      from algo_chunks c
     where use_semantic and query_embedding is not null
     order by rank_ix
     limit (select k * 2 from params)
  )
  select c.id, c.path, c.commit_sha, c.start_line, c.end_line, c.content,
         coalesce(1.0 / (rrf_k + ft.rank_ix), 0.0) * full_text_weight
           + coalesce(1.0 / (rrf_k + s.rank_ix), 0.0) * semantic_weight as score
    from full_text ft
    full outer join semantic s on ft.id = s.id
    join algo_chunks c on c.id = coalesce(ft.id, s.id)
   order by score desc
   limit (select k from params);
$$;

revoke all on function public.algo_hybrid_search(text, extensions.vector, integer, boolean, double precision, double precision, integer)
  from public, anon;
grant execute on function public.algo_hybrid_search(text, extensions.vector, integer, boolean, double precision, double precision, integer)
  to authenticated, service_role;
