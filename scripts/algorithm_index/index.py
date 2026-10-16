"""Builds Backlot's index of X's open-source ranking code (xai-org/x-algorithm, Apache-2.0).

Runs daily in GitHub Actions (.github/workflows/algorithm-index.yml). Each run:
  1. Lists the snapshot's files with git's own fingerprints (blob SHAs) and keeps only the
     folders we chose to index. Anti-spam and enforcement code is never indexed; any new
     top-level folder is reported for review instead of being indexed automatically.
  2. Proves its embedding model matches Supabase's built-in gte-small (probe sentence).
  3. Sends only files that changed since the last run, cut into pieces of at most 480
     tokens (counted with the model's own tokenizer) on line breaks, each with a vector.
  4. Copies every param!(...) default from home-mixer/params/param.rs.

Uploads go to the algo-ingest Supabase function, authenticated with a fresh GitHub
Actions identity token per request (they live about 5 minutes). No secrets are used.

Local check without network or model:  python index.py --repo <x-algorithm clone> --dry-run
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.request
from dataclasses import dataclass

AUDIENCE = "backlot-algo-ingest"
MODEL_REPO = "Supabase/gte-small"
MODEL_FILES = ["onnx/model.onnx", "onnx/model_quantized.onnx"]
MAX_TOKENS = 480  # gte-small reads 512 tokens including [CLS]/[SEP]; leave room for the path header
OVERLAP_LINES = 2
MAX_CHUNK_CHARS = 6000
BATCH_CHUNKS = 50
EMBED_BATCH = 32
PROBE_TEXT = "Backlot index check: how replies, likes and reposts are weighted when ranking posts in the For You feed."

# Folders that decide reach: candidate retrieval, ranking, feed assembly, visibility rules,
# adult-content handling, and docs. Keep in step with the roadmap.
INCLUDE_DIRS = {
    "home-mixer",
    "phoenix",
    "phoenix-rankall",
    "thunder",
    "candidate-pipeline",
    "simclusters",
    "visibility-filtering",
    "visibility-filtering-client",
    "under-the-hood",
    "vm-ranker",
    "xai-value-model",
    "adult-content",
    "pnsfwmedia",
    "docs",
}
INCLUDE_ROOT_FILES = {"README.md"}

# Reviewed and left out on purpose. Anti-spam, enforcement and detection internals are never
# indexed: Bil's compliance comes from X's published rules, not from detector code.
REVIEWED_EXCLUDED_DIRS = {
    "botmaker",
    "botmaker-rules",
    "abuse-enforcement-service",
    "abuse-ledger-service",
    "scarecrow",
    "takedowns",
    "bdsm",
    "user-cred-v2",
    "grox",
    "safety-label-user-agg",
    "agatha",
    # infrastructure with nothing about reach
    "media-model-proxy",
    "clip",
    "phoenix-rankall-strato",
}

EXTENSIONS = {".rs", ".py", ".scala", ".java", ".md", ".rst", ".thrift", ".proto"}
EXCLUDE_PATH = re.compile(
    r"/(train|training|cutedsl|tests?|loadtest|integrationtest|benchmarks?)/|_test\.(rs|py|scala)$|/test_[^/]*\.py$"
)
GENERATED_MARKER = "auto-generated code should have checked"
MAX_FILE_BYTES = 600_000
# Safety cap: the selection makes ~8,000 pieces. Far more means the chunker broke; stop before uploading.
MAX_TOTAL_CHUNKS = 30_000
# Bump when chunking changes, so every file is re-cut and re-embedded on the next run.
CHUNKER_VERSION = 2

PARAMS_FILE = "home-mixer/params/param.rs"
PARAM_RE = re.compile(r'param!\(\s*([A-Za-z0-9_]+)\s*,\s*([^,]+?)\s*,\s*"([^"]+)"\s*,\s*(.+?)\s*\);', re.S)
SYNC_RE = re.compile(r"last sync (\d{4}-\d{2}-\d{2}T[0-9:.]+Z)")
MIN_PARAMS = 100


# ---------- helpers ----------

def log(msg: str) -> None:
    print(msg, flush=True)


def split_identifiers(text: str) -> list[str]:
    """Same rule as supabase/functions/_shared/algorithm.ts: FavoriteWeight -> favorite weight."""
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", text)
    text = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", text)
    return [w for w in re.split(r"[^a-z0-9]+", text.lower()) if w]


def git(repo: str, *args: str) -> str:
    return subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True, text=True).stdout


# ---------- file selection ----------

@dataclass
class SourceFile:
    path: str
    sha: str


def select_files(repo: str) -> tuple[list[SourceFile], list[str]]:
    files: list[SourceFile] = []
    top_dirs: set[str] = set()
    for line in git(repo, "ls-tree", "-r", "HEAD").splitlines():
        meta, path = line.split("\t", 1)
        _mode, kind, sha = meta.split()
        if kind != "blob":
            continue
        top = path.split("/", 1)[0] if "/" in path else None
        if top:
            top_dirs.add(top)
        ext = os.path.splitext(path)[1]
        wanted = path in INCLUDE_ROOT_FILES or (top in INCLUDE_DIRS and ext in EXTENSIONS and not EXCLUDE_PATH.search(path))
        if not wanted:
            continue
        full = os.path.join(repo, path)
        if os.path.getsize(full) > MAX_FILE_BYTES:
            log(f"skip (too large): {path}")
            continue
        with open(full, encoding="utf-8", errors="replace") as fh:
            if GENERATED_MARKER in fh.read():
                continue  # code-generator output: field-by-field data definitions
        files.append(SourceFile(path, sha))
    unknown = sorted(top_dirs - INCLUDE_DIRS - REVIEWED_EXCLUDED_DIRS)
    return sorted(files, key=lambda f: f.path), unknown


# ---------- default settings ----------

def parse_params(repo: str) -> tuple[list[dict], str | None]:
    with open(os.path.join(repo, PARAMS_FILE), encoding="utf-8") as fh:
        text = fh.read()
    params = []
    for m in PARAM_RE.finditer(text):
        name, vtype, key, value = (g.strip() for g in m.groups())
        params.append({"name": name, "type": vtype, "key": key, "value": value, "line": text.count("\n", 0, m.start()) + 1})
    synced = SYNC_RE.search(text)
    return params, synced.group(1) if synced else None


# ---------- tokenizing and chunking ----------

class Counter:
    """Counts tokens with the model's own tokenizer (or ~3 chars per token in --dry-run)."""

    def __init__(self, tokenizer=None):
        self.tok = tokenizer

    def counts(self, lines: list[str]) -> list[int]:
        if self.tok is None:
            return [max(1, len(line) // 3) for line in lines]
        return [len(e.ids) for e in self.tok.encode_batch(lines, add_special_tokens=False)]


def chunk_file(path: str, text: str, counter: Counter) -> list[dict]:
    lines = text.split("\n")
    if not any(line.strip() for line in lines):
        return []
    counts = counter.counts(lines)
    budget = MAX_TOKENS - 24  # room for the "path lines a-b" header
    chunks = []
    i = 0
    while i < len(lines):
        j, used = i, 0
        while j < len(lines) and (used + counts[j] <= budget or j == i):
            used += counts[j] + 1
            j += 1
        content = "\n".join(lines[i:j]).strip("\n")
        if content.strip():
            if len(content) > MAX_CHUNK_CHARS:
                content = content[: MAX_CHUNK_CHARS - 2] + " …"
            start, end = i + 1, j
            words = " ".join(split_identifiers(f"{path} {content}"))
            chunks.append({
                "start": start,
                "end": end,
                "content": content,
                "searchText": f"{content}\n{words}"[:16000],
                "embedText": f"{path} lines {start}-{end}\n{content}",
            })
        if j >= len(lines):
            break
        i = max(j - OVERLAP_LINES, i + 1)
    return chunks


# ---------- embeddings (ONNX, same weights Supabase runs) ----------

class Embedder:
    def __init__(self, revision: str, model_file: str):
        import numpy as np
        import onnxruntime as ort
        from huggingface_hub import hf_hub_download
        from tokenizers import Tokenizer

        self.np = np
        tok_path = hf_hub_download(MODEL_REPO, "tokenizer.json", revision=revision)
        self.tokenizer = Tokenizer.from_file(tok_path)
        self.tokenizer.enable_truncation(max_length=512)
        self.tokenizer.enable_padding()
        # tokenizer.json ships with its own padding and truncation settings; counting must see
        # each line's real length, so both are switched off on the counting copy.
        self.counter_tokenizer = Tokenizer.from_file(tok_path)
        self.counter_tokenizer.no_padding()
        self.counter_tokenizer.no_truncation()
        self.session = ort.InferenceSession(
            hf_hub_download(MODEL_REPO, model_file, revision=revision), providers=["CPUExecutionProvider"]
        )
        self.inputs = {i.name for i in self.session.get_inputs()}

    def embed(self, texts: list[str]):
        np = self.np
        out = []
        for k in range(0, len(texts), EMBED_BATCH):
            enc = self.tokenizer.encode_batch(texts[k : k + EMBED_BATCH])
            ids = np.array([e.ids for e in enc], dtype=np.int64)
            mask = np.array([e.attention_mask for e in enc], dtype=np.int64)
            feed = {"input_ids": ids, "attention_mask": mask}
            if "token_type_ids" in self.inputs:
                feed["token_type_ids"] = np.zeros_like(ids)
            hidden = self.session.run(None, {n: v for n, v in feed.items() if n in self.inputs})[0]
            m = mask[..., None].astype(np.float32)
            pooled = (hidden * m).sum(axis=1) / np.clip(m.sum(axis=1), 1e-9, None)
            pooled /= np.clip(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-12, None)
            out.extend(pooled.astype("<f4"))
        return out


def b64(vec) -> str:
    return base64.b64encode(vec.astype("<f4").tobytes()).decode("ascii")


# ---------- upload ----------

class Ingest:
    def __init__(self, url: str):
        self.url = url
        self._token = ""
        self._token_at = 0.0

    def token(self) -> str:
        # GitHub identity tokens live about 5 minutes: reuse one for 3 minutes at most.
        if self._token and time.time() - self._token_at < 180:
            return self._token
        req = urllib.request.Request(
            os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"] + "&audience=" + AUDIENCE,
            headers={"Authorization": "bearer " + os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]},
        )
        with urllib.request.urlopen(req, timeout=30) as res:
            self._token = json.load(res)["value"]
        self._token_at = time.time()
        return self._token

    def call(self, payload: dict, allow: tuple[int, ...] = (200,)) -> tuple[int, dict]:
        body = json.dumps(payload).encode("utf-8")
        for attempt in range(4):
            req = urllib.request.Request(
                self.url, data=body, method="POST",
                headers={"Content-Type": "application/json", "Authorization": "Bearer " + self.token()},
            )
            try:
                with urllib.request.urlopen(req, timeout=120) as res:
                    return res.status, json.load(res)
            except urllib.error.HTTPError as err:
                detail = err.read().decode("utf-8", "replace")
                if err.code in allow:
                    return err.code, json.loads(detail or "{}")
                if err.code < 500 or attempt == 3:
                    raise RuntimeError(f"{payload.get('action')} failed: HTTP {err.code} {detail[:500]}") from None
            except (urllib.error.URLError, TimeoutError) as err:
                if attempt == 3:
                    raise RuntimeError(f"{payload.get('action')} failed: {err}") from None
            time.sleep(2 ** attempt)
        raise RuntimeError("unreachable")


# ---------- main ----------

def run(repo: str, dry_run: bool) -> dict:
    commit = git(repo, "rev-parse", "HEAD").strip()
    commit_date = git(repo, "log", "-1", "--format=%cI").strip()
    files, unknown = select_files(repo)
    params, synced = parse_params(repo)
    log(f"snapshot {commit} ({commit_date}): {len(files)} files selected, {len(params)} settings, synced {synced}")
    if unknown:
        log(f"::warning::New folders in x-algorithm, not indexed until reviewed: {', '.join(unknown)}")
    if len(params) < MIN_PARAMS:
        raise RuntimeError(f"Parsed only {len(params)} settings from {PARAMS_FILE}; expected at least {MIN_PARAMS}. Not uploading.")

    if dry_run:
        counter = Counter()
        total = 0
        for f in files:
            with open(os.path.join(repo, f.path), encoding="utf-8", errors="replace") as fh:
                total += len(chunk_file(f.path, fh.read(), counter))
        return {"files": len(files), "chunks_estimate": total, "params": len(params), "synced": synced, "unknown": unknown}

    from huggingface_hub import HfApi

    ingest = Ingest(os.environ["INGEST_URL"])
    info = HfApi().model_info(MODEL_REPO)
    revision = info.sha
    available = set(HfApi().list_repo_files(MODEL_REPO, revision=revision))
    candidates = [f for f in MODEL_FILES if f in available]
    if not candidates:
        raise RuntimeError(f"No ONNX weights found in {MODEL_REPO}@{revision}")

    # Matching check: pick the weights whose vectors match Supabase's built-in model.
    vectors, embedders = {}, {}
    for name in candidates:
        embedders[name] = Embedder(revision, name)
        vectors[name] = b64(embedders[name].embed([PROBE_TEXT])[0])
    _, probe = ingest.call({"action": "probe", "text": PROBE_TEXT, "vectors": vectors})
    cosines = probe["cosines"]
    model_file = max(cosines, key=cosines.get)
    probe_cosine = float(cosines[model_file])
    log(f"matching check: {json.dumps(cosines)} -> using {model_file} ({probe_cosine:.6f})")
    embedder = embedders[model_file]
    counter = Counter(embedder.counter_tokenizer)

    status, begun = ingest.call({
        "action": "begin",
        "commit": commit,
        "commitDate": commit_date,
        "files": [{"path": f.path, "sha": f.sha} for f in files],
        "model": {"repo": MODEL_REPO, "revision": revision, "file": model_file, "chunker": CHUNKER_VERSION, "probeCosine": probe_cosine},
    }, allow=(409,))
    if status == 409:
        raise RuntimeError(begun.get("detail", "begin refused"))
    to_index = set(begun["toIndex"])
    log(f"removed {begun['removed']} files; {len(to_index)} to index; model changed: {begun['modelChanged']}")

    sha_by_path = {f.path: f.sha for f in files}
    batch: list[dict] = []
    batch_size = 0
    sent_files = sent_chunks = 0

    def flush():
        nonlocal batch, batch_size
        if batch:
            code, res = ingest.call({"action": "chunks", "commit": commit, "files": batch}, allow=(409,))
            if code == 409:
                raise RuntimeError(res.get("detail", "chunks refused"))
            batch, batch_size = [], 0

    # Cut every changed file first, so a broken chunker is caught before anything uploads.
    planned: list[tuple[str, list[dict]]] = []
    for path in sorted(to_index):
        with open(os.path.join(repo, path), encoding="utf-8", errors="replace") as fh:
            planned.append((path, chunk_file(path, fh.read(), counter)))
    total = sum(len(c) for _, c in planned)
    log(f"{total} pieces planned for {len(planned)} files")
    if total > MAX_TOTAL_CHUNKS:
        raise RuntimeError(f"{total} pieces planned, over the {MAX_TOTAL_CHUNKS} safety cap. Not uploading.")

    for path, chunks in planned:
        vecs = embedder.embed([c["embedText"] for c in chunks]) if chunks else []
        payload = [
            {"start": c["start"], "end": c["end"], "content": c["content"], "searchText": c["searchText"], "embedding": b64(v)}
            for c, v in zip(chunks, vecs)
        ]
        parts = [payload[k : k + BATCH_CHUNKS] for k in range(0, len(payload), BATCH_CHUNKS)] or [[]]
        for n, part in enumerate(parts):
            if batch_size + len(part) > BATCH_CHUNKS:
                flush()
            batch.append({"path": path, "sha": sha_by_path[path], "part": n, "last": n == len(parts) - 1, "chunks": part})
            batch_size += len(part)
        sent_files += 1
        sent_chunks += len(payload)
        if sent_files % 100 == 0:
            log(f"... {sent_files}/{len(planned)} files, {sent_chunks} pieces")
    flush()

    status, stored = ingest.call(
        {"action": "params", "commit": commit, "file": PARAMS_FILE, "syncedAt": synced, "params": params}, allow=(409,)
    )
    if status == 409:
        raise RuntimeError(stored.get("detail", "params refused"))

    _, done = ingest.call({
        "action": "finish",
        "commit": commit,
        "commitDate": commit_date,
        "probeCosine": probe_cosine,
        "unknownFolders": unknown,
    })
    return {
        "commit": commit,
        "files_sent": sent_files,
        "pieces_sent": sent_chunks,
        "params": stored,
        "index": done,
        "probe": cosines,
        "model": f"{MODEL_REPO}@{revision} {model_file}",
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="path to a clone of xai-org/x-algorithm")
    ap.add_argument("--dry-run", action="store_true", help="select, chunk and parse only; no network")
    args = ap.parse_args()
    try:
        result = run(args.repo, args.dry_run)
    except Exception as err:  # report why, then fail the job so GitHub emails the owner
        message = f"{type(err).__name__}: {err}"
        log(f"::error::{message}")
        traceback.print_exc()
        if not args.dry_run and os.environ.get("INGEST_URL"):
            try:
                Ingest(os.environ["INGEST_URL"]).call({"action": "fail", "error": message[-3900:]})
            except Exception as report_err:  # noqa: BLE001
                log(f"could not record the failure: {report_err}")
        return 1
    summary = json.dumps(result, indent=2)
    log(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as fh:
            fh.write(f"## Algorithm index\n\n```json\n{summary}\n```\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
