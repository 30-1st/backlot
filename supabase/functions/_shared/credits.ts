// Client credits (approved Nov 6, 2026): until payments open, the executive grants a client
// more of what is metered for clients, the same way as Xev's extra reads.
//   xev    Xev reads: 3 free in all, plus clients.xev_extra
//   next   Up next posts the client starts: 40 a month, plus clients.next_extra
//   plans  plans Bil builds from the team chat: 8 a month, plus clients.plan_extra
// The team and the executive are never stopped by these. Only the executive changes them.

import { id, z } from './schemas/common.ts';
import { serviceClient } from './spend.ts';
import { BilInputError } from './bil.ts';
import { type Member, requireClientAccess } from './workspace.ts';

export const FREE_XEV_READS = 3;
export const NEXT_PER_MONTH = 40;
export const CHAT_PLANS_PER_MONTH = 8;
/** How a plan Bil built from the team chat is marked in its request notes. */
export const CHAT_MARK = 'Built from the team chat.';

const monthStart = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();

async function extras(clientId: string, ownerId: string) {
  const { data, error } = await serviceClient().from('clients').select('xev_extra, next_extra, plan_extra').eq('id', clientId).eq('owner_id', ownerId).maybeSingle();
  if (error || !data) throw new BilInputError('No such client.', 404);
  return { xev: Number(data.xev_extra ?? 0), next: Number(data.next_extra ?? 0), plans: Number(data.plan_extra ?? 0) };
}

/** Up next posts the client started this month, and how many they may start. */
export async function nextAllowanceOf(clientId: string, ownerId: string) {
  const [{ count }, x] = await Promise.all([
    serviceClient().from('campaigns').select('id', { count: 'exact', head: true }).eq('client_id', clientId).eq('owner_id', ownerId).eq('request->>kind', 'next').eq('request->>by', 'client').gte('created_at', monthStart()),
    extras(clientId, ownerId),
  ]);
  return { used: count ?? 0, allowed: NEXT_PER_MONTH + x.next };
}

/** Plans the client asked for in the team chat this month (their team's asks do not count), and how many they may ask for. */
export async function chatPlanAllowanceOf(clientId: string, ownerId: string) {
  const [{ count }, x] = await Promise.all([
    serviceClient().from('campaigns').select('id', { count: 'exact', head: true }).eq('client_id', clientId).eq('owner_id', ownerId).like('request->>notes', `${CHAT_MARK} By client.%`).gte('created_at', monthStart()),
    extras(clientId, ownerId),
  ]);
  return { used: count ?? 0, allowed: CHAT_PLANS_PER_MONTH + x.plans };
}

export const CreditsRequest = z.object({ clientId: id });

/** Every client credit: what is used, what is allowed, and what the executive added. Team only. */
export async function creditsGet(m: Member, req: z.infer<typeof CreditsRequest>) {
  requireClientAccess(m, req.clientId);
  if (m.role === 'client' || m.role === 'visitor') throw new BilInputError('Only your team sees credits.', 403);
  const db = serviceClient();
  const [x, next, plans, { count: reads }] = await Promise.all([
    extras(req.clientId, m.workspaceId),
    nextAllowanceOf(req.clientId, m.workspaceId),
    chatPlanAllowanceOf(req.clientId, m.workspaceId),
    db.from('xev_reads').select('id', { count: 'exact', head: true }).eq('client_id', req.clientId),
  ]);
  return {
    xev: { used: reads ?? 0, allowed: FREE_XEV_READS + x.xev, extra: x.xev, base: FREE_XEV_READS, per: 'in all' },
    next: { ...next, extra: x.next, base: NEXT_PER_MONTH, per: 'this month' },
    plans: { ...plans, extra: x.plans, base: CHAT_PLANS_PER_MONTH, per: 'this month' },
  };
}

const extra = z.number().int().min(0).max(1000).optional();
export const CreditsGrantRequest = z.object({ clientId: id, xev: extra, next: extra, plans: extra });

/** The executive sets a client's extra credits. Anyone else is refused. */
export async function creditsGrant(m: Member, req: z.infer<typeof CreditsGrantRequest>) {
  if (m.role !== 'owner') throw new BilInputError('Only the executive grants credits.', 403);
  const patch: Record<string, number> = {};
  if (req.xev !== undefined) patch.xev_extra = req.xev;
  if (req.next !== undefined) patch.next_extra = req.next;
  if (req.plans !== undefined) patch.plan_extra = req.plans;
  if (!Object.keys(patch).length) throw new BilInputError('Nothing to change.');
  const { error } = await serviceClient().from('clients').update(patch).eq('id', req.clientId).eq('owner_id', m.workspaceId);
  if (error) throw new Error(`Could not save that: ${error.message}`);
  return await creditsGet(m, { clientId: req.clientId });
}
