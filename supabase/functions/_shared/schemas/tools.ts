// Inputs and outputs for the shared toolbox Rein and Bil call.
//
// No tool can post, reply, like, follow or send messages. Every paid tool goes through
// the spend meter. The inspiration board is parked until after phase 7, so it has no
// tool yet.

import { z, id, isoDateTime, shortText, text, Citation, PostRef, xPostId } from './common.ts';
import { ReinBrief } from './rein.ts';
import { Campaign } from './bil.ts';
import { ClientProfile, PostTypeLibrary, VoiceCard } from './client.ts';

const handle = z.string().regex(/^[A-Za-z0-9_]{1,15}$/);

/** Shape of one tool: what goes in, what comes out. */
export type ToolShape<I extends z.ZodType, O extends z.ZodType> = { description: string; input: I; output: O };
const tool = <I extends z.ZodType, O extends z.ZodType>(description: string, input: I, output: O): ToolShape<I, O> => ({
  description,
  input,
  output,
});

export const TOOLS = {
  x_profile_lookup: tool(
    'Look up one public X profile: name, bio and public counts. $0.01 per profile, once per UTC day.',
    z.object({ handle }),
    z.object({
      handle,
      userId: xPostId.describe('X user ID. Never changes, so it is saved at intake.'),
      name: shortText(100),
      bio: text(400).optional(),
      followers: z.number().int().min(0),
      following: z.number().int().min(0),
      posts: z.number().int().min(0),
      verified: z.boolean(),
      location: shortText(100).optional(),
      link: shortText(200).optional().describe('The website on the profile, as X shows it.'),
      photoUrl: z.string().url().optional().describe('Profile photo on X\'s image server.'),
      bannerUrl: z.string().url().optional().describe('Header image on X\'s image server.'),
    }),
  ),

  x_post_search: tool(
    'Search recent public posts on a topic (last 7 days). Topics only: no from:, to: or @handles. Retweets excluded. $0.005 per post returned.',
    z.object({ query: shortText(200), maxPosts: z.number().int().min(10).max(50) }),
    z.object({ posts: z.array(PostRef.extend({ createdAt: isoDateTime, likes: z.number().int().min(0) })).max(50) }),
  ),

  client_posts_read: tool(
    'Onboarding and monthly reports only: read up to 100 of a client\'s own original posts (no replies or reposts) with their public numbers, optionally between two times. Text is used, then dropped; only derived numbers and post IDs are kept.',
    z.object({
      clientId: id,
      maxPosts: z.number().int().min(5).max(100),
      since: isoDateTime.optional().describe('Only posts at or after this time.'),
      until: isoDateTime.optional().describe('Only posts before this time.'),
    }),
    z.object({
      clientId: id,
      postsRead: z.number().int().min(0).max(100),
      posts: z
        .array(
          z.object({
            postId: xPostId,
            text: text(),
            createdAt: isoDateTime,
            hasMedia: z.boolean(),
            metrics: z
              .object({
                impressions: z.number().int().min(0),
                likes: z.number().int().min(0),
                replies: z.number().int().min(0),
                reposts: z.number().int().min(0),
                quotes: z.number().int().min(0),
                bookmarks: z.number().int().min(0),
              })
              .optional()
              .describe('X\'s public numbers for the post, read in the same request at no extra cost.'),
          }),
        )
        .max(100),
    }),
  ),

  brand_kit: tool(
    'Get a client\'s profile, voice card and post-type library.',
    z.object({ clientId: id }),
    z.object({
      clientId: id,
      profile: ClientProfile,
      voice: VoiceCard.optional().describe('Missing until onboarding has written one.'),
      postTypes: PostTypeLibrary.optional(),
    }),
  ),

  vault_search: tool(
    'Search the client\'s media vault by description.',
    z.object({ clientId: id, query: shortText(200), limit: z.number().int().min(1).max(20) }),
    z.object({ items: z.array(z.object({ assetId: id, description: shortText(300) })).max(20) }),
  ),

  algorithm_search: tool(
    'Search X\'s open-source ranking code (xai-org/x-algorithm) by keyword and meaning. Every hit links to the exact lines at the indexed snapshot. Free.',
    z.object({ question: shortText(300), limit: z.number().int().min(1).max(10) }),
    z.object({
      repo: z.literal('xai-org/x-algorithm'),
      license: z.literal('Apache-2.0'),
      repoCommit: z.string().regex(/^[0-9a-f]{40}$/),
      snapshotDate: isoDateTime.nullable(),
      indexedAt: isoDateTime.nullable(),
      search: z.enum(['keyword_and_meaning', 'keyword_only']).describe('keyword_only when the embedding check failed; say so when citing.'),
      hits: z
        .array(
          z.object({
            file: shortText(400),
            lines: z.object({ start: z.number().int().min(1), end: z.number().int().min(1) }),
            excerpt: text(1500),
            source: Citation,
          }),
        )
        .max(10),
    }),
  ),

  algorithm_params: tool(
    'Exact published DEFAULT settings from home-mixer/params/param.rs (e.g. FavoriteWeight), with change history. Defaults, not live values: X can change live values with feature switches. Free.',
    z.object({
      names: z.array(z.string().regex(/^[A-Za-z0-9_]{1,100}$/)).max(40).optional(),
      contains: z.string().regex(/^[A-Za-z0-9_]{1,60}$/).optional().describe('Part of a setting name, e.g. "Weight".'),
      limit: z.number().int().min(1).max(200),
    }),
    z.object({
      note: shortText(300),
      repo: z.literal('xai-org/x-algorithm'),
      license: z.literal('Apache-2.0'),
      repoCommit: z.string().regex(/^[0-9a-f]{40}$/).nullable(),
      defaultsSyncedAt: isoDateTime.nullable(),
      params: z
        .array(z.object({ name: shortText(100), type: shortText(60), value: z.string().max(2000), number: z.number().optional(), source: Citation }))
        .max(200),
      changes: z
        .array(z.object({ name: shortText(100), from: z.string().max(2000).nullable(), to: z.string().max(2000).nullable(), changedAt: isoDateTime, source: Citation }))
        .max(50),
    }),
  ),

  save_brief: tool('Save a Rein brief for Bil to review.', ReinBrief, z.object({ briefId: id, saved: z.boolean() })),

  write_campaign: tool(
    'Save a campaign blueprint. Never posts anything.',
    Campaign,
    z.object({ campaignId: id, saved: z.boolean() }),
  ),

  cost_meter: tool(
    'This month\'s spend against the caps. Free.',
    z.object({}),
    z.object({
      monthCapUsd: z.number(),
      monthUsedUsd: z.number(),
      byAgent: z.record(z.string(), z.number()),
    }),
  ),
} as const;

export type ToolName = keyof typeof TOOLS;
