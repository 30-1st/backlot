-- Match word forms in keyword search ("lowers" finds "lower", "scored" finds "score") by
-- using English stemming for both the stored text and the query. Code names are already
-- split into plain words by the indexer, so they stem the same way.
alter table public.algo_chunks alter column fts set expression as (to_tsvector('english', search_text));

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
           row_number() over (order by ts_rank_cd(c.fts, to_tsquery('english', query_tsquery)) desc) as rank_ix
      from algo_chunks c
     where query_tsquery <> ''
       and c.fts @@ to_tsquery('english', query_tsquery)
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
