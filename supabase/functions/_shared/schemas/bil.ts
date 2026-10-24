// Bil's outputs: his review of Rein's briefs, campaigns, and reward programs.
//
// Bil is the handler: every request goes through him and nothing ships without his
// approval. Backlot never posts; a campaign is a blueprint the client follows by hand.

import {
  z,
  id,
  isoDate,
  isoDateTime,
  shortText,
  slug,
  text,
  ComplianceFlags,
  FunnelStage,
  XAction,
} from './common.ts';
import { Dials } from './client.ts';

// ---------- review of a Rein brief ----------

export const TrendVerdict = z.enum(['use', 'watch', 'skip']);

export const BriefReview = z.object({
  briefId: id,
  clientId: id,
  decisions: z
    .array(
      z.object({
        topic: shortText(120),
        verdict: TrendVerdict,
        reason: shortText(400),
        hashtagFits: z
          .boolean()
          .describe('The trend\'s hashtag truly relates to the client\'s post. X bans hijacking unrelated hashtags.'),
        actWithinHours: z.number().int().min(1).max(168).optional().describe('How soon to post before the moment passes.'),
      }),
    )
    .max(10),
  reviewedAt: isoDateTime,
});

export type BriefReview = z.infer<typeof BriefReview>;

// ---------- reward programs ----------

/**
 * Actions a reward may be tied to. Likes, plain reposts and follows are left out on purpose:
 * they cannot carry a disclosure (FTC) and paying for them reads as metric inflation (X).
 */
export const RewardAction = z.enum(['reply', 'quote_post', 'signup', 'referral', 'community_join', 'ugc_post']);

/** Actions where the person posts about the brand, so their post must disclose the reward. */
const POSTING_ACTIONS = new Set(['quote_post', 'ugc_post']);

/** Above this total prize value, some states require registration and bonding. Legal check first. */
export const PRIZE_LEGAL_REVIEW_USD = 5000;

