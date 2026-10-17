// What Grok fills in for Bil, one shape per step, plus the plan as Backlot stores it.
//
// The Grok shapes are loose on purpose, like Rein's: plain strings with their limits in
// the description, enums and booleans, no patterns. One stray character is then cleaned
// up in code instead of failing a paid call. Code adds every ID, date and source, checks
// the result against the strict shapes in ./bil.ts and ./client.ts, and enforces the
// rules Grok cannot be trusted with (length as X counts it, hashtags, disclosures).

import { z, id, isoDate, shortText, slug, text, FunnelStage, XAction } from './common.ts';
import { Personality, Situation, ToneSliders, VoiceCard } from './client.ts';
import { RewardAction, RewardProgram, TrendVerdict } from './bil.ts';

const str = (description: string) => z.string().describe(description);
const habits = VoiceCard.shape.habits.shape;
const replyStyle = VoiceCard.shape.replyStyle.shape;

// ---------- onboarding ----------

/** What Grok writes about what performs; code adds the measured numbers and post IDs. */
export const WhatWorksDraft = z.object({
  summary: str('What their audience rewards, from the numbers given. Two or three plain sentences, under 600 characters.'),
  patterns: z.array(z.string()).max(8).describe('What the top posts share: topics, formats, hooks, length, timing, media. Each under 200 characters.'),
  doMore: z.array(z.string()).max(6).describe('What to do more of to reach further, each under 200 characters.'),
  avoid: z.array(z.string()).max(6).describe('What underperforms or draws negative reactions, each under 200 characters.'),
});
export type WhatWorksDraft = z.infer<typeof WhatWorksDraft>;

export const VoiceDraft = z.object({
  tone: ToneSliders,
  personality: z.object({ primary: Personality, secondary: Personality.optional() }),
  summary: str('The voice in two or three sentences, in plain words. Under 600 characters.'),
  wordsTheyUse: z.array(z.string()).max(30).describe('Words and phrases they really use. Each under 60 characters.'),
  wordsTheyAvoid: z.array(z.string()).max(30).describe('Words they avoid or would never use. Each under 60 characters.'),
  habits: z.object({
    emoji: habits.emoji,
    capitalization: habits.capitalization,
    postLength: habits.postLength,
    selfReference: habits.selfReference,
    notes: str('Punctuation, slang, signature phrases, sentence rhythm. Under 500 characters.'),
  }),
  replyStyle: z.object({ approach: replyStyle.approach, notes: str('Under 500 characters.') }),
  offLimits: z.array(z.string()).max(20).describe('Topics, words or jokes to stay away from. Each under 200 characters.'),
  toneBySituation: z
    .array(z.object({ situation: Situation, guidance: str('Under 300 characters.') }))
    .max(7),
  postTypes: z
    .array(
      z.object({
        slug: str('Lowercase letters, digits and dashes, 2 to 40 characters, e.g. "behind-the-scenes".'),
        name: str('Under 60 characters.'),
        purpose: str('What this kind of post does for this client. Under 300 characters.'),
        stages: z.array(FunnelStage).min(1).max(4),
      }),
    )
    .max(12)
    .describe('This client\'s own library of post types, 5 to 12 of them.'),
  whatWorks: WhatWorksDraft,
  observations: str('What in their posts and answers shaped this card, and anything the client should confirm. Under 800 characters.'),
});
export type VoiceDraft = z.infer<typeof VoiceDraft>;

// ---------- brief review ----------

export const ReviewDraft = z.object({
  decisions: z
    .array(
      z.object({
        topic: str('The trend\'s topic, exactly as given.'),
        verdict: TrendVerdict,
        reason: str('One line. Under 400 characters.'),
        hashtagFits: z.boolean().describe('The trend\'s hashtag truly relates to what this client would post about it.'),
        actWithinHours: z.number().int().optional().describe('For "use": how soon to post, 1 to 168 hours.'),
      }),
    )
    .max(10),
  evergreenIdeas: z.array(z.string()).max(5).describe('Steady topics worth evergreen posts for this client. Each under 200 characters.'),
});
export type ReviewDraft = z.infer<typeof ReviewDraft>;

// ---------- plan ----------

const RewardDraft = z.object({
  kind: z.enum(['draw', 'guaranteed']),
  action: RewardAction,
  reward: str('What people get. Under 200 characters.'),
  totalPrizeValueUsd: z.number(),
  disclosureTag: z.string().optional().describe('Draws: #BrandName_Contest or #BrandName_Sweepstakes. Rewarded posts: #ad.'),
  entryLimit: str('e.g. "one entry per day". Under 120 characters.'),
  startDayOffset: z.number().int(),
  endDayOffset: z.number().int(),
  noPurchaseNecessary: z.boolean(),
  officialRules: z.string().optional().describe('Required for draws: who can enter, dates, prize, how winners are picked and told. Under 2,000 characters.'),
  delivery: z.enum(['manual', 'x_approved_tool']),
  adultsOnly: z.boolean(),
});

