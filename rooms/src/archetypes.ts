// The six room looks, one per brand archetype. Each sets the light, the type, the
// marks that twinkle, the 3D object and how it moves. The client's accent color sits
// on top of every one.

export type Archetype = 'ruler' | 'creator' | 'jester' | 'rebel' | 'sage' | 'lover';

export type Look = {
  id: Archetype;
  dark: boolean;
  /** Base colors; "tint" mixes the accent into the background. */
  bg: string;
  tint: number;
  ink: string;
  muted: string;
  display: 'serif' | 'serif-italic' | 'grotesk' | 'grotesk-wide' | 'mono';
  glyphs: string[];
  object: 'crown' | 'ribbon' | 'dice' | 'shard' | 'rings' | 'heart';
  /** Idle turn in radians a second, and how far it bobs. */
  spin: number;
  bob: number;
  metal: number;
  rough: number;
  placeholder: (name: string) => string;
};

export const LOOKS: Record<Archetype, Look> = {
  ruler: {
    id: 'ruler', dark: true, bg: '#13080c', tint: 0.04, ink: '#f3e9de', muted: '#bfae9f',
    display: 'serif', glyphs: ['✦', '◆', '·'], object: 'crown', spin: 0.22, bob: 0.06, metal: 1, rough: 0.28,
    placeholder: (n) => `Ask Kris about ${n}`,
  },
  creator: {
    id: 'creator', dark: false, bg: '#fbfbff', tint: 0.1, ink: '#16131f', muted: '#575170',
    display: 'grotesk', glyphs: ['*', '✳', '·'], object: 'ribbon', spin: 0.35, bob: 0.08, metal: 0.2, rough: 0.35,
    placeholder: (n) => `Ask Kris what ${n} is making`,
  },
  jester: {
    id: 'jester', dark: false, bg: '#fffdf2', tint: 0.55, ink: '#141210', muted: '#3d3830',
    display: 'grotesk-wide', glyphs: ['+', '✶', '○'], object: 'dice', spin: 0.6, bob: 0.14, metal: 0, rough: 0.45,
    placeholder: (n) => `Ask Kris something about ${n}`,
  },
  rebel: {
    id: 'rebel', dark: false, bg: '#e4e4e0', tint: 0.02, ink: '#0e0e0e', muted: '#4b4b48',
    display: 'mono', glyphs: ['/', '×', '#'], object: 'shard', spin: 0.45, bob: 0.05, metal: 0.9, rough: 0.18,
    placeholder: (n) => `Ask Kris about ${n}`,
  },
  sage: {
    id: 'sage', dark: true, bg: '#0a1124', tint: 0.05, ink: '#e8eefc', muted: '#9fb0d6',
    display: 'serif-italic', glyphs: ['✧', '·', '∘'], object: 'rings', spin: 0.18, bob: 0.04, metal: 0.8, rough: 0.3,
    placeholder: (n) => `Ask Kris what ${n} knows`,
  },
  lover: {
    id: 'lover', dark: false, bg: '#fff8fa', tint: 0.12, ink: '#2a0f19', muted: '#6d4a57',
    display: 'serif-italic', glyphs: ['♡', '·', '✧'], object: 'heart', spin: 0.28, bob: 0.07, metal: 0.1, rough: 0.12,
    placeholder: (n) => `Ask Kris about ${n}`,
  },
};

export const lookFor = (preset: string): Look => LOOKS[(preset in LOOKS ? preset : 'creator') as Archetype];

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c: number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
export const mix = (a: string, b: string, t: number) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));

/** WCAG contrast between two colors. */
export function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const c = hex(h).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** The page colors for a look and an accent, with text that always reads. */
export function paletteFor(look: Look, accent: string) {
  const bg = mix(look.bg, accent, look.tint);
  const onAccent = contrast(accent, '#121218') >= contrast(accent, '#ffffff') ? '#121218' : '#ffffff';
  // The accent as text: pushed toward the ink until it reads on the background.
  let accentText = accent;
  for (let t = 0; t < 1 && contrast(accentText, bg) < 4.5; t += 0.1) accentText = mix(accent, look.ink, t);
  return { bg, ink: look.ink, muted: look.muted, accent, onAccent, accentText, surface: mix(bg, look.dark ? '#ffffff' : '#000000', look.dark ? 0.06 : 0.035), line: mix(bg, look.ink, 0.16) };
}
