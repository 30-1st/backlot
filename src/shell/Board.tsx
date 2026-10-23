import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FADE_DAYS,
  addLink,
  addShot,
  cleanPostUrl,
  daysLeft,
  handleOf,
  isFaded,
  listBoard,
  refuseShot,
  removeItem,
  setItem,
  shotUrls,
  type BoardItem,
  type Verdict,
} from '../lib/board';
import { plural } from '../lib/format';
import { campaignTitle } from './Notifications';
import type { ScreenProps } from './Shell';

// The inspiration board: X posts and screenshots the client or team want more of, or less
// of. A short note says what about it. Bil reads the verdict and the note before he plans,
// names the items a plan leaned on, and never sees the screenshot or the linked post.

const MAX_ITEMS = 150;
type Filter = 'live' | 'more' | 'not' | 'faded';

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function BoardScreen({ me, ws, single, isTeam, go }: ScreenProps) {
  const clientId = single;
  const client = ws.data?.clients.find((c) => c.id === clientId) ?? null;
  const [items, setItems] = useState<BoardItem[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('live');
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    try {
      const list = await listBoard(clientId);
      setItems(list);
      setError('');
      setUrls(await shotUrls(list.flatMap((i) => (i.path ? [i.path] : []))));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the board.');
    }
  }, [clientId]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  // Which campaigns leaned on each item, from the plans Bil wrote.
  const usedBy = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const c of ws.data?.campaigns ?? []) {
      if (c.clientId !== clientId) continue;
      const ids = (c.plan as { inspiredBy?: unknown } | null)?.inspiredBy;
      if (!Array.isArray(ids)) continue;
      for (const id of ids) out.set(String(id), [...(out.get(String(id)) ?? []), campaignTitle(c)]);
    }
    return out;
  }, [ws.data, clientId]);

  if (!clientId || !client) {
    return (
      <main className="bl-flow">
        <h1 className="bl-h1 bl-rise">Board</h1>
        <div className="bl-glass-card">
          <b>No client yet</b>
          <p className="bl-p bl-muted" style={{ margin: 0 }}>
            The board belongs to a client. Bring in a client first.
          </p>
        </div>
      </main>
    );
  }

  const kept = (items ?? []).filter((i) => !i.removedAt);
  const removed = (items ?? []).filter((i) => i.removedAt);
  const live = kept.filter((i) => !isFaded(i));
  const faded = kept.filter((i) => isFaded(i));
  const shown = filter === 'faded' ? faded : live.filter((i) => filter === 'live' || i.verdict === filter);
  const more = live.filter((i) => i.verdict === 'more').length;

  async function act(work: () => Promise<void>): Promise<boolean> {
    setError('');
    try {
      await work();
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
      return false;
    }
  }

  return (
    <main className="bl-flow bl-board">
      <div>
        <h1 className="bl-h1 bl-rise">Board</h1>
        <p className="bl-small" style={{ margin: '6px 0 0' }}>
          {isTeam ? `@${client.handle}. ` : ''}Posts and looks you want more of, or less of. Bil reads your notes before he plans, never the pictures. Items fade after {FADE_DAYS} days unless pinned.
        </p>
      </div>

      <AddItem
        full={kept.length >= MAX_ITEMS}
        onAdd={(kind, value, verdict, note) =>
          act(() => (kind === 'link' ? addLink(clientId, value as string, verdict, note) : addShot(me.workspaceId, clientId, value as File, verdict, note)))
        }
      />

      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}

      {items === null ? (
        <p className="bl-small" aria-busy="true">
          Loading the board.
        </p>
      ) : kept.length === 0 ? (
        <div className="bl-glass-card">
          <b>Nothing on the board yet</b>
          <p className="bl-p bl-muted" style={{ margin: 0 }}>
            Paste a link to an X post you love, or one you never want to sound like, and say what about it in a few words. A screenshot works too.
          </p>
        </div>
      ) : (
        <>
          <div className="bl-filters" role="group" aria-label="Show">
            {(
              [
                ['live', `In use ${live.length}`],
                ['more', `More like this ${more}`],
                ['not', `Not this ${live.length - more}`],
                ...(faded.length ? [['faded', `Faded ${faded.length}`]] : []),
              ] as Array<[Filter, string]>
            ).map(([f, label]) => (
              <button key={f} type="button" className="bl-tagchip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {label}
              </button>
            ))}
          </div>
          {filter === 'faded' && <p className="bl-small" style={{ margin: 0 }}>Bil no longer reads these. Pin one to bring it back. Unpinned items go for good at 90 days.</p>}
          {shown.length === 0 && <p className="bl-small">Nothing here.</p>}
          <ul className="bl-board-list">
            {shown.map((i) => (
              <li key={i.id} className={`bl-glass-card bl-board-item${isFaded(i) ? ' is-faded' : ''}`}>
                {i.kind === 'shot' ? (
                  <a className="bl-board-shot" href={i.path ? urls[i.path] : undefined} target="_blank" rel="noopener noreferrer" aria-label="Open the screenshot">
                    {i.path && urls[i.path] ? <img src={urls[i.path]} alt="" loading="lazy" /> : <span className="bl-small">Screenshot</span>}
                  </a>
                ) : (
                  <a className="bl-board-link" href={i.url ?? undefined} target="_blank" rel="noopener noreferrer">
                    <span className="bl-board-x" aria-hidden="true">X</span>
                    <span className="bl-ellipsis">Post by @{handleOf(i.url ?? '')}</span>
                    <span className="bl-small">Opens on X</span>
                  </a>
                )}
                {editing === i.id ? (
                  <EditItem
                    item={i}
                    onCancel={() => setEditing(null)}
                    onSave={(verdict, note) =>
                      act(async () => {
                        await setItem(i.id, verdict, note, i.pinned);
                        setEditing(null);
                      })
                    }
                  />
                ) : (
                  <>
                    <div className="bl-board-meta">
                      <span className={`bl-chip-ink${i.verdict === 'not' ? ' bad' : ''}`}>{i.verdict === 'more' ? 'More like this' : 'Not this'}</span>
                      <span className="bl-small">
                        {day(i.createdAt)} · {i.pinned ? 'Pinned' : isFaded(i) ? 'Faded' : `Fades in ${daysLeft(i)} ${plural(daysLeft(i), 'day')}`}
                      </span>
                    </div>
                    <p className="bl-p" style={{ margin: 0 }}>
                      {i.note}
                    </p>
                    {(usedBy.get(i.id) ?? []).length > 0 && (
                      <p className="bl-small" style={{ margin: 0 }}>
                        Bil leaned on this for {usedBy.get(i.id)!.join(', ')}.
                      </p>
                    )}
                    <div className="bl-row-actions">
                      <button type="button" className="bl-ghost" aria-pressed={i.pinned} onClick={() => void act(() => setItem(i.id, i.verdict, i.note, !i.pinned))}>
                        {i.pinned ? 'Unpin' : 'Pin'}
                      </button>
                      <button type="button" className="bl-ghost" onClick={() => setEditing(i.id)}>
                        Edit
                      </button>
                      <button type="button" className="bl-ghost" onClick={() => void act(() => removeItem(i.id, true))}>
                        Remove
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {removed.length > 0 && (
        <section className="bl-glass-card" aria-labelledby="removed-title">
          <b id="removed-title">Removed in the last 7 days</b>
          <ul className="bl-board-removed">
            {removed.map((i) => (
              <li key={i.id}>
                <span className="bl-small bl-ellipsis">{i.note}</span>
                <button type="button" className="bl-linkish" onClick={() => void act(() => removeItem(i.id, false))}>
                  Put back
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isTeam && (
        <p className="bl-small" style={{ margin: 0 }}>
          Plans list the items they leaned on. Start one from{' '}
          <button type="button" className="bl-linkish" onClick={() => go('create.plan')}>
            Plan a campaign
          </button>
          .
        </p>
      )}
    </main>
  );
}

function VerdictPick({ value, onChange }: { value: Verdict; onChange: (v: Verdict) => void }) {
  return (
    <div className="bl-seg" role="group" aria-label="Verdict">
      <button type="button" aria-pressed={value === 'more'} onClick={() => onChange('more')}>
        More like this
      </button>
      <button type="button" aria-pressed={value === 'not'} onClick={() => onChange('not')}>
        Not this
      </button>
    </div>
  );
}

function AddItem({ full, onAdd }: { full: boolean; onAdd: (kind: 'link' | 'shot', value: string | File, verdict: Verdict, note: string) => Promise<boolean> }) {
  const [kind, setKind] = useState<'link' | 'shot'>('link');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [verdict, setVerdict] = useState<Verdict>('more');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const linkOk = kind === 'link' ? Boolean(cleanPostUrl(url)) : Boolean(file);
  const noteOk = note.trim().length >= 3;

  async function submit() {
    if (!linkOk) return setWhy(kind === 'link' ? 'Paste a link to one X post, like x.com/handle/status/123.' : 'Choose a screenshot first.');
    if (!noteOk) return setWhy('Add a few words on what about it, so Bil knows what to take from it.');
    setBusy(true);
    setWhy('');
    try {
      if (await onAdd(kind, kind === 'link' ? url : file!, verdict, note.trim())) {
        setUrl('');
        setFile(null);
        setNote('');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bl-glass-card bl-brand-group" aria-labelledby="add-title">
      <h2 id="add-title" className="bl-section-title">
        Add to the board
      </h2>
      <div className="bl-seg" role="group" aria-label="What to add">
        <button type="button" aria-pressed={kind === 'link'} onClick={() => setKind('link')}>
          X link
        </button>
        <button type="button" aria-pressed={kind === 'shot'} onClick={() => setKind('shot')}>
          Screenshot
        </button>
      </div>
      {kind === 'link' ? (
        <label className="bl-field">
          <span className="bl-label">Link to the post</span>
          <input className="bl-input" inputMode="url" autoComplete="off" spellCheck={false} value={url} maxLength={500} placeholder="https://x.com/handle/status/123" onChange={(e) => setUrl(e.target.value)} />
        </label>
      ) : (
        <div className="bl-board-pick">
          {preview && <img src={preview} alt="The screenshot you chose" />}
          <button type="button" className="bl-ghost" onClick={() => picker.current?.click()}>
            {file ? 'Choose another' : 'Choose a screenshot'}
          </button>
          <input
            ref={picker}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif,.heic,.heif"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = '';
              if (!f) return;
              const no = refuseShot(f);
              setWhy(no ?? '');
              if (!no) setFile(f);
            }}
          />
        </div>
      )}
      <VerdictPick value={verdict} onChange={setVerdict} />
      <label className="bl-field">
        <span className="bl-label">What about it</span>
        <textarea
          className="bl-input"
          rows={2}
          maxLength={280}
          value={note}
          placeholder={verdict === 'more' ? 'For example: the first line asks a question, short and warm' : 'For example: too salesy, reads like an ad'}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {why && (
        <p className="bl-error" role="alert" style={{ margin: 0 }}>
          {why}
        </p>
      )}
      <button type="button" className="bl-btn" style={{ alignSelf: 'flex-start' }} disabled={busy || full} onClick={() => void submit()}>
        {full ? 'The board is full' : busy ? 'Adding' : 'Add it'}
      </button>
    </section>
  );
}

function EditItem({ item, onSave, onCancel }: { item: BoardItem; onSave: (v: Verdict, note: string) => Promise<boolean>; onCancel: () => void }) {
  const [verdict, setVerdict] = useState<Verdict>(item.verdict);
  const [note, setNote] = useState(item.note);
  const [busy, setBusy] = useState(false);
  return (
    <div className="bl-brand-group">
      <VerdictPick value={verdict} onChange={setVerdict} />
      <label className="bl-field">
        <span className="bl-label">What about it</span>
        <textarea className="bl-input" rows={2} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="bl-row-actions">
        <button type="button" className="bl-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="bl-btn"
          disabled={busy || note.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(verdict, note.trim());
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
