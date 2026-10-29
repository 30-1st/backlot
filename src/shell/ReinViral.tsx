import { useEffect, useMemo, useRef, useState } from 'react';
import type { ViralCreatorView, ViralPostView, ViralView } from '../lib/team';

// Rein's viral read of a niche: the posts doing best this week, split into rising (under a
// day old and moving fast) and proven (the week's biggest), the accounts behind them, what
// those posts share, and ideas built on it. Posts open in X's own embed, loaded only when
// tapped, so a brief of 20 posts stays light. Posts X marks sensitive stay covered until
// tapped. Account details are gone 24 hours after the brief was made; the embed still
// shows the account after that.

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const n = (v: number) => compact.format(Math.max(0, Math.round(v)));

function age(hours: number): string {
  if (hours < 1) return 'under an hour ago';
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const MEDIA_WORDS: Record<string, string> = { photo: 'Photo', video: 'Video', gif: 'GIF' };
function mediaLabel(media: string[]): string {
  if (!media.length) return 'Text only';
  const kinds = [...new Set(media)];
  if (kinds.length === 1 && kinds[0] === 'photo' && media.length > 1) return `${media.length} photos`;
  return kinds.map((k) => MEDIA_WORDS[k] ?? k).join(' + ');
}

/**
 * X's official post embed, as a plain frame (no outside script on Backlot's pages). The frame
 * tells the page its height through X's resize message, so it sizes itself to the post.
 */
function XEmbed({ postId }: { postId: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(480);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== 'https://platform.twitter.com' || e.source !== frame.current?.contentWindow) return;
      let data: unknown = e.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      const msg = (data as { 'twttr.embed'?: { method?: string; params?: Array<{ height?: unknown }> } } | null)?.['twttr.embed'];
      if (msg?.method !== 'twttr.private.resize') return;
      const h = Number(msg.params?.[0]?.height);
      if (Number.isFinite(h) && h > 60 && h < 4000) setHeight(Math.ceil(h));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  const night = document.querySelector('.bl-root')?.getAttribute('data-theme') === 'night';
  const src = `https://platform.twitter.com/embed/Tweet.html?id=${postId}&theme=${night ? 'dark' : 'light'}&dnt=true&hideThread=true&embedId=bl-${postId}`;
  return (
    <iframe
      ref={frame}
      className="bl-xembed"
      src={src}
      title="Post on X"
      loading="lazy"
      style={{ height }}
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
    />
  );
}

function PostCard({ p }: { p: ViralPostView }) {
  const [open, setOpen] = useState(false);
  const a = p.account;
  return (
    <li className="bl-viral-post">
      <div className="bl-viral-head">
        <span className="bl-viral-who">
          {a ? (
            <>
              <b>@{a.handle}</b>
              <span className="bl-small">{n(a.followers)} followers</span>
            </>
          ) : (
            <span className="bl-small">Account shows in the post</span>
          )}
        </span>
        <span className="bl-small">{age(p.ageHours)}</span>
      </div>
      <div className="bl-viral-numbers num" aria-label="Public numbers">
        <span>
          <b>{n(p.numbers.likes)}</b> likes
        </span>
        <span>
          <b>{n(p.numbers.replies)}</b> replies
        </span>
        <span>
          <b>{n(p.numbers.reposts)}</b> reposts
        </span>
        {p.numbers.views !== null && (
          <span>
            <b>{n(p.numbers.views)}</b> views
          </span>
        )}
      </div>
      <div className="bl-filters">
        <span className="bl-chip-ink">{mediaLabel(p.media)}</span>
        {p.vsUsual !== null && p.vsUsual >= 1.5 && <span className="bl-chip-ink next">{p.vsUsual >= 10 ? Math.round(p.vsUsual) : p.vsUsual.toFixed(1)}x their usual</span>}
        {p.bucket === 'rising' && <span className="bl-chip-ink">Moving fast</span>}
        {p.sensitive && <span className="bl-chip-ink">Sensitive</span>}
      </div>
      {a?.excerpt && !p.sensitive && <p className="bl-small bl-viral-excerpt">{a.excerpt}</p>}
      {open ? (
        <XEmbed postId={p.postId} />
      ) : (
        <button type="button" className={p.sensitive ? 'bl-viral-cover' : 'bl-ghost bl-start'} onClick={() => setOpen(true)}>
          {p.sensitive ? 'Sensitive post. Tap to show it' : 'Show the post'}
        </button>
      )}
    </li>
  );
}

function CreatorRow({ c, best }: { c: ViralCreatorView; best?: ViralPostView }) {
  return (
    <li className="bl-viral-creator">
      <span className="bl-viral-who">
        <b>@{c.handle}</b>
        <span className="bl-small">{n(c.followers)} followers</span>
      </span>
      <span className="bl-small">
        {best ? `Best post: ${n(best.numbers.likes)} likes, ${age(best.ageHours)}` : `${c.postsSeen} posts read this week`}
      </span>
      <a className="bl-linkish" href={`https://x.com/i/status/${c.bestPostId}`} target="_blank" rel="noopener noreferrer">
        Open on X
      </a>
    </li>
  );
}

type View = 'rising' | 'proven' | 'like';

export function Viral({ viral, followers }: { viral: ViralView; followers: number | null }) {
  const rising = viral.posts.filter((p) => p.bucket === 'rising');
  const proven = viral.posts.filter((p) => p.bucket === 'proven');
  const lo = followers ? Math.max(100, Math.round(followers / 3)) : 0;
  const hi = followers ? Math.round(followers * 3) : 0;
  const like = useMemo(
    () => (followers ? viral.posts.filter((p) => p.account && p.account.followers >= lo && p.account.followers <= hi) : []),
    [viral.posts, followers, lo, hi],
  );
  const [view, setView] = useState<View>(rising.length ? 'rising' : 'proven');
  const shown = view === 'rising' ? rising : view === 'proven' ? proven : like;
  const byPost = new Map(viral.posts.map((p) => [p.postId, p]));

  if (!viral.posts.length) return null;
  return (
    <section className="bl-viral" aria-label="What is doing best in the niche">
      {viral.stats && (
        <p className="bl-small" style={{ margin: 0 }}>
          Rein read {viral.stats.postsRead} posts from the accounts doing best in this niche this week
          {viral.stats.offNicheDropped ? `, and left out ${viral.stats.offNicheDropped} accounts that only shared its words` : ''}.
          {viral.stats.verifiedOnly ? ' Verified accounts only, which keeps bots and spam out.' : ''}
        </p>
      )}

      <div className="bl-seg" role="tablist" aria-label="Which posts">
        <button type="button" role="tab" aria-selected={view === 'rising'} aria-pressed={view === 'rising'} disabled={!rising.length} onClick={() => setView('rising')}>
          Rising <span className="num">{rising.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={view === 'proven'} aria-pressed={view === 'proven'} onClick={() => setView('proven')}>
          This week <span className="num">{proven.length}</span>
        </button>
        {followers !== null && (
          <button type="button" role="tab" aria-selected={view === 'like'} aria-pressed={view === 'like'} onClick={() => setView('like')}>
            Your size <span className="num">{like.length}</span>
          </button>
        )}
      </div>
      <p className="bl-small" style={{ margin: 0 }}>
        {view === 'rising'
          ? 'Under a day old and picking up engagement fastest. Catch these while they are still climbing.'
          : view === 'proven'
          ? 'The week\'s biggest posts, at most three per account. Safe formats to borrow.'
          : `Accounts between ${n(lo)} and ${n(hi)} followers, close to your ${n(followers ?? 0)}. The most realistic models to learn from.`}
      </p>
      {shown.length ? (
        <ol className="bl-viral-list">
          {shown.map((p) => (
            <PostCard key={p.postId} p={p} />
          ))}
        </ol>
      ) : (
        <p className="bl-small">{view === 'like' ? 'No accounts close to your size in this search. The other lists still show what is working.' : 'Nothing here this time.'}</p>
      )}

      {viral.patterns.length > 0 && (
        <div className="bl-glass-card bl-viral-block">
          <b>What&rsquo;s working</b>
          <ul className="bl-viral-patterns">
            {viral.patterns.map((p, i) => (
              <li key={i}>
                <b>{p.pattern}</b>
                <span className="bl-small">{p.why}</span>
                {p.postIds.length > 0 && (
                  <span className="bl-small">
                    Seen in {p.postIds.length} of the top posts
                    {p.postIds.slice(0, 1).map((id) => {
                      const post = byPost.get(id);
                      return post ? `, best ${n(post.numbers.likes)} likes` : '';
                    })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {viral.ideas.length > 0 && (
        <div className="bl-glass-card bl-viral-block">
          <b>Post ideas</b>
          <ul className="bl-viral-patterns">
            {viral.ideas.map((idea, i) => (
              <li key={i}>
                <span>{idea.idea}</span>
                {idea.pattern && <span className="bl-small">Built on: {idea.pattern}</span>}
              </li>
            ))}
          </ul>
          <span className="bl-small">Bil writes these in your own voice when he plans a campaign.</span>
        </div>
      )}

      {viral.creators.length > 0 ? (
        <div className="bl-glass-card bl-viral-block">
          <b>Who&rsquo;s going viral</b>
          <span className="bl-small">The accounts behind this week&rsquo;s top posts. Shown for today only; Rein never follows an account over time.</span>
          <ol className="bl-viral-creators">
            {viral.creators.slice(0, 10).map((c) => (
              <CreatorRow key={c.handle} c={c} best={byPost.get(c.bestPostId)} />
            ))}
          </ol>
        </div>
      ) : (
        viral.detailsExpired && <p className="bl-small">Account names are cleared a day after a search. Run it again to see who is doing best now.</p>
      )}
    </section>
  );
}
