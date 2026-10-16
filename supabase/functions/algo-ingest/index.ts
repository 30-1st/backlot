// Upload endpoint for the algorithm index. Only this repo's GitHub workflow can call it.
//
// Who may call: requests carry a GitHub Actions identity token (OIDC) in the
// Authorization header. It is signed by GitHub and accepted only when it was issued for
// audience "backlot-algo-ingest", to repository ID 1414664677 (30-1st/backlot, an ID that
// survives renames and cannot be claimed by a fork), on refs/heads/main, for a scheduled,
// push or manual run. No shared secret exists anywhere. Tokens live about 5 minutes, so
// the job asks GitHub for a fresh one before each call.
//
// Actions (POST JSON {action, ...}):
//   status  - what is indexed now (file fingerprints), so the job sends only changes
//   probe   - embeds a test sentence with Supabase's built-in gte-small and compares it
//             with the job's vectors, so both sides are proven to use the same model
//   begin   - records the snapshot and model, removes files that left the repo (refused
//             if that would remove more than 30% of the index), returns files to index
//   chunks  - replaces one file's pieces (sent in parts; a file counts as done only when
//             its last part lands, so a broken run is redone next time)
//   params  - stores the published default settings and logs every change (refused if
//             fewer than 100 settings arrive, so a broken parser cannot wipe them)
//   finish  - records counts and whether meaning search can be trusted
//   fail    - records why a run failed
//
// verify_jwt is off for this function (supabase/config.toml): GitHub's token is not a
// Supabase login, and this file does its own verification.

import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.2.12';
import { z } from 'npm:zod@4.6.7';
import { serviceClient } from '../_shared/spend.ts';
import { cosine, decodeVector, embedText, PARAMS_FILE, vectorLiteral } from '../_shared/algorithm.ts';

const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com';
const AUDIENCE = 'backlot-algo-ingest';
const REPOSITORY_ID = '1414664677';
const ALLOWED_EVENTS = new Set(['schedule', 'push', 'workflow_dispatch']);

/** A run may not remove more than this share of indexed files at once. */
const MAX_REMOVE_SHARE = 0.3;
/** param.rs holds 187 settings today; fewer than this means the parser broke. */
const MIN_PARAMS = 100;
/** Hard cap on stored pieces (~8,000 expected); protects the database from a broken chunker. */
const MAX_TOTAL_CHUNKS = 40_000;
/** Vectors match when the job's and Supabase's embeddings of the same text agree this closely. */
const MATCH_THRESHOLD = 0.99;

const jwks = createRemoteJWKSet(new URL(`${GITHUB_ISSUER}/.well-known/jwks`));

async function verifyGitHub(req: Request): Promise<{ ok: true; run: string } | { ok: false; why: string }> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { ok: false, why: 'missing token' };
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: GITHUB_ISSUER, audience: AUDIENCE, clockTolerance: 30 });
    if (String(payload.repository_id) !== REPOSITORY_ID) return { ok: false, why: 'wrong repository' };
    if (payload.ref !== 'refs/heads/main') return { ok: false, why: 'wrong branch' };
    if (!ALLOWED_EVENTS.has(String(payload.event_name))) return { ok: false, why: 'wrong event' };
    return { ok: true, run: String(payload.run_id ?? '') };
  } catch (err) {
    return { ok: false, why: err instanceof Error ? err.message : 'invalid token' };
  }
}

// ---------- request shapes ----------

const sha40 = z.string().regex(/^[0-9a-f]{40}$/);
const path = z.string().min(1).max(400).regex(/^[A-Za-z0-9_./-]+$/).refine((p) => !p.includes('..'), 'bad path');
const b64 = z.string().min(1).max(4096);

const Probe = z.object({ action: z.literal('probe'), text: z.string().min(1).max(500), vectors: z.record(z.string().max(100), b64) });

const Begin = z.object({
  action: z.literal('begin'),
  commit: sha40,
  commitDate: z.string().datetime({ offset: true }),
  files: z.array(z.object({ path, sha: sha40 })).min(1).max(5000),
  model: z.object({
    repo: z.string().max(200),
    revision: z.string().max(100),
    file: z.string().max(200),
    chunker: z.number().int().min(1),
    probeCosine: z.number(),
  }),
});

