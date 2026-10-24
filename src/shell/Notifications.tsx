import { isTeamRole, type Me } from '../lib/team';
import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { Activity, Workspace } from './data';
import { Checklist, setupLeft } from './Checklist';
import { shotsWanted } from './gaps';
import { PostMedia, ShotFrame } from './PostMedia';
import { clock, nextPost, wantsMedia, when, type Timed } from './timing';
import type { ScreenProps } from './Shell';
import { Banter } from './Banter';

// Home: notifications on a signal rail, newest first, with the ones that need you on top.
// Everything is worked out from the workspace data, so nothing here can drift out of step
// with the campaigns themselves.

type Item = {
  key: string;
  at: string;
  needs: boolean;
  label: string;
  title: string;
  body?: string;
  action?: { label: string; path: string; primary: boolean };
};

export function campaignTitle(c: { plan: Record<string, unknown> | null; request: Record<string, unknown> | null }): string {
  const t = (c.plan as { title?: string } | null)?.title ?? (c.request as { goal?: string } | null)?.goal;
  return typeof t === 'string' && t.trim() ? t.trim() : 'Campaign';
}

function build(me: Me, ws: Workspace, focus: string | null): Item[] {
  const isTeam = isTeamRole(me.role);
  const handle = (id: string) => ws.clients.find((c) => c.id === id)?.handle ?? '';
  const inScope = (clientId: string) => !focus || clientId === focus;
  const items: Item[] = [];

  for (const c of ws.campaigns) {
    if (!inScope(c.clientId)) continue;
    const label = `@${handle(c.clientId)} · Campaign`;
    const posts = ws.posts.filter((p) => p.campaignId === c.id);
    const blocked = posts.filter((p) => p.status === 'blocked');
    const pending = posts.filter((p) => p.status === 'ok' && p.review === 'pending');
    const changes = posts.filter((p) => p.review === 'changes');
    const open = `campaigns.${c.id}`;

    if (blocked.length) {
      const reasons = [...new Set(blocked.flatMap((p) => (Array.isArray(p.post.blockedReasons) ? p.post.blockedReasons : [])))]
        .slice(0, 2)
        .join(' ');
      items.push({
        key: `${c.id}:blocked`,
        at: c.updatedAt,
        needs: true,
        label,
        title: `${blocked.length} ${blocked.length === 1 ? 'post needs' : 'posts need'} a detail`,
        body: reasons || 'A link, price or time only you know.',
        action: { label: 'See what is missing', path: open, primary: true },
      });
    }
    if (pending.length) {
      items.push({
        key: `${c.id}:pending`,
        at: c.updatedAt,
        needs: true,
        label,
        title: isTeam
          ? `${pending.length} ${pending.length === 1 ? 'post is' : 'posts are'} ready to approve`
          : `${pending.length} ${pending.length === 1 ? 'post is' : 'posts are'} ready for your OK`,
        body: `${campaignTitle(c)}. About ${Math.max(1, Math.round(pending.length / 8))} min to review.`,
        action: { label: 'Review posts', path: open, primary: !isTeam },
      });
    }
    if (isTeam && changes.length) {
      items.push({
        key: `${c.id}:changes`,
        at: c.updatedAt,
        needs: true,
        label,
        title: `Changes asked for on ${changes.length} ${changes.length === 1 ? 'post' : 'posts'}`,
        action: { label: 'Read the notes', path: open, primary: false },
      });
    }
    if (isTeam && c.hold === 'month_budget') {
      items.push({
        key: `${c.id}:hold`,
        at: c.updatedAt,
        needs: true,
        label,
        title: 'Paused at this month\'s AI budget',
        body: 'It picks up where it stopped once you resume it or the month resets.',
        action: { label: 'Open campaign', path: open, primary: true },
      });
    } else if (c.status === 'planning' || c.status === 'drafting') {
      items.push({
        key: `${c.id}:working`,
        at: c.updatedAt,
        needs: false,
        label,
        title: `Bil is ${c.status === 'planning' ? 'planning' : 'drafting'} ${campaignTitle(c)}`,
        body: c.postsTotal ? `${c.postsDone} of ${c.postsTotal} posts written.` : undefined,
        action: { label: 'Watch it fill in', path: open, primary: false },
      });
    } else if (isTeam && c.status === 'failed') {
      items.push({
        key: `${c.id}:failed`,
        at: c.updatedAt,
        needs: true,
        label,
        title: 'A campaign stopped before it finished',
        action: { label: 'Open campaign', path: open, primary: false },
      });
    }
  }

  for (const v of ws.voices) {
    if (!inScope(v.clientId)) continue;
    const label = `@${handle(v.clientId)} · Voice`;
    if (!v.approved) {
      items.push({
        key: `${v.clientId}:voice`,
        at: v.updatedAt,
        needs: !isTeam,
        label,
        title: isTeam ? `Waiting for @${handle(v.clientId)} to approve their voice` : 'Approve your voice',
        body: isTeam ? undefined : 'Bil writes every post in this voice. Check it sounds like you.',
        action: { label: isTeam ? 'See the voice' : 'Check my voice', path: 'insights', primary: !isTeam },
      });
    }
    const measured = v.card?.whatWorks?.measuredAt as string | undefined;
    if (measured) {
      const summary = String(v.card.whatWorks.summary ?? '');
      const first = summary.split(/(?<=\.)\s/)[0];
      items.push({
        key: `${v.clientId}:learned`,
        at: measured,
        needs: false,
        label: `@${handle(v.clientId)} · Insights`,
        title: 'Bil measured what performs.',
        body: first || undefined,
        action: { label: 'See insights', path: 'insights', primary: false },
      });
    }
  }

  // Shots Bil asked for that are not in Media yet.
  for (const c of ws.clients) {
    if (!inScope(c.id)) continue;
    const shots = shotsWanted(ws, c.id);
    if (!shots.length) continue;
    items.push({
      key: `${c.id}:shots`,
      at: new Date().toISOString(),
      needs: true,
      label: `@${c.handle} · Media`,
      title: `Bil asked for ${shots.length} ${shots.length === 1 ? 'shot' : 'shots'}`,
      body: shots[0].idea.length > 90 ? `${shots[0].idea.slice(0, 88)}…` : shots[0].idea,
      // A client goes to their Media; the team to the campaign, which is always the right client.
      action: isTeam ? { label: 'See the shots', path: `campaigns.${shots[0].campaignId}`, primary: false } : { label: 'Open Media', path: 'library', primary: true },
    });
  }

  return items.sort((a, b) => Number(b.needs) - Number(a.needs) || b.at.localeCompare(a.at));
}

