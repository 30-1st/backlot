// Rules Bil's drafts must pass, enforced in code, never left to Grok.
//
// Each draft gets two lists back:
//   * redo: fixable problems (too long, a missing #ad, a stray hashtag). The slot is
//     drafted once more with the reasons attached; a second miss blocks it.
//   * blocked: things that must never ship (promised returns, adult content on a
//     non-adult account, Grok's own refusals or blocks). No second try.
//
// Length is counted the way X counts it, with X's own open-source library (twitter-text,
// Apache-2.0): links count as 23, emoji and CJK characters count as 2.

import twitter from 'npm:twitter-text@3.1.0';

/** X's standard limit, and the limit for long posts on X Premium. */
export const STANDARD_LIMIT = 280;
export const PREMIUM_LIMIT = 25_000;
/** Hashtags a post may carry besides required tags (#ad, contest tags). */
export const MAX_FREE_HASHTAGS = 2;

/** Claims that never ship, whatever the disclaimer. */
const FORBIDDEN_FINANCE =
  /\b(guaranteed (returns?|profits?|income)|risk[- ]free (returns?|profits?|investment)|can'?t lose|100x|1000x|to the moon|price target|will (hit|reach) \$?\d|buy (it )?now before|not financial advice,? but buy)\b/i;
const FINANCE_DISCLAIMER = /(not financial advice|education only|educational only|for educational purposes|not investment advice)/i;
const AD_TAG = /(^|[^\w])#ad\b|paid partnership/i;
const CONTEST_TAG = /#\w*(contest|sweepstakes)\b/i;
/** Asking for likes, reposts, follows or saves: X's engagement-bait enforcement (Jul 2026). */
const ENGAGEMENT_ASK = /\b(like|liking|repost|retweet|rt|follow|save|bookmark)\s+(this\s+)?(post\s+|tweet\s+|thread\s+)?(if|for|to win|and\s+i'?ll)\b/i;

export type CheckContext = {
  premium: boolean;
  /** Lowercase, without #: the client's list plus trend tags Bil approved. */
  allowedHashtags: Set<string>;
  wordsTheyAvoid: string[];
  adultAllowed: boolean;
  /** The client's approved links. When any are set, a draft may link only to them. */
  allowedLinks?: string[];
};

export type DraftFlags = {
  paidOrSponsored: boolean;
  financialContent: 'none' | 'education' | 'looks_like_advice';
  adultContent: boolean;
  promotion: 'none' | 'draw' | 'guaranteed_reward';
  blockedReasons: string[];
};

export type CheckResult = { redo: string[]; blocked: string[]; length: number; limit: number };

export function weightedLength(text: string): number {
  return twitter.parseTweet(text).weightedLength;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `word` appears as a whole word or phrase, ignoring case. */
function containsWord(text: string, word: string): boolean {
  const w = word.trim();
  if (w.length < 2) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegex(w)}($|[^\\p{L}\\p{N}_])`, 'iu').test(text);
}

export function checkDraft(draft: string, flags: DraftFlags, ctx: CheckContext): CheckResult {
  const redo: string[] = [];
  const blocked: string[] = [];
  const limit = ctx.premium ? PREMIUM_LIMIT : STANDARD_LIMIT;
  const length = weightedLength(draft);

  if (!draft.trim()) redo.push('The draft is empty.');
  if (length > limit) redo.push(`Too long: ${length} of ${limit} characters as X counts them. Cut it down.`);

  // Hashtags: required tags are always allowed; the rest must be on the list, at most two.
  const tags = (twitter.extractHashtags(draft) as string[]).map((t) => t.toLowerCase());
  const required = (t: string) => t === 'ad' || /(contest|sweepstakes)$/.test(t);
  const free = tags.filter((t) => !required(t));
  if (free.length > MAX_FREE_HASHTAGS) redo.push(`Uses ${free.length} hashtags; at most ${MAX_FREE_HASHTAGS} besides required tags.`);
  const unknown = [...new Set(free.filter((t) => !ctx.allowedHashtags.has(t)))];
  if (unknown.length) {
    redo.push(`Hashtag${unknown.length > 1 ? 's' : ''} ${unknown.map((t) => '#' + t).join(', ')} not on the client's list or an approved trend. Remove or swap.`);
  }

  // Disclosures.
  if (flags.paidOrSponsored && !AD_TAG.test(draft)) redo.push('Paid, gifted or rewarded post: add #ad near the start.');
  if (flags.promotion === 'draw' && !CONTEST_TAG.test(draft)) redo.push('Giveaway post: add the #Brand_Contest or #Brand_Sweepstakes tag.');
  if (flags.financialContent === 'looks_like_advice' && !FINANCE_DISCLAIMER.test(draft)) {
    redo.push('Could read as financial advice: add "Education only, not financial advice."');
  }

  // Links: only the client's approved ones, when they have set any.
  if (ctx.allowedLinks?.length) {
    const okPrefixes = ctx.allowedLinks.map((u) => u.replace(/\/+$/, '').toLowerCase());
    const urls = (twitter.extractUrls(draft) as string[]).map((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`).toLowerCase());
    const stray = urls.filter((u) => !okPrefixes.some((p) => u === p || u.startsWith(`${p}/`) || u.startsWith(`${p}?`)));
    if (stray.length) redo.push(`Links to ${stray.slice(0, 2).join(', ')}, which is not on the client's approved links. Use one of theirs or none.`);
  }

  // Engagement bait: earn replies and saves, never ask for them.
  if (ENGAGEMENT_ASK.test(draft)) redo.push('Asks people to like, repost, follow or save. X treats that as engagement bait; make it worth doing instead.');

  // Voice: words the client never uses.
  const avoided = ctx.wordsTheyAvoid.filter((w) => containsWord(draft, w));
  if (avoided.length) redo.push(`Uses words the client avoids: ${avoided.slice(0, 5).map((w) => `"${w}"`).join(', ')}.`);

  // Never ships.
  if (FORBIDDEN_FINANCE.test(draft)) blocked.push('Promises returns or predicts prices. A disclaimer cannot fix that.');
  if (flags.adultContent && !ctx.adultAllowed) blocked.push('Adult content on an account not set up as an adult niche.');
  for (const reason of flags.blockedReasons) if (reason.trim()) blocked.push(reason.trim().slice(0, 200));

  return { redo, blocked, length, limit };
}

/** Rough sign that Grok declined instead of answering. */
export function looksLikeRefusal(text: string): boolean {
  return /\b(I can(no|')t|I cannot|I won'?t|I'm (not able|unable) to|I am (not able|unable) to|unable to (help|assist|comply))\b/i.test(text);
}
