import type { CSSProperties } from 'react';

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
