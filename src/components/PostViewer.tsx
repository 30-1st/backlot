import { useState } from 'react';
import type { Post } from '../types';
import { statusOf, useStage } from '../state';
import { ago, compact, dateTime, longDate, plural } from '../lib/format';
import { Icon, MediaView, Modal, cx } from './ui';

/** The open post, the way someone tapping the grid sees it. */
export function PostViewer({ post, onClose }: { post: Post; onClose: () => void }) {
  const { sandbox, view, now, asOf, select } = useStage();
  const { profile, media, settings } = sandbox;
  const [index, setIndex] = useState(0);
  const i = Math.min(index, post.media.length - 1);
  const status = statusOf(post, now);
  const many = post.media.length > 1;

  return (
    <Modal label="Post" className="viewer" onClose={onClose}>
      <div className="viewer-in lit" data-lighting={settings.lighting}>
        <div className="viewer-media">
          <MediaView key={post.media[i]} item={media[post.media[i]]} controls />
          {many && i > 0 && (
            <button type="button" className="nav nav-prev" aria-label="Previous" onClick={() => setIndex(i - 1)}>
              <Icon name="left" size={18} />
            </button>
          )}
          {many && i < post.media.length - 1 && (
            <button type="button" className="nav nav-next" aria-label="Next" onClick={() => setIndex(i + 1)}>
              <Icon name="right" size={18} />
            </button>
          )}
          {many && (
            <div className="pips" aria-hidden="true">
              {post.media.map((id, n) => (
                <i key={`${id}-${n}`} className={cx(n === i && 'on')} />
              ))}
            </div>
          )}
        </div>

        <div className="viewer-side">
          <div className="viewer-head">
            <span className="mini-avatar">
              <MediaView item={profile.avatar ? media[profile.avatar] : undefined} />
            </span>
            <div className="viewer-who">
              <b>{profile.username || 'username'}</b>
              {post.location && <span>{post.location}</span>}
            </div>
            <button type="button" className="viewer-close" aria-label="Close" onClick={onClose}>
              <Icon name="close" size={20} />
            </button>
          </div>

          <div className="viewer-body">
            {post.caption ? (
              <p>
                <b>{profile.username || 'username'}</b> {post.caption}
              </p>
            ) : (
              <p className="quiet">No caption.</p>
            )}
          </div>

          <div className="viewer-foot">
            <div className="viewer-counts">
              <span>
                <Icon name="heart" size={22} />
                {compact(post.likes)} {plural(post.likes, 'like')}
              </span>
              <span>
                <Icon name="comment" size={22} />
                {compact(post.comments)} {plural(post.comments, 'comment')}
              </span>
            </div>
            <time dateTime={new Date(post.date).toISOString()}>
              {status === 'live' || view === 'visitor' ? ago(post.date, view === 'visitor' ? asOf : now) : longDate(post.date)}
            </time>
            {view === 'creator' && status !== 'live' && (
              <div className={cx('viewer-note', `chip-${status}`)}>
                {status === 'scheduled'
                  ? `Scheduled for ${dateTime(post.date, now)}. Visitors cannot see this yet.`
                  : 'Draft. Only you can see this.'}
              </div>
            )}
            {view === 'creator' && (
              <button
                type="button"
                className="app-btn"
                onClick={() => {
                  select({ type: 'post', id: post.id });
                  onClose();
                }}
              >
                Edit this post
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
