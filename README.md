# Backlot

A creative-mode sandbox for your social profile. Backlot rebuilds your profile page in a space you fully control, so you can plan the grid, move posts around, and see scheduled and unposted work in place before any of it goes live.

This is the profile-only build. There is no feed, no forecasting, and no connection to any social platform. Nothing is pulled from or sent to any social network.

## What it does

- **A login with a username and a password.** No email. There is no password reset, and a login that is not opened for 60 days is deleted with everything in it.
- **A homescreen to pick your platform.** Backlot opens on its logo and name with the supported platforms in a row underneath. Instagram is live. TikTok and X are shown as coming soon.
- **As many accounts as you want.** Choosing a platform shows every account you have made there, with a plus to add another.
- **Narrations.** Each account can hold several narrations: full copies of the same profile that you brand differently and compare. Each narration has its own save point. Switch between them from the top bar of the studio.
- **Your profile, editable.** Photo, username, name, category, bio, link, follower and following counts, and post count.
- **A grid you control.** Add as many posts as you like. Swap the media, build carousels, edit captions, locations, likes and comments.
- **Dates decide the order.** The grid is always newest first, the way a real profile is. Change a post's date and it moves. Drag one post onto another and the two swap: each takes the other's date.
- **Live, scheduled, draft.** Scheduled posts and drafts sit in the grid where they will land. Visitors never see them.
- **The page, bare.** Turn the side editor off and the page is shown the way the real app shows it. Editing then works the way people already know: Edit profile opens an edit screen, and tapping a post opens the scrolling list of posts, where every post has an Edit button.
- **Built for phones.** On a phone the page runs edge to edge, edit screens fill the display, the tools sit in a bar under the thumb, and the Back button closes whatever is open on top.
- **Visitor view.** See the profile the way a visitor does, right now or on any date you pick.
- **Highlights and pins.** Add, rename, reorder and re-cover highlights. Pin up to three posts.
- **Save point and revert.** Set a save point when the profile looks right. Revert brings back exactly that.
- **Bring in your profile.** Type the basics, add your own photos and videos, confirm they are yours, and the sandbox is built.
- **Light and dark, tall and square.** Check the grid in both app themes and both crops.

Working with other people (hosted build only):

- **Contacts.** Add someone by their exact username. They become a contact once they accept. You can remove or block anyone.
- **Chats.** Message a contact one to one, or start a group. New messages arrive live.
- **Share a narration.** The author picks who gets in and what each person may do: view or edit. This can be done from the narration's Share button, from the accounts list, or by dropping the narration into a chat.
- **What an editor can and cannot do.** An editor changes the page: profile, posts, highlights. Only the author can rename the narration, delete it, set its save point, or share it. Removing a contact ends every share between the two.
- **No silent overwrites.** Every save carries the version it was based on. If someone else saved first, the later save is turned away, the screen moves to the newer version, and the person is told.

## Run it

```bash
npm ci
npm run dev
```

Open the address it prints (usually http://localhost:5173).

## Get the latest

Stop the dev server first, then:

```bash
npm run sync
```

That one command pulls the newest code from GitHub and installs exactly the package versions the repo names.

Use `npm ci`, not `npm install`, for everyday installs. `npm ci` installs what `package-lock.json` says and never edits that file. `npm install` can rewrite it in small ways that differ from one computer to the next, and git then treats the file as changed and refuses to pull. `npm run sync` puts the file back before pulling, so it works either way. Keep `npm install <name>` for the times you are adding a new package on purpose.

```bash
npm run build          # the hosted site, in dist/
npm run build:single   # the offline version as one file, in dist-single/index.html
```

## Two ways it runs

**Hosted** (the default). The site talks to the Backlot Supabase project named in `.env`. Creators sign in, and their accounts, narrations, photos and videos are kept on the server, so they are there on any device.

**Offline** (`npm run build:single`). No sign-in. Everything is saved in the browser that is being used, and nothing leaves the device. This is the version used for quick previews.

The two values in `.env` are public by design: they are built into the site every visitor downloads. What protects the data is the database's own row rules, not those values. Never put a secret key or a database password in the repo.

## What is on Supabase

Everything needed to rebuild the project is in `supabase/`.

- `migrations/` creates the tables, the row rules, the private `media` bucket, and the daily cleanup job.
  - `members`: one row per login, with the username and the last time it was opened.
  - `accounts`: one social profile on one platform.
  - `narrations`: one telling of an account, holding the whole profile and its save point.
  - `contacts` and `blocks`: who agreed to work together, and who is shut out.
  - `conversations`, `conversation_members`, `messages`: chats, who is in them, and what was said.
  - `narration_shares`: who an author let into a narration, to view or to edit.
  - Every table has row level security on. A signed-in creator can reach their own rows and media folder, the chats they are in, and the narrations shared with them (plus those narrations' photos and videos). Signed-out visitors can reach nothing.
  - Other people can see only a member's id and username, and only if there is a tie between the two: a contact or request, a shared chat, or a shared narration.
- `functions/signup` creates a login. Supabase needs an address for every user, so each username gets an internal one on a domain that can never receive mail. Nobody sees it and nothing is sent to it.
- `functions/purge-inactive` runs once a day and removes logins idle for 60 days, with their accounts, narrations and media. It also removes chats nobody is in any more.

A single photo or video can be up to 50 MB.

## Layout of the code

```
src/
  App.tsx                  switches between the homescreen, a platform's accounts, a studio, and People
  Studio.tsx               one narration's working screen: top bar, saving, save point, views
  platforms.ts             the supported platforms and which ones are ready
  state.ts                 the sandbox reducer and the rules for order, status and dates
  types.ts                 data shapes
  sample.ts                the example profile and its drawn pictures
  styles.css               all styling
  lib/supabase.ts          the Supabase connection, and whether this build is hosted or offline
  lib/auth.ts              sign in, create a login, sign out
  lib/library.ts           accounts and narrations: picks the server or the browser as their home
  lib/library.cloud.ts     ... kept in Supabase
  lib/library.local.ts     ... kept in the browser
  lib/library.types.ts     ... the shapes both share
  lib/db.ts                IndexedDB wrapper
  lib/media.ts             photos and videos: upload, show, and clean up
  lib/people.ts            contacts, chats, messages and sharing
  lib/format.ts            counts and dates
  components/
    SignIn.tsx             sign in or create a login
    Home.tsx               the homescreen
    Accounts.tsx           the accounts of one platform, with their narrations
    NarrationMenu.tsx      the narration switcher in the studio's top bar
    ProfileSet.tsx         the profile: header, highlights, tabs, grid, drag to move
    Inspector.tsx          the editors for the profile, a post, or a highlight, as a side panel or a sheet
    PostsFeed.tsx          the scrolling list of posts that opens when one is tapped
    Intake.tsx             "Bring in your profile"
    People.tsx             contacts and chats
    PeopleButton.tsx       the way into People, with a count of what is waiting
    ShareDialog.tsx        who a narration is shared with, and what each person may do
    ui.tsx                 buttons, fields, icons, logo
```

Built with React, TypeScript, Vite, dnd-kit and Supabase.