const Chunk = z.object({
  start: z.number().int().min(1),
  end: z.number().int().min(1),
  content: z.string().min(1).max(8000),
  searchText: z.string().min(1).max(16000),
  embedding: b64,
});

const Chunks = z.object({
  action: z.literal('chunks'),
  commit: sha40,
  files: z
    .array(z.object({ path, sha: sha40, part: z.number().int().min(0), last: z.boolean(), chunks: z.array(Chunk).max(60) }))
    .min(1)
    .max(60),
});

const Params = z.object({
  action: z.literal('params'),
  commit: sha40,
  file: z.literal(PARAMS_FILE),
  syncedAt: z.string().datetime({ offset: true }).nullable(),
  params: z
    .array(
      z.object({
        name: z.string().regex(/^[A-Za-z0-9_]{1,100}$/),
        type: z.string().min(1).max(60),
        key: z.string().min(1).max(200),
        value: z.string().max(2000),
        line: z.number().int().min(1),
      }),
    )
    .max(2000),
});

const Finish = z.object({
  action: z.literal('finish'),
  commit: sha40,
  commitDate: z.string().datetime({ offset: true }),
  probeCosine: z.number(),
  unknownFolders: z.array(z.string().max(200)).max(200).default([]),
});

const Fail = z.object({ action: z.literal('fail'), error: z.string().max(4000) });

// ---------- handlers ----------

const db = () => serviceClient();

async function status() {
  const d = db();
  const [s, files] = await Promise.all([
    d.from('algo_index_status').select('*').eq('id', 1).single(),
    d.from('algo_files').select('path, blob_sha, complete').limit(10000),
  ]);
  if (s.error) throw new Error(s.error.message);
  if (files.error) throw new Error(files.error.message);
  return { status: s.data, files: files.data };
}

async function probe(body: z.infer<typeof Probe>) {
  const ours = await embedText(body.text);
  const cosines: Record<string, number> = {};
  for (const [name, v] of Object.entries(body.vectors)) cosines[name] = cosine(ours, decodeVector(v));
  return { cosines, threshold: MATCH_THRESHOLD };
}

async function begin(body: z.infer<typeof Begin>) {
  const d = db();
  const { data: current, error: sErr } = await d.from('algo_index_status').select('*').eq('id', 1).single();
  if (sErr) throw new Error(sErr.message);
  const { data: stored, error } = await d.from('algo_files').select('path, blob_sha, complete').limit(10000);
  if (error) throw new Error(error.message);

  const incoming = new Map(body.files.map((f) => [f.path, f.sha]));
  const stale = (stored ?? []).filter((f) => !incoming.has(f.path)).map((f) => f.path);
  if ((stored?.length ?? 0) > 50 && stale.length > MAX_REMOVE_SHARE * (stored?.length ?? 0)) {
    return {
      refused: true,
      detail: `This run would remove ${stale.length} of ${stored!.length} indexed files (over ${MAX_REMOVE_SHARE * 100}%). Nothing was changed.`,
    };
  }
  for (let i = 0; i < stale.length; i += 200) {
    const { error: delErr } = await d.from('algo_files').delete().in('path', stale.slice(i, i + 200));
    if (delErr) throw new Error(delErr.message);
  }

  // The model and the chunker version are stored together (model_file "onnx/model.onnx#chunker2"):
  // a change to either means every file is re-cut and re-embedded.
  const modelKey = `${body.model.file}#chunker${body.model.chunker}`;
  const modelChanged = Boolean(current.model_file) &&
    (current.model_repo !== body.model.repo || current.model_revision !== body.model.revision || current.model_file !== modelKey);
  const byPath = new Map((stored ?? []).map((f) => [f.path, f]));
  const toIndex = body.files
    .filter((f) => {
      const s = byPath.get(f.path);
      return modelChanged || !s || s.blob_sha !== f.sha || !s.complete;
    })
    .map((f) => f.path);

  const { error: upErr } = await d.from('algo_index_status').update({
    last_run_status: 'running',
    last_error: null,
    started_at: new Date().toISOString(),
    model_repo: body.model.repo,
    model_revision: body.model.revision,
    model_file: modelKey,
    probe_cosine: body.model.probeCosine,
    // Meaning search stays off while vectors from two different models could be mixed.
    ...(modelChanged ? { semantic_ok: false } : {}),
  }).eq('id', 1);
  if (upErr) throw new Error(upErr.message);
  return { refused: false, removed: stale.length, modelChanged, toIndex };
}

