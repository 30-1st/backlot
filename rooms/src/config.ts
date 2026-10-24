// Where the rooms site sends requests, and its public bot-check key.

/** The one door this site may call (see supabase/functions/room). */
export const ROOM_DOOR = 'https://hfmszquugwbfxsndpcao.supabase.co/functions/v1/room';

/**
 * Turnstile's site key is public by design. It comes from the Pages build setting
 * VITE_TURNSTILE_SITE_KEY. Local test runs use Cloudflare's published test key, which
 * always passes; production never falls back to it.
 */
export const TURNSTILE_SITE_KEY: string | null =
  import.meta.env.VITE_TURNSTILE_SITE_KEY || (import.meta.env.DEV ? '1x00000000000000000000AA' : null);
