import { useEffect, useMemo, useState } from 'react';
import { DIALS, riskyDials, type Dials } from '../lib/dials';
import { bil, type Decision } from '../lib/team';
import { PostMedia } from './PostMedia';
import { DayView, DetailBox, MonthView } from './Schedule';
import { timedPosts } from './timing';
import type { Campaign, Post } from './data';
import { Back } from './icons';
import { listAccounts } from '../lib/library';
import { rememberLayer, setXIntent } from '../components/CampaignLayer';
import { campaignTitle } from './Notifications';
import type { ScreenProps } from './Shell';
import { Banter } from './Banter';

// Campaigns: the list, and one campaign's posts reviewed one at a time or as a list.
// Post statuses use four words only: Draft, Needs you, Approved, Posted by you.
// Backlot never posts. "Posted by you" is the person telling us they posted it.

type Status = { word: 'Draft' | 'Needs you' | 'Approved' | 'Posted by you'; cls: string };

function statusOf(p: Post): Status {
  if (p.review === 'posted') return { word: 'Posted by you', cls: 'posted' };
  if (p.review === 'approved') return { word: 'Approved', cls: 'approved' };
  return { word: 'Needs you', cls: 'needs' };
}

function dayOf(c: Campaign, p: Post): string {
  const start = (c.request as { startDate?: string } | null)?.startDate;
  const offset = Number(p.post.dayOffset ?? 0);
  if (!start) return `Day ${offset + 1}`;
  const d = new Date(`${start}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function CampaignsScreen(props: ScreenProps & { campaignId: string | null }) {
  const { ws, go, focus, campaignId } = props;
  const [view, setView] = useState<'day' | 'month' | 'list'>('day');
  const [day, setDay] = useState<string | null>(null);
  if (!ws.data) return <main aria-busy="true" />;
  const campaign = campaignId ? ws.data.campaigns.find((c) => c.id === campaignId) : null;
  if (campaignId && campaign) return <CampaignView {...props} campaign={campaign} />;
  const thrown = campaignId ? ws.data.discarded.find((c) => c.id === campaignId) : null;
  if (campaignId && thrown) return <DiscardedView {...props} campaign={thrown} />;
  const timed = timedPosts(ws.data, focus).length > 0;
  // One bar on every view, so campaigns are always one tap from the schedule.
  const bar = (
    <div className="bl-seg bl-view-bar" role="group" aria-label="Schedule view">
      {timed && (
        <button type="button" aria-pressed={view === 'day'} onClick={() => setView('day')}>
          Schedule
        </button>
      )}
      <button type="button" aria-pressed={view === 'list' || !timed} onClick={() => setView('list')}>
        Campaigns
      </button>
      {timed && (
        <button type="button" aria-pressed={view === 'month'} onClick={() => setView('month')}>
          Month
        </button>
      )}
    </div>
  );
  if (!campaignId && view === 'month' && timed) {
    return (
      <MonthView
        {...props}
        bar={bar}
        onDayView={() => setView('day')}
        onDay={(d) => {
          setDay(d);
          setView('day');
        }}
      />
    );
  }
  if (!campaignId && view === 'day' && timed) return <DayView key={day ?? ''} {...props} bar={bar} startDay={day} onAll={() => setView('list')} />;

  const handle = (id: string) => ws.data!.clients.find((c) => c.id === id)?.handle ?? '';
  const list = ws.data.campaigns.filter((c) => !focus || c.clientId === focus);

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {bar}
      <h1 className="bl-h1 bl-rise">Campaigns</h1>
      {campaignId && !campaign && <p className="bl-error">That campaign is not in your workspace.</p>}
      {list.length === 0 ? (
        <div className="bl-empty bl-rise bl-d1">
          <b style={{ fontSize: 17 }}>No campaigns yet.</b>
          <span className="bl-small">
            {props.isTeam ? 'Plan one with Bil. Tag media in your Library first so he plans around what you have.' : 'Your team will send your first campaign here for your OK.'}
          </span>
          {props.isTeam && (
            <button type="button" className="bl-btn" onClick={() => go('create')}>
              Plan a campaign
            </button>
          )}
        </div>
      ) : (
        list.map((c, i) => {
          const posts = ws.data!.posts.filter((p) => p.campaignId === c.id);
          const done = posts.filter((p) => p.review === 'approved' || p.review === 'posted').length;
          const needs = posts.length - done;
          const pct = c.postsTotal ? Math.round((done / c.postsTotal) * 100) : 0;
          return (
            <a
              key={c.id}
              href={`#campaigns.${c.id}`}
              className={`bl-card bl-rise bl-d${Math.min(4, i + 1)}`}
              onClick={(e) => {
                e.preventDefault();
                go(`campaigns.${c.id}`);
              }}
            >
              <span className="bl-label">
                @{handle(c.clientId)}, {new Date(c.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
              <div className="bl-card-title">{campaignTitle(c)}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {needs > 0 && <span className="bl-chip needs">{needs} need you</span>}
                {done > 0 && <span className="bl-chip approved">{done} approved</span>}
                {(c.status === 'planning' || c.status === 'drafting') && !c.hold && <span className="bl-chip draft">Bil is writing</span>}
                {c.hold && <span className="bl-chip changes">Paused at budget</span>}
              </div>
              <span className="bl-meter" role="img" aria-label={`${pct} percent approved`}>
                <span style={{ width: `${pct}%` }} />
              </span>
            </a>
          );
        })
      )}
      <DiscardedList {...props} />
    </main>
  );
}

