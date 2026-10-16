// Who the client is (profile) and how they sound (voice card).
//
// The profile comes from the intake form. The voice card is written by Bil from the
// intake answers plus the client's own recent X posts, then approved by the client.
// Only the card is stored; text read from X is not. Samples the client pastes in
// themselves are their own content and may be kept.

import { z, id, isoDateTime, shortText, slug, text, FunnelStage } from './common.ts';

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

export const ClientProfile = z
  .object({
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
    adultContent: z.boolean().describe('Adult niche. Allowed only for adults, everyone 18+ and consenting.'),
    adultsOnlyConfirmed: z.boolean().describe('The client confirmed everyone involved is 18+ and consenting.'),
    updatedAt: isoDateTime,
  })
  .superRefine((p, ctx) => {
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
    learnedFrom: z.object({
      intake: z.literal(true),
      xPostsRead: z.number().int().min(0).max(50).describe('How many of the client\'s X posts Bil read at onboarding.'),
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
