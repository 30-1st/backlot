// The server's safety net for photo and video metadata (see migration media_scrub). Files
// are cleaned on the device before upload; this checks every stored file once and cleans
// any that still carry location, device or owner details, in place, at the same path.

import { scrubBytes, ScrubError } from './scrub.ts';
import { serviceClient } from './spend.ts';

const CACHE: Record<string, string> = { library: '3600', board: '3600', media: '31536000' };

async function digest(b: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', b as Uint8Array<ArrayBuffer>));
  return Array.from(h, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Checks files until none are left or the time is nearly up. One file in memory at a time. */
export async function scrubStoredMedia(until: number): Promise<{ checked: number; cleaned: number; skipped: number }> {
  const db = serviceClient();
  const tried = new Set<string>();
  let checked = 0;
  let cleaned = 0;
  let skipped = 0;
  while (Date.now() < until) {
    const { data, error } = await db.rpc('media_scrub_next', { p_limit: 5 });
    if (error) throw new Error(`Could not list files to check: ${error.message}`);
    const next = ((data ?? []) as Array<{ bucket: string; name: string; size: number; mime: string }>).filter((f) => !tried.has(`${f.bucket}/${f.name}`));
    if (!next.length) break;
    for (const f of next) {
      if (Date.now() >= until) break;
      tried.add(`${f.bucket}/${f.name}`);
      const { data: blob, error: dErr } = await db.storage.from(f.bucket).download(f.name);
      if (dErr || !blob) {
        // Left unmarked, so the next run tries again.
        console.error('media scrub: download failed', f.bucket, f.name, dErr?.message);
        continue;
      }
      let bytes: Uint8Array | null = new Uint8Array(await blob.arrayBuffer());
      try {
        const before = await digest(bytes);
        const out = scrubBytes(bytes, true);
        const changed = (await digest(out)) !== before;
        if (changed) {
          const { error: uErr } = await db.storage.from(f.bucket).upload(f.name, out, { upsert: true, contentType: f.mime || blob.type || 'application/octet-stream', cacheControl: CACHE[f.bucket] ?? '3600' });
          if (uErr) {
            console.error('media scrub: upload failed', f.bucket, f.name, uErr.message);
            continue;
          }
          cleaned++;
        }
        const { error: mErr } = await db.rpc('media_scrub_mark', { p_bucket: f.bucket, p_name: f.name, p_changed: changed, p_note: null });
        if (mErr) console.error('media scrub: could not record', mErr.message);
        checked++;
      } catch (err) {
        const why = err instanceof ScrubError ? err.message : 'unexpected error';
        if (!(err instanceof ScrubError)) console.error('media scrub failed', f.bucket, f.name, err instanceof Error ? err.message : err);
        await db.rpc('media_scrub_mark', { p_bucket: f.bucket, p_name: f.name, p_changed: false, p_note: `skipped: ${why}` });
        skipped++;
      } finally {
        bytes = null;
      }
    }
  }
  return { checked, cleaned, skipped };
}