/** Discarded campaigns for the clients in view, each one tap from coming back. */
function DiscardedList({ ws, go, focus }: ScreenProps) {
  const gone = (ws.data?.discarded ?? []).filter((c) => !focus || c.clientId === focus);
  if (!gone.length) return null;
  return (
    <details className="bl-discarded">
      <summary>Discarded ({gone.length})</summary>
      <ul className="bl-rows">
        {gone.map((c) => (
          <li key={c.id}>
            <a
              href={`#campaigns.${c.id}`}
              className="bl-linkish"
              onClick={(e) => {
                e.preventDefault();
                go(`campaigns.${c.id}`);
              }}
            >
              {campaignTitle(c)}
            </a>
            <span className="bl-small"> discarded {new Date(c.discardedAt!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** A discarded campaign: what that means, and the way back. */
function DiscardedView({ ws, go, campaign }: ScreenProps & { campaign: Campaign }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function restore() {
    setBusy(true);
    setError('');
    try {
      await bil.restore(campaign.id);
      await ws.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not restore it.');
      setBusy(false);
    }
  }
  return (
    <main className="bl-flow">
      <a
        href="#campaigns"
        className="bl-ghost bl-round"
        aria-label="All campaigns"
        onClick={(e) => {
          e.preventDefault();
          go('campaigns');
        }}
      >
        <Back />
      </a>
      <h1 className="bl-h1">{campaignTitle(campaign)}</h1>
      <div className="bl-wash" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <b>This campaign is discarded.</b>
        <span className="bl-small">
          It is off the schedule, Today and Kris&rsquo;s drafts, and Bil writes nothing more for it. Its posts are kept, so restoring brings everything back
          {campaign.status === 'planning' || campaign.status === 'drafting' ? ' and Bil picks up where he stopped' : ''}.
        </span>
        <button type="button" className="bl-btn bl-start" disabled={busy} onClick={() => void restore()}>
          {busy ? 'Restoring' : 'Restore it'}
        </button>
      </div>
      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}

function CampaignView({ ws, go, isTeam, campaign }: ScreenProps & { campaign: Campaign }) {
  const posts = useMemo(
    () => ws.data!.posts.filter((p) => p.campaignId === campaign.id).sort((a, b) => a.slot - b.slot),
    [ws.data, campaign.id],
  );
  const queue = posts.filter((p) => p.status === 'ok' && p.review === 'pending');
  const blocked = posts.filter((p) => p.status === 'blocked');
  const [mode, setMode] = useState<'one' | 'all'>(queue.length ? 'one' : 'all');
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [linking, setLinking] = useState(false);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [bulkNote, setBulkNote] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<number | null>(null);

  const current = openSlot !== null ? posts.find((p) => p.slot === openSlot) ?? null : queue[0] ?? null;
  // A half-typed post link belongs to the post it was typed for.
  useEffect(() => {
    setLinking(false);
    setLink('');
  }, [current?.slot]);
  const total = Math.max(campaign.postsTotal, posts.length);
  const working = (campaign.status === 'planning' || campaign.status === 'drafting') && !campaign.hold;
  const inspired = (campaign.plan as { inspiredBy?: unknown } | null)?.inspiredBy;
  const leaned = Array.isArray(inspired) ? inspired.length : 0;

  async function decide(p: Post, decision: Decision, text?: string, postUrl?: string) {
    if (postUrl && !X_POST.test(postUrl.trim())) {
      setError('Paste the link to the post on X, like x.com/handle/status/123.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await bil.review(campaign.id, p.slot, decision, text, postUrl?.trim() || undefined);
      ws.patchPost(campaign.id, p.slot, {
        review: decision,
        reviewNote: decision === 'changes' ? text ?? null : null,
        ...(decision === 'pending' ? { xPostId: null } : r.xPostId ? { xPostId: r.xPostId } : {}),
      });
      setAsking(false);
      setLinking(false);
      setLink('');
      setNote('');
      setOpenSlot(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(p: Post) {
    try {
      await navigator.clipboard.writeText(String(p.post.draft ?? ''));
      setCopied(p.slot);
      window.setTimeout(() => setCopied((s) => (s === p.slot ? null : s)), 1800);
    } catch {
      setError('Copying is blocked here. Press and hold the text to copy it instead.');
    }
  }

  const clientDials = ws.data!.clients.find((c) => c.id === campaign.clientId)?.profile.dials as Dials | undefined;
  const teamLocked = isTeam && riskyDials(clientDials);

  async function approveEvery() {
    setBusy(true);
    setError('');
    setBulkNote('');
    try {
      const r = await bil.approveAll(campaign.id);
      await ws.refresh();
      setConfirmAll(false);
      setBulkNote(
        `Approved ${r.approved} ${r.approved === 1 ? 'post' : 'posts'}.` +
          (r.needDetail ? ` ${r.needDetail} still ${r.needDetail === 1 ? 'needs' : 'need'} a detail.` : '') +
          (r.changes ? ` ${r.changes} with a change request ${r.changes === 1 ? 'was' : 'were'} left for Bil.` : ''),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve them.');
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    setBusy(true);
    setError('');
    try {
      await bil.discard(campaign.id);
      await ws.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not discard it.');
      setBusy(false);
    }
  }

  async function resume() {
    setBusy(true);
    setError('');
    try {
      await bil.resume(campaign.id);
      await ws.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resume.');
    } finally {
      setBusy(false);
    }
  }

  // Opens this client's X narration with the campaign layered on it, or X setup for their @.
  async function seeOnX() {
    setOpening(true);
    setError('');
    try {
      const handle = ws.data?.clients.find((c) => c.id === campaign.clientId)?.handle ?? '';
      const h = handle.toLowerCase();
      const mine = (await listAccounts('x')).flatMap((a) => a.narrations);
      const match = mine.filter((n) => h && n.username.toLowerCase() === h).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (match) {
        rememberLayer(match.id, campaign.id);
        go(`x.${match.id}`);
      } else {
        setXIntent({ handle, campaignId: campaign.id });
        go('x');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open your X narrations.');
      setOpening(false);
    }
  }

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="bl-bar" style={{ justifyContent: 'flex-start', gap: 12 }}>
        <button type="button" className="bl-ghost bl-round" aria-label="All campaigns" onClick={() => go('campaigns')}>
          <Back />
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--display)', fontSize: 22 }} className="bl-ellipsis">
            {campaignTitle(campaign)}
          </span>
          <span className="bl-label bl-ellipsis">Goal: {String((campaign.request as { goal?: string } | null)?.goal ?? '')}</span>
        </div>
      </div>
      {leaned > 0 && (
        <p className="bl-small" style={{ margin: 0 }}>
          Bil leaned on {leaned} {leaned === 1 ? 'item' : 'items'} from the board marked &ldquo;more like this.&rdquo;
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="bl-ticks" style={{ gridTemplateColumns: `repeat(${Math.max(1, total)}, minmax(0, 1fr))` }} role="img" aria-label="Review progress">
          {Array.from({ length: total }, (_, i) => {
            const p = posts.find((x) => x.slot === i + 1);
            const done = p && (p.review === 'approved' || p.review === 'posted');
            const now = p && current && p.slot === current.slot;
            return <span key={i} className={done ? 'done' : now ? 'now' : undefined} />;
          })}
        </div>
        <div className="bl-status" style={{ justifyContent: 'space-between' }}>
          <span>
            {posts.filter((p) => p.review === 'approved' || p.review === 'posted').length} approved, {queue.length} to review
            {blocked.length ? `, ${blocked.length} need a detail` : ''}
          </span>
          {working && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-text)' }}>
              <span className="bl-dot bl-live" /> Bil is writing {campaign.postsDone}/{campaign.postsTotal}
            </span>
          )}
        </div>
      </div>

      <button type="button" className="bl-ghost" style={{ alignSelf: 'flex-start' }} disabled={opening} onClick={() => void seeOnX()}>
        {opening ? 'Opening' : 'See it on the X profile'}
      </button>

      {queue.length > 0 && (
        <div className="bl-bulk">
          {!confirmAll ? (
            <button type="button" className="bl-btn" style={{ alignSelf: 'flex-start' }} disabled={busy || teamLocked} onClick={() => setConfirmAll(true)}>
              Approve all {queue.length}
            </button>
          ) : (
            <div className="bl-wash" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span>
                Approve all {queue.length} {queue.length === 1 ? 'post' : 'posts'} waiting for a yes?
                {blocked.length ? ` ${blocked.length} still ${blocked.length === 1 ? 'needs' : 'need'} a detail and stay as they are.` : ''} You can undo any one of them after.
              </span>
              <div className="bl-row-actions">
                <button type="button" className="bl-ghost" disabled={busy} onClick={() => setConfirmAll(false)}>
                  Cancel
                </button>
                <button type="button" className="bl-btn" disabled={busy} onClick={() => void approveEvery()}>
                  {busy ? 'Approving' : `Approve ${queue.length}`}
                </button>
              </div>
            </div>
          )}
          {teamLocked && <span className="bl-small">At this client&rsquo;s controversy and spice, they approve each post themselves.</span>}
        </div>
      )}
      {bulkNote && (
        <p className="bl-small" role="status" style={{ margin: 0 }}>
          {bulkNote}
        </p>
      )}

      {campaign.hold && isTeam && (
        <div className="bl-wash" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <b>Paused at this month's AI budget.</b>
          <span className="bl-small">Resuming continues where it stopped and spends from the new headroom, if any.</span>
          <button type="button" className="bl-btn bl-start" disabled={busy} onClick={() => void resume()}>
            Resume
          </button>
        </div>
      )}

      <div className="bl-seg">
        <button type="button" aria-pressed={mode === 'one'} onClick={() => setMode('one')}>
          One at a time
        </button>
        <button type="button" aria-pressed={mode === 'all'} onClick={() => setMode('all')}>
          All posts
        </button>
      </div>

      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}

      {mode === 'one' &&
        (current ? (
          <>
            <PostCard campaign={campaign} post={current} copied={copied === current.slot} onCopy={() => void copy(current)} />
            {current.status === 'ok' && (current.review === 'pending' || current.review === 'changes') && (
              <>
                {asking && (
                  <label className="bl-field">
                    <span className="bl-label">What should change</span>
                    <textarea
                      className="bl-textarea"
                      rows={2}
                      maxLength={500}
                      value={note}
                      placeholder="Shorter, or use a different photo"
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </label>
                )}
                <div className="bl-grid2">
                  <button
                    type="button"
                    className="bl-ghost big"
                    disabled={busy || (asking && !note.trim())}
                    onClick={() => (asking ? void decide(current, 'changes', note.trim()) : setAsking(true))}
                  >
                    {asking ? 'Send to the team' : 'Ask for a change'}
                  </button>
                  <button type="button" className="bl-btn big" disabled={busy} onClick={() => void decide(current, 'approved')}>
                    Approve
                  </button>
                </div>
              </>
            )}
            {(current.review === 'approved' || (current.review === 'posted' && !current.xPostId)) &&
              (linking ? (
                <div className="bl-brand-group">
                  <label className="bl-field">
                    <span className="bl-label">Link to the post on X</span>
                    <input className="bl-input" type="url" inputMode="url" value={link} maxLength={300} placeholder="x.com/handle/status/123" onChange={(e) => setLink(e.target.value)} />
                    <span className="bl-small">Monthly reports use it to see how this post did, so Bil and Kris learn what works for you.</span>
                  </label>
                  <div className="bl-grid2">
                    <button type="button" className="bl-ghost big" disabled={busy} onClick={() => (current.review === 'posted' ? setLinking(false) : void decide(current, 'posted'))}>
                      {current.review === 'posted' ? 'Cancel' : 'Skip the link'}
                    </button>
                    <button type="button" className="bl-btn big" disabled={busy || !link.trim()} onClick={() => void decide(current, 'posted', undefined, link)}>
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="bl-ghost big" disabled={busy} onClick={() => setLinking(true)}>
                  {current.review === 'posted' ? 'Add the post link' : 'I posted this'}
                </button>
              ))}
            <p className="bl-small" style={{ textAlign: 'center' }}>
              Approved posts wait for you to post them yourself. Backlot never posts.
            </p>
          </>
        ) : (
          <div className="bl-empty">
            <b style={{ fontSize: 17 }}>{working ? 'Bil is still writing.' : 'Nothing left to review.'}</b>
            <span className="bl-small">
              {working
                ? 'New posts appear here as he finishes them.'
                : blocked.length
                  ? `${blocked.length} ${blocked.length === 1 ? 'post needs' : 'posts need'} a detail before they can be written. Give it under All posts.`
                  : 'Every post has a decision. Copy the approved ones when it is time to post.'}
            </span>
            {working && <Banter moment="bil" className="center" after={400} />}
          </div>
        ))}

      {mode === 'all' && (
        <ul className="bl-list">
          {posts.map((p) => {
            const s = statusOf(p);
            const reasons: string[] = Array.isArray(p.post.blockedReasons) ? p.post.blockedReasons : [];
            return (
              <li key={p.slot} style={{ alignItems: 'flex-start' }}>
                <span className="bl-label" style={{ width: 28, paddingTop: 3 }}>
                  {String(p.slot).padStart(2, '0')}
                </span>
                <div className="bl-list-main">
                  <span className="bl-label">
                    {dayOf(campaign, p)}, {String(p.post.postWindow ?? '')}
                  </span>
                  <span style={{ lineHeight: 1.4 }}>
                    {p.status === 'blocked' ? String(p.post.idea ?? 'Waiting on a detail') : String(p.post.hook ?? p.post.draft ?? '')}
                  </span>
                  {p.status === 'blocked' ? (
                    <DetailBox campaignId={campaign.id} slot={p.slot} post={p.post} onDone={ws.refresh} />
                  ) : (
                    reasons.length > 0 && <span className="bl-small">Needs: {reasons.join(' ')}</span>
                  )}
                  {p.review === 'changes' && p.reviewNote && <span className="bl-small">Change asked: {p.reviewNote}</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                  <span className={`bl-chip ${s.cls}`}>{s.word}</span>
                  {p.status === 'ok' && (
                    <button
                      type="button"
                      className="bl-linkish accent"
                      onClick={() => {
                        setOpenSlot(p.slot);
                        setMode('one');
                        setAsking(false);
                      }}
                    >
                      Open
                    </button>
                  )}
                </div>
              </li>
            );
          })}
          {posts.length === 0 && <li className="bl-small">No posts written yet.</li>}
        </ul>
      )}

      <div className="bl-discard-row">
        <button type="button" className="bl-linkish bl-danger-link" disabled={busy} onClick={() => void discard()}>
          Discard this campaign
        </button>
        <span className="bl-small">
          It leaves the schedule{working ? ' and Bil stops writing' : ''}. You can restore it.
        </span>
      </div>
    </main>
  );
}

function PostCard({ campaign, post, copied, onCopy }: { campaign: Campaign; post: Post; copied: boolean; onCopy: () => void }) {
  const s = statusOf(post);
  const signals: { why?: string }[] = Array.isArray(post.post.algorithm?.signals) ? post.post.algorithm.signals : [];
  const why = signals.find((x) => x.why)?.why;
  return (
    <article className="bl-post">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="bl-label">
          {dayOf(campaign, post)}, {String(post.post.postWindow ?? '')}
        </span>
        <span className={`bl-chip ${s.cls}`}>{s.word}</span>
      </div>
      {typeof post.post.mediaId === 'string' && <PostMedia id={post.post.mediaId} size="hero" saveAs={`${campaignTitle(campaign)}-post-${post.slot}`} />}
      {post.post.mediaIdea && (
        <div className="bl-wash" style={{ fontSize: 14, lineHeight: 1.45 }}>
          <span className="bl-label accent">{post.post.mediaId ? 'How to post it: ' : 'Media: '}</span>
          {String(post.post.mediaIdea)}
        </div>
      )}
      <p className="bl-post-text">{String(post.post.draft ?? '')}</p>
      {post.post.compliance?.adultContent && (
        <div className="bl-error">
          Adult post. On X, mark its photos and videos as sensitive before posting, and never use them as a profile photo or header.
        </div>
      )}
      {post.post.engagementPlan && (
        <div className="bl-why">
          <span className="bl-label accent" style={{ paddingTop: 2 }}>
            After
          </span>
          <span>{String(post.post.engagementPlan)}</span>
        </div>
      )}
      {why && (
        <div className="bl-why">
          <span className="bl-label accent" style={{ paddingTop: 2 }}>
            Why
          </span>
          <span>{why}</span>
        </div>
      )}
      <BilsRead post={post.post} />
      {post.review === 'changes' && post.reviewNote && <div className="bl-error">Change asked: {post.reviewNote}</div>}
      <button type="button" className="bl-ghost bl-start" onClick={onCopy}>
        {copied ? 'Copied' : 'Copy the text'}
      </button>
    </article>
  );
}


type Signal = { action?: string; effect?: string; why?: string };

/** Actions that hurt a post's reach; raising them is bad news, lowering them good. */
const NEGATIVE = new Set(['not_interested', 'mute_author', 'block_author', 'report']);

const ACTION_WORDS: Record<string, string> = {
  favorite: 'likes',
  reply: 'replies',
  repost: 'reposts',
  quote: 'quotes',
  share: 'shares',
  share_via_dm: 'shares by DM',
  share_via_copy_link: 'link copies',
  click_post: 'post opens',
  click_profile: 'profile visits',
  click_link: 'link clicks',
  photo_expand: 'photo opens',
  video_open: 'video opens',
  click_quoted_post: 'quoted post opens',
  video_quality_view: 'video watches',
  dwell: 'time spent reading',
  follow_author: 'follows',
  not_interested: '"not interested" taps',
  mute_author: 'mutes',
  block_author: 'blocks',
  report: 'reports',
};

/** Bil's score and reasons for one post, folded away until asked for. */
/** An X post link: x.com or twitter.com, a handle, then /status/ and the number. */
const X_POST = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status(?:es)?\/\d{1,25}(?:[/?#].*)?$/i;

function BilsRead({ post }: { post: Record<string, any> }) {
  const a = post.algorithm as { score?: number; signals?: Signal[]; repoFile?: string; repoCommit?: string } | undefined;
  const v = post.voice as { match?: number; drift?: string[] } | undefined;
  if (!a || typeof a.score !== 'number') return null;
  const signals = Array.isArray(a.signals) ? a.signals.filter((x) => x.why) : [];
  const drift = Array.isArray(v?.drift) ? v!.drift.filter(Boolean) : [];
  const word = (s: Signal) => ACTION_WORDS[String(s.action ?? '')] ?? String(s.action ?? '').replace(/_/g, ' ');
  const repo =
    a.repoFile && a.repoCommit && /^[0-9a-f]{7,40}$/.test(a.repoCommit) && /^[A-Za-z0-9_./-]{1,200}$/.test(a.repoFile)
      ? `https://github.com/xai-org/x-algorithm/blob/${a.repoCommit}/${a.repoFile}`
      : null;
  return (
    <details className="bl-read">
      <summary>
        <span>Bil&rsquo;s read</span>
        <span className="bl-read-scores num">
          Fit {a.score}
          {typeof v?.match === 'number' ? ` · Voice ${v.match}` : ''}
        </span>
      </summary>
      <p className="bl-small" style={{ margin: 0 }}>
        Fit is how well the post suits X&rsquo;s published ranking settings, out of 100. Voice is how close it sounds to the approved voice card. Both are guides, not promises: X scores each post per viewer.
      </p>
      {signals.length > 0 && (
        <ul className="bl-read-list">
          {signals.map((s, i) => (
            <li key={i}>
              <span className={`bl-chip-ink${(s.effect === 'lowers') !== NEGATIVE.has(String(s.action)) ? ' bad' : ''}`}>
                {s.effect === 'lowers' ? 'Lowers' : 'Raises'} {word(s)}
              </span>
              <span>{s.why}</span>
            </li>
          ))}
        </ul>
      )}
      {drift.length > 0 && <p className="bl-small" style={{ margin: 0 }}>Where it drifts from their voice: {drift.join(' ')}</p>}
      <DialReadings dials={post.dials} />
      {repo && (
        <a className="bl-linkish" href={repo} target="_blank" rel="noopener noreferrer">
          The ranking code this is based on
        </a>
      )}
    </details>
  );
}

/** The dial check's readings next to the setting each draft was held to (dial upgrade 3). */
function DialReadings({ dials }: { dials?: { readings?: Record<string, number>; target?: Record<string, number> } }) {
  if (!dials?.readings || !dials.target) return null;
  return (
    <div>
      <span className="bl-label">Dials, read by a separate checker</span>
      <ul className="bl-dial-reads">
        {DIALS.map((d) => {
          const v = dials.readings![d.key];
          const t = dials.target![d.key];
          if (typeof v !== 'number' || typeof t !== 'number') return null;
          return (
            <li key={d.key} className={Math.abs(v - t) > 1 ? 'off' : undefined}>
              <span>{d.name}</span>
              <span className="num">
                {v} <span className="bl-muted">of {t}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
