-- Only logins made through Backlot's own sign-up have a row in public.members,
-- and the 60-day cleanup works from that table. Require that row before anyone
-- can create an account or upload a file, so a user created some other way
-- (for example straight through the Auth API) cannot store anything.
-- Narrations already require an account the creator owns, so they follow.

alter policy "Creators add their own accounts" on public.accounts
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.members m where m.id = (select auth.uid()))
  );

alter policy "Media: creators add their own files" on storage.objects
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.members m where m.id = (select auth.uid()))
  );
