// Who the client is (profile) and how they sound (voice card).
//
// The profile comes from the intake form. The voice card is written by Bil from the
// intake answers plus the client's own recent X posts, then approved by the client.
// Only the card is stored; text read from X is not. Samples the client pastes in
// themselves are their own content and may be kept.

import { z, id, isoDate, isoDateTime, shortText, slug, text, xPostId, FunnelStage } from './common.ts';

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

/**
 * The voice dials, each 1 to 7 (Kris Roadmap, approved Oct 23). Every level has a written
 * anchor (DIAL_ANCHORS) so Bil, Kris and the client read a number the same way.
 */
const dial = z.number().int().min(1).max(7);
export const Dials = z.object({
  controversy: dial,
  cringe: dial,
  brainrot: dial,
  hype: dial,
  salesPush: dial,
  insider: dial,
  usefulness: dial,
  trendChasing: dial,
  spice: dial,
});
export type Dials = z.infer<typeof Dials>;

/** Starting dials before a preset or the client's own posts set them. */
export const DEFAULT_DIALS: Dials = { controversy: 4, cringe: 3, brainrot: 2, hype: 4, salesPush: 3, insider: 3, usefulness: 4, trendChasing: 3, spice: 2 };

/** What levels 1, 4 and 7 mean for each dial, in the words of the Kris Roadmap. */
export const DIAL_ANCHORS: Record<keyof Dials, [string, string, string]> = {
  controversy: ['Nothing anyone could object to', 'A cheeky take some will argue with', 'A loud staged fight about the brand itself'],
  cringe: ['Polished and careful', 'Knowingly awkward now and then', 'Over the top, self-aware, all in'],
  brainrot: ['Plain sense', 'Internet slang, a meme format or two', 'Absurd, meme-dense, extremely online'],
  hype: ['Calm and low-key', 'Upbeat, a little suspense', 'Big energy, surprise and awe'],
  salesPush: ['Never mentions buying', 'The offer is one line at the end', 'Every post points to the offer'],
  insider: ['For anyone scrolling past', 'One wink fans will get', 'Running jokes only fans get'],
  usefulness: ['Pure entertainment', 'A tip inside the fun', 'Step-by-step, saves time or money'],
  trendChasing: ['Evergreen only', 'One trend a week, when it fits', 'Jumps on every trend Rein finds'],
  spice: ['Family-friendly', 'Mild slang, no swearing', 'Swearing and edgy jokes'],
};

/**
 * The combined risk check: controversy or spice at 6 or more, or the two summing above 9,
 * means the client approves each post themselves.
 */
export const riskyDials = (d: Pick<Dials, 'controversy' | 'spice'> | undefined) =>
  !!d && (d.controversy >= 6 || d.spice >= 6 || d.controversy + d.spice > 9);

/**
 * Context modifiers (dial upgrade 6): the funnel stage nudges the dials a notch, and no
 * dial ever leaves 1 to 7. Discover: hype and brainrot +1. Consider: usefulness +1.
 * Convert: sales push +1. Retain: no change.
 */
export const STAGE_NUDGES: Record<string, Partial<Record<keyof Dials, number>>> = {
  discover: { hype: 1, brainrot: 1 },
  consider: { usefulness: 1 },
  convert: { salesPush: 1 },
  retain: {},
};
export function targetDials(d: Dials, stage?: string): Dials {
  const out = { ...d };
  const nudge = (stage && STAGE_NUDGES[stage]) || {};
  for (const [k, v] of Object.entries(nudge) as Array<[keyof Dials, number]>) out[k] = Math.max(1, Math.min(7, out[k] + v));
  return out;
}

/** Humor styles from the Humor Styles Questionnaire, as the Kris Roadmap names them. */
export const HumorStyle = z.enum(['warm', 'self_deprecating', 'at_ideas', 'hard_moments']);

/**
 * One thing the client sells. Every fact here is written by the client or the team, so Kris
 * and Bil can name prices and deals without inventing any. The link must be one of the
 * client's approved links; a deal code is shared only while its end date has not passed.
 */
export const Offer = z.object({
  name: shortText(60),
  what: text(300).describe('What is included, in plain words.'),
  price: shortText(40).optional().describe('As the client writes it, e.g. "$15 a month" or "from $40".'),
  forWho: shortText(120).optional().describe('Who it suits, e.g. "first-timers" or "regulars who want more".'),
  link: z.string().url().max(500).regex(/^https:\/\//).optional().describe('Must match one of the client\'s approved links.'),
  deal: z
    .object({
      code: z.string().regex(/^[A-Za-z0-9_-]{3,24}$/, 'Codes use letters, numbers, - or _, 3 to 24 long').optional(),
      note: shortText(80).optional().describe('What the deal is, e.g. "20% off the first month".'),
      ends: isoDate.optional().describe('Last day the deal runs, in the client\'s time zone.'),
    })
    .refine((d) => d.code || d.note, 'A deal needs a code or a short note')
    .optional(),
});
export type Offer = z.infer<typeof Offer>;

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
    dials: Dials.optional().describe('The client\'s voice dials, 1 to 7 each. Bil and Kris write to them.'),
    humorStyles: z.array(HumorStyle).max(2).optional().describe('One or two humor styles the client is comfortable with.'),
    faq: z
      .array(z.object({ q: shortText(200), a: text(500) }))
      .max(20)
      .optional()
      .describe('Facts the client wrote themselves (hours, prices, shipping). Kris answers from these and never invents facts.'),
    links: z
      .array(z.object({ label: shortText(60), url: z.string().url().max(500).regex(/^https:\/\//, 'Use an https link') }))
      .max(12)
      .optional()
      .describe('The only links Bil and Kris may point people to.'),
    offers: z
      .array(Offer)
      .max(8)
      .optional()
      .describe('What the client sells, one entry per offer. Kris matches visitors to these and Bil names them in posts; neither invents offers, prices or deals.'),
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
    const urls = new Set((p.links ?? []).map((l) => l.url));
    (p.offers ?? []).forEach((o, i) => {
      if (o.link && !urls.has(o.link)) {
        ctx.addIssue({ code: 'custom', path: ['offers', i, 'link'], message: `The link for "${o.name}" is not one of the approved links.` });
      }
    });
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
    dialStart: z
      .object({
        top: Dials,
        bottom: Dials,
        matters: z.array(z.enum(['controversy', 'cringe', 'brainrot', 'hype', 'salesPush', 'insider', 'usefulness', 'trendChasing', 'spice'])).max(9),
        posts: z.object({ top: z.number().int().min(1).max(5), bottom: z.number().int().min(1).max(5) }),
      })
      .optional()
      .describe('Dial upgrade 1: where their best and weakest posts sit on the dials, as a suggested starting setting. A suggestion only; the dials change when someone saves them.'),
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
