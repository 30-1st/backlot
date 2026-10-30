import { useCallback, useEffect, useRef, useState } from 'react';
import { bil } from '../lib/team';
import { supabase } from '../lib/supabase';
import { coverBoxes, exportShot, loadShot, type Box } from '../lib/blur';
import type { ScreenProps } from './Shell';

// Xev: show her up to 3 screenshots of one sales conversation. Blur names and photos first
// (on this phone; the originals never leave it), and she tells you who the prospect is,
// where the chat stands on the buying-stage line, and 2 or 3 replies to send yourself.

const STAGES = [
  { key: 'first_contact', name: 'First contact' },
  { key: 'intrigue', name: 'Intrigue' },
  { key: 'value', name: 'Value' },
  { key: 'debate', name: 'Debate' },
  { key: 'decision', name: 'Decision' },
  { key: 'afterthought', name: 'Afterthought' },
  { key: 'loyalty', name: 'Loyalty' },
] as const;
type StageKey = (typeof STAGES)[number]['key'];

type Shot = { key: string; source: HTMLCanvasElement; boxes: Box[] };
type Thread = { id: string; label: string; stage: StageKey | null; updatedAt: string; outcome: string | null };
type Answer = {
  stop: boolean;
  stopReason: string | null;
  prospect: string[];
  stage: StageKey;
  stageWhy: string;
  moves: Array<{ reply: string; why: string; earns: string }>;
  coachNote: string;
  note: string;
};

/** One screenshot with drag-to-blur. */
function BlurEditor({ shot, onChange, onRemove }: { shot: Shot; onChange: (b: Box[]) => void; onRemove: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [live, setLive] = useState<Box | null>(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const shown = coverBoxes(shot.source, shot.boxes);
    c.width = shown.width;
    c.height = shown.height;
    const g = c.getContext('2d')!;
    g.drawImage(shown, 0, 0);
    if (live) {
      g.strokeStyle = '#3fd0c1';
      g.lineWidth = Math.max(2, c.width / 300);
      g.setLineDash([10, 8]);
      g.strokeRect(live.x, live.y, live.w, live.h);
    }
  }, [shot, live]);

  const at = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * shot.source.width, y: ((e.clientY - r.top) / r.height) * shot.source.height };
  };
  return (
    <div className="bl-xev-shot">
      <canvas
        ref={canvas}
        className="bl-xev-canvas"
        aria-label="Screenshot. Drag over names, usernames and photos to blur them."
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = at(e);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const p = at(e);
          setLive({ x: Math.min(drag.current.x, p.x), y: Math.min(drag.current.y, p.y), w: Math.abs(p.x - drag.current.x), h: Math.abs(p.y - drag.current.y) });
        }}
        onPointerUp={() => {
          if (live && live.w > 8 && live.h > 8) onChange([...shot.boxes, live]);
          drag.current = null;
          setLive(null);
        }}
      />
      <div className="bl-row-actions">
        <button type="button" className="bl-ghost" disabled={!shot.boxes.length} onClick={() => onChange(shot.boxes.slice(0, -1))}>
          Undo blur
        </button>
        <button type="button" className="bl-ghost" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}

