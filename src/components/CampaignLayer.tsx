import { useEffect, useMemo, useState } from 'react';
import { useWorkspace, type Campaign, type Client } from '../shell/data';
import { campaignTitle } from '../shell/Notifications';
import { addDays, dayParts, timedPosts, zoned } from '../shell/timing';
import { savesToAccount } from '../lib/library';
import { cx } from './ui';

// A Bil campaign shown on top of an X narration: a live layer, never a copy. The posts
// are read from the campaign as the signed-in person, so the database decides who may
// see them (the team, or that client), and a detail given or a change asked shows up
// here too. The narration itself is never changed, and turning the layer off leaves it
// exactly as it was. Which campaign is shown is remembered per narration in this browser.

export type Stage = 'discover' | 'consider' | 'convert' | 'retain';
export const STAGES: Array<{ id: Stage; n: number; word: string }> = [
  { id: 'discover', n: 1, word: 'Discover' },
  { id: 'consider', n: 2, word: 'Consider' },
  { id: 'convert', n: 3, word: 'Convert' },
  { id: 'retain', n: 4, word: 'Retain' },
];
export const stageOf = (s: unknown) => STAGES.find((x) => x.id === s) ?? null;

export type LayerPost = {
  key: string;
  campaignId: string;
  slot: number;
  /** When the post goes out, in milliseconds. */
  at: number;
  /** The client's calendar day, YYYY-MM-DD. */
  day: string;
  /** Still waiting on a detail: no text yet, never shown to visitors. */
  held: boolean;
  text: string;
  idea: string;
  missing: string[];
  mediaId: string | null;
  stage: Stage | null;
};

export type Layer = {
  campaign: Campaign;
  client: Client | undefined;
  title: string;
  tz: string;
  posts: LayerPost[];
  /** Every day of the campaign, in order, with the moment it ends. */
  days: Array<{ day: string; endsAt: number }>;
};

const KEY = (narrationId: string) => `backlot.layer.${narrationId}`;

export function rememberLayer(narrationId: string, campaignId: string | null): void {
  try {
    if (campaignId) window.localStorage.setItem(KEY(narrationId), campaignId);
    else window.localStorage.removeItem(KEY(narrationId));
  } catch {
    // Private windows may refuse; the layer then lasts for this visit only.
  }
}

const INTENT = 'backlot.newx';

/** "See it on X" with no X narration for that @ yet: X setup opens with the handle typed in. */
export function setXIntent(intent: { handle: string; campaignId: string } | null): void {
  try {
    if (intent) window.sessionStorage.setItem(INTENT, JSON.stringify(intent));
    else window.sessionStorage.removeItem(INTENT);
  } catch {
    // Without storage, X setup simply opens empty.
  }
}

export function takeXIntent(): { handle: string; campaignId: string } | null {
  try {
    const raw = window.sessionStorage.getItem(INTENT);
    window.sessionStorage.removeItem(INTENT);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v.handle === 'string' && typeof v.campaignId === 'string' ? v : null;
  } catch {
    return null;
  }
}

function remembered(narrationId: string): string | null {
  try {
    return window.localStorage.getItem(KEY(narrationId));
  } catch {
    return null;
  }
}

