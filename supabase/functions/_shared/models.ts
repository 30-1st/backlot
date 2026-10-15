// The one place Backlot names its Grok models. When xAI retires a model,
// change it here. Check https://docs.x.ai/developers/models.md and
// https://docs.x.ai/developers/pricing.md before changing.

export const MODELS = {
  /** Cheap, fast model for small jobs and setup checks. */
  light: 'grok-4.3',
} as const;
