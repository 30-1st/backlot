import { useId, type CSSProperties } from 'react';

// Backlot's own icon set, drawn in the ripple and signal language of the brand.
// All are 26 by 26, stroke in the current text colour, and hidden from screen readers
// (the button or link that holds one carries the name).

type P = { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 26 26',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

/** Home: a rail with a live node and ripples spreading from it. */
export function Signal({ size = 26 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M7 3.5v19" />
      <circle cx="7" cy="9" r="2.4" fill="currentColor" stroke="none" />
      <path d="M12 6.2a4.2 4.2 0 0 1 0 5.6" />
      <path d="M15.6 3.8a8 8 0 0 1 0 10.4" />
      <path d="M7 18.5h11.5" />
    </svg>
  );
}

/** Library: stacked media frames. */
export function Vault({ size = 26 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M8.5 4.5h10a3 3 0 0 1 3 3v10" />
      <rect x="4.5" y="8.5" width="13" height="13" rx="3" />
      <path d="M4.5 18l4-3.2 3 2.2 3.4-3 2.6 2.2" />
      <circle cx="13.5" cy="12.3" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Bil: a wave rising over the horizon, a post climbing the algorithm. */
export function Rise({ size = 28 }: P) {
  return (
    <svg {...base(size)} strokeWidth={1.8}>
      <path d="M4 17h18" />
      <path d="M8.5 17a4.5 4.5 0 0 1 9 0" />
      <path d="M5.6 12.6a8.6 8.6 0 0 1 14.8 0" opacity=".55" />
      <circle cx="13" cy="17" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Campaigns: a run of posts climbing. */
export function Sequence({ size = 26 }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="5" cy="20" r="2" />
      <circle cx="13" cy="13" r="2" />
      <circle cx="21" cy="6" r="2" />
      <path d="M6.6 18.6l4.8-4.2M14.6 11.6l4.8-4.2" />
      <path d="M23.6 2.8a5 5 0 0 1-.4 6.6" opacity=".55" />
    </svg>
  );
}

/** Insights: the 24 hour dial with its best window lit. */
export function Dial({ size = 26 }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="13" cy="13" r="9" opacity=".35" />
      <path d="M13 4a9 9 0 0 1 9 9" strokeWidth={2.6} />
      <circle cx="13" cy="13" r="1.8" fill="currentColor" stroke="none" />
      <path d="M13 13l4-4" />
    </svg>
  );
}

/** Narrate: a frame with lines of story beside it. */
export function Narrate({ size = 28 }: P) {
  return (
    <svg {...base(size)}>
      <rect x="3.5" y="5.5" width="13" height="15" rx="3" />
      <path d="M7 16l2.6-2.2 2.2 1.6 2.4-2.2" />
      <path d="M19.5 8h3M19.5 12h3M19.5 16h2" />
    </svg>
  );
}

/** Trends: a line rising to a lit point. */
export function Rising({ size = 28 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M3 20c4 0 5-4 8-4s4 3 6 3 3-7 6-13" />
      <circle cx="23" cy="6" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Night: a crescent with a small star. */
export function Moon({ size = 20 }: P) {
  return (
    <svg {...base(size)} viewBox="0 0 24 24" strokeWidth={1.7}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      <path d="M17 3.5v3M15.5 5h3" />
    </svg>
  );
}

/** Light: a sun rising over the horizon line, matching Rise. */
export function Sun({ size = 20 }: P) {
  return (
    <svg {...base(size)} viewBox="0 0 24 24" strokeWidth={1.7}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
    </svg>
  );
}

export function Back({ size = 20 }: P) {
  return (
    <svg {...base(size)} viewBox="0 0 24 24" strokeWidth={1.8}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function Chevron({ size = 14 }: P) {
  return (
    <svg {...base(size)} viewBox="0 0 24 24" strokeWidth={2}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function Arrow({ size = 18 }: P) {
  return (
    <svg {...base(size)} viewBox="0 0 24 24" strokeWidth={2}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function Check({ size = 12 }: P) {
  return (
    <svg {...base(size)} viewBox="0 0 24 24" strokeWidth={3}>
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

/** Concentric rings for dark cards and the welcome screen. */
export function Rings({ size, style, dashed = true }: { size: number; style?: CSSProperties; dashed?: boolean }) {
  const c = size / 2;
  return (
    <svg className="bl-rings" width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" aria-hidden="true" style={style}>
      <circle cx={c} cy={c} r={size * 0.16} stroke="var(--accent)" strokeWidth="1.2" opacity="0.7" />
      <circle
        className={dashed ? 'bl-spin' : undefined}
        cx={c}
        cy={c}
        r={size * 0.3}
        stroke="var(--accent)"
        strokeWidth="1"
        opacity="0.5"
        strokeDasharray={dashed ? '3 8' : undefined}
      />
      <circle cx={c} cy={c} r={size * 0.46} stroke="var(--accent)" strokeWidth="1" opacity="0.2" />
    </svg>
  );
}

/* ---------- Room and tool icons: objects from a film set, lit from above ----------
 * Each has a shaded body (light at the top, darker below), a solid part that gives it
 * weight, and a thin bright line along its top edge where the light catches it.
 * 32 by 32, drawn in the current text colour. */

const lit = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 32 32',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  className: 'bl-lit',
});

/** A gradient id that is safe inside url(#...). */
function useSvgId(): string {
  return 'bl' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
}

function Shade({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="currentColor" stopOpacity=".04" />
        <stop offset="1" stopColor="currentColor" stopOpacity=".32" />
      </linearGradient>
    </defs>
  );
}

function star(cx: number, cy: number, R: number, r: number): string {
  const pts: string[] = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rad = k % 2 === 0 ? R : r;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join(' L')}Z`;
}
const STAR = star(16, 12.4, 3.6, 1.55);

/** Team: a clapperboard, for the crew that makes it. */
export function Clapper({ size = 36 }: P) {
  const id = useSvgId();
  return (
    <svg {...lit(size)}>
      <Shade id={id} />
      <rect x="5" y="14.5" width="22" height="12.5" rx="2" fill={`url(#${id})`} />
      <path d="M5 19h22" />
      <path d="M5.4 14.3 25.2 9.1l.9 3.4L6.3 17.7z" fill="currentColor" stroke="none" />
      <path className="bl-edge" d="M6.6 13.6 24.6 8.9" />
    </svg>
  );
}

/** Client: a dressing-room door with a star, for the talent. */
export function StarDoor({ size = 36 }: P) {
  const id = useSvgId();
  return (
    <svg {...lit(size)}>
      <Shade id={id} />
      <path d="M9 27V7.5A2.5 2.5 0 0 1 11.5 5h9A2.5 2.5 0 0 1 23 7.5V27z" fill={`url(#${id})`} />
      <path d="M5.5 27h21" />
      <path d={STAR} fill="currentColor" stroke="none" />
      <circle cx="20" cy="19" r=".9" fill="currentColor" stroke="none" />
      <path className="bl-edge" d="M11 5.9h10" />
    </svg>
  );
}

const HOLES = [0, 1, 2, 3, 4].map((k) => {
  const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
  return [16 + 5.6 * Math.cos(a), 16 + 5.6 * Math.sin(a)];
});

/** Playground: a film reel, for stories you play with. */
export function Reel({ size = 36 }: P) {
  const id = useSvgId();
  return (
    <svg {...lit(size)}>
      <Shade id={id} />
      <circle cx="16" cy="16" r="10.5" fill={`url(#${id})`} />
      {HOLES.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.9" fill="currentColor" stroke="none" opacity=".85" />
      ))}
      <circle cx="16" cy="16" r="1.1" fill="currentColor" stroke="none" />
      <path d="M16 26.5h11.5" />
      <path className="bl-edge" d="M8.6 9.4A10 10 0 0 1 23.4 9.4" />
    </svg>
  );
}

/** Narrate Instagram: a page of lines. */
export function Page({ size = 36 }: P) {
  const id = useSvgId();
  return (
    <svg {...lit(size)}>
      <Shade id={id} />
      <rect x="6" y="5" width="20" height="22" rx="4" fill={`url(#${id})`} />
      <path d="M11 12h10M11 16h10M11 20h6" />
      <path className="bl-edge" d="M9 5.8h14" />
    </svg>
  );
}

/** Narrate X: a speech bubble. */
export function Bubble({ size = 36 }: P) {
  const id = useSvgId();
  return (
    <svg {...lit(size)}>
      <Shade id={id} />
      <path
        d="M6 8.5A2.5 2.5 0 0 1 8.5 6h15A2.5 2.5 0 0 1 26 8.5v10a2.5 2.5 0 0 1-2.5 2.5H14l-6 5v-5H8.5A2.5 2.5 0 0 1 6 18.5z"
        fill={`url(#${id})`}
      />
      <path d="M11 11.5h10M11 15.5h7" />
      <path className="bl-edge" d="M9 6.8h14" />
    </svg>
  );
}

/** Rein: a radar with its sweep. */
export function Radar({ size = 36 }: P) {
  const id = useSvgId();
  return (
    <svg {...lit(size)}>
      <Shade id={id} />
      <circle cx="16" cy="16" r="10.5" fill={`url(#${id})`} />
      <circle cx="16" cy="16" r="5.5" />
      <path d="M16 16 24.2 9.4A10.5 10.5 0 0 0 16 5.5z" fill="currentColor" stroke="none" opacity=".9" />
      <circle cx="16" cy="16" r="1.2" fill="currentColor" stroke="none" />
      <path className="bl-edge" d="M8.6 9.4A10 10 0 0 1 16 6" />
    </svg>
  );
}

/** Home: a house. */
export function House({ size = 20 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 11l8-6.5 8 6.5" />
      <path d="M6.5 9.5V19h11V9.5" />
    </svg>
  );
}

/** Clients: two people. */
export function People({ size = 26 }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="9.5" cy="9" r="3.5" />
      <path d="M3.5 21a6 6 0 0 1 12 0" />
      <path d="M17 5.6a3.4 3.4 0 0 1 0 6.8M19 15.4a6 6 0 0 1 3.5 5.6" />
    </svg>
  );
}
