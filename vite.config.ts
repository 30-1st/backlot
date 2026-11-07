import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import pkg from './package.json' with { type: 'json' };

// `npm run build` makes the normal multi-file site in dist/.
// `npm run build:single` packs everything into one dist-single/index.html.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  // The release, shown on Account, so a screenshot always says which version it came from.
  define: { __BACKLOT_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
}));
