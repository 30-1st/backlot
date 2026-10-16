// Langfuse tracing for every Backlot agent function.
//
// What this sets up, once per function instance:
//   - An OpenTelemetry tracer provider that sends spans to Langfuse only.
//   - The Langfuse integration for the Vercel AI SDK, so every Grok call made
//     with `ai` becomes a Langfuse "generation" with model, tokens and cost.
//   - Masking, so emails, phone numbers and API keys never leave this function.
//
// How a function uses it:
//   await withTracing(async () => { ...agent work... });
// withTracing makes sure the tracer is ready first and flushes spans before the
// response goes back. Edge functions can be frozen right after they reply, so
// unsent spans would otherwise be lost.
//
// Keys come from Supabase function secrets, read through ./secrets.ts (saved as
// "langfuse public key" and "langfuse secret key"). LANGFUSE_BASE_URL picks the data region; when it is not
// set, the region is found by asking each Langfuse cloud which one knows the key.

import { context, ROOT_CONTEXT } from 'npm:@opentelemetry/api@^1.9.0';
import { resourceFromAttributes } from 'npm:@opentelemetry/resources@2.12.0';
import { NodeTracerProvider } from 'npm:@opentelemetry/sdk-trace-node@2.12.0';
import { LangfuseSpanProcessor } from 'npm:@langfuse/otel@6.0.0';
import { setLangfuseTracerProvider } from 'npm:@langfuse/tracing@6.0.0';
import { LangfuseVercelAiSdkIntegration } from 'npm:@langfuse/vercel-ai-sdk@6.0.0';
import { registerTelemetry } from 'npm:ai@7.0.142';
import { secret } from './secrets.ts';

const REGIONS = [
  'https://cloud.langfuse.com', // EU
  'https://us.cloud.langfuse.com',
  'https://jp.cloud.langfuse.com',
  'https://hipaa.cloud.langfuse.com',
];

/** Where traces are filed. Backlot runs only one Supabase project for now, so it is set by secret. */
export const ENVIRONMENT = Deno.env.get('LANGFUSE_TRACING_ENVIRONMENT') ?? 'development';

// ---------- masking ----------

const MASKS: Array<[RegExp, string]> = [
  [/\b(?:xai|sk-lf|pk-lf|sk|pk)-[A-Za-z0-9_-]{8,}\b/g, '[key]'],
  [/\bBearer\s+[A-Za-z0-9%._~+/-]{16,}=*/g, 'Bearer [key]'],
  [/\bAAAAAAAAAAAAAAAAAAAA[A-Za-z0-9%]{20,}\b/g, '[x-token]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  // Phone numbers only when written with separators, so X post IDs (long bare digit runs) survive.
  [/(?:\+\d{1,3}[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, '[phone]'],
];

export function maskText(text: string): string {
  let out = text;
  for (const [pattern, swap] of MASKS) out = out.replace(pattern, swap);
  return out;
}

function maskDeep(value: unknown): unknown {
  if (typeof value === 'string') return maskText(value);
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v)]));
  }
  return value;
}

/**
 * Langfuse's own mask covers only its input, output and metadata fields. The AI SDK
 * writes prompts and replies into gen_ai.* fields, so this processor masks every
 * string field on a span while it is still open, before any exporter sees it.
 */
/** Tools whose results carry a client's own posts. */
const PRIVATE_TOOLS = new Set(['client_posts_read']);

/**
 * True for spans of private calls: a functionId starting "private-" (see grok.ts
 * privateTelemetry) or a private tool. Second guard behind recordInputs/recordOutputs
 * being off, in case a library update starts recording more.
 */
function isPrivateSpan(attributes: Record<string, unknown>): boolean {
  for (const value of Object.values(attributes)) {
    if (typeof value !== 'string') continue;
    if (value.startsWith('private-') || PRIVATE_TOOLS.has(value)) return true;
  }
  return false;
}

const maskingProcessor = {
  onStart() {},
  onEnding(span: { attributes: Record<string, unknown>; setAttribute(k: string, v: string): unknown }) {
    const hide = isPrivateSpan(span.attributes);
    for (const [key, value] of Object.entries(span.attributes)) {
      if (typeof value !== 'string') continue;
      // On private spans, any long text (prompts, tool results, replies) is replaced whole.
      if (hide && value.length > 120) {
        span.setAttribute(key, '[private]');
        continue;
      }
      const masked = maskText(value);
      if (masked !== value) span.setAttribute(key, masked);
    }
  },
  onEnd() {},
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};

