// The one place Backlot names its Grok models and their prices. When xAI retires a
// model or changes a price, change it here. Check https://docs.x.ai/developers/models.md
// and https://docs.x.ai/developers/pricing.md before changing.

export const MODELS = {
  /** Cheap, fast model for Rein's trend work and setup checks. */
  light: 'grok-4.3',
  /** xAI's most capable model (per its models page, 2026-10-16), for Bil's strategy and drafting. */
  strong: 'grok-4.7',
} as const;

/** Which model each agent runs on. */
export const AGENT_MODELS = {
  rein: MODELS.light,
  bil: MODELS.strong,
  check: MODELS.light,
} as const;

/**
 * Prices in US dollars PER TOKEN, the unit Langfuse's model definitions use
 * (its schema: "Prices are in USD per unit (e.g., per token)").
 * Keys must match the usage keys Langfuse records for these calls exactly:
 * "input" (uncached input), "input_cached_tokens", and "output" (includes reasoning).
 * These are the rates for prompts under 200k tokens; longer prompts cost double and are
 * not used by Backlot. Source: xAI models page, checked 2026-10-16.
 */
export const PRICES: Record<string, { input: number; input_cached_tokens: number; output: number }> = {
  'grok-4.3': {
    input: 0.00000125, // $1.25 per million
    input_cached_tokens: 0.0000002, // $0.20 per million
    output: 0.0000025, // $2.50 per million
  },
  'grok-4.7': {
    input: 0.000002, // $2.00 per million
    input_cached_tokens: 0.0000005, // $0.50 per million
    output: 0.000006, // $6.00 per million
  },
};

/**
 * X API prices in US dollars per item, pay-per-use plan.
 * Source: https://docs.x.com/x-api/getting-started/pricing, checked 2026-10-16. A resource
 * already billed in the same UTC day is not billed again.
 * userLookup: per user returned (the console billed $0.01 for one lookup on 2026-10-15).
 * postRead: per post returned, read with Backlot's app token.
 * ownedPostRead: per post when a client reads their own timeline with their own login.
 */
export const X_PRICES = {
  userLookup: 0.01,
  postRead: 0.005,
  ownedPostRead: 0.001,
} as const;

/** Token counts as the AI SDK reports them (`result.usage`). */
export type TokenUsage = {
  inputTokens?: number;
  inputTokenDetails?: { noCacheTokens?: number; cacheReadTokens?: number };
  outputTokens?: number;
};

/**
 * Real cost of one Grok call from its reported usage. Output includes reasoning tokens,
 * which xAI bills as output. Returns null for an unknown model, so the caller settles at
 * its estimate rather than recording a wrong number.
 */
export function grokCost(model: string, usage: TokenUsage | undefined): number | null {
  const price = PRICES[model];
  if (!price || !usage) return null;
  const cached = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const fresh = usage.inputTokenDetails?.noCacheTokens ?? Math.max(0, (usage.inputTokens ?? 0) - cached);
  const output = usage.outputTokens ?? 0;
  return round8(fresh * price.input + cached * price.input_cached_tokens + output * price.output);
}

/** xAI bills in ticks: 10,000,000,000 ticks = $1 (docs.x.ai cost tracking, checked 2026-10-16). */
const TICKS_PER_USD = 10_000_000_000;

type StepWithBilling = { providerMetadata?: { xai?: { costInUsdTicks?: unknown } } };

/**
 * The exact amount xAI billed for a call, from its own cost report. It includes every
 * token, cache discounts, and server-side tool fees such as X Search's per-post charge,
 * across all steps of a multi-step call. Returns null when xAI did not report it, so the
 * caller falls back to grokCost() or the estimate.
 */
export function grokBilled(result: { steps?: StepWithBilling[]; providerMetadata?: StepWithBilling['providerMetadata'] }): number | null {
  const steps = result.steps?.length ? result.steps : [{ providerMetadata: result.providerMetadata }];
  let ticks = 0;
  let seen = false;
  for (const step of steps) {
    const t = step.providerMetadata?.xai?.costInUsdTicks;
    if (typeof t === 'number' && Number.isFinite(t)) {
      ticks += t;
      seen = true;
    }
  }
  return seen ? round8(ticks / TICKS_PER_USD) : null;
}

/** X Search charges per item fetched (docs.x.ai pricing, checked 2026-10-16). */
export const X_SEARCH_PRICES = { post: 0.005, profile: 0.01 } as const;

/**
 * Upper-bound estimate for a Grok call before it runs, used to reserve budget.
 * Grok's reasoning tokens are billed as output and are NOT limited by maxOutputTokens
 * (a 200-token cap produced 573 output tokens in testing), so a reasoning allowance is added.
 * Input is counted at one token per 3 characters, on the high side. xSearchPosts adds
 * X Search's per-post fee for the posts the call is expected to fetch at most.
 */
export function grokEstimate(
  model: string,
  promptChars: number,
  maxOutputTokens: number,
  reasoningAllowance = 2000,
  xSearchPosts = 0,
): number {
  const price = PRICES[model];
  if (!price) throw new Error(`No price on file for ${model}; add it to PRICES first`);
  return round8(
    Math.ceil(promptChars / 3) * price.input +
      (maxOutputTokens + reasoningAllowance) * price.output +
      xSearchPosts * X_SEARCH_PRICES.post,
  );
}

function round8(n: number): number {
  return Math.round(n * 100_000_000) / 100_000_000;
}
