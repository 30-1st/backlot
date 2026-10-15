// The one place Backlot names its Grok models and their prices. When xAI retires a
// model or changes a price, change it here. Check https://docs.x.ai/developers/models.md
// and https://docs.x.ai/developers/pricing.md before changing.

export const MODELS = {
  /** Cheap, fast model for small jobs and setup checks. */
  light: 'grok-4.3',
} as const;

/**
 * Prices in US dollars PER TOKEN, the unit Langfuse's model definitions use
 * (its schema: "Prices are in USD per unit (e.g., per token)").
 * Keys must match the usage keys Langfuse records for these calls exactly:
 * "input" (uncached input), "input_cached_tokens", and "output" (includes reasoning).
 * Source: xAI pricing page, checked 2026-10-15.
 */
export const PRICES: Record<string, { input: number; input_cached_tokens: number; output: number }> = {
  'grok-4.3': {
    input: 0.00000125, // $1.25 per million
    input_cached_tokens: 0.0000002, // $0.20 per million
    output: 0.0000025, // $2.50 per million
  },
};

/**
 * X API prices in US dollars per item, pay-per-use plan.
 * userLookup: the X developer console billed $0.01 for one user lookup on 2026-10-15.
 */
export const X_PRICES = {
  userLookup: 0.01,
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

/**
 * Upper-bound estimate for a Grok call before it runs, used to reserve budget.
 * Grok's reasoning tokens are billed as output and are NOT limited by maxOutputTokens
 * (a 200-token cap produced 573 output tokens in testing), so a reasoning allowance is added.
 * Input is counted at one token per 3 characters, on the high side.
 */
export function grokEstimate(model: string, promptChars: number, maxOutputTokens: number, reasoningAllowance = 2000): number {
  const price = PRICES[model];
  if (!price) throw new Error(`No price on file for ${model}; add it to PRICES first`);
  return round8(Math.ceil(promptChars / 3) * price.input + (maxOutputTokens + reasoningAllowance) * price.output);
}

function round8(n: number): number {
  return Math.round(n * 100_000_000) / 100_000_000;
}
