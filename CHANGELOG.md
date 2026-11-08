# Changelog

## v0.9.5 (Nov 8, 2026): numbers in plain words, voice changes, fresher X knowledge

- **Bil says what the numbers mean.** No more "21.4 per 1,000". Every agent now reads a short reach summary built from the client's own posts: views a typical, good and best post gets, how that compares with their follower count (past it means X pushed the post into For You), how many times better one kind of post does, and their strongest time. Kept conservative: a new post is expected between typical and good, and beating their best is never promised. Post reasons on the Schedule are written the same way, and older posts' setting names and scores are cleaned out on screen.
- **Change the voice.** On Brand, "Change it" edits how they sound, words they use and avoid, and what is off limits. "Bil, read my page again" has Bil reread their latest posts (plus anything they say feels off) and rewrite the voice and what performs; "Go back to the old voice" undoes it. Twice a day, about 30 cents.
- **Bil's X algorithm knowledge refreshed** from the current settings: sharing (especially copying the link) counts most, replies from mutuals get a big boost, a follow counts strongly, profile clicks and video opens count for nothing today, and one report outweighs dozens of replies. He explains this to clients as the action he wants from readers, never as weights.
- **X's ranking code card on Quality** (executive only): which version of xai-org/x-algorithm Bil is trained on, X's latest push, recent setting changes, and "Get the latest now" (needs a GitHub token once; it also updates every morning).
- **Xev** never promises a clip or extra the client has not offered, even when a buyer haggles.
- The new safety-label-source folder in X's repo was reviewed and left out (it fetches labels; how labels change reach is already indexed).

## v0.9.4 (Nov 7, 2026): notifications on your phone

- **Turn on notifications** in Account, on each phone or computer. On iPhone it works once Backlot is on the Home Screen; Account shows how.
- **What pings you:**
  - Bil finished a plan, or wrote your next post.
  - A post needs a detail from you.
  - A post goes up within the hour and still has no yes.
  - Xev spotted someone in the DMs ready to buy or book, or with a question.
  - For the team: a client approved posts or asked for changes.
- **Calm by design:** at most one notification every 15 minutes (the rest are combined), nothing in your quiet hours (9 PM to 9 AM by default, your time) except a buyer ready to buy or book, and a few words only, never post text, DMs or a buyer's details.
- **Tapping one** opens the exact screen: the post, the plan or the chat.
- **New onboarding step for clients:** "Backlot on your phone", ticked by itself when they turn notifications on.
- **How:** standard Web Push from Supabase (no new service, no cost). The sending key is made by the server and kept in Supabase Vault; device addresses are readable only by the server.

## v0.9.3 (Nov 7, 2026): agents that understand the chat, posts you can change with Bil

**The team chat, rebuilt for quality** (from Khma's review of the @litax333 chat on Nov 7):
- One small planning step decides who answers by job: DMs and selling are Xev's, posts and plans Bil's, stories Kris's, trends Rein's. One voice by default; a second teammate only when they add something different.
- The agents now read what they need before answering: Xev's earlier reads and the replies she suggested (so she knows which nails he picked), the live DM thread when she is writing to a buyer she flagged (read from X, never saved), the client's Offers, Rein's latest trends when a plan or an upsell is on the table, and X's ranking code when someone asks how posts spread.
- Xev writes DMs as real texts, not captions: the message to send now, a different approach, and what to send if he says yes or goes quiet, each with Copy and "Copy and open X". On the strong model.
- They talk to the client in plain words, never the brand voice; do the thing instead of offering it; use the client's words instead of niche jargon like "tribute"; and never repeat themselves (a repeat is rewritten once).
- They act as consultants: what the client says is a fact; if they disagree, they say why once and then do what the client decides.
- Xev may suggest a product to sell when she sees a gap, and asks what the client sells when nothing is saved.
- Each answer gets room to think (it was cut short before).

**Posts are never locked:**
- "Change it with Bil" on every written post: say what to change, keep the photo, let Bil pick, choose another from Media, or go without. Bil rewrites it in seconds and says what he changed and why. Up to 10 times a post.
- Every new post carries Bil's reason for its angle and its photo or video.
- Today, the Schedule and the chat open the exact post you tapped.

**No more missed plans:** a plan Bil builds from the chat shows a progress card in the chat as he writes, and when it is done Bil posts the posts themselves in the chat to open, change or approve.

**Spending (approved):** the monthly AI cap is $50 for November; a chat turn may use up to 15 cents (it was 4); the chat may use $8 per client and $25 in all each month.

**Quality checks:** 8 test cases from the Nov 7 review, each saying what a good answer does; new rules for offering instead of doing, hashtags and jargon; the judge now rewards disagreeing once with a reason.

## v0.9.2 (Nov 7, 2026): stay on the newest version

- An app left open (an installed app on a phone, or a tab) now notices a newer version and switches to it: when it comes back on screen, or every 5 minutes while nobody is typing. Before, a phone could keep running the code it loaded hours earlier, so tonight's chat fixes did not show on it.
- No banter in chats, now checked by the screen itself (the team chat and HQ) instead of the address, and the waiting chip that held the banter no longer appears there either.

## v0.9.1 (Nov 7, 2026): bug sweep fixes

- The quality check (eval gate) had a $0.04 cap for the whole run, so after 2 or 3 test chats the rest were refused and scored "No answer". The run cap is now $0.40, and a refusal pauses the run instead of failing an agent. The false warning was re-run.
- A team chat turn that mentions a plan no longer risks going over the turn's 4-cent cap: the plan check has its own run, and the "must answer" retry can never sink the turn.
- Up next: "Make another" goes back to "Bil picks the best fit", the same file can be picked again after an upload, and the wait text says a few seconds.
- Quality judging: the judge now grades a reply against what was asked (small talk can score well; describing instead of delivering cannot) and never marks an agent down for not talking in the client's own persona. A daily sample that averages under 3 out of 5 now warns instead of passing.

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