async function chunks(body: z.infer<typeof Chunks>) {
  const d = db();
  const incoming = body.files.reduce((n, f) => n + f.chunks.length, 0);
  const { count: stored, error: countErr } = await d.from('algo_chunks').select('id', { count: 'exact', head: true });
  if (countErr) throw new Error(countErr.message);
  if ((stored ?? 0) + incoming > MAX_TOTAL_CHUNKS) {
    return { refused: true, detail: `Storing ${incoming} more pieces would pass the ${MAX_TOTAL_CHUNKS} cap (${stored} stored). Nothing was stored.` };
  }
  let pieces = 0;
  for (const f of body.files) {
    if (f.part === 0) {
      const { error } = await d.from('algo_files').upsert({
        path: f.path,
        blob_sha: f.sha,
        commit_sha: body.commit,
        chunk_count: 0,
        complete: false,
        indexed_at: new Date().toISOString(),
      });
      if (error) throw new Error(`${f.path}: ${error.message}`);
      const { error: delErr } = await d.from('algo_chunks').delete().eq('path', f.path);
      if (delErr) throw new Error(`${f.path}: ${delErr.message}`);
    }
    if (f.chunks.length) {
      const rows = f.chunks.map((c) => {
        if (c.end < c.start) throw new Error(`${f.path}: end line before start line`);
        return {
          path: f.path,
          commit_sha: body.commit,
          start_line: c.start,
          end_line: c.end,
          content: c.content,
          search_text: c.searchText,
          embedding: vectorLiteral(decodeVector(c.embedding)),
        };
      });
      const { error } = await d.from('algo_chunks').insert(rows);
      if (error) throw new Error(`${f.path}: ${error.message}`);
      pieces += rows.length;
    }
    if (f.last) {
      const { count, error: cErr } = await d.from('algo_chunks').select('id', { count: 'exact', head: true }).eq('path', f.path);
      if (cErr) throw new Error(`${f.path}: ${cErr.message}`);
      const { error } = await d.from('algo_files').update({ complete: true, chunk_count: count ?? 0 }).eq('path', f.path).eq('blob_sha', f.sha);
      if (error) throw new Error(`${f.path}: ${error.message}`);
    }
  }
  return { refused: false, stored: pieces };
}

async function params(body: z.infer<typeof Params>) {
  if (body.params.length < MIN_PARAMS) {
    return { refused: true, detail: `Only ${body.params.length} settings arrived (expected at least ${MIN_PARAMS}). Kept the old values.` };
  }
  const d = db();
  const { data: existing, error } = await d.from('algo_params').select('name, value');
  if (error) throw new Error(error.message);
  const before = new Map((existing ?? []).map((p) => [p.name, p.value]));
  const after = new Map(body.params.map((p) => [p.name, p.value]));

  // The first load seeds the table; only later runs log changes.
  const changes: Array<{ name: string; old_value: string | null; new_value: string | null; commit_sha: string }> = [];
  if (before.size) {
    for (const [name, value] of after) if (before.get(name) !== value) changes.push({ name, old_value: before.get(name) ?? null, new_value: value, commit_sha: body.commit });
    for (const [name, value] of before) if (!after.has(name)) changes.push({ name, old_value: value, new_value: null, commit_sha: body.commit });
  }

  const rows = body.params.map((p) => {
    const n = Number(p.value);
    return {
      name: p.name,
      value_type: p.type,
      switch_key: p.key,
      value: p.value,
      num_value: p.value.trim() !== '' && Number.isFinite(n) ? n : null,
      line: p.line,
      file: body.file,
      commit_sha: body.commit,
      updated_at: new Date().toISOString(),
    };
  });
  const { error: upErr } = await d.from('algo_params').upsert(rows);
  if (upErr) throw new Error(upErr.message);
  const removed = [...before.keys()].filter((n) => !after.has(n));
  if (removed.length) {
    const { error: delErr } = await d.from('algo_params').delete().in('name', removed);
    if (delErr) throw new Error(delErr.message);
  }
  if (changes.length) {
    const { error: chErr } = await d.from('algo_param_changes').insert(changes);
    if (chErr) throw new Error(chErr.message);
  }
  const { error: sErr } = await d.from('algo_index_status').update({ defaults_synced_at: body.syncedAt }).eq('id', 1);
  if (sErr) throw new Error(sErr.message);
  return { refused: false, stored: rows.length, changes: changes.length, seeded: before.size === 0 };
}

