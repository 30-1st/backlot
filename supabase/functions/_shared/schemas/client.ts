// Who the client is (profile) and how they sound (voice card).
//
// The profile comes from the intake form. The voice card is written by Bil from the
// intake answers plus the client's own recent X posts, then approved by the client.
// Only the card is stored; text read from X is not. Samples the client pastes in
// themselves are their own content and may be kept.

import { z, id, isoDateTime, shortText, slug, text, xPostId, FunnelStage } from './common.ts';

// ---------- client profile ----------

export const ClientKind = z.enum(['small_business', 'influencer', 'creator', 'professional']);

/** How the account presents itself. */
export const AccountStyle = z.enum(['personal', 'faceless', 'product', 'brand']);

export const Goal = z.enum(['sales', 'leads', 'bookings', 'followers', 'community', 'awareness']);

/** Regulated professions with their own advertising rules (SEC, FINRA, state bars and others). */
export const Profession = z.enum([
  'lawyer',
  'investment_adviser',
  'broker',
  'financial_planner',
  'insurance',
  'accountant',
  'real_estate',
  'other_licensed',
]);

export const Licensing = z
  .object({
    profession: Profession,
    regulator: shortText(120).describe('Who licenses them, e.g. "SEC", "FINRA", "New York State Bar".'),
    complianceReviewRequired: z
      .boolean()
      .describe('Their firm or regulator requires approval before posting. Bil flags drafts for it.'),
  })
  .describe('Present only when the client is licensed.');

/** The profile's fields without its cross-field rules, so forms can reuse a subset of them. */
export const ClientProfileBase = z.object({
    clientId: id,
    displayName: shortText(80),
    xHandle: z.string().regex(/^[A-Za-z0-9_]{1,15}$/).describe('Without the @.'),
    kind: ClientKind,
    accountStyle: AccountStyle,
    niche: shortText(200),
    offer: text(1000).describe('What they sell or want people to do.'),
    audience: text(1000).describe('Who they serve, in the client\'s words. Topics and needs only, never lists of people.'),
    positioning: text(1000).describe('What sets them apart from alternatives.'),
    goals: z
      .array(z.object({ goal: Goal, detail: shortText(280), target: shortText(120).optional() }))
      .min(1)
      .max(5),
    licensing: Licensing.optional(),
    timezone: z.string().regex(/^(UTC|[A-Za-z]+(\/[A-Za-z0-9_+-]+){1,2})$/).describe('IANA time zone, e.g. "America/New_York". Posting windows use it.'),
    language: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/).describe('Language posts are written in, e.g. "en" or "es-MX".'),
    xPremium: z.boolean().describe('On X Premium, so long posts are allowed. Pre-filled from the profile lookup, confirmed by the client.'),
    postsPerWeek: z.number().int().min(1).max(35).describe('How many posts the client can really publish by hand each week.'),
    allowedHashtags: z
      .array(z.string().regex(/^[A-Za-z0-9_]{1,50}$/))
      .max(15)
      .describe('Hashtags the client is happy to use, without the #. Drafts may use only these, approved trend tags and required tags.'),
    adultContent: z.boolean().describe('Adult niche. Allowed only for adults, everyone 18+ and consenting.'),
    adultsOnlyConfirmed: z.boolean().describe('The client confirmed everyone involved is 18+ and consenting.'),
    nicheKeywords: z
      .array(shortText(40))
      .max(12)
      .optional()
      .describe('Words people in their niche search and talk about. Rein and Bil use them for topics.'),
    competitors: z
      .array(z.string().regex(/^[A-Za-z0-9_]{1,15}$/))
      .max(10)
      .optional()
      .describe('X accounts the client competes with, without the @. For positioning only; never read or engaged with automatically.'),
    readConsentAt: isoDateTime
      .optional()
      .describe('When the person confirmed they own or manage this X account and allowed Bil to read its public posts. No read happens without it.'),
    updatedAt: isoDateTime,
});

export const ClientProfile = ClientProfileBase.superRefine((p, ctx) => {
    if (p.adultContent && !p.adultsOnlyConfirmed) {
      ctx.addIssue({
        code: 'custom',
        path: ['adultsOnlyConfirmed'],
        message: 'Adult niches need the client to confirm everyone is 18+ and consenting.',
      });
    }
    if (p.kind === 'professional' && !p.licensing) {
      ctx.addIssue({
        code: 'custom',
        path: ['licensing'],
        message: 'A professional client needs licensing details, so the right advertising rules apply.',
      });
    }
  });

export type ClientProfile = z.infer<typeof ClientProfile>;

// ---------- voice card ----------

