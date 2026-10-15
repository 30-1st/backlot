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
