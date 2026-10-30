// Who the signed-in person is inside Backlot's private workspace, read by the server.
//
// Roles (public.workspace_members):
//   owner   the executive; one per workspace; sees every client, grants access, and is
//           the only one who resets other people's passwords
//   team    sees the clients the owner granted them (client_access), runs Bil and Rein
//           for those clients, makes invites
//   client  sees only their own client; approves posts and answers Bil
//   visitor signed up without an invite to save narrations; the Playground only, no
//           client data, no Bil, no chats or sharing
//
// A workspace is identified by its owner's login ID, which is the owner_id every client
// row already carries. Server code scopes all client data to `workspaceId`.

import { serviceClient } from './spend.ts';

export type Role = 'owner' | 'team' | 'client' | 'visitor';

export type Member = {
  userId: string;
  workspaceId: string;
  role: Role;
  /** Set only for clients: the one client they are. */
  clientId: string | null;
  /** True right after a team password reset, until they choose their own. */
  mustChangePassword: boolean;
  /** Team members only: the clients the executive granted. Null for the owner (all) and clients. */
  granted: Set<string> | null;
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
  const db = serviceClient();
  const [{ data, error }, { data: me }] = await Promise.all([
    db.from('workspace_members').select('workspace_id, role, client_id').eq('user_id', userId).maybeSingle(),
    db.from('members').select('must_change_password').eq('id', userId).maybeSingle(),
  ]);
  if (error) throw new Error(`Could not read your membership: ${error.message}`);
  if (!data) return null;
  let granted: Set<string> | null = null;
  if (data.role === 'team') {
    const { data: rows, error: gError } = await db.from('client_access').select('client_id').eq('member_id', userId);
    if (gError) throw new Error(`Could not read your client access: ${gError.message}`);
    granted = new Set((rows ?? []).map((r: { client_id: string }) => r.client_id));
  }
  return {
    userId,
    workspaceId: data.workspace_id,
    role: data.role as Role,
    clientId: data.client_id,
    mustChangePassword: me?.must_change_password ?? false,
    granted,
  };
}

/** True when this person may see this client: the owner always, team when granted, a client for themselves. */
export function seesClient(m: Member, clientId: string): boolean {
  if (m.role === 'owner') return true;
  if (m.role === 'team') return m.granted?.has(clientId) ?? false;
  return m.clientId === clientId;
}

export function isTeam(m: Member): boolean {
  return m.role === 'owner' || m.role === 'team';
}

/** After a team reset, nothing works until the person picks their own password. */
export function requireOwnPassword(m: Member): void {
  if (m.mustChangePassword) throw new AccessError('Pick a new password first.');
}

/** Owner or team only. */
export function requireTeam(m: Member): void {
  if (!isTeam(m)) throw new AccessError('Only your Backlot team can do this.');
}

/** The owner may act for any client; team only for granted clients; a client only for themselves. */
export function requireClientAccess(m: Member, clientId: string): void {
  if (seesClient(m, clientId)) return;
  throw new AccessError(isTeam(m) ? 'The executive has not given you access to this client.' : 'That is not your account.');
}