// ---------- what is new ----------

type News = { key: string; at: string; fresh: boolean; title: string; path: string };

const POST_WORDS: Record<string, [string, string]> = {
  approved: ['approved', 'post'],
  changes: ['asked for changes on', 'post'],
  posted: ['marked', 'post as posted'],
  undone: ['undid a decision on', 'post'],
};
const OTHER_WORDS: Record<string, string> = {
  'voice:approved': 'approved the voice card',
  'brand:saved': 'updated the brand kit',
  'brand:suggested': 'suggested brand kit changes',
  'brand:approved': 'took the suggested brand kit changes',
  'brand:dropped': 'dropped the suggested brand kit changes',
  'campaign:discarded': 'discarded a campaign',
  'campaign:restored': 'restored a campaign',
};

/**
 * What other people did in the last 14 days: decisions, uploads, board items and finished
 * campaigns, grouped by day so ten approvals read as one line. Nothing the person did
 * themselves shows here. Lines newer than their last visit are marked fresh.
 */
function buildNews(me: Me, ws: Workspace, focus: string | null, seenAt: string | null): News[] {
  const isTeam = isTeamRole(me.role);
  const handle = (id: string) => ws.clients.find((c) => c.id === id)?.handle ?? '';
  const day = (iso: string) => iso.slice(0, 10);
  const groups = new Map<string, { a: Activity; n: number; at: string }>();
  for (const a of ws.activity) {
    if ((focus && a.clientId !== focus) || (a.actorId && a.actorId === me.userId)) continue;
    const k =
      a.kind === 'log'
        ? [a.kind, a.clientId, a.what, a.decision, a.campaignId ?? '', a.actorRole, day(a.at)].join('|')
        : [a.kind, a.clientId, day(a.at)].join('|');
    const g = groups.get(k);
    if (g) g.n += 1;
    else groups.set(k, { a, n: 1, at: a.at });
  }
  const out: News[] = [];
  for (const [k, { a, n, at }] of groups) {
    const h = handle(a.clientId);
    let title = '';
    let path = 'today';
    if (a.kind === 'log') {
      const who = a.actorRole === 'client' ? (isTeam ? `@${h}` : 'Someone on your account') : isTeam ? 'A teammate' : 'Your team';
      if (a.what === 'post') {
        const [verb, noun] = POST_WORDS[a.decision] ?? ['changed', 'post'];
        const c = a.campaignId ? ws.campaigns.find((x) => x.id === a.campaignId) : null;
        title = `${who} ${verb} ${n} ${n === 1 ? noun : noun.replace('post', 'posts')}${c ? ` in ${campaignTitle(c)}` : ''}`;
        path = a.campaignId && c ? `campaigns.${a.campaignId}` : 'approvals';
      } else {
        title = `${who} ${OTHER_WORDS[`${a.what}:${a.decision}`] ?? 'made a change'}`;
        path = a.what === 'brand' ? 'brand' : a.what === 'campaign' ? 'campaigns' : 'insights';
      }
    } else if (a.kind === 'media') {
      title = isTeam ? `${n} new ${n === 1 ? 'file' : 'files'} in @${h}'s Media` : `Your team added ${n} ${n === 1 ? 'file' : 'files'} to Media`;
      path = 'library';
    } else {
      title = isTeam ? `${n} new ${n === 1 ? 'item' : 'items'} on @${h}'s board` : `Your team added ${n} ${n === 1 ? 'item' : 'items'} to the board`;
      path = 'board';
    }
    out.push({ key: k, at, fresh: !seenAt || at > seenAt, title, path });
  }
  // Campaigns Bil finished, for the team (clients see the posts waiting for them instead).
  if (isTeam) {
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    for (const c of ws.campaigns) {
      if ((focus && c.clientId !== focus) || !['ready', 'approved'].includes(c.status) || c.updatedAt < since) continue;
      out.push({ key: `done|${c.id}`, at: c.updatedAt, fresh: !seenAt || c.updatedAt > seenAt, title: `Bil finished ${campaignTitle(c)} for @${handle(c.clientId)}`, path: `campaigns.${c.id}` });
    }
  }
  return out.sort((x, y) => y.at.localeCompare(x.at)).slice(0, 12);
}

