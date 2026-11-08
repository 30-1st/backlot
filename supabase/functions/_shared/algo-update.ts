// The executive's "X ranking code" card on Quality (approved Nov 8, 2026): what Bil's index
// of X's open-source ranking code (xai-org/x-algorithm) holds, what X last pushed, and a
// button that runs the indexing job now instead of waiting for the daily run.
//
// The job itself runs in GitHub Actions (it needs Python and the embedding model). The
// button asks GitHub to start it with GITHUB_ACTIONS_TOKEN, a fine-grained token Khma
// creates for this one repo with "Actions: read and write" and nothing else, kept in
// Supabase's function secrets. Without it, the card says how to add it.

import { serviceClient } from './spend.ts';
import { ALGO_REPO } from './algorithm.ts';
import { BilInputError } from './bil.ts';

const OUR_REPO = '30-1st/backlot';
const WORKFLOW = 'algorithm-index.yml';
const GH = 'https://api.github.com';
const headers = (token?: string) => ({
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'backlot-algo-check',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

/** What X last pushed to its ranking code repo (public, no login needed). */
async function latestUpstream(): Promise<{ commit: string; date: string; message: string } | null> {
  try {
    const res = await fetch(`${GH}/repos/${ALGO_REPO}/commits?per_page=1`, { headers: headers(), signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const [c] = (await res.json()) as Array<{ sha: string; commit: { committer: { date: string }; message: string } }>;
    return c ? { commit: c.sha, date: c.commit.committer.date, message: c.commit.message.split('\n')[0].slice(0, 120) } : null;
  } catch {
    return null;
  }
}

export async function algoStatus() {
  const db = serviceClient();
  const [{ data: s }, { data: changes }, latest] = await Promise.all([
    db.from('algo_index_status').select('commit_sha, commit_date, files, chunks, semantic_ok, last_run_status, last_error, started_at, finished_at').eq('id', 1).maybeSingle(),
    db.from('algo_param_changes').select('name, old_value, new_value, changed_at').order('changed_at', { ascending: false }).limit(8),
    latestUpstream(),
  ]);
  const running = Boolean(s?.started_at && (!s.finished_at || Date.parse(s.started_at) > Date.parse(s.finished_at)) && Date.now() - Date.parse(s.started_at) < 40 * 60_000);
  return {
    indexed: s
      ? { commit: s.commit_sha, date: s.commit_date, files: s.files, chunks: s.chunks, searchOk: s.semantic_ok, lastRun: s.finished_at ?? s.started_at, lastStatus: s.last_run_status, note: s.last_error }
      : null,
    latest,
    upToDate: Boolean(latest && s?.commit_sha && latest.commit === s.commit_sha),
    running,
    canRefresh: Boolean(Deno.env.get('GITHUB_ACTIONS_TOKEN')),
    changes: (changes ?? []).map((c: any) => ({ name: c.name, from: c.old_value, to: c.new_value, at: c.changed_at })),
  };
}

/** Starts the indexing job now. At most once every 15 minutes. */
export async function algoRefresh() {
  const token = Deno.env.get('GITHUB_ACTIONS_TOKEN');
  if (!token) throw new BilInputError('The update button needs a GitHub token first. The card shows how to add it.', 409);
  const status = await algoStatus();
  if (status.running) throw new BilInputError('An update is already running. It takes about 5 minutes.', 409);
  const last = status.indexed?.lastRun ? Date.parse(status.indexed.lastRun) : 0;
  if (Date.now() - last < 15 * 60_000) throw new BilInputError('The index was updated less than 15 minutes ago.', 429);
  const res = await fetch(`${GH}/repos/${OUR_REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main' }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401 || res.status === 403) throw new BilInputError('GitHub turned the token down. Check it has "Actions: read and write" on 30-1st/backlot and has not expired.', 502);
  if (!res.ok) throw new Error(`GitHub could not start the update (${res.status}).`);
  return { started: true, upToDateBefore: status.upToDate };
}
