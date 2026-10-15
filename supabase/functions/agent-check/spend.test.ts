// Run: AGENT_ADMIN_TOKEN=<token> deno run -A supabase/functions/agent-check/spend.test.ts
// Fakes Supabase RPC (with the same cap rules as the SQL), X, xAI and Langfuse; runs agent-check three ways.
const ledger: any[] = []; let nextId = 1;
const caps: Record<string, number> = { month: 5, check: 0.05 };
const counted = (r: any) => r.status === 'released' ? 0 : r.status === 'settled' ? r.cost : r.estimate;
let xStatus = 200; let grokCalls = 0; let checkCap = 0.05; let grokMode: 'ok' | '429' | 'hang' = 'ok';
globalThis.fetch = async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('http://fake.supa/rest/v1/rpc/')) {
    const fn = url.split('/rpc/')[1].split('?')[0]; const a = JSON.parse(init.body || '{}');
    if (fn === 'agent_spend_reserve') {
      caps.check = checkCap;
      const month = ledger.reduce((s, r) => s + counted(r), 0), run = ledger.filter((r) => r.run === a.run).reduce((s, r) => s + counted(r), 0);
      if (month + a.estimate > caps.month) return Response.json({ ok: false, reason: 'month', used: month, cap: caps.month });
      if (run + a.estimate > caps[a.agent]) return Response.json({ ok: false, reason: 'run', used: run, cap: caps[a.agent] });
      const row = { id: nextId++, run: a.run, agent: a.agent, kind: a.kind, estimate: a.estimate, status: 'reserved', cost: null, trace: a.trace }; ledger.push(row);
      return Response.json({ ok: true, id: row.id });
    }
    if (fn === 'agent_spend_settle') {
      // Mirrors private.spend_settle: same kind + resource already billed today settles at $0.
      const r = ledger.find((x) => x.id === a.reservation); let cost = a.cost; const res = a.detail?.resource;
      if (res && cost > 0 && ledger.some((x) => x !== r && x.kind === r.kind && x.status === 'settled' && x.cost > 0 && x.detail?.resource === res)) { cost = 0; a.detail.deduped = true; }
      r.status = cost === null ? 'released' : 'settled'; r.cost = cost; r.detail = a.detail; return new Response(null, { status: 204 });
    }
    if (fn === 'agent_spend_summary') return Response.json({ month_used: ledger.reduce((s, r) => s + counted(r), 0) });
  }
  if (url.includes('/api/public/projects')) return new Response('{}', { status: 200 });
  if (url.includes('/api/public/otel')) return new Response('{}', { status: 200 });
  if (url.startsWith('https://api.x.com/')) return xStatus === 200
    ? Response.json({ data: { username: 'XDevelopers', name: 'Developers', verified: true, public_metrics: { followers_count: 698636, tweet_count: 4377 } } })
    : Response.json({ title: 'Payment Required' }, { status: xStatus });
  if (url.startsWith('https://api.x.ai/')) {
    grokCalls++; const req = JSON.parse(init.body);
    if (grokMode === '429') return Response.json({ error: { message: 'rate limited' } }, { status: 429 });
    if (grokMode === 'hang') return await new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal.reason)));
    return Response.json({ id: 'r', object: 'response', created_at: 1, model: req.model, status: 'completed',
      output: [{ type: 'message', id: 'm', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'It has 698636 followers.', annotations: [] }] }],
      usage: { input_tokens: 238, output_tokens: 573, total_tokens: 811, input_tokens_details: { cached_tokens: 128 }, output_tokens_details: { reasoning_tokens: 500 } } });
  }
  throw new Error('unexpected fetch ' + url);
};
for (const [k, v] of Object.entries({ 'xai api key': 'xai-t', 'bearer token': 'AAAAt', 'langfuse public key': 'pk-lf-t', 'langfuse secret key': 'sk-lf-t', SUPABASE_URL: 'http://fake.supa', SUPABASE_SERVICE_ROLE_KEY: 'svc', LANGFUSE_BASE_URL: 'http://127.0.0.1:9' })) Deno.env.set(k, v);
let handler: any; (Deno as any).serve = (h: any) => { handler = h; return {} as any; };
await import('./index.ts');
const token = Deno.env.get('AGENT_ADMIN_TOKEN') ?? '';
const run = async () => (await handler(new Request('http://x', { method: 'POST', headers: { 'x-backlot-admin': token }, body: '{"action":"run"}' }))).json();
let ok = 0, bad = 0; const check = (name: string, cond: boolean, extra = '') => { cond ? ok++ : bad++; console.log(cond ? 'PASS' : 'FAIL', name, extra); };

