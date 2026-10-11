import type { MediaItem, Post, Sandbox } from './types';

// The example profile a new visitor lands on. Its pictures are drawn here as
// small still lifes so the app ships with no image files and no one's real content.

type Kind = 'vase' | 'bowl' | 'cup' | 'bottle';
interface Vessel {
  kind: Kind;
  x: number;
  w: number;
  h: number;
  fill: string;
}
interface Scene {
  wall: [string, string];
  table: string;
  vessels: Vessel[];
  glow?: [number, number];
  square?: boolean;
}

function outline(v: Vessel, base: number): string {
  const { x, w, h } = v;
  const l = x - w / 2;
  const r = x + w / 2;
  const t = base - h;
  switch (v.kind) {
    case 'bowl':
      return `M${l},${t} C${l},${base - h * 0.1} ${x - w * 0.22},${base} ${x},${base} C${x + w * 0.22},${base} ${r},${base - h * 0.1} ${r},${t} Z`;
    case 'cup':
      return `M${l},${t} L${l + w * 0.08},${base - 12} Q${l + w * 0.1},${base} ${l + w * 0.22},${base} L${r - w * 0.22},${base} Q${r - w * 0.1},${base} ${r - w * 0.08},${base - 12} L${r},${t} Z`;
    case 'vase': {
      const n = w * 0.2;
      return `M${x - n},${t} C${x - n},${t + h * 0.2} ${l},${t + h * 0.3} ${l},${t + h * 0.6} C${l},${base - h * 0.08} ${x - w * 0.3},${base} ${x},${base} C${x + w * 0.3},${base} ${r},${base - h * 0.08} ${r},${t + h * 0.6} C${r},${t + h * 0.3} ${x + n},${t + h * 0.2} ${x + n},${t} Z`;
    }
    case 'bottle': {
      const n = w * 0.16;
      return `M${x - n},${t} L${x - n},${t + h * 0.3} C${x - n},${t + h * 0.42} ${l},${t + h * 0.42} ${l},${t + h * 0.58} L${l},${base - 14} Q${l},${base} ${l + 14},${base} L${r - 14},${base} Q${r},${base} ${r},${base - 14} L${r},${t + h * 0.58} C${r},${t + h * 0.42} ${x + n},${t + h * 0.42} ${x + n},${t + h * 0.3} L${x + n},${t} Z`;
    }
  }
}

const mouth: Record<Kind, number> = { bowl: 1, cup: 1, vase: 0.4, bottle: 0.32 };

