-- Location, device and owner details are removed from photos and videos on the device
-- before upload. This sweep is the safety net on the server: it checks every stored file
-- once (files kept before cleaning existed, and uploads from an older copy of the app),
-- cleans it in place if anything is left, and records that it was checked.

create table if not exists private.media_scrubbed (
  bucket text not null,
  name text not null,
  checked_at timestamptz not null default now(),
  changed boolean not null default false,
  note text check (char_length(note) <= 300),
  primary key (bucket, name)
);
alter table private.media_scrubbed enable row level security;
revoke all on private.media_scrubbed from public, anon, authenticated;

create or replace function public.media_scrub_next(p_limit integer default 5)
returns table(bucket text, name text, size bigint, mime text)
language sql
stable
security definer
set search_path to ''
as $$
  select o.bucket_id, o.name, coalesce((o.metadata ->> 'size')::bigint, 0), coalesce(o.metadata ->> 'mimetype', '')
    from storage.objects o
   where o.bucket_id in ('library', 'media', 'board')
     and coalesce((o.metadata ->> 'size')::bigint, 0) between 1 and 52428800
     and not exists (select 1 from private.media_scrubbed s where s.bucket = o.bucket_id and s.name = o.name)
   order by o.created_at
   limit greatest(1, least(p_limit, 20));
$$;

create or replace function public.media_scrub_mark(p_bucket text, p_name text, p_changed boolean, p_note text default null)
returns void
language sql
security definer
set search_path to ''
as $$
  insert into private.media_scrubbed (bucket, name, changed, note)
  values (p_bucket, p_name, p_changed, left(p_note, 300))
  on conflict (bucket, name) do update set checked_at = now(), changed = excluded.changed, note = excluded.note;
$$;

create or replace function private.media_scrub_due()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (select 1 from public.media_scrub_next(1));
$$;

revoke all on function public.media_scrub_next(integer) from public, anon, authenticated;
revoke all on function public.media_scrub_mark(text, text, boolean, text) from public, anon, authenticated;
revoke all on function private.media_scrub_due() from public, anon, authenticated;
grant execute on function public.media_scrub_next(integer) to service_role;
grant execute on function public.media_scrub_mark(text, text, boolean, text) to service_role;

-- Every 15 minutes, only while some file has not been checked yet.
select cron.schedule(
  'media-scrub-tick',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := (select value from public.internal_config where key = 'project_url') || '/functions/v1/bil-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-bil-token', (select value from public.internal_config where key = 'bil_worker_token')
    ),
    body := '{"job":"scrub_media"}'::jsonb,
    timeout_milliseconds := 5000
  )
  where private.media_scrub_due();
  $job$
);
