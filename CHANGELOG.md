# Changelog

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
