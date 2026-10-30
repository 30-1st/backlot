import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BASE_TAGS,
  addFile,
  cleanTag,
  listLibrary,
  postTypeTags,
  refuse,
  removeFile,
  restoreFile,
  setStatus,
  setTags,
  signedUrls,
  type LibraryItem,
  type MediaStatus,
} from '../lib/clientMedia';
import { plural } from '../lib/format';
import { daysSince, shotsWanted, usage } from './gaps';
import type { ScreenProps } from './Shell';
import { supabase } from '../lib/supabase';
import { team } from '../lib/team';

// Media: a client's real photos and videos. Add them, tag them once, and Bil plans every
// campaign around what is really here. Bil reads the tags, never the images.

type Upload = { key: string; name: string; state: 'waiting' | 'sending' | 'done' | 'failed'; error?: string };

function seconds(s: number | null): string {
  if (s == null) return '';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

function goneOn(removedAt: string): string {
  return new Date(new Date(removedAt).getTime() + 7 * 86_400_000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Thumb({ item, url, big = false }: { item: LibraryItem; url?: string; big?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <span className="bl-thumb-empty">
        {item.kind === 'video' ? 'Video' : 'Photo'}
        <small>{broken ? 'Preview not supported here' : 'Loading'}</small>
      </span>
    );
  }
  return item.kind === 'video' ? (
    <video src={`${url}#t=0.1`} muted playsInline preload="metadata" controls={big} onError={() => setBroken(true)} />
  ) : (
    <img src={url} alt={item.tags.length ? item.tags.join(', ') : 'Untagged photo'} loading="lazy" onError={() => setBroken(true)} />
  );
}

const STALE_DAYS = 14;

export function LibraryScreen({ me, ws, single, isTeam, go }: ScreenProps) {
  const clientId = single;
  const client = ws.data?.clients.find((c) => c.id === clientId) ?? null;
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [typeTags, setTypeTags] = useState<string[]>([]);
  const [showRemoved, setShowRemoved] = useState(false);
  const [order, setOrder] = useState<'high' | 'low'>('high');
  const [ranked, setRanked] = useState<{ tags: Array<{ tag: string; posts: number; score: number }>; measured: number } | null>(null);
  const [niche, setNiche] = useState<Array<{ pattern: string; why: string }> | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  // Bil's "make next": the shot types that score best on this client's posted posts (from the
  // latest monthly report). Under 10 posted posts with media, the niche's patterns from Rein.
  useEffect(() => {
    setRanked(null);
    setNiche(null);
    if (!clientId || !supabase) return;
    let live = true;
    void supabase
      .from('client_reports')
      .select('numbers')
      .eq('client_id', clientId)
      .order('month', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (!live) return;
        const n = (data?.[0]?.numbers ?? {}) as { mediaTags?: Array<{ tag: string; posts: number; score: number }>; mediaPostsMeasured?: number };
        const r = { tags: n.mediaTags ?? [], measured: n.mediaPostsMeasured ?? 0 };
        setRanked(r);
        if (r.measured < 10) {
          team.reinClient(clientId, 'worldwide').then(
            (b) => live && setNiche((b.latest?.viral?.patterns ?? []).slice(0, 5).map((p) => ({ pattern: p.pattern, why: p.why }))),
            () => live && setNiche([]),
          );
        }
      });
    return () => {
      live = false;
    };
  }, [clientId]);

  const load = useCallback(async () => {
    if (!clientId) return;
    try {
      const list = await listLibrary(clientId);
      setItems(list);
      setError('');
      const u = await signedUrls(list.map((i) => i.path));
      setUrls(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the Library.');
    }
  }, [clientId]);

  useEffect(() => {
    setItems(null);
    setFilter('all');
    void load();
    if (clientId) void postTypeTags(clientId).then(setTypeTags, () => setTypeTags([]));
  }, [clientId, load]);

  const kept = useMemo(() => (items ?? []).filter((i) => !i.removedAt), [items]);
  const removed = useMemo(() => (items ?? []).filter((i) => i.removedAt), [items]);
  // Retired files stay out of the usual view; they have a filter of their own.
  const live = useMemo(() => kept.filter((i) => i.status !== 'retired'), [kept]);
  const retired = useMemo(() => kept.filter((i) => i.status === 'retired'), [kept]);
  const untagged = live.filter((i) => i.tags.length === 0);
  const { used, planned } = useMemo(() => (ws.data && clientId ? usage(ws.data, clientId) : { used: new Set<string>(), planned: new Set<string>() }), [ws.data, clientId]);
  const fresh = live.filter((i) => i.status === 'new');
  const approved = live.filter((i) => i.status === 'approved');
  const usedFiles = live.filter((i) => used.has(i.id));
  const shots = ws.data && clientId ? shotsWanted(ws.data, clientId) : [];
  const newest = (kind: 'photo' | 'video') => kept.filter((i) => i.kind === kind).map((i) => i.createdAt).sort().pop();
  const videoDays = daysSince(newest('video'));
  const photoDays = daysSince(newest('photo'));
  const gaps = [
    ...(items !== null && kept.length > 0 && (videoDays === null || videoDays >= STALE_DAYS) ? [videoDays === null ? 'No videos yet.' : `No new video in ${videoDays} days.`] : []),
    ...(items !== null && kept.length > 0 && photoDays !== null && photoDays >= STALE_DAYS ? [`No new photos in ${photoDays} days.`] : []),
  ];
  // Every tag, ordered by how often it appears in the best posts (from the monthly report),
  // then by how many files carry it.
  const tagOrder = useMemo(() => {
    const files = new Map<string, number>();
    for (const i of live) for (const t of i.tags) files.set(t, (files.get(t) ?? 0) + 1);
    const best = new Map((ranked?.tags ?? []).map((t, k) => [t.tag, { posts: t.posts, rank: k }]));
    const list = [...files.entries()].map(([tag, n]) => ({ tag, files: n, inBest: best.get(tag)?.posts ?? 0, rank: best.get(tag)?.rank ?? 999 }));
    list.sort((a, b) => a.rank - b.rank || b.files - a.files || a.tag.localeCompare(b.tag));
    return order === 'high' ? list : list.reverse();
  }, [live, ranked, order]);
  const shown =
    filter === 'all'
      ? live
      : filter === 'untagged'
        ? untagged
        : filter === ':new'
          ? fresh
          : filter === ':approved'
            ? approved
            : filter === ':used'
              ? usedFiles
              : filter === ':retired'
                ? retired
                : live.filter((i) => i.tags.includes(filter));
  const open = kept.find((i) => i.id === openId) ?? null;

  async function addFiles(files: FileList | File[]) {
    if (!clientId) return;
    const list = [...files];
    const queue: Upload[] = list.map((f, i) => ({ key: `${Date.now()}-${i}`, name: f.name, state: refuse(f) ? 'failed' : 'waiting', error: refuse(f) ?? undefined }));
    setUploads(queue);
    for (let i = 0; i < list.length; i++) {
      if (queue[i].state === 'failed') continue;
      setUploads((u) => u.map((x, k) => (k === i ? { ...x, state: 'sending' } : x)));
      try {
        await addFile(me.workspaceId, clientId, list[i]);
        setUploads((u) => u.map((x, k) => (k === i ? { ...x, state: 'done' } : x)));
      } catch (e) {
        setUploads((u) => u.map((x, k) => (k === i ? { ...x, state: 'failed', error: e instanceof Error ? e.message : 'Upload failed.' } : x)));
      }
    }
    await load();
    setFilter('untagged');
  }

  if (!clientId) {
    return (
      <main style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 className="bl-h1 bl-rise">Media</h1>
        <div className="bl-glass-card">
          <b>No client yet</b>
          <p className="bl-p bl-muted" style={{ margin: 0 }}>
            Media belongs to a client. Bring in a client first, then add their photos and videos here.
          </p>
        </div>
      </main>
    );
  }

  const sending = uploads.some((u) => u.state === 'sending' || u.state === 'waiting');

  return (
    <main
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="bl-h1 bl-rise">Media</h1>
          <p className="bl-p bl-muted" style={{ margin: '4px 0 0' }}>
            {isTeam && client ? `@${client.handle}. ` : ''}
            {items === null ? 'Loading.' : `${live.length} ${plural(live.length, 'file')}. Bil plans around the tags, and never sees the images.`}{' '}
            <button type="button" className="bl-linkish" onClick={() => go('board')}>
              Your board
            </button>
          </p>
        </div>
        <button type="button" className="bl-btn" onClick={() => picker.current?.click()} disabled={sending}>
          {sending ? 'Adding' : 'Add photos and videos'}
        </button>
        <input
          ref={picker}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif,video/mp4,video/quicktime,video/webm,.heic,.heif,.mov"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}

      {uploads.length > 0 && (
        <ul className="bl-uploads" aria-live="polite">
          {uploads.map((u) => (
            <li key={u.key}>
              <span className="bl-upload-name">{u.name}</span>
              <span className={`bl-chip-ink${u.state === 'failed' ? ' bad' : ''}`}>
                {u.state === 'waiting' ? 'Waiting' : u.state === 'sending' ? 'Uploading' : u.state === 'done' ? 'Added' : 'Not added'}
              </span>
              {u.error && <span className="bl-small bl-upload-err">{u.error}</span>}
            </li>
          ))}
          {!sending && (
            <li>
              <button type="button" className="bl-linkish" onClick={() => setUploads([])}>
                Clear this list
              </button>
            </li>
          )}
        </ul>
      )}

      {items !== null && live.length === 0 && uploads.length === 0 && (
        <div className="bl-glass-card">
          <b>No media yet</b>
          <p className="bl-p bl-muted" style={{ margin: 0 }}>
            Add the photos and videos {isTeam ? 'this client really has' : 'you really have'}. Tag each one once (like "mirror selfie" or "outfit") and Bil
            matches them to posts when he plans a campaign. You can also drop files onto this page.
          </p>
        </div>
      )}

      {(untagged.length > 0 || gaps.length > 0) && (
        <section className="bl-glass-card bl-gaps" aria-labelledby="gaps-title">
          <b id="gaps-title">What Media needs</b>
          <ul>
            {untagged.length > 0 && (
              <li>
                {untagged.length} {plural(untagged.length, 'file needs', 'files need')} tags. Bil can only plan around tagged files.
              </li>
            )}
            {gaps.map((g) => (
              <li key={g}>{g} Fresh media keeps posts from repeating.</li>
            ))}
          </ul>
        </section>
      )}

      <section className="bl-glass-card bl-make-next" aria-labelledby="next-title">
        <b id="next-title">Make next</b>
        {ranked === null ? (
          <span className="bl-small" aria-busy="true">Loading Bil&rsquo;s picks.</span>
        ) : ranked.measured >= 10 && ranked.tags.length > 0 ? (
          <>
            <span className="bl-small">The 5 shot types that score best on your posted posts, by X&rsquo;s own ranking weights.</span>
            <ol className="bl-next-list">
              {ranked.tags.slice(0, 5).map((t, i) => (
                <li key={t.tag}>
                  <span className="bl-next-rank num">{i + 1}</span>
                  <span className="bl-next-main">
                    <b>{t.tag}</b>
                    <span className="bl-next-bar" aria-hidden="true">
                      <span style={{ width: `${Math.max(8, Math.round((t.score / ranked.tags[0].score) * 100))}%` }} />
                    </span>
                  </span>
                  <span className="bl-small num">{t.posts} posts</span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <>
            <span className="bl-small">
              Fewer than 10 posted posts with media so far ({ranked.measured}), so Bil leans on what is working in your niche. Add the posting link when you mark a post posted, and this list turns into your own.
            </span>
            {niche === null ? (
              <span className="bl-small" aria-busy="true">Loading your niche.</span>
            ) : niche.length ? (
              <ol className="bl-next-list">
                {niche.map((p, i) => (
                  <li key={i}>
                    <span className="bl-next-rank num">{i + 1}</span>
                    <span className="bl-next-main">
                      <b>{p.pattern}</b>
                      <span className="bl-small">{p.why}</span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <span className="bl-small">No niche search yet. Run one on Rein&rsquo;s tab and Bil uses it here.</span>
            )}
          </>
        )}
        {shots.length > 0 && (
          <button type="button" className="bl-linkish bl-start" onClick={() => go(`campaigns.${shots[0].campaignId}`)}>
            See the shots planned posts are waiting on
          </button>
        )}
      </section>

      {kept.length > 0 && (
        <div className="bl-filter-row">
          <label className="bl-field" style={{ flex: '1 1 220px', minWidth: 0 }}>
            <span className="bl-label">Show</span>
            <select className="bl-input" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All files ({live.length})</option>
              {untagged.length > 0 && <option value="untagged">Untagged ({untagged.length})</option>}
              {fresh.length > 0 && fresh.length < live.length && <option value=":new">New ({fresh.length})</option>}
              {approved.length > 0 && <option value=":approved">Approved ({approved.length})</option>}
              {usedFiles.length > 0 && <option value=":used">Used ({usedFiles.length})</option>}
              {retired.length > 0 && <option value=":retired">Retired ({retired.length})</option>}
              <optgroup label={order === 'high' ? 'Tags, most used in best posts first' : 'Tags, least used in best posts first'}>
                {tagOrder.map((t) => (
                  <option key={t.tag} value={t.tag}>
                    {t.tag} ({t.files} {t.files === 1 ? 'file' : 'files'}{t.inBest ? `, in ${t.inBest} best posts` : ''})
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <div className="bl-seg" role="group" aria-label="Tag order">
            <button type="button" aria-pressed={order === 'high'} onClick={() => setOrder('high')}>
              High to low
            </button>
            <button type="button" aria-pressed={order === 'low'} onClick={() => setOrder('low')}>
              Low to high
            </button>
          </div>
        </div>
      )}

      {shown.length > 0 && (
        <ul className="bl-media-grid">
          {shown.map((i) => (
            <li key={i.id}>
              <button type="button" className="bl-tile" onClick={() => setOpenId(i.id)} aria-label={`${i.kind === 'video' ? 'Video' : 'Photo'}${i.tags.length ? `: ${i.tags.join(', ')}` : ', untagged'}`}>
                <Thumb item={i} url={urls[i.path]} />
                {i.kind === 'video' && <span className="bl-tile-badge num">{seconds(i.durationS) || 'Video'}</span>}
                {i.tags.length === 0 ? (
                  <span className="bl-tile-badge warn">Needs tags</span>
                ) : used.has(i.id) ? (
                  <span className="bl-tile-badge">Used</span>
                ) : planned.has(i.id) ? (
                  <span className="bl-tile-badge">In a plan</span>
                ) : i.status === 'approved' ? (
                  <span className="bl-tile-badge">Approved</span>
                ) : i.status === 'retired' ? (
                  <span className="bl-tile-badge">Retired</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      {removed.length > 0 && (
        <section className="bl-removed">
          <button type="button" className="bl-linkish" aria-expanded={showRemoved} onClick={() => setShowRemoved((s) => !s)}>
            Removed recently ({removed.length})
          </button>
          {showRemoved && (
            <ul>
              {removed.map((i) => (
                <li key={i.id}>
                  <span className="bl-removed-thumb">
                    <Thumb item={i} url={urls[i.path]} />
                  </span>
                  <span className="bl-small" style={{ flex: 1 }}>
                    {i.tags.join(', ') || 'Untagged'}. Gone for good on {goneOn(i.removedAt!)}.
                  </span>
                  <button
                    type="button"
                    className="bl-ghost"
                    onClick={() =>
                      void restoreFile(i.id).then(load, (e: Error) => setError(e.message))
                    }
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {open && (
        <TagSheet
          key={open.id}
          item={open}
          url={urls[open.path]}
          suggestions={[...new Set([...typeTags, ...[...tagOrder].sort((a, b) => b.files - a.files).slice(0, 8).map((t) => t.tag), ...BASE_TAGS])]}
          onClose={() => setOpenId(null)}
          onSaved={() => {
            setOpenId(null);
            void load();
          }}
          onError={setError}
        />
      )}
    </main>
  );
}

function TagSheet({
  item,
  url,
  suggestions,
  onClose,
  onSaved,
  onError,
}: {
  item: LibraryItem;
  url?: string;
  suggestions: string[];
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [tags, setTagList] = useState<string[]>(item.tags);
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState(item.note ?? '');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const [status, setStatusState] = useState<MediaStatus>(item.status);
  const [krisOk, setKrisOk] = useState(item.krisOk);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (t: string) => setTagList((s) => (s.includes(t) ? s.filter((x) => x !== t) : s.length >= 20 ? s : [...s, t]));
  const addTyped = () => {
    const c = cleanTag(typed);
    if (!c) {
      setHint('Use letters, numbers, spaces or dashes, up to 32 characters.');
      return;
    }
    setHint('');
    if (!tags.includes(c)) toggle(c);
    setTyped('');
  };

  async function save() {
    setBusy(true);
    try {
      await setTags(item.id, tags, note.trim() || null);
      if (status !== item.status || krisOk !== item.krisOk) await setStatus(item.id, status, krisOk && status !== 'retired');
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save the tags.');
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await removeFile(item.id);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not remove the file.');
      setBusy(false);
    }
  }

  const all = [...new Set([...tags, ...suggestions])];

  // Drawn into the app's root so it sits above the dock and keeps the theme's colours.
  const host = document.querySelector('.bl-root') ?? document.body;
  return createPortal(
    <div className="bl-sheet-back" onClick={onClose}>
      <section className="bl-sheet" role="dialog" aria-modal="true" aria-label="Tag this file" onClick={(e) => e.stopPropagation()}>
        <div className="bl-sheet-media">
          <Thumb item={item} url={url} big />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="bl-sheet-title">Tag this {item.kind}</h2>
          <button type="button" className="bl-ghost bl-round" aria-label="Close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <p className="bl-small" style={{ margin: 0 }}>
          Pick what is in it. Bil matches tags to the posts he plans.
        </p>
        <div className="bl-filters" role="group" aria-label="Tags">
          {all.map((t) => (
            <button key={t} type="button" className="bl-tagchip" aria-pressed={tags.includes(t)} onClick={() => toggle(t)}>
              {t}
            </button>
          ))}
        </div>
        <form
          style={{ display: 'flex', gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            addTyped();
          }}
        >
          <label className="bl-sr" htmlFor="newtag">
            Add your own tag
          </label>
          <input id="newtag" className="bl-input" value={typed} maxLength={32} placeholder="Your own tag" onChange={(e) => setTyped(e.target.value)} />
          <button type="submit" className="bl-ghost" disabled={!typed.trim()}>
            Add
          </button>
        </form>
        {hint && <p className="bl-small" style={{ margin: 0 }}>{hint}</p>}
        <label className="bl-small" htmlFor="note" style={{ marginBottom: -6 }}>
          Note for Bil (optional)
        </label>
        <textarea id="note" className="bl-input" rows={2} maxLength={300} value={note} placeholder="For example: only use after Friday" onChange={(e) => setNote(e.target.value)} />
        <div className="bl-field">
          <span className="bl-label">Status</span>
          <div className="bl-seg" role="group" aria-label="Status">
            {(
              [
                ['new', 'New'],
                ['approved', 'Approved'],
                ['retired', 'Retired'],
              ] as const
            ).map(([v, l]) => (
              <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatusState(v)}>
                {l}
              </button>
            ))}
          </div>
          <span className="bl-small">
            {status === 'retired' ? 'Kept for the record. Bil never plans with it again.' : status === 'approved' ? 'Good to use. Bil plans with it.' : 'Bil plans with it once it has tags.'}
          </span>
        </div>
        <label className="bl-brand-check">
          <input type="checkbox" checked={krisOk && status !== 'retired'} disabled={status === 'retired'} onChange={(e) => setKrisOk(e.target.checked)} />
          <span>OK for Kris to show. Only files with this on can ever appear on the client&rsquo;s Kris page.</span>
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <button type="button" className="bl-ghost bl-danger-text" onClick={() => void remove()} disabled={busy}>
            Remove
          </button>
          <button type="button" className="bl-btn" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving' : 'Save'}
          </button>
        </div>
        <p className="bl-small" style={{ margin: 0 }}>
          Removed files can be restored for 7 days, then they are deleted for good.
        </p>
      </section>
    </div>,
    host,
  );
}
