// What Rein hands back from one trend fetch.
//
// Trends are about topics, never people: no user lists, audience profiles or traits
// inferred about individuals. Evidence is kept as post IDs (shown with X's official
// embed) plus a short excerpt only when one came from X's own API. Rein says what is
// trending and why; she never says buy or sell, predicts prices or rates an asset.
// Bil reviews every brief before a client sees it.

import { z, id, isoDateTime, shortText, text, Citation, MAX_EXCERPT, xPostId } from './common.ts';

export const Momentum = z.enum(['rising', 'peaking', 'fading']);

/** Regions Rein can be asked about, with X's location IDs (WOEIDs). */
export const REGIONS = {
  worldwide: 1,
  us: 23424977,
  uk: 23424975,
  canada: 23424775,
} as const;
export const Region = z.enum(['worldwide', 'us', 'uk', 'canada']);
export type Region = z.infer<typeof Region>;

/** What Bil sends Rein. */
export const ReinRequest = z.object({
  niche: shortText(200),
  region: Region.default('worldwide'),
  video: z.boolean().default(false).describe('Let Grok watch videos in posts. Costs extra tokens; only when video matters.'),
});
export type ReinRequest = z.infer<typeof ReinRequest>;

/** One post backing a trend. The excerpt exists only when X's API supplied the real text. */
export const TrendEvidence = z.object({
  postId: xPostId,
  excerpt: text(MAX_EXCERPT).optional(),
});

/** Post volume from X's own counts, so momentum is measured, never guessed. */
export const TrendVolume = z.object({
  posts7d: z.number().int().min(0),
  last24h: z.number().int().min(0),
  dailyAverageBefore: z.number().min(0).describe('Average posts per day over the days before the last 24 hours.'),
  last6h: z.number().int().min(0),
  sameHoursYesterday: z.number().int().min(0).describe('The same 6 hours one day earlier, so the daily cycle cancels out.'),
  countQuery: shortText(512),
});

export const Trend = z.object({
  topic: shortText(120),
  summary: text(600).describe('What is happening, in plain words.'),
  whyNow: text(400).describe('Why it is moving now.'),
  momentum: Momentum,
  volume: TrendVolume,
  onXTrendingList: z.boolean().describe('Also on X\'s own trending list for the region.'),
  hashtags: z.array(z.string().regex(/^#[A-Za-z0-9_]{1,60}$/)).max(5),
  evidence: z.array(TrendEvidence).max(5),
  sources: z.array(Citation).max(5),
  touchesFinance: z.boolean().describe('About a coin, stock or other asset. Bil then applies the financial rules.'),
  touchesAdult: z.boolean(),
});
export type Trend = z.infer<typeof Trend>;

export const ReinBrief = z
  .object({
    briefId: id,
    niche: shortText(200),
    region: Region,
    withVideo: z.boolean(),
    requestedBy: z.literal('bil').describe('Rein only works when Bil asks.'),
    searchedWith: z.enum(['x_search', 'x_api']).describe('x_api means Grok\'s X search failed and X\'s own search was used.'),
    createdAt: isoDateTime,
    trends: z.array(Trend).max(10),
    notFound: text(400).optional().describe('Said plainly when nothing real is trending, instead of padding the list.'),
  })
  .superRefine((b, ctx) => {
    if (b.trends.length === 0 && !b.notFound) {
      ctx.addIssue({ code: 'custom', path: ['notFound'], message: 'An empty brief must say why nothing was found.' });
    }
  });
export type ReinBrief = z.infer<typeof ReinBrief>;

/**
 * What Grok fills in. Only what Grok can know: code adds IDs, times, momentum and
 * volume, then checks the whole brief against ReinBrief. Kept loose on purpose (no
 * patterns), so one stray character is cleaned up in code instead of failing the call.
 */
export const MAX_CANDIDATES = 6;
export const ReinCandidates = z.object({
  candidates: z
    .array(
      z.object({
        topic: z.string().describe('Short name of the topic.'),
        summary: z.string().describe('What is happening, in plain words. Under 600 characters.'),
        whyNow: z.string().describe('Why it is moving now. Under 400 characters.'),
        countQuery: z
          .string()
          .describe('An X search query matching posts about this topic and little else: keywords, "quoted phrases", #hashtags, OR, parentheses. No from:, to:, @handles, list: or url:. Under 400 characters.'),
        hashtags: z.array(z.string()).max(5).describe('Hashtags people are really using for it, with the #.'),
        postIds: z.array(z.string()).max(8).describe('IDs of posts you actually saw in X search results, digits only.'),
        touchesFinance: z.boolean(),
        touchesAdult: z.boolean(),
      }),
    )
    .max(MAX_CANDIDATES),
  notFound: z.string().optional().describe('If nothing real is trending, say so plainly here and leave candidates empty.'),
});
export type ReinCandidates = z.infer<typeof ReinCandidates>;

/**
 * Evidence as stored. Excerpts are cleared 24 hours after saving (hourly database job),
 * so a stored excerpt may be null; the post ID stays for the official X embed.
 */
export const StoredEvidence = z.object({
  trendIndex: z.number().int().min(0).max(9),
  postId: xPostId,
  excerpt: text(MAX_EXCERPT).nullable(),
});
export type StoredEvidence = z.infer<typeof StoredEvidence>;

/** Turns a niche into the key briefs are shared under: lowercase, single spaces. */
export function nicheKey(niche: string): string {
  return niche.trim().replace(/\s+/g, ' ').toLowerCase();
}
