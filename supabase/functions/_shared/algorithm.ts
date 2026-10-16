// Bil's window into X's open-source ranking code (xai-org/x-algorithm, Apache-2.0).
//
// The index is built by the daily GitHub job (scripts/algorithm_index) through the
// algo-ingest function. This module reads it:
//   * algorithmSearch: keyword + meaning search over the code, every hit linked to the
//     exact lines on GitHub at the snapshot it was indexed from.
//   * algorithmParams: the published DEFAULT settings from home-mixer/params/param.rs.
//     X can change live values with feature switches, so these are never "live" numbers.
//
// Questions are embedded with Supabase's built-in gte-small (free, about 100 to 200 ms of
// CPU), the same model the job uses. If the job's last matching check failed, search
// drops to keyword only and says so.

import { serviceClient } from './spend.ts';

declare const Supabase: {
  ai: {
    Session: new (model: string) => {
      run(input: string, options: { mean_pool: boolean; normalize: boolean }): Promise<unknown>;
    };
  };
};

export const ALGO_REPO = 'xai-org/x-algorithm';
export const ALGO_LICENSE = 'Apache-2.0';
export const PARAMS_FILE = 'home-mixer/params/param.rs';

// ---------- embeddings ----------

let session: { run(input: string, options: { mean_pool: boolean; normalize: boolean }): Promise<unknown> } | null = null;

/** 384 numbers for a text, from Supabase's built-in gte-small (mean pooled, normalized). */
export async function embedText(text: string): Promise<number[]> {
  session ??= new Supabase.ai.Session('gte-small');
  const out = await session.run(text, { mean_pool: true, normalize: true });
  const arr = Array.from(out as ArrayLike<number>);
  if (arr.length !== 384) throw new Error(`gte-small returned ${arr.length} numbers, expected 384`);
  return arr;
}

/** Decodes a vector sent as base64 little-endian float32 (how the job uploads them). */
export function decodeVector(b64: string): number[] {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (bytes.length !== 384 * 4) throw new Error(`vector has ${bytes.length} bytes, expected ${384 * 4}`);
  const view = new DataView(bytes.buffer);
  return Array.from({ length: 384 }, (_, i) => view.getFloat32(i * 4, true));
}

/** Postgres pgvector literal. */
export function vectorLiteral(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(',')}]`;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// ---------- keyword terms ----------

const STOPWORDS = new Set(
  ('a an and are as at be by can do does for from has have how i if in into is it its of on or so that the their them ' +
    'there these they this to was what when where which who why will with you your about after before more most')
    .split(' '),
);

/**
 * Splits code names into words the same way the indexer does:
 * "FavoriteWeight" and "favorite_weight" both become "favorite weight".
 */
export function splitIdentifiers(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** OR-joined keyword query: 'lowers | reach | post'. Only [a-z0-9] reach Postgres. */
export function keywordQuery(question: string): string {
  const terms = [...new Set(splitIdentifiers(question).filter((t) => t.length > 1 && !STOPWORDS.has(t)))];
  return terms.slice(0, 16).join(' | ');
}

// ---------- status ----------

export type AlgoStatus = {
  commit_sha: string | null;
  commit_date: string | null;
  defaults_synced_at: string | null;
  semantic_ok: boolean;
  files: number;
  chunks: number;
  last_run_status: string;
  finished_at: string | null;
};

export async function indexStatus(): Promise<AlgoStatus> {
  const { data, error } = await serviceClient()
    .from('algo_index_status')
    .select('commit_sha, commit_date, defaults_synced_at, semantic_ok, files, chunks, last_run_status, finished_at')
    .eq('id', 1)
    .single();
  if (error) throw new Error(`Algorithm index unavailable: ${error.message}`);
  return data as AlgoStatus;
}

function permalink(commit: string, path: string, start?: number, end?: number): string {
  const lines = start ? `#L${start}${end && end !== start ? `-L${end}` : ''}` : '';
  return `https://github.com/${ALGO_REPO}/blob/${commit}/${path}${lines}`;
}

// ---------- search ----------

export async function algorithmSearch(question: string, limit: number) {
  const status = await indexStatus();
  if (!status.commit_sha || status.chunks === 0) throw new Error('The algorithm index has not been built yet');
  const tsquery = keywordQuery(question);
  let semantic = status.semantic_ok;
  let embedding: string | null = null;
  if (semantic) {
    try {
      embedding = vectorLiteral(await embedText(question));
    } catch (err) {
      console.error('Query embedding failed; keyword search only', err instanceof Error ? err.message : err);
      semantic = false;
    }
  }
  const { data, error } = await serviceClient().rpc('algo_hybrid_search', {
    query_tsquery: tsquery,
    query_embedding: embedding,
    match_count: limit,
    use_semantic: semantic,
  });
  if (error) throw new Error(`Algorithm search failed: ${error.message}`);
  return {
    repo: ALGO_REPO,
    license: ALGO_LICENSE,
    repoCommit: status.commit_sha,
    snapshotDate: status.commit_date,
    indexedAt: status.finished_at,
    search: semantic ? ('keyword_and_meaning' as const) : ('keyword_only' as const),
    hits: (data ?? []).map((h: any) => ({
      file: h.path,
      lines: { start: h.start_line, end: h.end_line },
      excerpt: String(h.content).slice(0, 1500),
      source: { label: `${h.path} lines ${h.start_line}-${h.end_line}`, url: permalink(h.commit_sha, h.path, h.start_line, h.end_line) },
    })),
  };
}

// ---------- published default settings ----------

export async function algorithmParams(opts: { names?: string[]; contains?: string; limit: number }) {
  const db = serviceClient();
  const status = await indexStatus();
  let q = db.from('algo_params').select('name, value_type, value, num_value, line, file, commit_sha').order('name').limit(opts.limit);
  if (opts.names?.length) q = q.in('name', opts.names);
  else if (opts.contains) q = q.ilike('name', `%${opts.contains.replace(/[%_\\]/g, '')}%`);
  const { data: params, error } = await q;
  if (error) throw new Error(`Settings lookup failed: ${error.message}`);
  const names = (params ?? []).map((p: any) => p.name);
  const { data: changes } = names.length
    ? await db
      .from('algo_param_changes')
      .select('name, old_value, new_value, commit_sha, changed_at')
      .in('name', names)
      .order('changed_at', { ascending: false })
      .limit(50)
    : { data: [] };
  return {
    note: 'Published default values from X\'s open-source code. X can change live values with feature switches, so these are defaults, not live numbers.',
    repo: ALGO_REPO,
    license: ALGO_LICENSE,
    repoCommit: status.commit_sha,
    defaultsSyncedAt: status.defaults_synced_at,
    params: (params ?? []).map((p: any) => ({
      name: p.name,
      type: p.value_type,
      value: p.value,
      number: p.num_value ?? undefined,
      source: { label: `${p.file} line ${p.line}`, url: permalink(p.commit_sha, p.file, p.line) },
    })),
    changes: (changes ?? []).map((c: any) => ({
      name: c.name,
      from: c.old_value,
      to: c.new_value,
      changedAt: c.changed_at,
      source: { label: `snapshot ${String(c.commit_sha).slice(0, 7)}`, url: `https://github.com/${ALGO_REPO}/commit/${c.commit_sha}` },
    })),
  };
}
