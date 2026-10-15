// Spending meter for agents. Every paid call goes through Budget.charge():
//   1. reserve an upper-bound estimate in the database (refused if it would break a cap)
//   2. make the call
//   3. settle with the real cost, or release the reservation if the call was never charged
// The caps and the ledger live in Postgres (private.spend_limits / private.spend_ledger);
// see migration 20261015101500_agent_spend_meter.sql.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import { getActiveTraceId } from 'npm:@langfuse/tracing@6.0.0';

export type AgentName = 'rein' | 'bil' | 'check';

/** Thrown when a reservation would go over a cap. Nothing was spent. */
export class SpendLimitError extends Error {
  constructor(
    readonly reason: 'run' | 'month' | 'no_limit',
    readonly detail: Record<string, unknown>,
  ) {
    super(
      reason === 'month'
        ? `Monthly agent budget reached ($${detail.used} of $${detail.cap} used)`
        : reason === 'run'
          ? `This run would go over its $${detail.cap} limit`
          : String(detail.detail ?? 'No spending limit is set'),
    );
    this.name = 'SpendLimitError';
  }
}

/** The service-role database client edge functions use. Never sent to a browser. */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!;
  let key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  try {
    const named = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (typeof named.default === 'string') key = named.default;
  } catch {
    // Fall back to the legacy key above.
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Errors after which the provider may already have charged us (the call reached them). */
function mayHaveBeenCharged(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  return name === 'TimeoutError' || name === 'AbortError';
}

export class Budget {
  readonly runId = crypto.randomUUID();

  constructor(
    readonly agent: AgentName,
    private readonly db: SupabaseClient = serviceClient(),
  ) {}

  /**
   * Runs one paid call inside a reservation.
   * @param kind      what is being paid for, e.g. 'grok' or 'x_user_lookup'
   * @param estimate  upper-bound cost in USD, reserved before the call
   * @param work      the call itself
   * @param costOf    the real cost from the result; null means "use the estimate"
   */
  async charge<T>(
    kind: string,
    estimate: number,
    work: () => Promise<T>,
    costOf: (result: T) => number | null,
  ): Promise<T> {
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
      // Not charged (e.g. the provider refused the request): release. Possibly charged
      // (timed out mid-call): keep the estimate, the safe side.
      await this.settle(reservation, mayHaveBeenCharged(err) ? estimate : null, {
        failed: err instanceof Error ? err.message.slice(0, 200) : 'failed',
      });
      throw err;
    }
    const cost = costOf(result);
    await this.settle(reservation, cost ?? estimate, cost === null ? { estimated: true } : {});
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
