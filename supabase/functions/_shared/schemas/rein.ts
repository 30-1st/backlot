// What Rein hands back from one trend fetch.
//
// Trends are about topics, never people: no user lists, audience profiles or traits
// inferred about individuals. Evidence is kept as post IDs and short excerpts only.
// Rein says what is trending and why; she never says buy or sell, predicts prices or
// rates an asset. Bil reviews every brief before a client sees it.

import { z, id, isoDateTime, shortText, text, Citation, PostRef } from './common.ts';

export const Momentum = z.enum(['rising', 'peaking', 'fading']);

export const Trend = z.object({
  topic: shortText(120),
  summary: text(600).describe('What is happening, in plain words.'),
  whyNow: text(400).describe('Why it is moving now.'),
  momentum: Momentum,
  hashtags: z.array(z.string().regex(/^#[A-Za-z0-9_]{1,60}$/)).max(5),
  evidence: z.array(PostRef).max(5),
  sources: z.array(Citation).max(5),
  touchesFinance: z.boolean().describe('About a coin, stock or other asset. Bil then applies the financial rules.'),
  touchesAdult: z.boolean(),
});

export const ReinBrief = z
  .object({
    briefId: id,
    niche: shortText(200),
    requestedBy: z.literal('bil').describe('Rein only works when Bil asks.'),
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
