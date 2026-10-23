// Spending meter for agents. Every paid call goes through Budget.charge():
//   1. reserve an upper-bound estimate in the database (refused if it would break a cap)
//   2. make the call
//   3. settle with the real cost, or release the reservation if the call was never charged
// The caps and the ledger live in Postgres (private.spend_limits / private.spend_ledger);
// see migration 20261015101119_agent_spend_meter.sql.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import { getActiveTraceId } from 'npm:@langfuse/tracing@6.0.0';

/**
 * Each name is a scope in private.spend_limits. 'campaign' covers one whole campaign
 * (its run id is the campaign id, so the plan and every drafting batch add up).
 */
export type AgentName = 'rein' | 'bil' | 'check' | 'onboard' | 'campaign' | 'report' | 'desk';

/** Thrown when a reservation would go over a cap. Nothing was spent. */
export class SpendLimitError extends Error {
  constructor(
    readonly reason: 'run' | 'month' | 'no_limit' | 'call',
    readonly detail: Record<string, unknown>,
  ) {
    super(
      reason === 'month'
        ? `Monthly agent budget reached ($${detail.used} of $${detail.cap} used)`
        : reason === 'run'
          ? `This run would go over its $${detail.cap} limit`
          : reason === 'call'
            ? `This call's estimate ($${detail.estimate}) is over the $${detail.cap} per-call limit`
          : String(detail.detail ?? 'No spending limit is set'),
    );
    this.name = 'SpendLimitError';
  }
}

/** The service-role database client edge functions use. Never sent to a browser. */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!;
  return createClient(url, serverKey(), { auth: { persistSession: false, autoRefreshToken: false } });
}

/** The project's default server key: the named "default" secret key, else the legacy service role key. */
export function serverKey(): string {
  let key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  try {
    const named = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (typeof named.default === 'string') key = named.default;
  } catch {
    // Fall back to the legacy key above.
  }
  return key;
}

/** Every server key this project accepts: all named secret keys plus the legacy service role key. */
export function serverKeys(): string[] {
  const keys = new Set<string>();
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) keys.add(legacy);
  try {
    const named = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    for (const v of Object.values(named)) if (typeof v === 'string' && v) keys.add(v);
  } catch {
    // No named keys.
  }
  return [...keys];
}

/**
 * True when the provider answered with an error status (e.g. X's 402, an xAI 429), which
 * means the request was refused and not billed. Looks through wrapped errors: the AI SDK
 * puts the status on APICallError.statusCode and wraps retries in RetryError.lastError.
 * Anything else (a timeout, a dropped connection) may have been billed, so the caller
 * keeps the estimate.
 */
export function providerRefused(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== 'object' || depth > 5) return false;
  const e = err as { statusCode?: unknown; cause?: unknown; lastError?: unknown };
  if (typeof e.statusCode === 'number' && e.statusCode >= 400) return true;
  if (e.cause instanceof Response && !e.cause.ok) return true;
  return providerRefused(e.lastError, depth + 1) || providerRefused(e.cause, depth + 1);
}

/** Extra information a paid call can attach when it settles. */
export type ChargeOptions = {
  /**
   * The billed resource, e.g. 'x_user:xdevelopers'. X bills each resource once per UTC
   * day, so a repeat read of the same resource that day settles at $0 (done in SQL).
   */
  resource?: string;
};

export type BudgetOptions = {
  /** Continue an existing run, e.g. a campaign id shared by its plan and drafting batches. */
  runId?: string;
  /** Refuse any single call whose estimate is above this, in USD. */
  perCallCap?: number;
  db?: SupabaseClient;
};

export class Budget {
  readonly runId: string;
  /** What this Budget has charged so far, in USD (settled costs, estimates where no cost came back). */
  spentUsd = 0;
  private readonly perCallCap?: number;
  private readonly db: SupabaseClient;

  constructor(
    readonly agent: AgentName,
    options: BudgetOptions = {},
  ) {
    this.runId = options.runId ?? crypto.randomUUID();
    this.perCallCap = options.perCallCap;
    this.db = options.db ?? serviceClient();
  }

  /**
   * Runs one paid call inside a reservation.
   * @param kind      what is being paid for, e.g. 'grok' or 'x_user_lookup'
   * @param estimate  upper-bound cost in USD, reserved before the call
   * @param work      the call itself
   * @param costOf    the real cost from the result; null means "use the estimate"
   * @param options   e.g. the resource read, for X's once-a-day billing
   */
  async charge<T>(
    kind: string,
    estimate: number,
    work: () => Promise<T>,
    costOf: (result: T) => number | null,
    options: ChargeOptions = {},
  ): Promise<T> {
    const base = options.resource ? { resource: options.resource } : {};
    if (this.perCallCap !== undefined && estimate > this.perCallCap) {
      throw new SpendLimitError('call', { estimate, cap: this.perCallCap });
    }
    const { data, error } = await this.db.rpc('agent_spend_reserve', {
      run: this.runId,
      agent: this.agent,
      kind,
      estimate,
      trace: getActiveTraceId() ?? null,
    });
    if (error) throw new Error(`Spend meter unavailable: ${error.message}`);
    if (!data?.ok) throw new SpendLimitError(data?.reason ?? 'no_limit', data ?? {});
    const reservation = data.id as number;

    let result: T;
    try {
      result = await work();
    } catch (err) {
      // Refused by the provider: not billed, release. Anything else (timeout, dropped
      // connection) may have been billed: keep the estimate, the safe side.
      const refused = providerRefused(err);
      if (!refused) this.spentUsd += estimate;
      await this.settle(reservation, refused ? null : estimate, {
        ...base,
        failed: err instanceof Error ? err.message.slice(0, 200) : 'failed',
        ...(refused ? {} : { estimated: true }),
      });
      throw err;
    }
    const cost = costOf(result);
    this.spentUsd += cost ?? estimate;
    await this.settle(reservation, cost ?? estimate, cost === null ? { ...base, estimated: true } : base);
    return result;
  }

  private async settle(reservation: number, cost: number | null, detail: Record<string, unknown>) {
    const { error } = await this.db.rpc('agent_spend_settle', { reservation, cost, detail });
    // A failed settle leaves the reservation counting at its estimate, which is the safe side.
    if (error) console.error('Spend settle failed', reservation, error.message);
  }

  /** This month's spend, caps, and spend by agent. */
  async summary(): Promise<Record<string, unknown>> {
    const { data, error } = await this.db.rpc('agent_spend_summary');
    if (error) throw new Error(`Spend meter unavailable: ${error.message}`);
    return data;
  }
}
