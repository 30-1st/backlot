import { ROOM_DOOR } from './config';

export type RoomView = {
  state: 'open' | 'preview' | 'closed';
  slug: string;
  handle: string;
  name: string;
  preset: string;
  accent: string;
  greeting: string;
  buttons: Array<{ label: string; url: string }>;
  /** Every approved link, by number, so the assistant's link buttons can point at them. */
  links: Array<{ label: string; url: string } | null>;
  faq: Array<{ q: string; a: string }>;
  hero: { kind: 'photo' | 'video'; url: string } | null;
  ageGate: boolean;
  /** room: chat is live. test: a preview link, paid from the test budget. off: not yet. */
  chat: 'room' | 'test' | 'off';
};

export type Msg = { seq: number; role: 'visitor' | 'kris'; body: string; links: number[]; source: string };

export class DoorError extends Error {
  constructor(message: string, readonly status: number, readonly data: Record<string, unknown> = {}) {
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
    throw new DoorError('This room cannot reach the assistant right now. Check your connection and try again.', 0);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new DoorError(String(data.error ?? (res.status === 404 ? 'private' : 'Something went wrong. Try again.')), res.status, data);
  return data as T;
}

export const openRoom = (slug: string, preview?: string) => call<RoomView>({ action: 'open', slug, preview });
export const verifyVisit = (slug: string, token: string, preview?: string) => call<{ ticket: string; expiresAt: string }>({ action: 'verify', slug, token, preview });
export const chat = (slug: string, ticket: string, text: string, after: number, preview?: string) =>
  call<{ messages: Msg[]; closed?: boolean; deleted?: boolean }>({ action: 'chat', slug, ticket, text, after, preview });
export const history = (slug: string, ticket: string, preview?: string) => call<{ messages: Msg[] }>({ action: 'history', slug, ticket, preview });
export const deleteChat = (slug: string, ticket: string, preview?: string) => call<{ deleted: boolean }>({ action: 'delete', slug, ticket, preview });
/** Counting only; failures are ignored so a tap never feels slow. */
export const tap = (slug: string, kind: 'faq' | 'link', preview?: string, after?: 'handoff') => {
  void call({ action: 'tap', slug, kind, preview, after }).catch(() => undefined);
};
