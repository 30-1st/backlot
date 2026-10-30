import type { Campaign, Client, Post, Workspace } from './data';

// When each post goes out. Bil plans a day (days after the campaign's start date) and a
// window in the client's own time zone, like "16:00 to 18:00". This turns that into a
// real moment, so Today can say "4:00 PM, in 1 h 12 min".

export type Timed = {
  campaign: Campaign;
  post: Post;
  client: Client | undefined;
  tz: string;
  /** When the window opens and closes. */
  start: Date;
  end: Date;
  /** The client's calendar day, YYYY-MM-DD. */
  day: string;
};

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The instant a wall-clock time happens in a time zone. */
export function zoned(day: string, hh: number, mm: number, tz: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(guess));
    const v = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const seen = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour') % 24, v('minute'));
    return new Date(guess - (seen - guess));
  } catch {
    return new Date(guess);
  }
}

/** Today's date in a time zone, YYYY-MM-DD. */
export function todayIn(tz: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function parseWindow(w: unknown): { sh: number; sm: number; eh: number; em: number } | null {
  const m = String(w ?? '').match(/(\d{1,2}):(\d{2})\D+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [sh, sm, eh, em] = m.slice(1).map(Number);
  if (sh > 23 || eh > 24 || sm > 59 || em > 59) return null;
  return { sh, sm, eh, em };
}

/** Every post that has a day and a window, with its real times, in posting order. */
export function timedPosts(ws: Workspace, focus: string | null): Timed[] {
  const out: Timed[] = [];
  for (const c of ws.campaigns) {
    if (focus && c.clientId !== focus) continue;
    const start = (c.request as { startDate?: string } | null)?.startDate;
    if (!start) continue;
    const client = ws.clients.find((x) => x.id === c.clientId);
    const tz = String(client?.profile?.timezone ?? '') || Intl.DateTimeFormat().resolvedOptions().timeZone;
    for (const p of ws.posts) {
      if (p.campaignId !== c.id) continue;
      const w = parseWindow(p.post.postWindow);
      if (!w) continue;
      const day = addDays(start, Number(p.post.dayOffset ?? 0));
      const s = zoned(day, w.sh, w.sm, tz);
      let e = zoned(day, w.eh % 24, w.em, tz);
      if (e <= s) e = new Date(e.getTime() + 86_400_000);
      out.push({ campaign: c, post: p, client, tz, start: s, end: e, day });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime() || a.post.slot - b.post.slot);
}

/** The next post still to go out: its window has not closed and nobody has marked it posted. */
export function nextPost(ws: Workspace, focus: string | null, now = Date.now()): Timed | null {
  return timedPosts(ws, focus).find((t) => t.end.getTime() > now && t.post.review !== 'posted' && t.post.review !== 'not_posted') ?? null;
}

const DAY = 86_400_000;
/** Past posts the client approved that still need the X link (or a "Not posted"). */
export function missingLinks(ws: Workspace, clientId: string, now = Date.now()): Timed[] {
  return timedPosts(ws, clientId).filter(
    (t) => !t.campaign.discardedAt && t.end.getTime() <= now && (t.post.review === 'approved' || (t.post.review === 'posted' && !t.post.xPostId)),
  );
}
/** Those more than 3 days past their time: campaigns hide until they are settled (Backlot's terms). */
export function overdueLinks(ws: Workspace, clientId: string, now = Date.now()): Timed[] {
  return missingLinks(ws, clientId, now).filter((t) => now - t.end.getTime() > 3 * DAY);
}

/** "4:00 PM" in the client's time zone, split so the numbers can be set large. */
export function clock(d: Date, tz: string): { time: string; half: string } {
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
    const m = s.match(/^(.*?)\s?([AP]M)$/i);
    return m ? { time: m[1], half: m[2].toUpperCase() } : { time: s, half: '' };
  } catch {
    return { time: d.toLocaleTimeString(), half: '' };
  }
}

/** "In 1 h 12 min", "Open now, until 6:00 PM", or "Tomorrow at 11:00 AM". */
export function when(t: Timed, now = Date.now()): string {
  const ms = t.start.getTime() - now;
  if (ms <= 0) {
    const e = clock(t.end, t.tz);
    return `Open now, until ${e.time} ${e.half}`.trim();
  }
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `In ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 12) return `In ${h} h ${mins % 60} min`;
  const today = todayIn(t.tz, new Date(now));
  const tomorrow = addDays(today, 1);
  const label = t.day === today ? 'Later today' : t.day === tomorrow ? 'Tomorrow' : new Date(`${t.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' });
  return label;
}

/** A short day name for the day strip: "Thu" and "22". */
export function dayParts(day: string): { name: string; num: string } {
  const d = new Date(`${day}T12:00:00Z`);
  return {
    name: d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }),
    num: String(d.getUTCDate()),
  };
}

/** True when Bil's media idea really describes a photo or video, not "text only". */
export function wantsMedia(idea: unknown): boolean {
  const s = String(idea ?? '').trim().toLowerCase();
  return s.length > 0 && !/^(none|text[- ]only|no media)/.test(s);
}
