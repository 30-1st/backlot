import { useCallback, useEffect, useRef, useState } from 'react';
import { bil } from '../lib/team';
import { addFile, listLibrary, refuse, smallCopy, type LibraryItem } from '../lib/clientMedia';
import { PostMedia } from './PostMedia';
import { isNextPost } from './Notifications';
import type { ScreenProps } from './Shell';

// Up next (approved Nov 6, 2026): the client, or their team, makes the next post in three
// picks. 1) The goal it is for, from the goals they saved (editable right here). 2) The photo
// or video, each marked by Bil for that goal: green fits, yellow somewhat, red not at all,
// gray not tagged yet. New files can be added here and Bil tags them. 3) Anything Bil should
// know. Bil writes it with Xev (her selling rules and tips for money goals), and it lands
// first on Today and the Schedule for a yes. Nothing is posted; the client posts it.

type Goal = { goal: string; detail: string; target?: string };
type Fit = { fit: 'green' | 'yellow' | 'red'; why: string };

const KINDS: Array<[string, string]> = [
  ['sales', 'Sales'],
  ['leads', 'Leads'],
  ['bookings', 'Bookings'],
  ['followers', 'Followers'],
  ['community', 'Community'],
  ['awareness', 'Awareness'],
];
const kindWord = (k: string) => KINDS.find(([v]) => v === k)?.[1] ?? k;
const LEGEND: Array<[Fit['fit'] | 'none', string]> = [
  ['green', 'Fits the goal'],
  ['yellow', 'Could work'],
  ['red', 'Not for this goal'],
  ['none', 'Not tagged yet'],
];

