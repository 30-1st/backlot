// Keeps an open app on the newest version (Nov 7, 2026). An installed app on a phone can stay
// open for hours, running the code it loaded then, so fixes shipped since never reach it.
// This looks at the live page now and then and, when a newer build is out, reloads, but only
// at a safe moment: when the app comes back on screen, or while nobody is typing.

const LOOK_EVERY_MS = 5 * 60_000;
const MIN_GAP_MS = 60_000;

/** The build this page is running: the hashed name of its main script. */
function running(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return s ? new URL(s.src, location.href).pathname : null;
}

async function latest(): Promise<string | null> {
  try {
    const html = await fetch('/', { cache: 'no-store', credentials: 'same-origin' }).then((r) => (r.ok ? r.text() : ''));
    return html.match(/\/assets\/index-[\w-]+\.js/)?.[0] ?? null;
  } catch {
    return null; // Offline or a hiccup: try again later.
  }
}

/** True while someone is typing, so a reload never eats their words. */
function busy(): boolean {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) return false;
  if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'file'].includes(el.type))) return true;
  return false;
}

export function keepFresh() {
  const mine = running();
  if (!mine) return;
  let last = Date.now();
  const look = async (cameBack: boolean) => {
    if (Date.now() - last < MIN_GAP_MS) return;
    last = Date.now();
    const now = await latest();
    if (!now || now === mine) return;
    if (cameBack || !busy()) location.reload();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void look(true);
  });
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void look(false);
  }, LOOK_EVERY_MS);
}
