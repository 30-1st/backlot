// Which web pages may call Backlot's doors from a browser.
//
// Only Backlot's own site (and each deployment's address under it) and the local test app
// on this computer. Other sites get no CORS permission, so a browser refuses to hand them
// the answer. This is a second lock: every door still checks the login itself.

const SITE = 'backlot-as9.pages.dev';

function allowed(origin: string): boolean {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.protocol === 'https:' && (u.hostname === SITE || u.hostname.endsWith(`.${SITE}`))) return true;
  // The local test app (npm run dev), on any port.
  if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
  return false;
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const base: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  if (origin && allowed(origin)) base['Access-Control-Allow-Origin'] = origin;
  return base;
}

/** Wraps a door so every answer, including the preflight, carries the right CORS headers. */
export function withCors(handle: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    const res = await handle(req);
    const headers = new Headers(res.headers);
    headers.delete('Access-Control-Allow-Origin');
    for (const [k, v] of Object.entries(corsHeaders(req))) headers.set(k, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
