---
name: grok-api
description: Use when writing or changing any Backlot code that calls xAI's Grok API (models, Responses API, x_search, web_search, structured outputs, tools), or when choosing a Grok model or estimating its cost.
---

# Grok API in Backlot

xAI publishes no official agent skill. This skill points at xAI's own sources and records the rules Backlot follows. It holds no API facts of its own on purpose: xAI changes models and prices often.

## 1. Read the docs first, every time

Never write Grok code from memory. In order of preference:

1. The `xai-docs` MCP server (configured in `.mcp.json`, endpoint `https://docs.x.ai/api/mcp`): `search_docs`, `list_doc_pages`, `get_doc_page`.
2. Any docs page as markdown: append `.md` to its URL. Index: `https://docs.x.ai/llms.txt`.
3. Pages Backlot leans on:
   - Models: https://docs.x.ai/developers/models.md
   - Pricing: https://docs.x.ai/developers/pricing.md
   - Responses API: https://docs.x.ai/developers/rest-api-reference/inference/responses.md
   - Structured outputs: https://docs.x.ai/developers/model-capabilities/text/structured-outputs.md
   - X Search tool: https://docs.x.ai/developers/tools/x-search.md
   - Function calling: https://docs.x.ai/developers/tools/function-calling.md
   - Release notes (check for retired models): https://docs.x.ai/developers/release-notes.md

## 2. How Backlot calls Grok

- Server side only, in Supabase Edge Functions. The key is the `XAI_API_KEY` function secret. It never reaches the browser, the repo, or chat.
- Through the Vercel AI SDK (`ai`) with the `@ai-sdk/xai` provider, pinned to exact versions.
- Every call runs inside a Langfuse trace using `supabase/functions/_shared/observability.ts`. See the `langfuse` skill for tracing rules.
- Name models only in `supabase/functions/_shared/models.ts`, so a retirement means one edit.
- Every call passes `providerOptions: grokOptions(agent, reasoning)` from `supabase/functions/_shared/grok.ts`: `store: false` (nothing kept on xAI's side), one prompt cache key per agent and knowledge version, and an explicit reasoning effort (`none` for plain tool steps, `low` for searches, `medium` for drafting, `high` for strategy).
- Put stable text first in every prompt (instructions, knowledge), then client data, then the request, so the cached opening is as long as possible.
- Meter every call with `grokBilled(result)` first: it sums xAI's own `costInUsdTicks` across steps, which includes X Search's per-post fee. Token math (`grokCost`) leaves that fee out and is only the fallback.
- Calls that carry a client's own posts use `privateTelemetry(...)`, so Langfuse records timing, tokens and cost only.
- Our own function tools and Grok's `x_search` work in the same Responses API request (verified live 2026-10-16), even though the AI SDK docs say otherwise.

## 3. Backlot's rules for anything Grok writes or reads

These come from xAI's Acceptable Use Policy, xAI's Enterprise Terms, and X's developer terms. Details and sources are in the Backlot Roadmap doc, "Platform terms we build to" and "Our own terms and legal setup".

- Backlot never posts, replies, likes, follows or sends messages. Agents draft; people publish.
- Trend work is about topics, never about individual people. No user lists, audience profiles, or inferred sensitive traits (sex life, health, politics, religion). No tracking named accounts.
- No financial advice: an agent may say an asset is trending and why, never buy, sell, price predictions or ratings.
- Adult niches: adults only. Never sexualize minors, never depict real people pornographically, never generate or edit images of real people.
- Paid promotion gets an #ad reminder. Refuse drafts that promise returns, coordinate a pump, or hide that a post is paid.
- Never train or fine-tune any model on X content or on Grok outputs.
- X posts are shown with X's official embed. Stored posts keep IDs and short excerpts only, refreshed, and removed within 24 hours of disappearing from X.
