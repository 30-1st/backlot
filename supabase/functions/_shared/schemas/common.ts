// Building blocks shared by every Backlot schema.
//
// Two jobs at once:
//   1. Grok's structured output follows these shapes (they are turned into JSON Schema).
//   2. Zod checks every result again after it comes back, because xAI only guarantees
//      some limits (strings up to 2,048 characters, arrays up to 256 items) and treats
//      the rest as best effort. Rules JSON Schema cannot express live in .superRefine()
//      and run only in that second check.
//
// xAI limits these shapes respect (docs.x.ai structured outputs, checked 2026-10-16):
// no self-nesting shapes, strings at most 2,048 characters, arrays at most 256 items,
// objects at most 64 properties, and only a subset of regex in `pattern`.

import { z } from 'npm:zod@4.6.7';

export { z };

/** Longest text xAI guarantees in a structured output. */
export const MAX_TEXT = 2048;

/**
 * Stored X post excerpts stay short (our rule: IDs and short excerpts only, removed within
 * 24 hours of the post leaving X).
 */
export const MAX_EXCERPT = 120;

export const text = (max = MAX_TEXT) => z.string().trim().min(1).max(max);
export const shortText = (max = 280) => text(max);

/** A UUID made by Backlot (clients, briefs, campaigns). */
export const id = z.string().uuid();

/** An X post ID: digits only. */
export const xPostId = z.string().regex(/^[0-9]{1,25}$/);

/** A slug: lowercase letters, digits and dashes. Used for post types and pillars. */
export const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/);

export const isoDateTime = z.string().datetime({ offset: true });
export const isoDate = z.string().date();

/** A reference to a public X post: its ID and a short excerpt, never the full text. */
export const PostRef = z
  .object({
    postId: xPostId,
    excerpt: text(MAX_EXCERPT),
  })
  .describe('A public X post, kept as its ID and a short excerpt only.');

/** Where a claim came from. */
export const Citation = z.object({
  label: shortText(200),
  url: z.string().url(),
});

/** The stages a follower moves through, from stranger to repeat buyer. */
export const FunnelStage = z
  .enum(['discover', 'consider', 'convert', 'retain'])
  .describe('discover = strangers find the account; consider = followers weigh it up; convert = they buy, book or sign up; retain = they come back and advocate.');

/**
 * Engagement actions X's ranking predicts, as listed in xai-org/x-algorithm's README
 * (checked 2026-10-16). Negative ones are weighted against a post.
 */
export const XAction = z.enum([
  'favorite',
  'reply',
  'repost',
  'quote',
  'share',
  'share_via_dm',
  'share_via_copy_link',
  'click_post',
  'click_profile',
  'click_link',
  'photo_expand',
  'video_open',
  'click_quoted_post',
  'video_quality_view',
  'dwell',
  'follow_author',
  'not_interested',
  'mute_author',
  'block_author',
  'report',
]);

export const NEGATIVE_ACTIONS = ['not_interested', 'mute_author', 'block_author', 'report'] as const;

/** What a piece of content touches, so the right rules run on it. */
export const ComplianceFlags = z
  .object({
    paidOrSponsored: z.boolean().describe('Paid, gifted or affiliate content. Needs #ad or "Paid partnership".'),
    financialContent: z
      .enum(['none', 'education', 'looks_like_advice'])
      .describe('looks_like_advice means a disclaimer is required and Bil re-checks the wording.'),
    licensedApprovalNeeded: z.boolean().describe('The client is licensed and their compliance team must approve this.'),
    adultContent: z.boolean(),
    promotion: z.enum(['none', 'draw', 'guaranteed_reward']),
    blockedReasons: z
      .array(shortText(200))
      .max(10)
      .describe('Why Bil will not let this ship as written. Empty when it can ship.'),
  })
  .describe('Rules this content triggers.');

export type ComplianceFlags = z.infer<typeof ComplianceFlags>;
