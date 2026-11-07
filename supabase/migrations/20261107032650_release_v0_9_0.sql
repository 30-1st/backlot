-- Release v0.9.0 (Nov 7, 2026): the version before the waitlist. The app (package.json), the
-- Edge Functions (deployed from the same commit, tagged v0.9.0 in git) and this database
-- (every migration up to and including this one) make up one release.
comment on schema public is 'Backlot release v0.9.0 (2026-11-07). App, functions and database are versioned together; see git tag v0.9.0.';