/** Nielsen Norman Group's four tone dimensions, each on a three-point scale. */
export const ToneSliders = z.object({
  humor: z.enum(['funny', 'neutral', 'serious']),
  formality: z.enum(['formal', 'neutral', 'casual']),
  respect: z.enum(['respectful', 'neutral', 'irreverent']),
  energy: z.enum(['enthusiastic', 'neutral', 'matter_of_fact']),
});

/** Aaker's five brand personality dimensions. */
export const Personality = z.enum(['sincerity', 'excitement', 'competence', 'sophistication', 'ruggedness']);

export const Situation = z.enum(['everyday', 'sale', 'announcement', 'education', 'banter', 'apology', 'crisis']);

/**
 * What already performs on the client's own page, measured from their public post
 * numbers (X's public_metrics). Bil builds every campaign on this, then pushes past it.
 * Only derived numbers and post IDs are kept, never the posts' text.
 */
export const WhatWorks = z
  .object({
    summary: text(600).describe('What their audience rewards, in two or three plain sentences.'),
    patterns: z.array(shortText(200)).max(8).describe('Patterns the top posts share: topics, formats, hooks, length, timing, media.'),
    doMore: z.array(shortText(200)).max(6),
    avoid: z.array(shortText(200)).max(6),
    stats: z.object({
      postsMeasured: z.number().int().min(0).max(48),
      medianImpressions: z.number().min(0).nullable(),
      medianScorePer1k: z
        .number()
        .min(0)
        .nullable()
        .describe('Engagement weighted by X\'s ranking weights (replies and quotes count most), per 1,000 impressions.'),
      groups: z
        .array(z.object({ label: shortText(60), posts: z.number().int().min(0), medianScorePer1k: z.number().min(0).nullable() }))
        .max(12)
        .describe('The same score split by time of day, media and length.'),
    }),
    topPostIds: z.array(xPostId).max(5).describe('Their best posts by score, shown with X\'s embed.'),
    measuredAt: isoDateTime,
  })
  .describe('What performs on their page today.');

export type WhatWorks = z.infer<typeof WhatWorks>;

export const VoiceCard = z
  .object({
    clientId: id,
    version: z.number().int().min(1),
    tone: ToneSliders,
    personality: z.object({ primary: Personality, secondary: Personality.optional() }),
    summary: text(600).describe('The voice in two or three sentences, in plain words.'),
    wordsTheyUse: z.array(shortText(60)).max(40),
    wordsTheyAvoid: z.array(shortText(60)).max(40),
    habits: z.object({
      emoji: z.enum(['none', 'light', 'heavy']),
      capitalization: z.enum(['standard', 'lowercase', 'caps_for_emphasis']),
      postLength: z.enum(['short', 'medium', 'long', 'mixed']),
      selfReference: z.enum(['i', 'we', 'brand_name', 'none']).describe('How the account refers to itself.'),
      notes: text(500).optional().describe('Punctuation, slang, signature phrases, sentence rhythm.'),
    }),
    replyStyle: z.object({
      approach: z.enum(['warm', 'witty', 'blunt', 'helpful', 'playful']),
      notes: text(500).optional(),
    }),
    offLimits: z.array(shortText(200)).max(20).describe('Topics, words or jokes the client never wants.'),
    toneBySituation: z
      .array(z.object({ situation: Situation, guidance: shortText(300) }))
      .max(7)
      .describe('Voice stays the same; tone shifts with the moment.'),
    clientSamples: z
      .array(text())
      .max(10)
      .describe('Posts the client pasted in themselves. Never text copied from X by Backlot.'),
    whatWorks: WhatWorks.optional(),
    learnedFrom: z.object({
      intake: z.literal(true),
      xPostsRead: z.number().int().min(0).max(48).describe('How many of the client\'s X posts Bil read at onboarding.'),
      clientEdits: z.number().int().min(0).describe('Client edits folded back into this card.'),
    }),
    approvedByClient: z.boolean(),
    updatedAt: isoDateTime,
  })
  .describe('How one client sounds. Every draft is checked against it.');

export type VoiceCard = z.infer<typeof VoiceCard>;

// ---------- post-type library ----------

/** One kind of post a client uses. Each client has their own library; there is no fixed loop. */
export const PostType = z.object({
  slug,
  name: shortText(60),
  purpose: shortText(300),
  stages: z.array(FunnelStage).min(1).max(4),
});

export const PostTypeLibrary = z
  .object({
    clientId: id,
    types: z.array(PostType).min(1).max(30),
  })
  .superRefine((lib, ctx) => {
    const seen = new Set<string>();
    lib.types.forEach((t, i) => {
      if (seen.has(t.slug)) ctx.addIssue({ code: 'custom', path: ['types', i, 'slug'], message: `Duplicate post type "${t.slug}".` });
      seen.add(t.slug);
    });
  });

export type PostTypeLibrary = z.infer<typeof PostTypeLibrary>;
