// Invite codes and temporary passwords.
//
// Codes look like BKLT-7KQ2-M9XD: 8 random characters from a 31-character alphabet with
// no look-alikes (no 0, 1, I, L or O), about 40 bits, single use, valid 7 days. Only a
// SHA-256 hash is stored, so a database leak does not leak usable codes.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// Bytes at or above this are skipped, so every character is equally likely.
const LIMIT = 256 - (256 % ALPHABET.length);

function randomChars(n: number): string {
  let out = '';
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) {
      if (b < LIMIT && out.length < n) out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out;
}

/** A fresh invite code, shown to the inviter once. */
export function newInviteCode(): string {
  const c = randomChars(8);
  return `BKLT-${c.slice(0, 4)}-${c.slice(4)}`;
}

/** Uppercase, letters and digits only, without the BKLT prefix, so typing slips do not matter. */
export function normalizeCode(code: string): string {
  const flat = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return flat.startsWith('BKLT') ? flat.slice(4) : flat;
}

/** True when the input could be a code at all (8 characters from the alphabet). */
export function looksLikeCode(code: string): boolean {
  const n = normalizeCode(code);
  return n.length === 8 && [...n].every((ch) => ALPHABET.includes(ch));
}

export async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`backlot-invite:${normalizeCode(code)}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A temporary password a teammate reads out once: 16 characters, about 79 bits. */
export function temporaryPassword(): string {
  const c = randomChars(16);
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}-${c.slice(12)}`;
}
