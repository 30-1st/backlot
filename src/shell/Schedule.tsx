import { useMemo, useState } from 'react';
import { bil } from '../lib/team';
import { PostMedia, ShotFrame } from './PostMedia';
import { clock, dayParts, timedPosts, todayIn, wantsMedia, type Timed } from './timing';
import type { ScreenProps } from './Shell';

// Schedule: one day at a time. Each post shows its photo or video first, then its time,
// its first line, and what to do with it. Approving here is one tap.

function statusWord(t: Timed): { word: string; cls: string } {
  if (t.post.status === 'blocked') return { word: 'Needs a detail', cls: 'bad' };
  if (t.post.review === 'posted') return { word: 'Posted', cls: '' };
  if (t.post.review === 'approved') return { word: 'Approved', cls: '' };
  if (t.post.review === 'changes') return { word: 'Changes asked', cls: '' };
  return { word: 'Waiting for OK', cls: '' };
}

/** What Bil said a held post is missing, in his words, shortest first. */
function missing(post: Record<string, unknown>): string[] {
  const c = post.compliance as { blockedReasons?: unknown } | undefined;
  const list = Array.isArray(c?.blockedReasons) ? c.blockedReasons : Array.isArray(post.blockedReasons) ? post.blockedReasons : [];
  return list.map(String).filter((r) => r && !/^Still breaks a rule/.test(r)).slice(0, 3);
}