export function XevScreen({ me, ws, single }: ScreenProps) {
  const client = ws.data?.clients.find((c) => c.id === single) ?? null;
  const [status, setStatus] = useState<{ left: number; allowed: number; unlimited: boolean } | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadId, setThreadId] = useState<string>('');
  const [label, setLabel] = useState('');
  const [shots, setShots] = useState<Shot[]>([]);
  const [note, setNote] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ readId: string; threadId: string | null; answer: Answer } | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [extra, setExtra] = useState('');
  const picker = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!client || !supabase) return;
    const [s, t] = await Promise.all([
      bil.xevStatus(client.id).catch(() => null),
      supabase.from('xev_threads').select('id, label, stage, updated_at, outcome').eq('client_id', client.id).order('updated_at', { ascending: false }).limit(20),
    ]);
    if (s) setStatus(s);
    setThreads((t.data ?? []).map((r) => ({ id: r.id, label: r.label, stage: r.stage, updatedAt: r.updated_at, outcome: r.outcome })));
  }, [client]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!client) {
    return (
      <main className="bl-flow">
        <h1 className="bl-h1 bl-rise">Xev</h1>
        <p className="bl-p">Xev coaches a client&rsquo;s sales chats. Pick a client first.</p>
      </main>
    );
  }

  async function add(files: FileList | null) {
    if (!files) return;
    setError('');
    const room = 3 - shots.length;
    const list = [...files].slice(0, room);
    try {
      const loaded = await Promise.all(list.map(async (f, i) => ({ key: `${Date.now()}-${i}`, source: await loadShot(f), boxes: [] as Box[] })));
      setShots((s) => [...s, ...loaded]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that picture.');
    }
  }

  async function read() {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const images = shots.map((s) => exportShot(coverBoxes(s.source, s.boxes)));
      const r = await bil.xevRead(client!.id, images, { threadId: threadId || undefined, label: threadId ? undefined : label.trim() || undefined, note: note.trim() || undefined });
      setResult({ readId: r.readId, threadId: r.threadId, answer: r.answer as Answer });
      if (r.threadId) setThreadId(r.threadId);
      setShots([]);
      setNote('');
      setOk(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xev could not read that right now.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, i: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      window.setTimeout(() => setCopied(null), 1500);
      if (result && i >= 0) void bil.xevFeedback(client!.id, { readId: result.readId, used: true });
    } catch {
      setError('Copy did not work here. Select the text and copy it.');
    }
  }

  const stageIndex = result ? STAGES.findIndex((s) => s.key === result.answer.stage) : -1;
  const canRead = shots.length > 0 && ok && !busy && (status?.unlimited || (status?.left ?? 0) > 0);

  return (
    <main className="bl-flow bl-xev">
      <div>
        <h1 className="bl-h1 bl-rise">Xev</h1>
        <p className="bl-p" style={{ margin: '6px 0 0' }}>
          Hi, I&rsquo;m Xev. Show me a sales chat and I&rsquo;ll tell you what he actually wants, where you are with him, and exactly what to send next. You do the sending, I do the scheming.
        </p>
        {status && (
          <span className="bl-small">
            {status.unlimited ? 'You can read as many as you like.' : `${status.left} of ${status.allowed} reads left.`}
          </span>
        )}
      </div>

      <section className="bl-glass-card bl-xev-form" aria-labelledby="xev-new">
        <h2 id="xev-new" className="bl-h2">
          Show Xev a chat
        </h2>
        <label className="bl-field">
          <span className="bl-label">Conversation</span>
          <select className="bl-input" value={threadId} onChange={(e) => setThreadId(e.target.value)}>
            <option value="">A new conversation</option>
            {threads.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
                {t.stage ? ` · ${STAGES.find((s) => s.key === t.stage)?.name}` : ''}
                {t.outcome ? ` · ${t.outcome === 'closed' ? 'closed' : 'did not close'}` : ''}
              </option>
            ))}
          </select>
        </label>
        {!threadId && (
          <label className="bl-field">
            <span className="bl-label">Call it something (no names)</span>
            <input className="bl-input" maxLength={60} value={label} placeholder="[For example: VIP question, Tuesday]" onChange={(e) => setLabel(e.target.value)} />
          </label>
        )}

        <input ref={picker} type="file" accept="image/jpeg,image/png" multiple hidden onChange={(e) => void add(e.target.files).then(() => (e.target.value = ''))} />
        {shots.length < 3 && (
          <button type="button" className="bl-ghost bl-start" onClick={() => picker.current?.click()}>
            {shots.length ? 'Add another screenshot' : 'Pick up to 3 screenshots'}
          </button>
        )}
        {shots.length > 0 && <span className="bl-small">Drag over names, usernames, profile photos and any picture in the chat to blur them. Blurring happens on this phone.</span>}
        {shots.map((s, i) => (
          <BlurEditor
            key={s.key}
            shot={s}
            onChange={(boxes) => setShots((all) => all.map((x, k) => (k === i ? { ...x, boxes } : x)))}
            onRemove={() => setShots((all) => all.filter((_, k) => k !== i))}
          />
        ))}

        <label className="bl-field">
          <span className="bl-label">A note for Xev (optional)</span>
          <input className="bl-input" maxLength={300} value={note} placeholder="[For example: he asked about the VIP price]" onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="bl-check-line">
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I may share this chat, and names and photos are blurred.
        </label>
        <button type="button" className="bl-btn bl-start" disabled={!canRead} onClick={() => void read()}>
          {busy ? 'Xev is reading' : 'Read it, Xev'}
        </button>
        <span className="bl-small">Screenshots are read once and never saved. Xev keeps only a short note of where the chat stands, for 30 days.</span>
        {error && (
          <p className="bl-error" role="alert">
            {error}
          </p>
        )}
      </section>

      {result && (
        <section className="bl-glass-card bl-xev-answer" aria-labelledby="xev-a" aria-live="polite">
          <h2 id="xev-a" className="bl-h2">
            Xev&rsquo;s read
          </h2>
          {result.answer.stop && (
            <div className="bl-wash" role="alert">
              <b>Time to stop selling here.</b>
              <p className="bl-small" style={{ margin: '4px 0 0' }}>{result.answer.stopReason}</p>
            </div>
          )}
          <p className="bl-p" style={{ margin: 0 }}>{result.answer.coachNote}</p>

          <div>
            <span className="bl-label">Where you are</span>
            <ol className="bl-xev-line" aria-label="Buying stage">
              {STAGES.map((s, i) => (
                <li key={s.key} className={i === stageIndex ? 'is-now' : i < stageIndex ? 'is-past' : ''} aria-current={i === stageIndex ? 'step' : undefined}>
                  <span className="bl-xev-dot" aria-hidden="true" />
                  <span>{s.name}</span>
                </li>
              ))}
            </ol>
            <span className="bl-small">{result.answer.stageWhy}</span>
          </div>

          {result.answer.prospect.length > 0 && (
            <div>
              <span className="bl-label">The prospect</span>
              <ul className="bl-report-list">{result.answer.prospect.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}

          <div className="bl-xev-moves">
            <span className="bl-label">{result.answer.stop ? 'A kind way out' : 'Send one of these'}</span>
            {result.answer.moves.map((m, i) => (
              <div key={i} className="bl-xev-move">
                <p className="bl-postcard-text">{m.reply}</p>
                <span className="bl-small">
                  {m.why} <b>Aims for: {m.earns}</b>
                </span>
                <button type="button" className="bl-ghost bl-start" onClick={() => void copy(m.reply, i)}>
                  {copied === i ? 'Copied' : 'Copy'}
                </button>
              </div>
            ))}
          </div>

          {result.answer.note && (
            <div>
              <span className="bl-label">For your own notes</span>
              <p className="bl-small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{result.answer.note}</p>
              <button type="button" className="bl-ghost bl-start" onClick={() => void copy(result.answer.note, -1)}>
                {copied === -1 ? 'Copied' : 'Copy the note'}
              </button>
            </div>
          )}

          {result.threadId && (
            <div className="bl-row-actions">
              <button type="button" className="bl-ghost" onClick={() => void bil.xevFeedback(client.id, { threadId: result.threadId!, outcome: 'closed' }).then(load)}>
                Closed it
              </button>
              <button type="button" className="bl-ghost" onClick={() => void bil.xevFeedback(client.id, { threadId: result.threadId!, outcome: 'not_closed' }).then(load)}>
                Didn&rsquo;t close
              </button>
            </div>
          )}
        </section>
      )}

      {me.role === 'owner' && (
        <section className="bl-glass-card bl-xev-form" aria-labelledby="xev-grant">
          <h2 id="xev-grant" className="bl-h2">
            Extra reads for @{client.handle}
          </h2>
          <span className="bl-small">3 are free. Until payments open, you grant more here.</span>
          <div className="bl-row-actions">
            <label className="bl-sr" htmlFor="xev-extra">
              Extra reads
            </label>
            <input id="xev-extra" className="bl-input" style={{ width: 110 }} type="number" min={0} max={1000} value={extra} placeholder="0" onChange={(e) => setExtra(e.target.value)} />
            <button
              type="button"
              className="bl-btn"
              disabled={extra === ''}
              onClick={() =>
                void bil.xevGrant(client.id, Math.max(0, Math.min(1000, Number(extra) || 0))).then(
                  () => load(),
                  (e: unknown) => setError(e instanceof Error ? e.message : 'Could not save that.'),
                )
              }
            >
              Save
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