export const RewardProgram = z
  .object({
    kind: z.enum(['draw', 'guaranteed']).describe('draw = winners picked by chance; guaranteed = everyone who acts gets it.'),
    action: RewardAction,
    reward: shortText(200),
    totalPrizeValueUsd: z.number().min(0),
    disclosureTag: z
      .string()
      .regex(/^#[A-Za-z0-9_]{2,60}$/)
      .optional()
      .describe('For draws: #Brand_Contest or #Brand_Sweepstakes. For posts made to earn a reward: #ad.'),
    onePerPerson: z.literal(true).describe('One account per person; multiple accounts make an entrant ineligible.'),
    entryLimit: shortText(120).describe('e.g. "one entry per day".'),
    startDate: isoDate,
    endDate: isoDate,
    noPurchaseNecessary: z.boolean(),
    officialRules: text(2048).optional().describe('Required for draws.'),
    delivery: z
      .enum(['manual', 'x_approved_tool'])
      .describe('No keyword-only auto replies and no bulk automated DMs (X automation rules).'),
    legalReviewRequired: z.boolean(),
    adultsOnly: z.boolean(),
  })
  .superRefine((r, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (r.endDate < r.startDate) issue('endDate', 'The program ends before it starts.');
    if (r.kind === 'draw') {
      if (!r.noPurchaseNecessary) issue('noPurchaseNecessary', 'A chance draw must not require a purchase (lottery law).');
      if (!r.officialRules) issue('officialRules', 'A chance draw needs official rules.');
      if (!r.disclosureTag || !/(contest|sweepstakes)/i.test(r.disclosureTag)) {
        issue('disclosureTag', 'A draw needs a tag with "Contest" or "Sweepstakes" in it (FTC).');
      }
    }
    if (POSTING_ACTIONS.has(r.action) && r.kind === 'guaranteed' && !r.disclosureTag) {
      issue('disclosureTag', 'People posting to earn a reward must disclose it, e.g. #ad (FTC).');
    }
    if (r.totalPrizeValueUsd > PRIZE_LEGAL_REVIEW_USD && !r.legalReviewRequired) {
      issue('legalReviewRequired', `Prizes over $${PRIZE_LEGAL_REVIEW_USD} need a legal check first.`);
    }
  });

export type RewardProgram = z.infer<typeof RewardProgram>;

// ---------- campaigns ----------

export const AlgorithmScore = z.object({
  score: z.number().int().min(0).max(100).describe('A guide, not a promise: real scores differ per viewer.'),
  signals: z
    .array(
      z.object({
        action: XAction,
        effect: z.enum(['raises', 'lowers']),
        why: shortText(240),
      }),
    )
    .max(10),
  repoFile: z.string().regex(/^[A-Za-z0-9_./-]{1,200}$/).describe('File in xai-org/x-algorithm the judgment rests on.'),
  repoCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
});

export const VoiceCheck = z.object({
  voiceCardVersion: z.number().int().min(1),
  match: z.number().int().min(0).max(100),
  drift: z.array(shortText(200)).max(5).describe('Where the draft slipped toward a generic tone.'),
});

export const CampaignPost = z.object({
  order: z.number().int().min(1),
  dayOffset: z.number().int().min(0).max(90),
  postWindow: shortText(60).describe('Local time window, e.g. "18:00 to 20:00 ET".'),
  postType: slug.describe('A slug from this client\'s post-type library.'),
  pillar: slug,
  stage: FunnelStage,
  hook: shortText(280),
  draft: text().describe('The full post, ready to copy. Includes any required #ad or disclaimer.'),
  callToAction: shortText(200).optional(),
  mediaIdea: shortText(400).optional().describe('A description only. Agents never make images of real people.'),
  mediaId: id.optional().describe('The client\'s own Library file this post uses, matched by its tags.'),
  engagementPlan: shortText(400).optional().describe('What the client does by hand after posting, e.g. reply to early comments.'),
  algorithm: AlgorithmScore,
  voice: VoiceCheck,
  compliance: ComplianceFlags,
  /** The separate dial check (upgrade 3): what each dial read on this draft, and the setting it was held to. */
  dials: z.object({ readings: Dials, target: Dials }).optional(),
});

export const Campaign = z
  .object({
    campaignId: id,
    clientId: id,
    title: shortText(120),
    goal: shortText(280),
    kpis: z.array(shortText(160)).min(1).max(6),
    startDate: isoDate,
    lengthDays: z.number().int().min(1).max(90),
    pillars: z.array(z.object({ slug, name: shortText(60), why: shortText(240) })).min(1).max(6),
    posts: z.array(CampaignPost).min(1).max(120),
    reward: RewardProgram.optional(),
    basedOnBriefs: z.array(id).max(10),
    approval: z.object({
      status: z.enum(['draft', 'approved', 'needs_client', 'blocked']),
      notes: text(1000).optional(),
    }),
    createdAt: isoDateTime,
  })
  .superRefine((c, ctx) => {
    const pillars = new Set(c.pillars.map((p) => p.slug));
    c.posts.forEach((p, i) => {
      if (!pillars.has(p.pillar)) {
        ctx.addIssue({ code: 'custom', path: ['posts', i, 'pillar'], message: `Pillar "${p.pillar}" is not in this campaign.` });
      }
      if (p.dayOffset >= c.lengthDays) {
        ctx.addIssue({ code: 'custom', path: ['posts', i, 'dayOffset'], message: 'Post falls after the campaign ends.' });
      }
    });
    const blocked = c.posts.some((p) => p.compliance.blockedReasons.length > 0);
    if (blocked && c.approval.status === 'approved') {
      ctx.addIssue({ code: 'custom', path: ['approval', 'status'], message: 'A campaign with a blocked post cannot be approved.' });
    }
  });

export type Campaign = z.infer<typeof Campaign>;

/**
 * Checks a campaign's post types against the client's library. Kept outside the schema
 * because the library is stored separately.
 */
export function unknownPostTypes(campaign: Campaign, librarySlugs: Iterable<string>): string[] {
  const known = new Set(librarySlugs);
  return [...new Set(campaign.posts.map((p) => p.postType).filter((s) => !known.has(s)))];
}