export const PlanDraft = z.object({
  title: str('Under 120 characters.'),
  goal: str('The business goal in one sentence. Under 280 characters.'),
  kpis: z.array(z.string()).min(1).max(6).describe('One main measure and one or two supporting ones the client can see. Each under 160 characters.'),
  pillars: z
    .array(z.object({ slug: str('Lowercase letters, digits and dashes.'), name: str('Under 60 characters.'), why: str('Under 240 characters.') }))
    .min(1)
    .max(6),
  slots: z
    .array(
      z.object({
        slot: z.number().int().describe('1, 2, 3 ... in posting order.'),
        dayOffset: z.number().int().describe('Days after the start date, 0 = the first day.'),
        postWindow: str('Local time window, e.g. "18:00 to 20:00". Under 60 characters.'),
        postType: str('A slug from the client\'s post-type library.'),
        pillar: str('A slug from this plan\'s pillars.'),
        stage: FunnelStage,
        idea: str('What this post does and its angle. Under 300 characters.'),
        trendTopic: z.string().optional().describe('Only when it uses a trend you marked "use", exactly as named.'),
      }),
    )
    .max(60),
  reward: RewardDraft.optional().describe('Only when the client asked for a giveaway or reward.'),
  notes: str('Why this plan, what to watch, and what is a guess (posting windows are). Under 1,000 characters.'),
});
export type PlanDraft = z.infer<typeof PlanDraft>;

// ---------- drafting ----------

export const BatchDraft = z.object({
  posts: z
    .array(
      z.object({
        slot: z.number().int().describe('The slot number you were given.'),
        hook: str('The first line, exactly as it appears in the draft.'),
        draft: str('The full post, ready to copy, including any required #ad, contest tag or disclaimer.'),
        callToAction: z.string().optional(),
        mediaIdea: z.string().optional().describe('A description only. Never images of real people. Under 400 characters.'),
        engagementPlan: z.string().optional().describe('What the client does by hand after posting. Under 400 characters.'),
        algorithmScore: z.number().int().describe('0 to 100: how well this fits X\'s ranking, from the settings given. A guide, not a promise.'),
        signals: z
          .array(z.object({ action: XAction, effect: z.enum(['raises', 'lowers']), why: str('Under 240 characters.') }))
          .max(6),
        voiceMatch: z.number().int().describe('0 to 100 against the voice card.'),
        drift: z.array(z.string()).max(5).describe('Where it slipped toward a generic tone. Empty if none.'),
        compliance: z.object({
          paidOrSponsored: z.boolean(),
          financialContent: z.enum(['none', 'education', 'looks_like_advice']),
          adultContent: z.boolean(),
          promotion: z.enum(['none', 'draw', 'guaranteed_reward']),
          blockedReasons: z.array(z.string()).max(5).describe('Why this must not ship as written. Empty when it can ship.'),
        }),
      }),
    )
    .max(10),
});
export type BatchDraft = z.infer<typeof BatchDraft>;

// ---------- the plan as stored on the campaign ----------

export const PlanSlot = z.object({
  slot: z.number().int().min(1).max(60),
  dayOffset: z.number().int().min(0).max(90),
  postWindow: shortText(60),
  postType: slug,
  pillar: slug,
  stage: FunnelStage,
  idea: shortText(300),
  trendTopic: shortText(120).optional(),
});
export type PlanSlot = z.infer<typeof PlanSlot>;

export const AlgorithmContext = z.object({
  repoCommit: z.string().regex(/^[0-9a-f]{40}$/),
  params: z.array(z.object({ name: shortText(100), value: z.string().max(200) })).max(80),
  excerpts: z.array(z.object({ file: shortText(400), lines: shortText(40), text: text(800) })).max(4),
});
export type AlgorithmContext = z.infer<typeof AlgorithmContext>;

export const CampaignPlan = z.object({
  title: shortText(120),
  goal: shortText(280),
  kpis: z.array(shortText(160)).min(1).max(6),
  startDate: isoDate,
  lengthDays: z.number().int().min(1).max(90),
  pillars: z.array(z.object({ slug, name: shortText(60), why: shortText(240) })).min(1).max(6),
  slots: z.array(PlanSlot).min(1).max(60),
  reward: RewardProgram.optional(),
  notes: text(1000),
  briefId: id.optional(),
  reviewId: id.optional(),
  /** Hashtags of trends Bil marked "use" with a fitting tag, without the #. */
  trendHashtags: z.array(z.string()).max(20),
  algorithm: AlgorithmContext,
  /** What code removed or changed from Grok's plan, in plain words. */
  adjustments: z.array(shortText(300)).max(30),
});
export type CampaignPlan = z.infer<typeof CampaignPlan>;