export function needsYouCount(me: Me, ws: Workspace, focus: string | null): number {
  return build(me, ws, focus).filter((i) => i.needs).length + buildNews(me, ws, focus, ws.seenAt).filter((n) => n.fresh).length;
}

function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (m < 60) return m <= 1 ? 'just now' : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function Alert() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17.2v.1" />
    </svg>
  );
}
function Tick() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
function Go() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

/** The next post, set large: its time, then its photo or video, its first line, and one button. */
function NextUp({ t, isTeam, go }: { t: Timed; isTeam: boolean; go: (p: string) => void }) {
  const c = clock(t.start, t.tz);
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zone = here !== t.tz ? ` (${t.tz.split('/').pop()?.replace(/_/g, ' ')} time)` : '';
  const mediaId = typeof t.post.post.mediaId === 'string' ? t.post.post.mediaId : null;
  const blocked = t.post.status === 'blocked';
  const text = blocked ? String(t.post.post.idea ?? 'Waiting on a detail') : String(t.post.post.hook ?? t.post.post.draft ?? '');
  const approved = t.post.review === 'approved';
  return (
    <>
      <section className="bl-next bl-in" aria-labelledby="next-label">
        <span id="next-label" className="bl-small">
          {isTeam ? `Next post for @${t.client?.handle ?? ''}` : 'Your next post'}
        </span>
        <div className="bl-next-time">
          <span className="bl-hero-time num">{c.time}</span>
          <span className="bl-next-half">{c.half}</span>
        </div>
        <span className="bl-small num">
          {when(t)}
          {zone}
        </span>
      </section>
      <article className="bl-glass-card bl-next-card bl-in" style={{ animationDelay: '80ms' }}>
        {mediaId ? <PostMedia id={mediaId} size="hero" /> : wantsMedia(t.post.post.mediaIdea) ? <ShotFrame idea={String(t.post.post.mediaIdea)} /> : null}
        <p className="bl-next-text">{text}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className={`bl-chip-ink${blocked ? ' bad' : ''}`}>{blocked ? 'Needs a detail' : approved ? 'Approved' : 'Waiting for OK'}</span>
          {!isTeam && !blocked && <span className="bl-chip-ink">You post it yourself</span>}
        </div>
        <button type="button" className="bl-btn bl-wide" onClick={() => go(`campaigns.${t.campaign.id}`)}>
          {blocked ? 'See what is missing' : approved ? 'Open the post' : 'Review and approve'}
        </button>
      </article>
    </>
  );
}

