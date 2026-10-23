import { isTeamRole, type Me } from '../lib/team';
import type { Workspace } from './data';
import { PostMedia, ShotFrame } from './PostMedia';
import { clock, nextPost, wantsMedia, when, type Timed } from './timing';
import type { ScreenProps } from './Shell';

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

  return items.sort((a, b) => Number(b.needs) - Number(a.needs) || b.at.localeCompare(a.at));
}

export function needsYouCount(me: Me, ws: Workspace, focus: string | null): number {
  return build(me, ws, focus).filter((i) => i.needs).length;
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
  if (!ws.data) return <main aria-busy="true" />;
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

  return (
    <main className="bl-today">
      <h1 className="bl-sr">Today</h1>
      {next && <NextUp t={next} isTeam={isTeam} go={go} />}

      {needs.length > 0 && (
        <section>
          <h2 className="bl-section-title">
            Needs you <span className="num">{needs.length}</span>
          </h2>
          <ul className="bl-rows">{needs.map(row)}</ul>
        </section>
      )}

      {quiet.length > 0 && (
        <section>
          <h2 className="bl-section-title">Lately</h2>
          <ul className="bl-rows">{quiet.map(row)}</ul>
        </section>
      )}

      {items.length === 0 && !next && (
        <div className="bl-glass-card bl-in" style={{ alignItems: 'center', textAlign: 'center', padding: '28px 20px' }}>
          <b style={{ fontSize: 17 }}>You are all caught up</b>
          <span className="bl-small">
            {isTeam
              ? ws.data.clients.length
                ? 'Nothing is waiting on you. Start something new with Bil.'
                : 'No clients yet. Bring in your first client with Bil to begin.'
              : 'Nothing needs you right now. New posts from your team show up here.'}
          </span>
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
