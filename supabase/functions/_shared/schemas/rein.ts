// What Rein hands back from one trend fetch.
//
// A brief has two parts:
//   * viral: the posts and creators actually blowing up in the niche this week, found in
//     two steps (search the niche, then read the best recent posts of the creators that
//     search turned up), ranked in code by X's own published ranking weights.
//   * trends: topics with momentum measured from X's own post counts.
// Accounts appear only because their public posts matched the niche search. Nothing about
// a person is inferred or labeled (X's developer rules), no account is watched over time,
// and only the posters are shown, never likers, repliers or fans. The brief keeps post and
// account IDs; handles, names, follower counts and excerpts live in brief_posts, where they
// are cleared 24 hours after saving. Rein never says buy or sell, predicts prices or rates
// an asset. Bil reviews every brief before a client sees it.

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

/** X's public numbers for a post, read when the brief was made. */
export const PostNumbers = z.object({
  likes: z.number().int().min(0),
  reposts: z.number().int().min(0),
  replies: z.number().int().min(0),
  quotes: z.number().int().min(0),
  bookmarks: z.number().int().min(0),
  views: z.number().int().min(0).nullable(),
});

export const MediaKind = z.enum(['photo', 'video', 'gif']);

/** One post that is doing well in the niche. Shown with X's official embed. */
export const ViralPost = z.object({
  postId: xPostId,
  authorId: xPostId,
  createdAt: isoDateTime,
  ageHours: z.number().min(0),
  numbers: PostNumbers,
  media: z.array(MediaKind).max(4),
  sensitive: z.boolean().describe('X marked it possibly sensitive. The app covers it until tapped.'),
  score: z.number().min(0).describe('Likes, reposts, replies and quotes, each times X\'s published ranking weight.'),
  perHour: z.number().min(0).describe('Score per hour since it was posted.'),
  vsUsual: z.number().min(0).nullable().describe('Score against the median of the same account\'s other posts this week. 3 means three times their usual.'),
  bucket: z.enum(['rising', 'proven']).describe('rising: under 24 hours old and moving fast. proven: the week\'s biggest.'),
});
export type ViralPost = z.infer<typeof ViralPost>;

/** An account behind the niche's top posts. Details (handle, followers) live in brief_posts for 24 hours. */
export const ViralCreator = z.object({
  authorId: xPostId,
  bestPostId: xPostId,
  postsSeen: z.number().int().min(1),
  medianScore: z.number().min(0),
  bestScore: z.number().min(0),
});

export const ViralPattern = z.object({
  pattern: shortText(120).describe('What the top posts share, e.g. "outfit photo with a this-or-that question".'),
  why: text(300),
  postIds: z.array(xPostId).max(5),
});

export const PostIdea = z.object({
  idea: text(300),
  pattern: shortText(120),
});

export const ViralSection = z.object({
  queries: z.array(shortText(300)).max(4).describe('The niche searches Rein ran.'),
  posts: z.array(ViralPost).max(20),
  creators: z.array(ViralCreator).max(15),
  patterns: z.array(ViralPattern).max(5),
  ideas: z.array(PostIdea).max(6).describe('Niche-level ideas. Bil writes them in each client\'s own voice.'),
  stats: z.object({
    postsRead: z.number().int().min(0),
    offNicheDropped: z.number().int().min(0),
    sensitive: z.number().int().min(0),
    verifiedOnly: z.boolean(),
  }),
});
export type ViralSection = z.infer<typeof ViralSection>;

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
    viral: ViralSection.optional().describe('Missing on briefs made before Oct 29, 2026.'),
    notFound: text(400).optional().describe('Said plainly when nothing real is trending, instead of padding the list.'),
  })
  .superRefine((b, ctx) => {
    if (b.trends.length === 0 && !(b.viral?.posts.length) && !b.notFound) {
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

/** Grok, step 1: how the niche talks on X. Code adds the filters. */
export const NicheQueries = z.object({
  queries: z
    .array(z.string())
    .max(3)
    .describe('Up to 3 search phrases in the niche\'s own words: keywords, "quoted phrases", #hashtags and OR only. No other operators.'),
  offNiche: z.string().optional().describe('Things that share the niche\'s words but are not it (a song title, a TV show), so they can be dropped.'),
});
export type NicheQueries = z.infer<typeof NicheQueries>;

/** Grok, step 2: which accounts in the first search are really in the niche, and the topics they are on. */
export const NicheRead = z.object({
  inNiche: z.array(z.string()).max(60).describe('Numbers (the n in [n]) of accounts whose posts and bio show they are in this niche.'),
  candidates: ReinCandidates.shape.candidates,
  notFound: z.string().optional(),
});
export type NicheRead = z.infer<typeof NicheRead>;

/** Grok, step 3: what the top posts have in common, and ideas built on it. */
export const NicheFormats = z.object({
  drop: z
    .array(z.string())
    .max(40)
    .default([])
    .describe('Numbers (the n in p<n>) of posts that are not this niche\'s kind of content: news, politics, errands, unrelated topics.'),
  patterns: z
    .array(z.object({ pattern: z.string(), why: z.string(), posts: z.array(z.string()).max(5).describe('Numbers (the n in [n]) of posts that show it.') }))
    .max(5),
  ideas: z.array(z.object({ idea: z.string(), pattern: z.string() })).max(6),
});
export type NicheFormats = z.infer<typeof NicheFormats>;

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
