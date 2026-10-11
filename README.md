# Backlot

A creative-mode sandbox for your social profile. Backlot rebuilds your profile page in a space you fully control, so you can plan the grid, move posts around, and see scheduled and unposted work in place before any of it goes live.

This is the profile-only build. There is no feed, no forecasting, and no connection to any social platform. Nothing is pulled from or sent to anyone else's servers.

## What it does

- **Your profile, editable.** Photo, username, name, category, bio, link, follower and following counts, and post count.
- **A grid you control.** Add as many posts as you like. Swap the media, build carousels, edit captions, locations, likes and comments.
- **Dates decide the order.** The grid is always newest first, the way a real profile is. Change a post's date and it moves. Drag a post to a new spot and its date changes to fit.
- **Live, scheduled, draft.** Scheduled posts and drafts sit in the grid where they will land. Only you see them.
- **Visitor view.** See the profile the way a visitor does, right now or on any date you pick.
- **Highlights and pins.** Add, rename, reorder and re-cover highlights. Pin up to three posts.
- **Save point and revert.** Set a save point when the profile looks right. Revert brings back exactly that.
- **Bring in your profile.** Type the basics, add your own photos and videos, confirm they are yours, and the sandbox is built.
- **Light and dark, tall and square.** Check the grid in both app themes and both crops.

## Run it

```bash
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173).

```bash
npm run build          # production site in dist/
npm run build:single   # one self-contained file in dist-single/index.html
```

## Where things are saved

Everything is saved in the browser the creator is using, in IndexedDB: the sandbox and its save point as JSON, and uploaded photos and videos as files. There are no accounts and no server yet. Clearing site data clears the sandbox.

`src/lib/db.ts` is the only file that touches storage, so moving to hosted accounts later means replacing that one file.

## Layout of the code

```
src/
  App.tsx                  top bar, saving, save point, view switching
  state.ts                 the sandbox reducer and the rules for order, status and dates
  types.ts                 data shapes
  sample.ts                the example profile and its drawn pictures
  styles.css               all styling
  lib/db.ts                IndexedDB wrapper
  lib/media.ts             uploaded files and the URLs to show them
  lib/format.ts            counts and dates
  components/
    ProfileSet.tsx         the profile: header, highlights, tabs, grid, drag to move
    Inspector.tsx          the property panel for the profile, a post, or a highlight
    PostViewer.tsx         the opened post
    Intake.tsx             "Bring in your profile"
    ui.tsx                 buttons, fields, icons, logo
```

Built with React, TypeScript, Vite and dnd-kit.
