-- Signed-in users had TRUNCATE (plus REFERENCES and TRIGGER) on the toolbox tables, from
-- Supabase's default grants. TRUNCATE skips row level security, so any account could have
-- emptied every client's data. Users never need these; only the server does.
revoke truncate, references, trigger on
  public.clients, public.voice_cards, public.post_type_libraries, public.niche_briefs,
  public.brief_evidence, public.brief_reviews, public.campaigns, public.campaign_posts,
  public.algo_chunks, public.algo_files, public.algo_index_status, public.algo_param_changes, public.algo_params
  from anon, authenticated;

-- Tables created from now on start without them too.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
