import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Backlot runs in one of two modes, decided when the site is built:
//
//   hosted   The Supabase address and key are present. Creators sign in, and
//            their accounts, narrations and media are kept on the server.
//   offline  They are blank. No sign-in, everything stays in this browser.

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_KEY;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

/** True when this build talks to Supabase. */
export const hosted = supabase !== null;

/** The signed-in creator's id, or null when signed out or offline. */
export async function currentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}
