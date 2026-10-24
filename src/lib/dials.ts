// The nine dials on a client's brand kit, as the app shows them. The server's copy in
// supabase/functions/_shared/schemas/client.ts is the one Bil and Kris read; keep the
// two in step.

export type DialKey = 'controversy' | 'cringe' | 'brainrot' | 'hype' | 'salesPush' | 'insider' | 'usefulness' | 'trendChasing' | 'spice';
export type Dials = Record<DialKey, number>;

export const DEFAULT_DIALS: Dials = { controversy: 4, cringe: 3, brainrot: 2, hype: 4, salesPush: 3, insider: 3, usefulness: 4, trendChasing: 3, spice: 2 };

export const DIALS: Array<{ key: DialKey; name: string; at: [string, string, string] }> = [
  { key: 'controversy', name: 'Controversy', at: ['Nothing anyone could object to', 'A cheeky take some will argue with', 'A loud staged fight about the brand itself'] },
  { key: 'cringe', name: 'Cringe', at: ['Polished and careful', 'Knowingly awkward now and then', 'Over the top, self-aware, all in'] },
  { key: 'brainrot', name: 'Brainrot', at: ['Plain sense', 'Internet slang, a meme format or two', 'Absurd, meme-dense, extremely online'] },
  { key: 'hype', name: 'Hype', at: ['Calm and low-key', 'Upbeat, a little suspense', 'Big energy, surprise and awe'] },
  { key: 'salesPush', name: 'Sales push', at: ['Never mentions buying', 'The offer is one line at the end', 'Every post points to the offer'] },
  { key: 'insider', name: 'Insider', at: ['For anyone scrolling past', 'One wink fans will get', 'Running jokes only fans get'] },
  { key: 'usefulness', name: 'Usefulness', at: ['Pure entertainment', 'A tip inside the fun', 'Step-by-step, saves time or money'] },
  { key: 'trendChasing', name: 'Trend chasing', at: ['Evergreen only', 'One trend a week, when it fits', 'Jumps on every trend Rein finds'] },
  { key: 'spice', name: 'Spice', at: ['Family-friendly', 'Mild slang, no swearing', 'Swearing and edgy jokes'] },
];

export type HumorStyle = 'warm' | 'self_deprecating' | 'at_ideas' | 'hard_moments';
export const HUMOR: Array<[HumorStyle, string]> = [
  ['warm', 'Warm, laughing with people'],
  ['self_deprecating', 'Laughing at themselves'],
  ['at_ideas', 'Poking at ideas and trends, never people'],
  ['hard_moments', 'Finding the funny in hard moments'],
];

/** Controversy or spice at 6 or more, or the two summing above 9: the client approves each post. */
export const riskyDials = (d: Dials | null | undefined) => !!d && (d.controversy >= 6 || d.spice >= 6 || d.controversy + d.spice > 9);

/** The anchor for any level: 1 to 2 low, 3 to 5 middle, 6 to 7 high. */
export const anchorFor = (at: [string, string, string], v: number) => (v <= 2 ? at[0] : v >= 6 ? at[2] : at[1]);