export function UpNextScreen({ me, ws, go, single, isTeam, pick }: ScreenProps & { pick?: (id: string) => void }) {
  const clients = ws.data?.clients ?? [];
  const client = clients.find((c) => c.id === single) ?? null;
  const adult = Boolean((client?.profile as { adultContent?: boolean } | undefined)?.adultContent);
  const goals: Goal[] = Array.isArray(client?.profile?.goals) ? (client!.profile.goals as Goal[]) : [];

  const [goalIndex, setGoalIndex] = useState<number | null>(null);
  const [files, setFiles] = useState<LibraryItem[] | null>(null);
  const [fits, setFits] = useState<Record<string, Fit>>({});
  const [scoring, setScoring] = useState(false);
  const [mediaId, setMediaId] = useState<string | 'text' | null>(null);
  const [note, setNote] = useState('');
  const [product, setProduct] = useState<string | null>(null);
  const products: Array<{ name: string; price?: string }> = Array.isArray(client?.profile?.offers) ? (client!.profile.offers as Array<{ name: string; price?: string }>) : [];
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [started, setStarted] = useState<string | null>(null);
  const [allowance, setAllowance] = useState<{ used: number; allowed: number } | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    if (!client) return;
    try {
      setFiles((await listLibrary(client.id)).filter((f) => !f.removedAt && f.status !== 'retired'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load Media.');
    }
  }, [client]);

  const score = useCallback(
    async (i: number) => {
      if (!client) return;
      setScoring(true);
      try {
        setFits((await bil.mediaFit(client.id, i)).fits ?? {});
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Bil could not score the files.');
      } finally {
        setScoring(false);
      }
    },
    [client],
  );

  useEffect(() => {
    setGoalIndex(null);
    setFits({});
    setMediaId(null);
    setStarted(null);
    void loadFiles();
    if (client && !isTeam) bil.nextAllowance(client.id).then((a) => setAllowance(typeof a?.allowed === 'number' ? a : null), () => setAllowance(null));
  }, [client?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once Bil is writing, watch for the post to land.
  const job = started ? ws.data?.campaigns.find((c) => c.id === started) : null;
  const done = job && (job.status === 'ready' || job.status === 'approved' || job.status === 'failed');
  useEffect(() => {
    if (!started || done) return;
    const t = window.setInterval(() => void ws.refresh(), 6000);
    return () => window.clearInterval(t);
  }, [started, done, ws]);

  if (!ws.data) return <main aria-busy="true" />;

  if (!client) {
    return (
      <main className="bl-flow">
        <h1 className="bl-h1 bl-rise">Up next</h1>
        <p className="bl-p bl-muted" style={{ margin: 0 }}>
          Pick the client this post is for.
        </p>
        <ul className="bl-rows">
          {clients.map((c) => (
            <li key={c.id}>
              <button type="button" className="bl-row" onClick={() => pick?.(c.id)}>
                <span className="bl-row-txt">
                  <b>@{c.handle}</b>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  if (editing) return <GoalsEditor clientId={client.id} goals={goals} onDone={async () => { await ws.refresh(); setEditing(false); setGoalIndex(null); setFits({}); }} onBack={() => setEditing(false)} />;

  async function upload(list: FileList) {
    if (!client) return;
    setError('');
    const added: Array<{ id: string; file: File }> = [];
    for (const f of [...list]) {
      const why = refuse(f);
      if (why) {
        setError(why);
        continue;
      }
      setUploading(`Adding ${f.name}`);
      try {
        added.push({ id: await addFile(me.workspaceId, client.id, f), file: f });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed.');
      }
    }
    // Bil tags new files from a small copy made here (not for adult accounts: tag those by hand in Media).
    if (!adult) {
      for (const a of added) {
        setUploading('Bil is tagging it');
        try {
          await bil.mediaTag(client.id, a.id, await smallCopy({ file: a.file }, a.file.type.startsWith('video/') ? 'video' : 'photo'));
        } catch {
          // Untagged files stay gray; they can be tagged in Media.
        }
      }
    }
    setUploading('');
    await loadFiles();
    if (added[0]) setMediaId(added[0].id);
    if (goalIndex !== null) await score(goalIndex);
  }

  async function write() {
    if (!client || goalIndex === null || !mediaId) return;
    setBusy(true);
    setError('');
    try {
      const r = await bil.nextPost(client.id, goalIndex, mediaId === 'text' ? null : mediaId, note.trim() || undefined, product ?? undefined);
      setStarted(r.campaignId);
      await ws.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bil could not start it.');
    } finally {
      setBusy(false);
    }
  }

  const live = (files ?? []).slice().sort((a, b) => rank(fits[a.id]) - rank(fits[b.id]));
  const chosen = mediaId && mediaId !== 'text' ? live.find((f) => f.id === mediaId) : null;
  const writingNow = ws.data.campaigns.some((c) => c.clientId === client.id && isNextPost(c) && (c.status === 'planning' || c.status === 'drafting'));

  if (started) {
    return (
      <main className="bl-flow">
        <h1 className="bl-h1 bl-rise">Up next</h1>
        <section className="bl-cmd-card" aria-live="polite">
          {!done ? (
            <>
              <b>Bil and Xev are writing it.</b>
              <span className="bl-small">About a minute. You can leave this screen; it lands first on Today and the Schedule.</span>
            </>
          ) : job?.status === 'failed' ? (
            <>
              <b>That one did not work.</b>
              <span className="bl-small">Nothing was posted. Try again in a minute.</span>
            </>
          ) : (
            <>
              <b>Your next post is ready.</b>
              <span className="bl-small">{ws.data.posts.some((p) => p.campaignId === job?.id && p.status === 'blocked') ? 'It needs one detail from you first.' : 'It is first in line, waiting for a yes.'}</span>
            </>
          )}
          <div className="bl-row-actions">
            <button type="button" className="bl-btn" onClick={() => go('campaigns')}>
              See it on the Schedule
            </button>
            <button type="button" className="bl-ghost" onClick={() => { setStarted(null); setMediaId(null); setNote(''); }}>
              Make another
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="bl-flow bl-wide bl-upn">
      <div className="bl-sched-top">
        <h1 className="bl-h1 bl-rise">Up next</h1>
        {allowance && <span className="bl-small">{Math.max(0, allowance.allowed - allowance.used)} of {allowance.allowed} left this month</span>}
      </div>
      <p className="bl-p bl-muted" style={{ margin: '-6px 0 0' }}>
        Pick the goal and the photo or video. Bil writes the post with Xev, and it goes first on your Schedule for your yes.
      </p>

      <section className="bl-cmd-card" aria-labelledby="upn-goal">
        <div className="bl-sched-top">
          <h2 id="upn-goal" className="bl-section-title">
            1. What is it for?
          </h2>
          <button type="button" className="bl-linkish" onClick={() => setEditing(true)}>
            {goals.length ? 'Edit goals' : 'Add a goal'}
          </button>
        </div>
        {goals.length === 0 ? (
          <p className="bl-small" style={{ margin: 0 }}>
            No goals saved yet. Add one to start.
          </p>
        ) : (
          <div className="bl-upn-goals" role="radiogroup" aria-label="Goal">
            {goals.map((g, i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={goalIndex === i}
                className={`bl-upn-goal${goalIndex === i ? ' on' : ''}`}
                onClick={() => {
                  setGoalIndex(i);
                  void score(i);
                }}
              >
                <b>{kindWord(g.goal)}</b>
                <span>{g.detail}</span>
                {g.target && <small>Target: {g.target}</small>}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="bl-cmd-card" aria-labelledby="upn-media">
        <div className="bl-sched-top">
          <h2 id="upn-media" className="bl-section-title">
            2. Which photo or video?
          </h2>
          <button type="button" className="bl-ghost" disabled={Boolean(uploading)} onClick={() => picker.current?.click()}>
            {uploading || 'Add photos or videos'}
          </button>
          <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple hidden onChange={(e) => e.target.files && void upload(e.target.files)} />
        </div>
        {goalIndex !== null && (
          <ul className="bl-upn-legend" aria-label="What the colors mean">
            {LEGEND.map(([k, w]) => (
              <li key={k}>
                <span className={`bl-fit ${k}`} aria-hidden="true" />
                {w}
              </li>
            ))}
            {scoring && <li className="bl-small">Bil is scoring them</li>}
          </ul>
        )}
        {files === null ? (
          <p className="bl-small" aria-busy="true">
            Loading Media.
          </p>
        ) : (
          <ul className="bl-upn-grid" aria-label="Your Media">
            <li>
              <button type="button" className={`bl-upn-tile text${mediaId === 'text' ? ' on' : ''}`} aria-pressed={mediaId === 'text'} onClick={() => setMediaId('text')}>
                <span>Aa</span>
                <small>Text only</small>
              </button>
            </li>
            {live.map((f) => {
              const fit = fits[f.id];
              const k = goalIndex === null ? null : fit ? fit.fit : 'none';
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    className={`bl-upn-tile${mediaId === f.id ? ' on' : ''}`}
                    aria-pressed={mediaId === f.id}
                    aria-label={`${f.kind}${f.tags.length ? `: ${f.tags.join(', ')}` : ''}${k ? `. ${LEGEND.find(([x]) => x === k)?.[1]}` : ''}`}
                    onClick={() => setMediaId(f.id)}
                  >
                    <PostMedia id={f.id} size="thumb" />
                    {k && <span className={`bl-fit ${k}`} aria-hidden="true" />}
                    {f.kind === 'video' && <small className="bl-upn-vid">Video</small>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {chosen && (
          <p className="bl-small" style={{ margin: 0 }}>
            {chosen.tags.length ? chosen.tags.join(', ') : 'Not tagged yet'}
            {goalIndex !== null && fits[chosen.id] ? `. Bil: ${fits[chosen.id].why}` : ''}
          </p>
        )}
      </section>

      <section className="bl-cmd-card" aria-labelledby="upn-note">
        <div className="bl-sched-top">
          <h2 id="upn-note" className="bl-section-title">
            3. Feature a product? <span className="bl-small">(optional)</span>
          </h2>
          <button type="button" className="bl-linkish" onClick={() => go('products')}>
            {products.length ? 'Edit products' : 'Add products'}
          </button>
        </div>
        {products.length > 0 && (
          <div className="bl-upn-chips" role="radiogroup" aria-label="Product">
            {products.map((p) => (
              <button key={p.name} type="button" role="radio" aria-checked={product === p.name} className={`bl-chip-pick${product === p.name ? ' on' : ''}`} onClick={() => setProduct(product === p.name ? null : p.name)}>
                {p.name}
                {p.price ? ` · ${p.price}` : ''}
              </button>
            ))}
          </div>
        )}
        <h3 className="bl-label" style={{ margin: '6px 0 0' }}>
          Anything Bil should know? (optional)
        </h3>
        <textarea className="bl-input" rows={2} maxLength={240} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: a small coffee send, playful, mention the new set" />
      </section>

      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}
      <div className="bl-row-actions">
        <button type="button" className="bl-btn" disabled={busy || writingNow || goalIndex === null || !mediaId} onClick={() => void write()}>
          {busy || writingNow ? 'Bil is writing' : 'Write it with Bil and Xev'}
        </button>
        <span className="bl-small">{isTeam ? 'About 5 to 15 cents.' : 'Included in your plan.'}</span>
      </div>
    </main>
  );
}

const rank = (f: Fit | undefined) => (f ? { green: 0, yellow: 1, red: 2 }[f.fit] : 3);

/** The client's goals, edited and saved without leaving Up next. */
function GoalsEditor({ clientId, goals, onDone, onBack }: { clientId: string; goals: Goal[]; onDone: () => Promise<void>; onBack: () => void }) {
  const [list, setList] = useState<Goal[]>(goals.length ? goals.map((g) => ({ goal: g.goal, detail: g.detail ?? '', target: g.target ?? '' })) : [{ goal: 'sales', detail: '', target: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (i: number, patch: Partial<Goal>) => setList(list.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  async function save() {
    setBusy(true);
    setError('');
    try {
      await bil.goalsSave(clientId, list.map((g) => ({ goal: g.goal, detail: g.detail.trim(), ...(g.target?.trim() ? { target: g.target.trim() } : {}) })));
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the goals.');
      setBusy(false);
    }
  }
  return (
    <main className="bl-flow">
      <button type="button" className="bl-linkish" style={{ alignSelf: 'flex-start' }} onClick={onBack}>
        ‹ Back to Up next
      </button>
      <h1 className="bl-h1 bl-rise">Goals</h1>
      <p className="bl-p bl-muted" style={{ margin: '-6px 0 0' }}>
        What the posts are working toward. Bil plans and writes for these.
      </p>
      {list.map((g, i) => (
        <section key={i} className="bl-cmd-card">
          <label className="bl-label" htmlFor={`g-kind-${i}`}>
            Goal {i + 1}
          </label>
          <select id={`g-kind-${i}`} className="bl-input" value={g.goal} onChange={(e) => set(i, { goal: e.target.value })}>
            {KINDS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <input className="bl-input" maxLength={280} value={g.detail} placeholder="In your words, e.g. small coffee sends from new fans" aria-label={`Goal ${i + 1} in your words`} onChange={(e) => set(i, { detail: e.target.value })} />
          <input className="bl-input" maxLength={120} value={g.target ?? ''} placeholder="Target, optional, e.g. 10 a week" aria-label={`Goal ${i + 1} target`} onChange={(e) => set(i, { target: e.target.value })} />
          {list.length > 1 && (
            <button type="button" className="bl-linkish" style={{ alignSelf: 'flex-start' }} onClick={() => setList(list.filter((_, j) => j !== i))}>
              Remove this goal
            </button>
          )}
        </section>
      ))}
      {list.length < 5 && (
        <button type="button" className="bl-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setList([...list, { goal: 'followers', detail: '', target: '' }])}>
          Add a goal
        </button>
      )}
      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}
      <div className="bl-row-actions">
        <button type="button" className="bl-btn" disabled={busy || list.some((g) => !g.detail.trim())} onClick={() => void save()}>
          {busy ? 'Saving' : 'Save and go back'}
        </button>
      </div>
    </main>
  );
}
