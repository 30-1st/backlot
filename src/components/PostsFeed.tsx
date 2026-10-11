import { useEffect, useMemo, useRef, useState } from 'react';
import type { Post } from '../types';
import { isPublic, orderPosts, statusOf, useStage } from '../state';
import { ago, dateTime, longDate, plural } from '../lib/format';
import { Icon, MediaView, Modal, cx } from './ui';

/**
 * The page's posts as one scrolling list, the way tapping a post on a profile
 * opens them in the real app. Starts at the post that was tapped. In creator
 * view every post has an Edit button, and the list follows each change live,
 * so you can scroll the page and shape it at the same time.
 */
export function PostsFeed({ startId, onClose }: { startId: string; onClose: () => void }) {
  const { sandbox, view, asOf } = useStage();
  const creator = view === 'creator';

  const posts = useMemo(() => {
    const shown = creator ? sandbox.posts : sandbox.posts.filter((p) => isPublic(p, asOf));
    const { pinned, rest } = orderPosts(shown);
    return [...pinned, ...rest];
  }, [creator, sandbox.posts, asOf]);

  // Jump to the tapped post once, on opening. After that the reader scrolls freely.
  const start = useRef(startId);
  useEffect(() => {
    document.getElementById(`feed-${start.current}`)?.scrollIntoView({ block: 'start' });
  }, []);

  return (
    <Modal label="Posts" className="feed" onClose={onClose}>
      <div className="feed-in lit" data-lighting={sandbox.settings.lighting}>
        <header className="feed-head">
          <button type="button" className="feed-back" aria-label="Back to profile" onClick={onClose}>
            <Icon name="left" size={24} />
          </button>
          <div className="feed-title">
            <span>{sandbox.profile.username || 'username'}</span>
            <strong>Posts</strong>
          </div>
        </header>

        <div className="feed-list">
          {posts.map((post) => (
            <FeedPost key={post.id} post={post} />
          ))}
          {posts.length === 0 && <p className="feed-empty">No posts to show.</p>}
        </div>
      </div>
    </Modal>
  );
}

function FeedPost({ post }: { post: Post }) {
  const { sandbox, view, now, asOf, canEdit, select } = useStage();
  const { profile, media } = sandbox;
  const creator = view === 'creator';
  const status = statusOf(post, now);
  const username = profile.username || 'username';

  return (
    <article className="fp" id={`feed-${post.id}`}>
      <header className="fp-head">
        <span className="mini-avatar">
          <MediaView item={profile.avatar ? media[profile.avatar] : undefined} />
        </span>
        <div className="fp-who">
          <b>{username}</b>
          {post.location && <span>{post.location}</span>}
        </div>
        {post.pinnedAt !== null && (
          <span className="fp-pin" title="Pinned">
            <Icon name="pin" size={16} fill />
          </span>
        )}
        {creator && canEdit && (
          <button type="button" className="app-btn fp-edit" onClick={() => select({ type: 'post', id: post.id })}>
            Edit
          </button>
        )}
      </header>

      <Carousel ids={post.media} />

      <div className="fp-body">
        {creator && status !== 'live' && (
          <div className={cx('fp-note', `chip-${status}`)}>
            {status === 'scheduled'
              ? `Scheduled for ${dateTime(post.date, now)}. Visitors cannot see this yet.`
              : 'Draft. Only you can see this.'}
          </div>
        )}
        <div className="fp-actions" aria-hidden="true">
          <Icon name="heart" size={24} />
          <Icon name="comment" size={24} />
          <Icon name="send" size={24} />
          <span className="fp-save">
            <Icon name="bookmark" size={24} />
          </span>
        </div>
        <div className="fp-likes">
          {post.likes.toLocaleString('en-US')} {plural(post.likes, 'like')}
        </div>
        {post.caption && (
          <p className="fp-caption">
            <b>{username}</b> {post.caption}
          </p>
        )}
        {post.comments > 0 && (
          <div className="fp-comments">
            View {post.comments === 1 ? '1 comment' : `all ${post.comments.toLocaleString('en-US')} comments`}
          </div>
        )}
        <time className="fp-time" dateTime={new Date(post.date).toISOString()}>
          {status === 'live' || !creator ? ago(post.date, creator ? now : asOf) : longDate(post.date)}
        </time>
      </div>
    </article>
  );
}

/** A post's photos and videos, side by side. Swipe, or use the arrows. */
function Carousel({ ids }: { ids: string[] }) {
  const { sandbox } = useStage();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const many = ids.length > 1;
  const at = Math.min(index, ids.length - 1);

  function go(n: number) {
    const el = track.current;
    if (el) el.scrollTo({ left: n * el.clientWidth, behavior: 'smooth' });
  }

  return (
    <div className="car" data-tile={sandbox.settings.tile}>
      <div
        className="car-track"
        ref={track}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.clientWidth > 0) setIndex(Math.round(el.scrollLeft / el.clientWidth));
        }}
      >
        {ids.map((id, n) => (
          <div className="car-slide" key={`${id}-${n}`}>
            <MediaView item={sandbox.media[id]} controls />
          </div>
        ))}
      </div>
      {many && (
        <>
          <span className="car-count">
            {at + 1}/{ids.length}
          </span>
          {at > 0 && (
            <button type="button" className="nav nav-prev" aria-label="Previous" onClick={() => go(at - 1)}>
              <Icon name="left" size={18} />
            </button>
          )}
          {at < ids.length - 1 && (
            <button type="button" className="nav nav-next" aria-label="Next" onClick={() => go(at + 1)}>
              <Icon name="right" size={18} />
            </button>
          )}
          <div className="pips" aria-hidden="true">
            {ids.map((id, n) => (
              <i key={`${id}-${n}`} className={cx(n === at && 'on')} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
