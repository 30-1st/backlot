# Backlot

Backlot is a self-serve X consultancy in one app. A team of four AI agents does the work a social media agency would: Rein reads the market, Bil plans and writes campaigns, Kris acts as publicist and hosts each client's public room, and Xev coaches sales chats. People approve everything, and they post by hand. Backlot never posts, replies, likes, follows or sends messages on X.

## Who uses it

- **The team** runs clients: plans campaigns with Bil, checks Rein's trends, works the engagement desk, and keeps the approvals record.
- **Clients** see their posts for the day one card at a time, approve or change them, keep their Brand kit and Media, talk to Kris, and get one free Opportunity Meeting with Rein a month.
- **Casual users** use the Playground (Rein's trends and Opportunities). Paid meetings open with payments.

## The agents

| Agent | Job | Where the code is |
| --- | --- | --- |
| Rein | Trends in a niche, and the Opportunity Meeting: a sourced market read shown as slides, exported as a PDF | `supabase/functions/_shared/rein.ts`, `_shared/opportunity.ts`, `src/shell/Rein.tsx`, `src/shell/Opportunities.tsx` |
| Bil | Strategist: campaigns, reports, quote posts, the voice | `_shared/bil.ts`, `functions/bil`, `functions/bil-worker` |
| Kris | Publicist and room host | `_shared/kris*.ts`, `functions/room`, `src/shell/Kris.tsx`, `rooms/` |
| Xev | Sales chat coach: reads screenshots blurred on the phone, never saved | `_shared/xev.ts`, `src/shell/Xev.tsx`, `src/lib/blur.ts` |

Each agent's training lives in `supabase/functions/_shared/knowledge/`.

## The stack

- **App:** React 19, TypeScript and Vite. Screens are in `src/shell`, calls and helpers in `src/lib`. Long pages share the parts in `src/shell/Present.tsx`: a short header with "How this works", folding sections, and a one-step-per-screen deck.
- **Rooms site:** the same stack, built separately from `rooms/`.
- **Hosting:** Cloudflare Pages (the app at backlot-as9.pages.dev, rooms at backlot-rooms.pages.dev). Security headers are in `public/_headers`.
- **Database, logins, files:** Supabase (Postgres with row rules on every table, Auth, Storage, pg_cron). Everything to rebuild it is in `supabase/migrations`, applied in order.
- **Server code:** Supabase Edge Functions on Deno in `supabase/functions`. They deploy from main through GitHub Actions.
- **AI:** xAI Grok (4.3 light, 4.7 strong) through the Vercel AI SDK, pinned. Models and prices are named only in `_shared/models.ts`. Every paid call goes through the spend caps in `_shared/spend.ts`.
- **X data:** the official X API v2 with an app-only token, metered through one helper. No scraping.
- **Tracing:** Langfuse, with client content kept out.

## Run it

```bash
npm ci
npm run dev          # the app, usually at http://localhost:5173
npm run dev:rooms    # the rooms site
npm run build        # the app, in dist/
npm run build:rooms  # the rooms site
npm run sync         # pull the newest code and install the exact package versions
```

Use `npm ci` for everyday installs; it never rewrites `package-lock.json`.

The two values in `.env` (the Supabase address and its public key) are public by design. The database's row rules protect the data. Secret keys live only in Supabase function secrets and GitHub secrets, entered by the owner, never in the repo.

## House rules

- No fake or sample data. Placeholders go in [BRACKETS].
- Every number an agent shows carries its source, or it is not shown.
- No images of real people in the app's own art. Adult content is for adults only.
- Every new paid step gets its own spend cap.
- One migration per database change.

The full docs (roadmaps, knowledge packs, tech stack) are kept outside the repo in Backlot Docs.
