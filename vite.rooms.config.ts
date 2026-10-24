import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The rooms site (K1): a separate small app for client rooms, on its own address.
// `npm run build:rooms` makes dist-rooms/, which the second Cloudflare Pages site serves.
// It shares no code with the Backlot app: no login, no Supabase library, no offline helper.
export default defineConfig({
  root: 'rooms',
  publicDir: 'public',
  plugins: [react()],
  build: { outDir: '../dist-rooms', emptyOutDir: true, assetsInlineLimit: 0 },
  server: { port: 5199 },
});
