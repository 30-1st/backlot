import { ROOM_DOOR } from './config';

export type RoomView = {
  state: 'open' | 'preview' | 'closed';
  slug: string;
  handle: string;
  name: string;
  preset: 'creator' | 'creator_adult';
  accent: string;
  greeting: string;
  buttons: Array<{ label: string; url: string }>;
  hero: { kind: 'photo' | 'video'; url: string } | null;
  ageGate: boolean;
};

export class DoorError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(ROOM_DOOR, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new DoorError('This room cannot load right now. Check your connection and try again.', 0);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new DoorError(String(data.error ?? (res.status === 404 ? 'private' : 'Something went wrong. Try again.')), res.status);
  return data as T;
}

export const openRoom = (slug: string, preview?: string) => call<RoomView>({ action: 'open', slug, preview });
export const verifyVisit = (slug: string, token: string, preview?: string) =>
  call<{ ticket: string; expiresAt: string }>({ action: 'verify', slug, token, preview });