export function Notifications({ me, ws, go, focus, isTeam }: ScreenProps) {
  // What counted as new when this screen opened. It stays marked for this visit even
  // after the visit is recorded, so nothing disappears while it is being read.
  const firstSeen = useRef<string | null | undefined>(undefined);
  if (firstSeen.current === undefined && ws.data) firstSeen.current = ws.data.seenAt;
  const loaded = Boolean(ws.data);
  useEffect(() => {
    if (!loaded || !supabase) return;
    const t = window.setTimeout(() => {
      void supabase!.rpc('notices_seen').then(({ data }) => {
        if (typeof data === 'string') ws.markSeen(data);
      });
    }, 1500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  if (!ws.data) return <main aria-busy="true" />;
  const news = buildNews(me, ws.data, focus, firstSeen.current ?? null);
  const items = build(me, ws.data, focus);
  const needs = items.filter((i) => i.needs);
  const quiet = items.filter((i) => !i.needs).slice(0, 4);
  const next = nextPost(ws.data, isTeam ? focus : me.clientId ?? focus);

  const row = (it: Item, i: number) => (
    <li key={it.key}>
      <a
        className="bl-row bl-in"
        style={{ animationDelay: `${120 + i * 50}ms` }}
        href={`#${it.action?.path ?? 'today'}`}
        onClick={(e) => {
          e.preventDefault();
          if (it.action) go(it.action.path);
        }}
      >
        <span className={`bl-row-ic${it.needs ? ' alert' : ''}`}>{it.needs ? <Alert /> : <Tick />}</span>
        <span className="bl-row-txt">
          <b>{it.title}</b>
          <small>{[it.label.replace(' · ', ', '), it.body].filter(Boolean).join('. ')}</small>
        </span>
        <span className="bl-row-go">
          <Go />
        </span>
      </a>
    </li>
  );

  // A client still being set up sees their checklist first.
  const mine = !isTeam && me.clientId ? ws.data.clients.find((c) => c.id === me.clientId) : undefined;
  const setup = mine && setupLeft(ws.data, mine) > 0 ? mine : undefined;

  return (
    <main className="bl-today">
      <h1 className="bl-sr">Today</h1>
      {setup && (
        <section className="bl-glass-card bl-in" aria-labelledby="setup-title">
          <h2 id="setup-title" className="bl-section-title" style={{ margin: 0 }}>
            Getting set up
          </h2>
          <Checklist ws={ws.data} client={setup} isTeam={false} go={go} onChanged={() => void ws.refresh()} />
        </section>
      )}
      {next && <NextUp t={next} isTeam={isTeam} go={go} />}

      {needs.length > 0 && (
        <section>
          <h2 className="bl-section-title">
            Needs you <span className="num">{needs.length}</span>
          </h2>
          <ul className="bl-rows">{needs.map(row)}</ul>
        </section>
      )}

      {news.length > 0 && (
        <section aria-labelledby="new-title">
          <h2 id="new-title" className="bl-section-title">
            What&rsquo;s new {news.some((n) => n.fresh) && <span className="num">{news.filter((n) => n.fresh).length}</span>}
          </h2>
          <ul className="bl-rows">
            {news.map((n, i) => (
              <li key={n.key}>
                <a
                  className={`bl-row bl-in${n.fresh ? ' is-fresh' : ''}`}
                  style={{ animationDelay: `${120 + i * 40}ms` }}
                  href={`#${n.path}`}
                  onClick={(e) => {
                    e.preventDefault();
                    go(n.path);
                  }}
                >
                  <span className="bl-row-ic">{n.fresh ? <span className="bl-new-dot" aria-label="New" /> : <Tick />}</span>
                  <span className="bl-row-txt">
                    <b>{n.title}</b>
                    <small>{ago(n.at)}</small>
                  </span>
                  <span className="bl-row-go">
                    <Go />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {quiet.length > 0 && (
        <section>
          <h2 className="bl-section-title">Lately</h2>
          <ul className="bl-rows">{quiet.map(row)}</ul>
        </section>
      )}

      {items.length === 0 && news.length === 0 && !next && (
        <div className="bl-glass-card bl-in" style={{ alignItems: 'center', textAlign: 'center', padding: '28px 20px' }}>
          <b style={{ fontSize: 17 }}>You are all caught up</b>
          <span className="bl-small">
            {isTeam
              ? ws.data.clients.length
                ? 'Nothing is waiting on you. Start something new with Bil.'
                : 'No clients yet. Bring in your first client with Bil to begin.'
              : 'Nothing needs you right now. New posts from your team show up here.'}
          </span>
          {(!isTeam || ws.data.clients.length > 0) && <Banter moment="clear" className="center" after={500} />}
          {isTeam && (
            <button type="button" className="bl-btn" onClick={() => go('create')}>
              Ask Bil
            </button>
          )}
        </div>
      )}
    </main>
  );
}
