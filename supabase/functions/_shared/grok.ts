// How every Backlot agent calls Grok. One place for the settings that decide cost,
// speed and privacy, so no call site forgets one.
//
//   * store: false. xAI keeps requests and replies by default; ours hold client data,
//     so nothing is kept on xAI's side. (The provider then carries reasoning between
//     steps in encrypted form, so multi-step tool calls still work.)
//   * promptCacheKey: one key per agent and knowledge version, e.g. "bil-k1". xAI caches
//     the shared opening of a prompt automatically; the key routes calls with the same
//     opening together. Every client shares Bil's instructions and knowledge, so they are
//     billed at the cached rate after the first call. Change the version when the
//     knowledge pack changes, so a stale cache is never reused.
//   * reasoningEffort: 'none' for plain tool steps, 'low' for searches, 'medium' for
//     drafting from an approved plan, 'high' for strategy. Reasoning is billed as output,
//     so this is the biggest cost lever after caching. grok-4.7 accepts low, medium,
//     high and xhigh only, never 'none' (its model page, checked 2026-10-17).
//   * Prompts must put stable text first (instructions, knowledge), then client data,
//     then the request, so the cached opening is as long as possible.

import { createXai } from 'npm:@ai-sdk/xai@5.0.23';
import { secret } from './secrets.ts';

export type Reasoning = 'none' | 'low' | 'medium' | 'high';

/** Knowledge pack versions. Bump one when that agent's instructions or knowledge change. */
export const KNOWLEDGE_VERSION = {
  rein: 'k2',
  bil: 'k2',
  check: 'k1',
} as const;

export function xaiClient() {
  const apiKey = secret('xaiApiKey');
  if (!apiKey) throw new Error('The xAI API key secret is not set');
  return createXai({ apiKey });
}

/** Provider options for one call. */
export function grokOptions(agent: keyof typeof KNOWLEDGE_VERSION, reasoning: Reasoning, extra: { maxTurns?: number } = {}) {
  return {
    xai: {
      store: false,
      promptCacheKey: `${agent}-${KNOWLEDGE_VERSION[agent]}`,
      reasoningEffort: reasoning,
      parallelToolCalls: true,
      ...(extra.maxTurns ? { maxTurns: extra.maxTurns } : {}),
    },
  };
}

/** Telemetry for calls that carry a client's own posts: nothing but timing, tokens and cost reaches Langfuse. */
export function privateTelemetry(functionId: string) {
  return { functionId: `private-${functionId}`, recordInputs: false, recordOutputs: false };
}
