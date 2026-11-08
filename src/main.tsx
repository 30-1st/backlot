import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ThemeProvider } from './shell/theme';
import { Stagehand } from './shell/Stagehand';
import { dressSplash } from './lib/splash';
import { keepFresh } from './lib/fresh';
import './styles.css';

dressSplash();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ThemeProvider>
      <App />
      <Stagehand />
    </ThemeProvider>
  </StrictMode>,
);

// The installed-app helper (public/sw.js). Production hosted builds only: the one-file
// build has no server to fetch it from, and development must never be cached.
if (import.meta.env.PROD && import.meta.env.MODE !== 'single' && import.meta.env.VITE_SUPABASE_URL && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
  // A tapped notification opens its screen in the app that is already open.
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { type?: unknown; path?: unknown } | null;
    if (d?.type === 'backlot-go' && typeof d.path === 'string' && /^[A-Za-z0-9._-]{0,160}$/.test(d.path)) window.location.hash = d.path;
  });
}

// An app left open picks up new versions on its own (lib/fresh.ts). Hosted builds only.
if (import.meta.env.PROD && import.meta.env.MODE !== 'single' && import.meta.env.VITE_SUPABASE_URL) keepFresh();
