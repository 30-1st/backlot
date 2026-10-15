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
// Keys come from Supabase function secrets: LANGFUSE_PUBLIC_KEY and
// LANGFUSE_SECRET_KEY. LANGFUSE_BASE_URL picks the data region; when it is not
// set, the region is found by asking each Langfuse cloud which one knows the key.

import { NodeTracerProvider } from 'npm:@opentelemetry/sdk-trace-node@2.11.0';
import { LangfuseSpanProcessor } from 'npm:@langfuse/otel@5.11.1';
import { setLangfuseTracerProvider } from 'npm:@langfuse/tracing@5.11.1';
import { LangfuseVercelAiSdkIntegration } from 'npm:@langfuse/vercel-ai-sdk@5.11.1';
import { registerTelemetry } from 'npm:ai@7.0.126';

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
const maskingProcessor = {
  onStart() {},
  onEnding(span: { attributes: Record<string, unknown>; setAttribute(k: string, v: string): unknown }) {
    for (const [key, value] of Object.entries(span.attributes)) {
      if (typeof value !== 'string') continue;
      const masked = maskText(value);
      if (masked !== value) span.setAttribute(key, masked);
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

/** Starts tracing once. Resolves to the Langfuse base URL, or null when tracing is off. */
export function startTracing(): Promise<string | null> {
  if (ready) return ready;
  ready = (async () => {
    const publicKey = Deno.env.get('LANGFUSE_PUBLIC_KEY');
    const secretKey = Deno.env.get('LANGFUSE_SECRET_KEY');
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
    // Order matters: masking runs first, so the Langfuse exporter only sees masked text.
    const provider = new NodeTracerProvider({ spanProcessors: [maskingProcessor, processor] });
    // Registers the async context manager, so nested observations find their parent.
    provider.register();
    setLangfuseTracerProvider(provider);
    registerTelemetry(new LangfuseVercelAiSdkIntegration());
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

/** Runs agent work with tracing ready before it and flushed after it, even when it throws. */
export async function withTracing<T>(work: () => Promise<T>): Promise<T> {
  await startTracing();
  try {
    return await work();
  } finally {
    await flushTraces();
  }
}