/**
 * The AI SDK names its spans after the model ("chat grok-4.3"). Langfuse's guide asks for
 * stable, verb-first names with the model kept in its own field, so a model change never
 * breaks dashboards or evaluators. The agent span takes the call's functionId; the inner
 * spans get fixed names.
 */
const namingProcessor = {
  onStart() {},
  onEnding(span: { name: string; attributes: Record<string, unknown>; updateName(name: string): unknown }) {
    const op = span.attributes['gen_ai.operation.name'];
    if (op === 'invoke_agent') {
      const agent = span.attributes['gen_ai.agent.name'];
      span.updateName(typeof agent === 'string' && agent ? agent : 'run-model');
    } else if (op === 'agent_step') {
      span.updateName('model-step');
    } else if (op === 'chat' || op === 'text_completion' || op === 'generate_content') {
      span.updateName('call-model');
    }
  },
  onEnd() {},
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};

// ---------- setup ----------

let processor: LangfuseSpanProcessor | null = null;
let ready: Promise<string | null> | null = null;

/** Finds which Langfuse cloud region these keys belong to. */
async function findRegion(publicKey: string, secretKey: string): Promise<string | null> {
  const fixed = Deno.env.get('LANGFUSE_BASE_URL') ?? Deno.env.get('LANGFUSE_HOST');
  if (fixed) return fixed.replace(/\/+$/, '');
  const auth = 'Basic ' + btoa(`${publicKey}:${secretKey}`);
  for (const base of REGIONS) {
    try {
      const res = await fetch(`${base}/api/public/projects`, {
        headers: { Authorization: auth },
        signal: AbortSignal.timeout(4000),
      });
      await res.body?.cancel();
      if (res.ok) return base;
    } catch {
      // try the next region
    }
  }
  return null;
}

/** Basic auth header for Langfuse's public API, or null when the keys are missing. */
export function langfuseAuth(): string | null {
  const publicKey = secret('langfusePublicKey');
  const secretKey = secret('langfuseSecretKey');
  return publicKey && secretKey ? 'Basic ' + btoa(`${publicKey}:${secretKey}`) : null;
}

/** Starts tracing once. Resolves to the Langfuse base URL, or null when tracing is off. */
export function startTracing(): Promise<string | null> {
  if (ready) return ready;
  ready = (async () => {
    const publicKey = secret('langfusePublicKey');
    const secretKey = secret('langfuseSecretKey');
    if (!publicKey || !secretKey) {
      console.warn('Langfuse keys are not set, so tracing is off.');
      return null;
    }
    const baseUrl = await findRegion(publicKey, secretKey);
    if (!baseUrl) {
      console.warn('No Langfuse region accepted these keys, so tracing is off.');
      return null;
    }
    processor = new LangfuseSpanProcessor({
      publicKey,
      secretKey,
      baseUrl,
      environment: ENVIRONMENT,
      release: Deno.env.get('BACKLOT_RELEASE') ?? undefined,
      mask: ({ data }) => maskDeep(data),
    });
    // Order matters: naming and masking run first, so the exporter only sees the final names and masked text.
    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({ 'service.name': 'backlot-agents' }),
      spanProcessors: [namingProcessor, maskingProcessor, processor],
    });
    // Registers the async context manager so nested observations find their parent.
    // The Supabase runtime may already own the global tracer; then this is a no-op,
    // which is why our tracer is also handed to Langfuse and the AI SDK directly.
    provider.register();
    setLangfuseTracerProvider(provider);
    registerTelemetry(new LangfuseVercelAiSdkIntegration({ tracer: provider.getTracer('backlot-ai-sdk') }));
    return baseUrl;
  })();
  return ready;
}

/** Sends every finished span to Langfuse now. */
export async function flushTraces(): Promise<void> {
  if (!processor) return;
  try {
    await processor.forceFlush();
  } catch (err) {
    console.error('Langfuse flush failed', err instanceof Error ? err.message : err);
  }
}

/**
 * Runs agent work with tracing ready before it and flushed after it, even when it throws.
 * The work starts from an empty context, so each run is its own Langfuse trace and never
 * hangs under a span the hosting runtime opened for the HTTP request.
 */
export async function withTracing<T>(work: () => Promise<T>): Promise<T> {
  await startTracing();
  try {
    return await context.with(ROOT_CONTEXT, work);
  } finally {
    await flushTraces();
  }
}
