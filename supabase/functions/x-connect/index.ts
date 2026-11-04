// X's sign-in sends the browser back here after the client says yes (or no) to connecting
// their account. The platform's JWT check is off because X's redirect carries no Backlot
// login; the single-use state made by the bil function's x_connect action is what proves
// who started it (see _shared/x-connect.ts). The answer is always a redirect to the app,
// with one outcome word and nothing else.

import { APP_URL, xConnectFinish } from '../_shared/x-connect.ts';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

Deno.serve(async (req) => {
  if (req.method !== 'GET') return new Response('GET only', { status: 405, headers: HEADERS });
  let to = `${APP_URL}/#xev.failed`;
  try {
    to = await xConnectFinish(new URL(req.url).searchParams);
  } catch (err) {
    console.error('x-connect: failed', err instanceof Error ? err.message.slice(0, 200) : 'unknown');
  }
  return new Response(null, { status: 302, headers: { ...HEADERS, Location: to } });
});