async function finish(body: z.infer<typeof Finish>) {
  const d = db();
  const [files, pieces, incomplete] = await Promise.all([
    d.from('algo_files').select('path', { count: 'exact', head: true }),
    d.from('algo_chunks').select('id', { count: 'exact', head: true }),
    d.from('algo_files').select('path', { count: 'exact', head: true }).eq('complete', false),
  ]);
  for (const r of [files, pieces, incomplete]) if (r.error) throw new Error(r.error.message);
  const semanticOk = body.probeCosine >= MATCH_THRESHOLD;
  const { error } = await d.from('algo_index_status').update({
    commit_sha: body.commit,
    commit_date: body.commitDate,
    files: files.count ?? 0,
    chunks: pieces.count ?? 0,
    probe_cosine: body.probeCosine,
    semantic_ok: semanticOk,
    last_run_status: (incomplete.count ?? 0) > 0 ? 'failed' : 'ok',
    last_error: (incomplete.count ?? 0) > 0
      ? `${incomplete.count} files did not finish uploading; they are redone next run`
      : body.unknownFolders.length
      ? `New folders in the repo, not indexed until reviewed: ${body.unknownFolders.join(', ')}`
      : null,
    finished_at: new Date().toISOString(),
  }).eq('id', 1);
  if (error) throw new Error(error.message);
  return { files: files.count, chunks: pieces.count, incomplete: incomplete.count, semanticOk };
}

async function fail(body: z.infer<typeof Fail>) {
  const { error } = await db().from('algo_index_status').update({
    last_run_status: 'failed',
    last_error: body.error,
    finished_at: new Date().toISOString(),
  }).eq('id', 1);
  if (error) throw new Error(error.message);
  return { recorded: true };
}

// ---------- server ----------

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const who = await verifyGitHub(req);
  if (!who.ok) return json(401, { error: 'not allowed', why: who.why });

  const raw = await req.json().catch(() => null);
  try {
    switch (raw?.action) {
      case 'status':
        return json(200, await status());
      case 'probe':
        return json(200, await probe(Probe.parse(raw)));
      case 'begin': {
        const r = await begin(Begin.parse(raw));
        return json(r.refused ? 409 : 200, r);
      }
      case 'chunks': {
        const r = await chunks(Chunks.parse(raw));
        return json(r.refused ? 409 : 200, r);
      }
      case 'params': {
        const r = await params(Params.parse(raw));
        return json(r.refused ? 409 : 200, r);
      }
      case 'finish':
        return json(200, await finish(Finish.parse({ unknownFolders: [], ...raw })));
      case 'fail':
        return json(200, await fail(Fail.parse(raw)));
      default:
        return json(400, { error: 'unknown action' });
    }
  } catch (err) {
    const message = err instanceof z.ZodError ? `bad request: ${err.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}` : err instanceof Error ? err.message : 'failed';
    console.error('algo-ingest', raw?.action, message);
    return json(err instanceof z.ZodError ? 400 : 500, { error: message });
  }
});
