// Short templated notes from Kris (a campaign finished, a report made, trends saved).
// No AI and no cost; one per event, keyed by ref. Kept apart from kris.ts so functions
// that only leave a note do not load the AI code.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';

export async function krisNote(
  db: SupabaseClient,
  n: { workspaceId: string; clientId: string; ref: string; body: string; link?: string },
): Promise<void> {
  const { error } = await db.from('kris_messages').insert({
    workspace_id: n.workspaceId,
    client_id: n.clientId,
    role: 'kris',
    kind: 'note',
    body: n.body.replace(/\s*—\s*/g, ', ').slice(0, 2000),
    link: n.link ? n.link.slice(0, 80) : null,
    ref: n.ref.slice(0, 120),
  });
  // 23505: that note was already sent. Anything else is logged and never fails the caller.
  if (error && error.code !== '23505') console.error('Kris note failed', n.ref, error.message);
}