/** The campaigns this person may layer on an X narration, and the one chosen. */
export function useCampaignLayer(narrationId: string, enabled: boolean, handle: string) {
  const on = enabled && savesToAccount();
  const ws = useWorkspace(on);
  const [chosen, setChosen] = useState<string | null>(() => remembered(narrationId));

  // A detail given or a change asked elsewhere shows up when you come back to this tab.
  useEffect(() => {
    if (!on) return;
    const back = () => document.visibilityState === 'visible' && void ws.refresh();
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [on, ws]);

  const options = useMemo(() => {
    const data = ws.data;
    if (!on || !data) return [];
    const h = handle.replace(/^@/, '').toLowerCase();
    const handleOf = (id: string) => data.clients.find((c) => c.id === id)?.handle ?? '';
    return data.campaigns
      .filter((c) => data.posts.some((p) => p.campaignId === c.id))
      .map((c) => ({ id: c.id, title: campaignTitle(c), handle: handleOf(c.clientId), start: String(c.request?.startDate ?? '') }))
      // Campaigns for the @ this narration is staged as come first.
      .sort((a, b) => Number(b.handle.toLowerCase() === h) - Number(a.handle.toLowerCase() === h) || b.start.localeCompare(a.start));
  }, [on, ws.data, handle]);

  const layer = useMemo<Layer | null>(() => {
    const data = ws.data;
    if (!on || !data || !chosen) return null;
    const campaign = data.campaigns.find((c) => c.id === chosen);
    if (!campaign) return null;
    const timed = timedPosts({ ...data, campaigns: [campaign] }, null);
    const client = data.clients.find((c) => c.id === campaign.clientId);
    const tz = String(client?.profile?.timezone ?? '') || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const posts: LayerPost[] = timed.map((t) => {
      const p = t.post.post as Record<string, unknown>;
      const c = p.compliance as { blockedReasons?: unknown } | undefined;
      const reasons = Array.isArray(c?.blockedReasons) ? c.blockedReasons : Array.isArray(p.blockedReasons) ? p.blockedReasons : [];
      const held = t.post.status === 'blocked';
      return {
        key: `${campaign.id}:${t.post.slot}`,
        campaignId: campaign.id,
        slot: t.post.slot,
        at: t.start.getTime(),
        day: t.day,
        held,
        text: held ? '' : String(p.draft ?? p.hook ?? ''),
        idea: String(p.idea ?? ''),
        missing: reasons.map(String).filter((r) => r && !/^Still breaks a rule/.test(r)).slice(0, 3),
        mediaId: typeof p.mediaId === 'string' ? p.mediaId : null,
        stage: stageOf(p.stage)?.id ?? null,
      };
    });
    const start = String(campaign.request?.startDate ?? posts[0]?.day ?? '');
    const length = Math.max(Number(campaign.request?.lengthDays ?? 0), ...posts.map((p) => daysBetween(start, p.day) + 1), 1);
    const days = start
      ? Array.from({ length: Math.min(length, 90) }, (_, i) => {
          const day = addDays(start, i);
          return { day, endsAt: zoned(day, 23, 59, tz).getTime() + 59_000 };
        })
      : [];
    return { campaign, client, title: campaignTitle(campaign), tz, posts, days };
  }, [on, ws.data, chosen]);

  const choose = (id: string | null) => {
    setChosen(id);
    rememberLayer(narrationId, id);
  };

  return { available: on && options.length > 0, options, chosen: layer ? chosen : null, choose, layer };
}

function daysBetween(a: string, b: string): number {
  if (!a || !b) return 0;
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/** Pick a campaign to show on this profile, or none. */
export function LayerPicker({
  options,
  chosen,
  onChoose,
}: {
  options: Array<{ id: string; title: string; handle: string; start: string }>;
  chosen: string | null;
  onChoose: (id: string | null) => void;
}) {
  return (
    <label className="layer-pick">
      <span>Campaign</span>
      <select value={chosen ?? ''} onChange={(e) => onChoose(e.target.value || null)} aria-label="Campaign shown on this profile">
        <option value="">None</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.title}
            {o.handle ? ` · @${o.handle}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Day 1, Day 2...: jump the visitor view to the end of that campaign day. */
export function DayChips({ layer, asOf, onPick }: { layer: Layer; asOf: number; onPick: (ms: number) => void }) {
  if (layer.days.length === 0) return null;
  const current = layer.days.findIndex((d) => asOf <= d.endsAt && asOf > d.endsAt - 86_400_000);
  return (
    <div className="day-chips" role="group" aria-label="Campaign day">
      {layer.days.map((d, i) => {
        const p = dayParts(d.day);
        return (
          <button key={d.day} type="button" className="day-chip" aria-pressed={i === current} onClick={() => onPick(d.endsAt)}>
            <b>Day {i + 1}</b>
            <span>
              {p.name} {p.num}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Every campaign post in order, numbered by its stage, so the story's build is easy to read. */
export function ArcStrip({ posts, onJump }: { posts: LayerPost[]; onJump: (key: string) => void }) {
  const ordered = [...posts].sort((a, b) => a.at - b.at);
  if (ordered.length === 0) return null;
  return (
    <div className="arc">
      <div className="arc-strip" role="list" aria-label="The campaign's arc, in posting order">
        {ordered.map((p, i) => {
          const s = stageOf(p.stage);
          return (
            <button
              key={p.key}
              type="button"
              role="listitem"
              className={cx('arc-seg', s && `is-${s.id}`, p.held && 'is-held')}
              aria-label={`Post ${i + 1}: ${s?.word ?? 'No stage'}${p.held ? ', needs a detail' : ''}`}
              onClick={() => onJump(p.key)}
            >
              {s?.n ?? '·'}
            </button>
          );
        })}
      </div>
      <div className="arc-key" aria-hidden="true">
        {STAGES.map((s) => (
          <span key={s.id}>
            <i className={`arc-dot is-${s.id}`}>{s.n}</i> {s.word}
          </span>
        ))}
      </div>
    </div>
  );
}
