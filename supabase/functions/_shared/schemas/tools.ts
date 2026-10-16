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
      name: shortText(100),
      bio: text(400).optional(),
      followers: z.number().int().min(0),
      following: z.number().int().min(0),
      posts: z.number().int().min(0),
      verified: z.boolean(),
    }),
  ),

  x_post_search: tool(
    'Search recent public posts on a topic. Topics only, never people. $0.005 per post returned.',
    z.object({ query: shortText(200), maxPosts: z.number().int().min(10).max(50) }),
    z.object({ posts: z.array(PostRef.extend({ createdAt: isoDateTime, likes: z.number().int().min(0) })).max(50) }),
  ),

  client_posts_read: tool(
    'Onboarding only: read up to 50 of a client\'s own recent posts to learn their voice. Text is used, then dropped; only the voice card is kept.',
    z.object({ clientId: id, maxPosts: z.number().int().min(5).max(50) }),
    z.object({
      clientId: id,
      postsRead: z.number().int().min(0).max(50),
      posts: z.array(z.object({ postId: xPostId, text: text(), createdAt: isoDateTime })).max(50),
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
    'Search the indexed xai-org/x-algorithm code and the parsed weights table.',
    z.object({ question: shortText(300), limit: z.number().int().min(1).max(10) }),
    z.object({
      repoCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
      hits: z.array(z.object({ file: shortText(200), excerpt: text(1500), source: Citation })).max(10),
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
