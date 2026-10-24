// Loads Cloudflare Turnstile only when it is needed, and renders one widget.

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loading: Promise<Turnstile> | null = null;

function load(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('no turnstile')));
    s.onerror = () => {
      loading = null;
      reject(new Error('blocked'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Shows the check in `el`; resolves with a one-time token, rejects if it cannot run here. */
export async function runCheck(el: HTMLElement, siteKey: string, theme: 'light' | 'dark'): Promise<string> {
  const t = await load();
  return await new Promise<string>((resolve, reject) => {
    const id = t.render(el, {
      sitekey: siteKey,
      action: 'room',
      theme,
      appearance: 'interaction-only',
      callback: (token: string) => resolve(token),
      'error-callback': () => {
        t.remove(id);
        reject(new Error('failed'));
      },
      'unsupported-callback': () => reject(new Error('unsupported')),
      'timeout-callback': () => reject(new Error('timeout')),
    });
  });
}