function draw(scene: Scene, seed: number): string {
  const W = 800;
  const H = scene.square ? 800 : 1000;
  const tableY = Math.round(H * 0.72);
  const base = tableY + 28;
  const [gx, gy] = scene.glow ?? [0.3, 0.25];

  const vessels = scene.vessels
    .map((v) => {
      const d = outline(v, base);
      const rim = v.w * mouth[v.kind];
      const top = base - v.h;
      return (
        `<ellipse cx="${v.x + v.w * 0.14}" cy="${base + 4}" rx="${v.w * 0.62}" ry="${Math.max(10, v.w * 0.07)}" fill="#000" opacity=".3" filter="url(#soft)"/>` +
        `<path d="${d}" fill="${v.fill}"/><path d="${d}" fill="url(#shade)"/>` +
        `<ellipse cx="${v.x}" cy="${top}" rx="${rim / 2}" ry="${Math.max(4, rim * 0.085)}" fill="${v.fill}"/>` +
        `<ellipse cx="${v.x}" cy="${top}" rx="${rim / 2 - 4}" ry="${Math.max(2, rim * 0.085 - 3)}" fill="#000" opacity=".34"/>`
      );
    })
    .join('');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<defs>` +
    `<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${scene.wall[0]}"/><stop offset="1" stop-color="${scene.wall[1]}"/></linearGradient>` +
    `<radialGradient id="glow" cx="${gx}" cy="${gy}" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".36"/></linearGradient>` +
    `<linearGradient id="fall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient>` +
    `<filter id="soft" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="12"/></filter>` +
    `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="${seed}"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  .16 0 0 0 0"/></filter>` +
    `</defs>` +
    `<rect width="${W}" height="${H}" fill="url(#wall)"/>` +
    `<rect width="${W}" height="${H}" fill="url(#glow)"/>` +
    `<rect y="${tableY}" width="${W}" height="${H - tableY}" fill="${scene.table}"/>` +
    `<rect y="${tableY}" width="${W}" height="${H - tableY}" fill="url(#fall)"/>` +
    `<rect y="${tableY}" width="${W}" height="2" fill="#fff" opacity=".14"/>` +
    vessels +
    `<rect width="${W}" height="${H}" filter="url(#grain)"/>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const scenes: Scene[] = [
  /* 0 */ { wall: ['#d9d2c3', '#c4bba8'], table: '#8a7a66', vessels: [{ kind: 'vase', x: 400, w: 230, h: 430, fill: '#ece5d6' }] },
  /* 1 */ { wall: ['#3b4a45', '#2a3632'], table: '#1c2421', glow: [0.7, 0.2], vessels: [{ kind: 'bowl', x: 320, w: 330, h: 150, fill: '#c9b08a' }, { kind: 'cup', x: 580, w: 130, h: 150, fill: '#e6ddcb' }] },
  /* 2 */ { wall: ['#c9a48c', '#b58a70'], table: '#6e4f3e', vessels: [{ kind: 'bottle', x: 290, w: 150, h: 470, fill: '#f0e6d6' }, { kind: 'bowl', x: 530, w: 270, h: 120, fill: '#3c3a36' }] },
  /* 3 */ { wall: ['#e7e3da', '#d6d0c2'], table: '#b9ae98', vessels: [{ kind: 'cup', x: 230, w: 130, h: 150, fill: '#5d6b63' }, { kind: 'cup', x: 400, w: 130, h: 150, fill: '#c98f6b' }, { kind: 'cup', x: 570, w: 130, h: 150, fill: '#efe6d2' }] },
  /* 4 */ { wall: ['#22283a', '#161a27'], table: '#0e111a', glow: [0.25, 0.3], vessels: [{ kind: 'vase', x: 420, w: 270, h: 390, fill: '#d7c08d' }] },
  /* 5 */ { wall: ['#b8c1b0', '#9ea996'], table: '#5f6a58', vessels: [{ kind: 'bowl', x: 400, w: 440, h: 200, fill: '#f1ece0' }] },
  /* 6 */ { wall: ['#e2c9a6', '#d2b58c'], table: '#8b6c48', glow: [0.75, 0.25], vessels: [{ kind: 'bottle', x: 280, w: 125, h: 410, fill: '#2f3a36' }, { kind: 'vase', x: 510, w: 210, h: 310, fill: '#f3ead9' }] },
  /* 7 */ { wall: ['#4a3b36', '#332824'], table: '#1f1816', vessels: [{ kind: 'cup', x: 400, w: 210, h: 230, fill: '#e8d9c0' }] },
  /* 8 */ { wall: ['#d5dadd', '#bfc6ca'], table: '#7c868c', vessels: [{ kind: 'vase', x: 300, w: 190, h: 370, fill: '#2c3440' }, { kind: 'bowl', x: 550, w: 250, h: 115, fill: '#eeeae0' }] },
  /* 9 */ { wall: ['#cdb7a7', '#bda390'], table: '#7d6253', glow: [0.6, 0.2], vessels: [{ kind: 'bowl', x: 290, w: 290, h: 135, fill: '#f0e8da' }, { kind: 'bowl', x: 550, w: 210, h: 105, fill: '#a8563c' }] },
  /* 10 */ { wall: ['#2f3b33', '#232c26'], table: '#141a16', vessels: [{ kind: 'bottle', x: 400, w: 175, h: 490, fill: '#e3d3ad' }] },
  /* 11 */ { wall: ['#ebe6dc', '#ddd6c8'], table: '#a59a86', vessels: [{ kind: 'cup', x: 310, w: 155, h: 175, fill: '#3a4a44' }, { kind: 'cup', x: 500, w: 155, h: 175, fill: '#c9a45a' }] },
  /* 12 */ { wall: ['#c7cfc4', '#aab5a6'], table: '#6b7867', glow: [0.7, 0.3], vessels: [{ kind: 'vase', x: 250, w: 150, h: 260, fill: '#f1ece0' }, { kind: 'vase', x: 420, w: 190, h: 360, fill: '#d9cdb4' }, { kind: 'vase', x: 600, w: 140, h: 220, fill: '#8a9a8c' }] },
  /* 13 */ { wall: ['#e6d6c6', '#d6c2ad'], table: '#9a7f66', vessels: [{ kind: 'bowl', x: 400, w: 360, h: 160, fill: '#33413c' }] },
  /* 14: avatar */ { wall: ['#2a3632', '#1e2824'], table: '#131a17', square: true, glow: [0.35, 0.3], vessels: [{ kind: 'vase', x: 400, w: 300, h: 380, fill: '#e3d3ad' }] },
];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function makeExample(now = Date.now()): Sandbox {
  const media: Record<string, MediaItem> = {};
  scenes.forEach((scene, i) => {
    const id = `example_${i}`;
    media[id] = { id, kind: 'image', src: draw(scene, i + 3) };
  });
  const m = (i: number) => `example_${i}`;

  const post = (id: string, shots: number[], offset: number, caption: string, extra: Partial<Post> = {}): Post => ({
    id,
    media: shots.map(m),
    caption,
    location: '',
    date: now + offset,
    draft: false,
    pinnedAt: null,
    likes: 0,
    comments: 0,
    ...extra,
  });

  const posts: Post[] = [
    post('ex_draft', [13], 6 * DAY, 'Working title: the ink bowl. Not sure this one makes the cut.', { draft: true }),
    post('ex_sched2', [12], 4 * DAY + 3 * HOUR, 'Three heights, one glaze. The full bud vase set lands Friday at 10.', { location: 'Fieldnote Studio' }),
    post('ex_sched1', [4], 1 * DAY + 5 * HOUR, 'Kiln opens Friday. This one is going first.'),
    post('ex_1', [0], -1 * DAY - 2 * HOUR, 'The tall bone vase is back on the shelf. Twelve made, each a little different at the shoulder.', { likes: 2841, comments: 96, pinnedAt: now - 20 * DAY }),
    post('ex_2', [1, 5, 9], -3 * DAY, 'Breakfast set, three ways. Swipe for the sage serving bowl.', { likes: 1920, comments: 54, location: 'Fieldnote Studio' }),
    post('ex_3', [2], -6 * DAY - 4 * HOUR, 'Clay rose wall, cream bottle, charcoal bowl. Shot at 4pm when the light comes in low.', { likes: 3312, comments: 121 }),
    post('ex_4', [3], -9 * DAY, 'Espresso cups in moss, clay and oat. Which one is yours?', { likes: 4105, comments: 388 }),
    post('ex_5', [6], -13 * DAY - 6 * HOUR, 'A bottle for oil and a vase for whatever is growing by the door.', { likes: 1477, comments: 31 }),
    post('ex_6', [7], -17 * DAY, 'One mug. Took eleven tries to get the lip right.', { likes: 2260, comments: 73 }),
    post('ex_7', [8], -22 * DAY - 3 * HOUR, 'Slate blue is staying in the line for winter.', { likes: 1688, comments: 40 }),
    post('ex_8', [10], -27 * DAY, 'The tall one. 38cm, wheel thrown in two parts.', { likes: 2954, comments: 88 }),
    post('ex_9', [11], -33 * DAY - 5 * HOUR, 'Pairs go out together. Moss and brass.', { likes: 1203, comments: 27 }),
  ];

  return {
    version: 1,
    isExample: true,
    profile: {
      username: 'fieldnote.ceramics',
      name: 'Fieldnote Ceramics',
      category: 'Artist',
      bio: 'Small-batch stoneware, thrown in a garage studio.\nKiln opens the first Friday of every month.',
      link: 'fieldnote.example/shop',
      avatar: m(14),
      followers: 48213,
      following: 412,
      postCount: 214,
    },
    highlights: [
      { id: 'ex_h1', title: 'Kiln days', cover: m(4) },
      { id: 'ex_h2', title: 'Process', cover: m(7) },
      { id: 'ex_h3', title: 'Restocks', cover: m(3) },
      { id: 'ex_h4', title: 'Your tables', cover: m(9) },
    ],
    posts,
    media,
    settings: { lighting: 'light', tile: 'portrait' },
  };
}
