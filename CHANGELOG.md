# Changelog

## v0.9.1 (Nov 7, 2026): bug sweep fixes

- The quality check (eval gate) had a $0.04 cap for the whole run, so after 2 or 3 test chats the rest were refused and scored "No answer". The run cap is now $0.40, and a refusal pauses the run instead of failing an agent. The false warning was re-run.
- A team chat turn that mentions a plan no longer risks going over the turn's 4-cent cap: the plan check has its own run, and the "must answer" retry can never sink the turn.
- Up next: "Make another" goes back to "Bil picks the best fit", the same file can be picked again after an upload, and the wait text says a few seconds.

## v0.9.0 (Nov 7, 2026): before the waitlist

The first versioned release. The app, the Edge Functions and the database ship together under this tag.

- **Up next:** the client picks a goal and a photo (or lets Bil pick from their Media); Bil writes the post in seconds with Xev's selling rules, then scores the Media green, yellow or red and suggests stronger picks.
- **Products:** clients paste their list in any shape and Bil turns it into products every agent reads.
- **Team chat:** your message shows at once with a progress line while the team answers; Bil builds plans from the conversation; a yes to an offer gets the thing itself; no banter in chats.
- **Xev:** Connect X DM watch timed after posts, Check messages now, See the chat panel with Copy and open X.
- **Media:** Bil auto-tags every upload (adult accounts once confirmed adults only) and the client can fix tags or add their own words.
- **Credits:** the executive grants extra Up next posts, chat plans and Xev reads per client.
- **HQ:** the executive and each team member get their own chat with the four agents.
- **Look and feel:** one quiet progress line wherever something loads; the team view rebuilt (Today, Schedule, Clients).
- **Database:** 81 migrations; the repo and the database list the same versions.

### v0.9.0 bug sweep (same night)

- A team member talking to the client no longer triggers Bil's plan or next-post shortcuts.
- A short yes ("Yeah that would be nice Kris") gets what an agent offered; a bare agent name picks who answers.
- Client chat-plan credits count only the client's own asks.
- Check messages now could stop after one page on a busy inbox; the run cap is now $0.75.
- A message still sending stays at the bottom when the chat refreshes.
- The Quality screen shows an error instead of breaking on an incomplete answer.
- Migrations: 34 older files renamed to the versions the database recorded, 3 hand-run migrations recorded, and the missing payments file added, so the repo and the database match (81 and 81).
