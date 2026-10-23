import type { Workspace } from './data';
import { wantsMedia } from './timing';

// What a client's Media is missing: the shots Bil asked for in campaigns that still have
// no file, and how long since the last new photo or video.

export type Shot = { campaignId: string; slot: number; idea: string };

/** Posts still to go out whose shot Bil described but no file is matched to yet. */
export function shotsWanted(ws: Workspace, clientId: string): Shot[] {
  const mine = new Set(ws.campaigns.filter((c) => c.clientId === clientId).map((c) => c.id));
  return ws.posts
    .filter((p) => mine.has(p.campaignId) && p.status === 'ok' && p.review !== 'posted' && !p.post.mediaId && wantsMedia(p.post.mediaIdea))
    .map((p) => ({ campaignId: p.campaignId, slot: p.slot, idea: String(p.post.mediaIdea) }));
}

/** Media ids that went into a post the client marked as posted, and ids planned into any post. */
export function usage(ws: Workspace, clientId: string): { used: Set<string>; planned: Set<string> } {
  const mine = new Set(ws.campaigns.filter((c) => c.clientId === clientId).map((c) => c.id));
  const used = new Set<string>();
  const planned = new Set<string>();
  for (const p of ws.posts) {
    if (!mine.has(p.campaignId) || typeof p.post.mediaId !== 'string') continue;
    planned.add(p.post.mediaId);
    if (p.review === 'posted') used.add(p.post.mediaId);
  }
  return { used, planned };
}

/** Whole days since a date, or null when there is none. */
export function daysSince(iso: string | undefined, now = Date.now()): number | null {
  return iso ? Math.floor((now - Date.parse(iso)) / 86_400_000) : null;
}