// A: everything works
let r = await run();
const a = ledger.filter((x) => x.run === r.runId);
check('A passes', r.passed === true);
check('A x lookup settled at $0.01', a.find((x) => x.kind === 'x_user_lookup')?.status === 'settled' && a.find((x) => x.kind === 'x_user_lookup')?.cost === 0.01);
const g = a.find((x) => x.kind === 'grok');
check('A grok settled at real cost $0.0015956', g?.status === 'settled' && Math.abs(g.cost - 0.0015956) < 1e-9, JSON.stringify({ est: g?.estimate, cost: g?.cost }));
check('A estimate was above real cost', g?.estimate >= g?.cost);

// B: X refuses (402) -> released, nothing charged; Grok still runs
xStatus = 402; r = await run(); xStatus = 200;
const b = ledger.filter((x) => x.run === r.runId);
check('B x lookup released, $0', b.find((x) => x.kind === 'x_user_lookup')?.status === 'released');
check('B reports the X error', /Payment Required/.test(r.steps.x.detail), r.steps.x.detail);

// C: cap too small for the Grok estimate -> refused before calling Grok
// Simulate a new UTC day so the X lookup is billed again ($0.01), leaving too little for Grok.
for (const x of ledger) if (x.detail) delete x.detail.resource;
checkCap = 0.012; const before = grokCalls; r = await run(); checkCap = 0.05;
check('C grok step refused by cap', r.steps.grok.ok === false && /limit/.test(r.steps.grok.detail), r.steps.grok.detail);
check('C Grok was never called', grokCalls === before);
check('C x lookup still fit and settled', ledger.filter((x) => x.run === r.runId).some((x) => x.kind === 'x_user_lookup' && x.status === 'settled'));

// E: second lookup of the same profile the same day is billed $0 (X deduplicates per UTC day)
const startE = ledger.length; r = await run();
const e = ledger.slice(startE).find((x) => x.kind === 'x_user_lookup');
check('E repeat lookup settles at $0, marked deduped', e?.cost === 0 && e?.detail?.deduped === true, JSON.stringify(e?.detail));
check('E resource recorded', e?.detail?.resource === 'x_user:xdevelopers');

// F: xAI refuses (429) -> released, $0 (AI SDK wraps it in a RetryError; providerRefused must see through)
grokMode = '429'; r = await run(); grokMode = 'ok';
const f = ledger.filter((x) => x.run === r.runId && x.kind === 'grok')[0];
check('F refused Grok call released', f?.status === 'released', JSON.stringify({ status: f?.status, failed: f?.detail?.failed }));

// G: Grok hangs past the timeout -> estimate kept (may have been billed)
const { providerRefused } = await import('../_shared/spend.ts');
const timeoutErr = new DOMException('signal timed out', 'TimeoutError');
check('G timeout is not treated as refused', providerRefused(timeoutErr) === false);
check('G status 402 is treated as refused', providerRefused({ statusCode: 402 }) === true);
check('G nested RetryError 429 is treated as refused', providerRefused({ lastError: { statusCode: 429 } }) === true);

// D: spend action
const sp = await (await handler(new Request('http://x', { method: 'POST', headers: { 'x-backlot-admin': token }, body: '{"action":"spend"}' }))).json();
check('D spend summary', typeof sp.month_used === 'number', JSON.stringify(sp));
console.log(`\n${ok} passed, ${bad} failed`); Deno.exit(bad ? 1 : 0);
