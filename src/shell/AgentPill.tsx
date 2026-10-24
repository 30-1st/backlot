import { useEffect, useRef, useState } from 'react';
import type { useWorkspace } from './data';
import { campaignTitle } from './Notifications';
import { Banter } from './Banter';

// A small live pill above the dock that follows Bil's background work across every screen:
//   working  "Bil is writing <campaign>", with a real progress bar (posts done of total).
//            Tap it to open the campaign. It hides on that campaign's own screen, where the
//            same progress already shows, and the x hides it for the rest of the visit.
//   done     When a campaign finishes while the app is open, the pill turns into a short
//            notice: how many posts wait for a yes, a way to review them, and Kris's note.
//            It stays 12 seconds, holds still while a finger or pointer is on it, and can be
//            closed. A failed campaign gets a plain notice with no jokes.
// Only changes seen during this visit raise a notice, so opening the app never replays old
// news (the Today screen already lists that).

const WORKING = new Set(['planning', 'drafting']);
const DONE_MS = 12_000;
const LEAVE_MS = 200;

type Done = { id: string; title: string; failed: boolean; waiting: number };

// Kept outside the component, so moving between Home and other screens (which remounts the
// pill) neither misses a finish nor drops a notice that is showing.
let seenIds: Set<string> | null = null;
let shownDone: Done | null = null;

export function AgentPill({ ws, go, here, docked, isTeam }: { ws: ReturnType<typeof useWorkspace>; go: (p: string) => void; here: string; docked: boolean; isTeam: boolean }) {
  const data = ws.data;
  const [done, setDoneState] = useState<Done | null>(shownDone);
  const setDone = (d: Done | null) => {
    shownDone = d;
    setDoneState(d);
  };
  const [leaving, setLeaving] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const held = useRef(false);

  useEffect(() => {
    if (!data) return;
    const now = new Set(data.campaigns.filter((c) => WORKING.has(c.status) && !c.hold).map((c) => c.id));
    const before = seenIds;
    seenIds = now;
    if (!before) return;
    for (const id of before) {
      if (now.has(id)) continue;
      const c = data.campaigns.find((x) => x.id === id);
      if (!c || c.hold) continue;
      setLeaving(false);
      setDone({
        id,
        title: campaignTitle(c),
        failed: c.status === 'failed',
        waiting: data.posts.filter((p) => p.campaignId === id && p.status === 'ok' && p.review === 'pending').length,
      });
      break;
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    setLeaving(true);
    window.setTimeout(() => {
      setDone(null);
      setLeaving(false);
    }, LEAVE_MS);
  };

  useEffect(() => {
    if (!done) return;
    let left = DONE_MS;
    let last = Date.now();
    const t = window.setInterval(() => {
      const n = Date.now();
      if (!held.current) left -= n - last;
      last = n;
      if (left <= 0) {
        window.clearInterval(t);
        close();
      }
    }, 250);
    return () => window.clearInterval(t);
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return null;
  const hold = {
    onPointerEnter: () => (held.current = true),
    onPointerLeave: () => (held.current = false),
    onFocus: () => (held.current = true),
    onBlur: () => (held.current = false),
  };
  const cls = `bl-pill${docked ? ' docked' : ''}${leaving ? ' leaving' : ''}`;

  if (done) {
    return (
      <div className={`${cls} ${done.failed ? 'failed' : 'done'}`} role="status" {...hold}>
        <span className="bl-pill-mark" aria-hidden="true">
          {done.failed ? (
            '!'
          ) : (
            <svg viewBox="0 0 16 16" width="14" height="14">
              <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <span className="bl-pill-text">
          <b>{done.failed ? `Bil hit a problem with ${done.title}` : `${done.title} is ready`}</b>
          <span>
            {done.failed
              ? 'Open it to see what happened and try again.'
              : done.waiting
                ? `${done.waiting} ${done.waiting === 1 ? 'post is' : 'posts are'} waiting for a yes.`
                : 'Bil finished writing.'}
          </span>
          {!done.failed && <Banter moment="done" after={900} counts={false} />}
        </span>
        <span className="bl-pill-actions">
          <button
            type="button"
            className="bl-pill-go"
            onClick={() => {
              close();
              go(`campaigns.${done.id}`);
            }}
          >
            {done.failed ? 'Open' : 'Review'}
          </button>
          {!done.failed && !isTeam && (
            <button
              type="button"
              className="bl-pill-link"
              onClick={() => {
                close();
                go('kris');
              }}
            >
              Kris&rsquo;s note
            </button>
          )}
        </span>
        <button type="button" className="bl-pill-x" aria-label="Close" onClick={close}>
          ×
        </button>
      </div>
    );
  }

  const working = data.campaigns.filter((c) => WORKING.has(c.status) && !c.hold && !hidden.has(c.id) && here !== `campaigns.${c.id}`);
  if (!working.length) return null;
  const c = working[0];
  const pct = c.postsTotal > 0 ? Math.round((c.postsDone / c.postsTotal) * 100) : 0;
  return (
    <div className={`${cls} working`}>
      <button type="button" className="bl-pill-main" onClick={() => go(`campaigns.${c.id}`)}>
        <span className="bl-dot bl-live" aria-hidden="true" />
        <span className="bl-pill-text">
          <b>
            Bil is {c.status === 'planning' ? 'planning' : 'writing'} {campaignTitle(c)}
          </b>
          <span>
            {c.status === 'planning' ? 'Working out the plan first.' : `${c.postsDone} of ${c.postsTotal} posts written`}
            {working.length > 1 ? `, and ${working.length - 1} more` : ''}
          </span>
        </span>
        <span className="bl-pill-bar" aria-hidden="true">
          <span style={{ width: `${c.status === 'planning' ? 4 : Math.max(4, pct)}%` }} />
        </span>
      </button>
      <button type="button" className="bl-pill-x" aria-label="Hide this for now" onClick={() => setHidden((h) => new Set(h).add(c.id))}>
        ×
      </button>
    </div>
  );
}
