import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { bil } from '../lib/team';
import type { ScreenProps } from './Shell';

// The engagement desk: posts worth answering or joining. Backlot never replies or likes.
// A person opens the post on X, acts by hand through X Delegate, then marks it here.
// Only post IDs and short excerpts are kept (excerpts clear after 24 hours), never who
// wrote them, and items go after 7 days.

type Item = {
  id: string;
  kind: 'reply' | 'conversation';
  postId: string;
  excerpt: string | null;
  topic: string | null;
  postedAt: string | null;
  status: 'open' | 'done' | 'skipped';
  foundAt: string;
};
type Show = 'open' | 'done' | 'skipped';

const REPLY_READS = 25;

function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (m < 60) return m <= 1 ? 'just now' : `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export function DeskScreen({ ws, single, isTeam }: ScreenProps) {
  const client = ws.data?.clients.find((c) => c.id === single) ?? null;
  const adult = Boolean((client?.profile as { adultContent?: unknown } | undefined)?.adultContent);
  const [items, setItems] = useState<Item[] | null>(null);
  const [show, setShow] = useState<Show>('open');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'' | 'free' | 'paid'>('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!supabase || !client) return;
    const { data, error: e } = await supabase
      .from('desk_items')
      .select('id, kind, post_id, excerpt, topic, posted_at, status, found_at')
      .eq('client_id', client.id)
      .order('found_at', { ascending: false })
      .limit(200);
    if (e) return setError(e.message);
    setItems(
      (data ?? []).map((r) => ({
        id: r.id,
        kind: r.kind === 'reply' ? 'reply' : 'conversation',
        postId: String(r.post_id),
        excerpt: r.excerpt ?? null,
        topic: r.topic ?? null,
        postedAt: r.posted_at ?? null,
        status: r.status,
        foundAt: r.found_at,
      })),
    );
  }, [client]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  if (!client) {
    return (
      <main className="bl-flow">
        <h1 className="bl-h1 bl-rise">Engagement desk</h1>
        <p className="bl-p bl-muted">Pick a client first.</p>
      </main>
    );
  }

  async function fill(replies: boolean) {
    setBusy(replies ? 'paid' : 'free');
    setError('');
    setNote('');
    try {
      const r = await bil.desk(client!.id, replies);
      const parts = [
        replies ? `${r.replies} ${r.replies === 1 ? 'reply or mention' : 'replies and mentions'} from the last 2 days` : '',
        r.adult ? '' : `${r.conversations} trend ${r.conversations === 1 ? 'post' : 'posts'}`,
      ].filter(Boolean);
      setNote(`Found ${parts.join(' and ') || 'nothing new'}${replies ? `, for $${r.costUsd.toFixed(2)}` : ''}. Anything already on the desk stays as it was.`);
      setConfirming(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The desk could not be filled right now.');
    } finally {
      setBusy('');
    }
  }

  async function mark(i: Item, status: Item['status']) {
    if (!supabase) return;
    setError('');
    const { error: e } = await supabase.rpc('desk_mark', { p_id: i.id, p_status: status });
    if (e) return setError(e.message);
    setItems((list) => (list ?? []).map((x) => (x.id === i.id ? { ...x, status } : x)));
  }

  const list = (items ?? []).filter((i) => i.status === show);
  const count = (s: Show) => (items ?? []).filter((i) => i.status === s).length;
  const replies = list.filter((i) => i.kind === 'reply');
  const convos = list.filter((i) => i.kind === 'conversation');
  const topics = [...new Set(convos.map((c) => c.topic ?? 'Rising now'))];

  const row = (i: Item) => (
    <li key={i.id} className="bl-desk-item">
      <p className="bl-desk-text">{i.excerpt ?? <span className="bl-muted">The excerpt is cleared after 24 hours. Open the post to read it.</span>}</p>
      <div className="bl-desk-meta">
        <span className="bl-small">{i.postedAt ? ago(i.postedAt) : `found ${ago(i.foundAt)}`}</span>
        <a className="bl-linkish" href={`https://x.com/i/status/${i.postId}`} target="_blank" rel="noopener noreferrer">
          Open on X
        </a>
      </div>
      <div className="bl-row-actions">
        {i.status === 'open' ? (
          <>
            <button type="button" className="bl-ghost" onClick={() => void mark(i, 'skipped')}>
              Skip
            </button>
            <button type="button" className="bl-btn" onClick={() => void mark(i, 'done')}>
              {i.kind === 'reply' ? 'Answered' : 'Joined'}
            </button>
          </>
        ) : (
          <button type="button" className="bl-ghost" onClick={() => void mark(i, 'open')}>
            Put back
          </button>
        )}
      </div>
    </li>
  );

  const estimate = (REPLY_READS * 0.005).toFixed(2);

  return (
    <main className="bl-flow">
      <div>
        <h1 className="bl-h1 bl-rise">Engagement desk</h1>
        <p className="bl-small" style={{ margin: '6px 0 0' }}>
          {isTeam ? `@${client.handle}. ` : ''}Posts worth answering or joining. Backlot never replies or likes: open the post on X, answer by hand as the client, then mark it here. Items go after 7 days.
        </p>
      </div>

      {isTeam && (
        <section className="bl-glass-card bl-brand-group" aria-labelledby="fill-t">
          <h2 id="fill-t" className="bl-section-title">
            Fill the desk
          </h2>
          {!adult && (
            <button type="button" className="bl-ghost" style={{ alignSelf: 'flex-start' }} disabled={busy !== ''} onClick={() => void fill(false)}>
              {busy === 'free' ? 'Pulling' : 'Pull posts from rising topics (free)'}
            </button>
          )}
          {confirming ? (
            <div className="bl-wash" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span>
                Up to ${estimate} from this month&rsquo;s AI budget: X charges $0.005 for each post it returns, {REPLY_READS} at most. It reads who replied to or mentioned @{client.handle} in the last 2 days.
              </span>
              <div className="bl-row-actions">
                <button type="button" className="bl-ghost" disabled={busy !== ''} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button type="button" className="bl-btn" disabled={busy !== ''} onClick={() => void fill(true)}>
                  {busy === 'paid' ? 'Reading X' : 'Check'}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="bl-btn" style={{ alignSelf: 'flex-start' }} disabled={busy !== ''} onClick={() => setConfirming(true)}>
              Check replies (up to ${estimate})
            </button>
          )}
          {adult && <p className="bl-small" style={{ margin: 0 }}>Adult niche: the desk shows replies to the client only, never posts from the wider niche.</p>}
        </section>
      )}

      {note && (
        <p className="bl-small" role="status" style={{ margin: 0 }}>
          {note}
        </p>
      )}
      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}

      {items === null && !error && <p className="bl-small" aria-busy="true">Loading the desk.</p>}

      {items && items.length > 0 && (
        <div className="bl-filters" role="group" aria-label="Show">
          {(
            [
              ['open', `To do ${count('open')}`],
              ['done', `Done ${count('done')}`],
              ['skipped', `Skipped ${count('skipped')}`],
            ] as Array<[Show, string]>
          ).map(([s, l]) => (
            <button key={s} type="button" className="bl-tagchip" aria-pressed={show === s} onClick={() => setShow(s)}>
              {l}
            </button>
          ))}
        </div>
      )}

      {items && list.length === 0 && (
        <div className="bl-glass-card">
          <b>{show === 'open' ? 'Nothing to do right now' : 'Nothing here'}</b>
          {show === 'open' && (
            <p className="bl-p bl-muted" style={{ margin: 0 }}>
              {isTeam ? 'Fill the desk above. Replies first: answering the people who reply to the client counts the most on X.' : 'Your team fills this when there are replies to answer.'}
            </p>
          )}
        </div>
      )}

      {replies.length > 0 && (
        <section aria-labelledby="rep-t">
          <h2 id="rep-t" className="bl-section-title">
            Replies and mentions <span className="num">{replies.length}</span>
          </h2>
          <ul className="bl-desk">{replies.map(row)}</ul>
        </section>
      )}

      {topics.map((t) => (
        <section key={t} aria-label={`Conversations about ${t}`}>
          <h2 className="bl-section-title">Join in: {t}</h2>
          <ul className="bl-desk">{convos.filter((c) => (c.topic ?? 'Rising now') === t).map(row)}</ul>
        </section>
      ))}
    </main>
  );
}
