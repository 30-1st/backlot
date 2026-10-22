import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The installed-app helper (public/sw.js). Production hosted builds only: the one-file
// build has no server to fetch it from, and development must never be cached.
if (import.meta.env.PROD && import.meta.env.MODE !== 'single' && import.meta.env.VITE_SUPABASE_URL && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
