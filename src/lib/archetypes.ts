// The six room looks, one per brand archetype. The rooms site keeps its own copy of the
// visuals (rooms/src/archetypes.ts); this list is what the team picks from in Backlot.

export type Archetype = 'ruler' | 'creator' | 'jester' | 'rebel' | 'sage' | 'lover';

export const ARCHETYPES: Array<{ id: Archetype; name: string; fits: string; object: string; accent: string }> = [
  { id: 'ruler', name: 'Ruler', fits: 'Luxury, power, status, findom, premium services', object: 'A gold crown and a turning coin', accent: '#d8b98a' },
  { id: 'creator', name: 'Creator', fits: 'Artists, makers, designers, everyday creators', object: 'A twisting ribbon of paint', accent: '#5b4bff' },
  { id: 'jester', name: 'Jester', fits: 'Comedy, memes, chaotic fun, party brands', object: 'A pair of tumbling dice', accent: '#ffcc1a' },
  { id: 'rebel', name: 'Rebel', fits: 'Streetwear, music, alt scenes, anything loud', object: 'A sharp chrome shard', accent: '#ff3b30' },
  { id: 'sage', name: 'Sage', fits: 'Coaches, educators, finance, wellness, tarot', object: 'Orbiting rings, like an astrolabe', accent: '#8fb3ff' },
  { id: 'lover', name: 'Lover', fits: 'Beauty, fashion, romance, intimate brands', object: 'A glass heart', accent: '#ff5c8a' },
];
