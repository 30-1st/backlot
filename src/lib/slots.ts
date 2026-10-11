import type { Sandbox, SavePoint } from '../types';
import { PLATFORMS, type Platform } from '../platforms';
import { referencedMedia } from '../state';
import { kvGet, kvSet } from './db';

// Each platform keeps its own profile and its own save point.
// This file is the one place that knows where they are stored, so moving them
// to hosted accounts later means changing these functions and nothing else.

const sandboxKey = (p: Platform) => `sandbox:${p}`;
const savePointKey = (p: Platform) => `savePoint:${p}`;

const isSandbox = (v: unknown): v is Sandbox => !!v && (v as Sandbox).version === 1;
const isSavePoint = (v: unknown): v is SavePoint => !!v && isSandbox((v as SavePoint).sandbox);

export interface Slot {
  sandbox?: Sandbox;
  savePoint?: SavePoint;
}

export async function loadSlot(platform: Platform): Promise<Slot> {
  let sandbox = await kvGet<unknown>(sandboxKey(platform));
  let savePoint = await kvGet<unknown>(savePointKey(platform));

  // Before profiles were kept per platform there was a single Instagram-style
  // sandbox. Carry it over the first time so nobody loses their work.
  if (platform === 'instagram' && !isSandbox(sandbox)) {
    const old = await kvGet<unknown>('sandbox');
    if (isSandbox(old)) {
      sandbox = old;
      await kvSet(sandboxKey(platform), old);
      const oldPoint = await kvGet<unknown>('savePoint');
      if (!isSavePoint(savePoint) && isSavePoint(oldPoint)) {
        savePoint = oldPoint;
        await kvSet(savePointKey(platform), oldPoint);
      }
    }
  }

  return {
    sandbox: isSandbox(sandbox) ? sandbox : undefined,
    savePoint: isSavePoint(savePoint) ? savePoint : undefined,
  };
}

export function saveSandbox(platform: Platform, sandbox: Sandbox): Promise<void> {
  return kvSet(sandboxKey(platform), sandbox);
}

export function saveSavePoint(platform: Platform, point: SavePoint): Promise<void> {
  return kvSet(savePointKey(platform), point);
}

/** Media that the other platforms' profiles and save points still use, so cleanup leaves it alone. */
export async function mediaInOtherSlots(except: Platform): Promise<Set<string>> {
  const keep = new Set<string>();
  for (const { id } of PLATFORMS) {
    if (id === except) continue;
    const sandbox = await kvGet<unknown>(sandboxKey(id));
    const point = await kvGet<unknown>(savePointKey(id));
    if (isSandbox(sandbox)) for (const m of referencedMedia(sandbox)) keep.add(m);
    if (isSavePoint(point)) for (const m of referencedMedia(point.sandbox)) keep.add(m);
  }
  return keep;
}

export interface SlotSummary {
  /** True once the creator has brought in their own profile. */
  own: boolean;
  username: string;
}

/** Just enough about a saved profile to label it on the homescreen. */
export async function summarize(platform: Platform): Promise<SlotSummary | null> {
  try {
    const { sandbox } = await loadSlot(platform);
    if (!sandbox) return null;
    return { own: !sandbox.isExample, username: sandbox.profile.username };
  } catch {
    return null;
  }
}
