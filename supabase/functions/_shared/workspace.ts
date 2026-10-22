// Who the signed-in person is inside Backlot's private workspace, read by the server.
//
// Roles (public.workspace_members):
//   owner   the founder; one per workspace
//   team    sees every client, runs Bil and Rein, makes invites, resets passwords
//   client  sees only their own client; approves posts and answers Bil
//
// A workspace is identified by its owner's login ID, which is the owner_id every client
// row already carries. Server code scopes all client data to `workspaceId`.

import { serviceClient } from './spend.ts';

export type Role = 'owner' | 'team' | 'client';

export type Member = {
  userId: string;
  workspaceId: string;
  role: Role;
  /** Set only for clients: the one client they are. */
  clientId: string | null;
};

/** Thrown when someone signed in tries something their role does not allow. */
export class AccessError extends Error {
  constructor(message: string, readonly status = 403) {
    super(message);
    this.name = 'AccessError';
  }
}

/** Reads the person's membership with the server key. Null when they are in no workspace. */
export async function memberOf(userId: string): Promise<Member | null> {
  const { data, error } = await serviceClient()
    .from('workspace_members')
    .select('workspace_id, role, client_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Could not read your membership: ${error.message}`);
  if (!data) return null;
  return { userId, workspaceId: data.workspace_id, role: data.role as Role, clientId: data.client_id };
}

export function isTeam(m: Member): boolean {
  return m.role === 'owner' || m.role === 'team';
}

/** Owner or team only. */
export function requireTeam(m: Member): void {
  if (!isTeam(m)) throw new AccessError('Only your Backlot team can do this.');
}

/** Team may act for any client in the workspace; a client only for themselves. */
export function requireClientAccess(m: Member, clientId: string): void {
  if (isTeam(m)) return;
  if (m.clientId !== clientId) throw new AccessError('That is not your account.');
}
