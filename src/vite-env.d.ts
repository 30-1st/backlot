/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** The release from package.json, set at build time (vite.config.ts). */
declare const __BACKLOT_VERSION__: string;