/** A held post: what Bil needs, a box to give it, and Bil rewrites the post. */
export function DetailBox({ campaignId, slot, post, onDone }: { campaignId: string; slot: number; post: Record<string, unknown>; onDone: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const needs = missing(post);
  const id = `detail-${campaignId}-${slot}`;

  async function send() {
    setBusy(true);
    setNote('');
    try {
      const r = await bil.fillDetail(campaignId, slot, detail.trim());
      if (r.status === 'blocked') setNote(r.reasons[0] ? `Bil still needs more: ${r.reasons[0]}` : 'Bil still needs more to write this post.');
      else setOpen(false);
      await onDone();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Bil could not rewrite this post right now.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="bl-btn" onClick={() => setOpen(true)}>
        Give the detail
      </button>
    );
  }
  return (
    <form
      className="bl-detail"
      onSubmit={(e) => {
        e.preventDefault();
        if (detail.trim().length >= 2 && !busy) void send();
      }}
    >
      {needs.length > 0 && (
        <ul className="bl-detail-needs">
          {needs.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <label className="bl-label" htmlFor={id}>
        The detail
      </label>
      <textarea id={id} className="bl-input" rows={3} maxLength={500} value={detail} placeholder="For example: $40, ships Friday, link in bio" onChange={(e) => setDetail(e.target.value)} autoFocus />
      {note && (
        <p className="bl-error" role="alert">
          {note}
        </p>
      )}
      <div className="bl-row-actions">
        <button type="button" className="bl-ghost" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit" className="bl-btn" disabled={busy || detail.trim().length < 2}>
          {busy ? 'Bil is writing' : 'Send to Bil'}
        </button>
      </div>
      <span className="bl-small">Bil rewrites only this post with what you give him. It uses a few cents of the AI budget.</span>
    </form>
  );
}

export function DayView({ ws, go, focus, onAll, onMonth, startDay }: ScreenProps & { onAll: () => void; onMonth?: () => void; startDay?: string | null }) {
  const all = useMemo(() => (ws.data ? timedPosts(ws.data, focus) : []), [ws.data, focus]);
  const days = useMemo(() => [...new Set(all.map((t) => t.day))].sort(), [all]);
  const tz = all[0]?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = todayIn(tz);
  const firstDay = days.includes(today) ? today : days.find((d) => d > today) ?? days[days.length - 1];
  const [picked, setPicked] = useState<string | null>(startDay ?? null);
  const day = picked && days.includes(picked) ? picked : firstDay;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const posts = all.filter((t) => t.day === day);
  const now = Date.now();
  const nextKey = all.find((t) => t.end.getTime() > now && t.post.review !== 'posted');
  const waiting = posts.filter((t) => t.post.status === 'ok' && (t.post.review === 'pending' || t.post.review === 'changes'));
  const key = (t: Timed) => `${t.campaign.id}:${t.post.slot}`;

  async function approve(list: Timed[]) {
    setError('');
    for (const t of list) {
      setBusy(key(t));
      try {
        await bil.review(t.campaign.id, t.post.slot, 'approved');
        ws.patchPost(t.campaign.id, t.post.slot, { review: 'approved', reviewNote: null });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not approve that post.');
        break;
      }
    }
    setBusy(null);
  }

  return (
    <main className="bl-sched">
      <h1 className="bl-sr">Schedule</h1>
      {onMonth && (
        <div className="bl-sched-switch">
          <button type="button" className="bl-ghost" onClick={onMonth}>
            Month
          </button>
        </div>
      )}
      <div className="bl-days" role="group" aria-label="Day">
        {days.map((d) => {
          const p = dayParts(d);
          return (
            <button key={d} type="button" className="bl-day" aria-pressed={d === day} onClick={() => setPicked(d)}>
              <span>{p.name}</span>
              <b className="num">{p.num}</b>
              {d === today && <i aria-label="today" />}
            </button>
          );
        })}
      </div>

      <div className="bl-sched-head">
        <span className="bl-small num">
          {day === today ? 'Today' : new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' })}, {posts.length} {posts.length === 1 ? 'post' : 'posts'}
        </span>
        {waiting.length > 1 && (
          <button type="button" className="bl-ghost" disabled={busy !== null} onClick={() => void approve(waiting)}>
            Approve the rest
          </button>
        )}
      </div>
      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}

      <ol className="bl-sched-list">
        {posts.map((t, i) => {
          const s = statusWord(t);
          const c = clock(t.start, t.tz);
          const isNext = nextKey && key(nextKey) === key(t);
          const mediaId = typeof t.post.post.mediaId === 'string' ? t.post.post.mediaId : null;
          const text = t.post.status === 'blocked' ? String(t.post.post.idea ?? 'Waiting on a detail') : String(t.post.post.hook ?? t.post.post.draft ?? '');
          const canApprove = t.post.status === 'ok' && (t.post.review === 'pending' || t.post.review === 'changes');
          return (
            <li key={key(t)} className={`bl-glass-card bl-slot${isNext ? ' next' : ''} bl-in`} style={{ animationDelay: `${Math.min(i, 5) * 60}ms` }}>
              <div className="bl-slot-top">
                {mediaId ? <PostMedia id={mediaId} size="thumb" /> : wantsMedia(t.post.post.mediaIdea) ? <ShotFrame idea={String(t.post.post.mediaIdea)} size="thumb" /> : null}
                <div className="bl-slot-main">
                  <div className="bl-slot-row">
                    <b className="num">
                      {c.time} {c.half}
                    </b>
                    <span className={`bl-chip-ink${isNext ? ' next' : ''}${s.cls ? ` ${s.cls}` : ''}`}>{isNext && s.word === 'Waiting for OK' ? 'Next, waiting' : isNext ? `Next, ${s.word.toLowerCase()}` : s.word}</span>
                  </div>
                  <p className="bl-slot-text">{text}</p>
                  {t.post.status === 'ok' && Boolean((t.post.post.compliance as { adultContent?: unknown } | undefined)?.adultContent) && (
                    <p className="bl-adult-note">18+ · Mark the media sensitive when you post. Never use it as a profile photo or header.</p>
                  )}
                </div>
              </div>
              <div className="bl-row-actions">
                {canApprove && (
                  <>
                    <button type="button" className="bl-ghost" onClick={() => go(`campaigns.${t.campaign.id}`)}>
                      Change
                    </button>
                    <button type="button" className="bl-btn" disabled={busy !== null} onClick={() => void approve([t])}>
                      {busy === key(t) ? 'Approving' : 'Approve'}
                    </button>
                  </>
                )}
                {t.post.status === 'blocked' && <DetailBox campaignId={t.campaign.id} slot={t.post.slot} post={t.post.post} onDone={ws.refresh} />}
                {!canApprove && t.post.status !== 'blocked' && (
                  <button type="button" className="bl-ghost" onClick={() => go(`campaigns.${t.campaign.id}`)}>
                    Open the post
                  </button>
                )}
              </div>
            </li>
          );
        })}
        {posts.length === 0 && <li className="bl-small">Nothing planned for this day.</li>}
      </ol>

      <button type="button" className="bl-linkish" style={{ alignSelf: 'flex-start' }} onClick={onAll}>
        All campaigns
      </button>
    </main>
  );
}

type Mark = 'needs' | 'approved' | 'posted' | 'held';

function markOf(t: Timed): Mark {
  if (t.post.status === 'blocked') return 'held';
  if (t.post.review === 'posted') return 'posted';
  if (t.post.review === 'approved') return 'approved';
  return 'needs';
}

const MARK_WORDS: Record<Mark, string> = { needs: 'waiting for OK', approved: 'approved', posted: 'posted', held: 'needs a detail' };

/** Month view: every day of one month, with a dot per post coloured by where it stands. */
export function MonthView({ ws, focus, isTeam, go, onDay, onDayView }: ScreenProps & { onDay: (day: string) => void; onDayView: () => void }) {
  const all = useMemo(() => (ws.data ? timedPosts(ws.data, focus) : []), [ws.data, focus]);
  const tz = all[0]?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = todayIn(tz);
  const firstPlanned = all.find((t) => t.day >= today)?.day ?? all[all.length - 1]?.day ?? today;
  const [month, setMonth] = useState(firstPlanned.slice(0, 7));

  const byDay = useMemo(() => {
    const m = new Map<string, Timed[]>();
    for (const t of all) m.set(t.day, [...(m.get(t.day) ?? []), t]);
    return m;
  }, [all]);

  const [y, mo] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const lead = first.getUTCDay();
  const cells: Array<string | null> = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, mo - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const inMonth = all.filter((t) => t.day.startsWith(month));
  const count = (k: Mark) => inMonth.filter((t) => markOf(t) === k).length;
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 1, 1 + i)).toLocaleDateString(undefined, { weekday: 'narrow', timeZone: 'UTC' }));

  return (
    <main className="bl-sched">
      <h1 className="bl-sr">Schedule, month</h1>
      <div className="bl-sched-switch">
        <button type="button" className="bl-ghost" onClick={onDayView}>
          Day
        </button>
      </div>
      <div className="bl-month-head">
        <button type="button" className="bl-ghost bl-round" aria-label="Previous month" onClick={() => shift(-1)}>
          &#8249;
        </button>
        <b>{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</b>
        <button type="button" className="bl-ghost bl-round" aria-label="Next month" onClick={() => shift(1)}>
          &#8250;
        </button>
      </div>
      <div className="bl-month" role="grid" aria-label="Posts by day">
        {weekdays.map((w, i) => (
          <span key={`w${i}`} className="bl-month-wd" aria-hidden="true">
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} className="bl-month-cell is-empty" />;
          const list = byDay.get(d) ?? [];
          const label = `${new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}${
            list.length ? `, ${list.length} ${list.length === 1 ? 'post' : 'posts'}: ${(['needs', 'held', 'approved', 'posted'] as Mark[])
              .map((k) => [k, list.filter((t) => markOf(t) === k).length] as const)
              .filter(([, n]) => n)
              .map(([k, n]) => `${n} ${MARK_WORDS[k]}`)
              .join(', ')}`
              : ', nothing planned'
          }`;
          return (
            <button key={d} type="button" className={`bl-month-cell${d === today ? ' is-today' : ''}`} aria-label={label} disabled={!list.length} onClick={() => onDay(d)}>
              <span className="num">{Number(d.slice(8))}</span>
              {list.length > 0 && (
                <span className="bl-month-dots" aria-hidden="true">
                  {list.slice(0, 4).map((t) => (
                    <i key={`${t.campaign.id}:${t.post.slot}`} className={`m-${markOf(t)}`} />
                  ))}
                  {list.length > 4 && <em>+{list.length - 4}</em>}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <ul className="bl-month-key" aria-label="This month">
        {(['needs', 'held', 'approved', 'posted'] as Mark[]).map((k) => (
          <li key={k}>
            <i className={`m-${k}`} aria-hidden="true" />
            <span className="num">{count(k)}</span> {MARK_WORDS[k]}
          </li>
        ))}
      </ul>
      <div className="bl-row-actions">
        <button type="button" className="bl-linkish" onClick={() => go('approvals')}>
          {isTeam ? 'Approvals log' : 'Your approvals log'}
        </button>
        <button type="button" className="bl-linkish" onClick={() => go('reports')}>
          Monthly reports
        </button>
        <button type="button" className="bl-linkish" onClick={() => go('desk')}>
          Engagement desk
        </button>
      </div>
    </main>
  );
}
