// Measures what already performs on a client's own page, from X's public numbers.
//
// Each post gets a score: its likes, replies, reposts and quotes, each multiplied by X's
// own published ranking weight for that action (read from Backlot's algorithm index), per
// 1,000 impressions. Replies and quotes count far more than likes, the way X's ranking
// counts them, so the score rewards what actually pushes a post further.
//
// Code computes every number. Grok only reads the numbers and the posts to name the
// patterns. Only the numbers, the patterns and post IDs are stored, never post text.

import { algorithmParams } from './algorithm.ts';

export type MeasuredPost = {
  postId: string;
  text: string;
  createdAt: string;
  hasMedia: boolean;
  metrics?: { impressions: number; likes: number; replies: number; reposts: number; quotes: number; bookmarks: number };
};

type Weights = { like: number; reply: number; repost: number; quote: number };

/** Today's published defaults, used only if the index cannot be read. */
const FALLBACK_WEIGHTS: Weights = { like: 0.66, reply: 5, repost: 1, quote: 5 };

export async function rankingWeights(): Promise<Weights> {
  try {
    const r = await algorithmParams({ names: ['FavoriteWeight', 'ReplyWeight', 'RetweetWeight', 'QuoteWeight'], limit: 4 });
    const get = (name: string, fallback: number) => {
      const v = Number(r.params.find((p) => p.name === name)?.value);
      return Number.isFinite(v) && v > 0 ? v : fallback;
    };
    return {
      like: get('FavoriteWeight', FALLBACK_WEIGHTS.like),
      reply: get('ReplyWeight', FALLBACK_WEIGHTS.reply),
      repost: get('RetweetWeight', FALLBACK_WEIGHTS.repost),
      quote: get('QuoteWeight', FALLBACK_WEIGHTS.quote),
    };
  } catch {
    return FALLBACK_WEIGHTS;
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round(m * 10) / 10;
}

function localHour(iso: string, timeZone: string): number {
  try {
    const h = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date(iso));
    return Number(h) % 24;
  } catch {
    return new Date(iso).getUTCHours();
  }
}

const WINDOWS = [
  { label: 'night (0:00 to 6:00)', from: 0, to: 6 },
  { label: 'morning (6:00 to 12:00)', from: 6, to: 12 },
  { label: 'afternoon (12:00 to 18:00)', from: 12, to: 18 },
  { label: 'evening (18:00 to 24:00)', from: 18, to: 24 },
];

export type Measured = MeasuredPost & { score: number | null; weighted: number; hour: number };

export type Performance = {
  posts: Measured[];
  stats: {
    postsMeasured: number;
    medianImpressions: number | null;
    medianScorePer1k: number | null;
    groups: Array<{ label: string; posts: number; medianScorePer1k: number | null }>;
  };
  topPostIds: string[];
  weights: Weights;
};

export async function measure(posts: MeasuredPost[], timeZone: string): Promise<Performance> {
  const weights = await rankingWeights();
  const measured: Measured[] = posts.map((p) => {
    const m = p.metrics;
    const weighted = m ? m.likes * weights.like + m.replies * weights.reply + m.reposts * weights.repost + m.quotes * weights.quote : 0;
    // A score needs impressions to compare posts fairly; brand-new posts with none are left unscored.
    const score = m && m.impressions > 0 ? Math.round((weighted / m.impressions) * 1000 * 10) / 10 : null;
    return { ...p, weighted, score, hour: localHour(p.createdAt, timeZone) };
  });
  const scored = measured.filter((p) => p.score !== null);
  const group = (label: string, list: Measured[]) => ({ label, posts: list.length, medianScorePer1k: median(list.map((p) => p.score!)) });
  const groups = [
    ...WINDOWS.map((w) => group(`posted in the ${w.label}`, scored.filter((p) => p.hour >= w.from && p.hour < w.to))),
    group('with a photo or video', scored.filter((p) => p.hasMedia)),
    group('text only', scored.filter((p) => !p.hasMedia)),
    group('short (under 100 characters)', scored.filter((p) => p.text.length < 100)),
    group('medium (100 to 200 characters)', scored.filter((p) => p.text.length >= 100 && p.text.length <= 200)),
    group('long (over 200 characters)', scored.filter((p) => p.text.length > 200)),
  ].filter((g) => g.posts > 0);
  const ranked = [...scored].sort((a, b) => b.score! - a.score!);
  return {
    posts: measured,
    stats: {
      postsMeasured: scored.length,
      medianImpressions: median(scored.map((p) => p.metrics!.impressions)),
      medianScorePer1k: median(scored.map((p) => p.score!)),
      groups,
    },
    topPostIds: ranked.slice(0, 5).map((p) => p.postId),
    weights,
  };
}

/** One post line for the prompt: its numbers first, then its text. */
export function postLine(p: Measured, maxChars: number): string {
  const t = p.text.replace(/\s+/g, ' ').trim().slice(0, maxChars);
  const m = p.metrics;
  const nums = m
    ? `views ${m.impressions} · replies ${m.replies} · quotes ${m.quotes} · reposts ${m.reposts} · likes ${m.likes} · bookmarks ${m.bookmarks} · score ${p.score ?? 'n/a'}`
    : 'no numbers';
  return `- [${nums}${p.hasMedia ? ' · media' : ''}] ${t}`;
}

/** The measured summary for the prompt. */
export function statsText(perf: Performance): string {
  const s = perf.stats;
  return [
    `Score = (likes × ${perf.weights.like} + replies × ${perf.weights.reply} + reposts × ${perf.weights.repost} + quotes × ${perf.weights.quote}) per 1,000 views, using X's published ranking weights.`,
    `Posts with numbers: ${s.postsMeasured}. Median views: ${s.medianImpressions ?? 'n/a'}. Median score: ${s.medianScorePer1k ?? 'n/a'}.`,
    ...s.groups.map((g) => `- ${g.label}: ${g.posts} posts, median score ${g.medianScorePer1k ?? 'n/a'}`),
  ].join('\n');
}
