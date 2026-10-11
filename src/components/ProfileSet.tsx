import { useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Post } from '../types';
import { dateBetween, isPublic, orderPosts, statusOf, useStage } from '../state';
import { compact, dateTime, plural, shortDate } from '../lib/format';
import { Icon, MediaView, cx } from './ui';

type Tab = 'posts' | 'reels';

export function ProfileSet({ onAddHighlight }: { onAddHighlight: () => void }) {
  const { sandbox, view, asOf, selection, select } = useStage();
  const { profile, highlights, posts, media, settings } = sandbox;
  const [tab, setTab] = useState<Tab>('posts');
  const creator = view === 'creator';

  const shown = useMemo(() => {
    const base = creator ? posts : posts.filter((p) => isPublic(p, asOf));
    return tab === 'reels' ? base.filter((p) => media[p.media[0]]?.kind === 'video') : base;
  }, [creator, posts, asOf, tab, media]);

  const publicCount = useMemo(() => posts.filter((p) => isPublic(p, asOf)).length, [posts, asOf]);
  const postCount = profile.postCount ?? publicCount;

  const stats: Array<[number, string]> = [
    [postCount, plural(postCount, 'post')],
    [profile.followers, plural(profile.followers, 'follower')],
    [profile.following, 'following'],
  ];

  return (
    <div className="set lit" data-lighting={settings.lighting}>
      <header className={cx('pf-head', creator && selection?.type === 'profile' && 'is-selected')}>
        {creator ? (
          <button type="button" className="pf-avatar" onClick={() => select({ type: 'profile' })} aria-label="Edit profile photo">
            <MediaView item={profile.avatar ? media[profile.avatar] : undefined} />
          </button>
        ) : (
          <div className="pf-avatar">
            <MediaView item={profile.avatar ? media[profile.avatar] : undefined} />
          </div>
        )}

        <div className="pf-top">
          <h1 className="pf-username">{profile.username || 'username'}</h1>
          <div className="pf-actions">
            {creator ? (
              <button type="button" className="app-btn" onClick={() => select({ type: 'profile' })}>
                Edit profile
              </button>
            ) : (
              <>
                <span className="app-btn solid">Follow</span>
                <span className="app-btn">Message</span>
              </>
            )}
          </div>
        </div>

        <ul className="pf-stats">
          {stats.map(([n, label]) => (
            <li key={label}>
              <b>{compact(n)}</b> {label}
            </li>
          ))}
        </ul>

        <div className="pf-bio">
          {profile.name && <div className="pf-name">{profile.name}</div>}
          {profile.category && <div className="pf-category">{profile.category}</div>}
          {profile.bio && <p>{profile.bio}</p>}
          {profile.link && (
            <div className="pf-link">
              <Icon name="link" size={14} />
              {profile.link}
            </div>
          )}
        </div>
      </header>

      {(highlights.length > 0 || creator) && (
        <div className="hl-row">
          {highlights.map((h) => {
            const body = (
              <>
                <span className="hl-ring">
                  <MediaView item={h.cover ? media[h.cover] : undefined} />
                </span>
                <span className="hl-title">{h.title || 'Untitled'}</span>
              </>
            );
            return creator ? (
              <button
                key={h.id}
                type="button"
                className={cx('hl', selection?.type === 'highlight' && selection.id === h.id && 'is-selected')}
                onClick={() => select({ type: 'highlight', id: h.id })}
              >
                {body}
              </button>
            ) : (
              <div key={h.id} className="hl">
                {body}
              </div>
            );
          })}
          {creator && (
            <button type="button" className="hl hl-new" onClick={onAddHighlight}>
              <span className="hl-ring">
                <Icon name="plus" size={26} />
              </span>
              <span className="hl-title">New</span>
            </button>
          )}
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="Profile sections">
        <button type="button" role="tab" aria-selected={tab === 'posts'} onClick={() => setTab('posts')}>
          <Icon name="grid" /> Posts
        </button>
        <button type="button" role="tab" aria-selected={tab === 'reels'} onClick={() => setTab('reels')}>
          <Icon name="play" /> Reels
        </button>
      </div>

      <Grid posts={shown} sortable={creator && tab === 'posts'} tab={tab} />
    </div>
  );
}

function Grid({ posts, sortable, tab }: { posts: Post[]; sortable: boolean; tab: Tab }) {
  const { sandbox, dispatch, view, now, say } = useStage();
  const { pinned, rest } = useMemo(() => orderPosts(posts), [posts]);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    // Enter still selects a tile; Space picks it up to move with the arrow keys.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = rest.findIndex((p) => p.id === active.id);
    const to = rest.findIndex((p) => p.id === over.id);
    if (from < 0 || to < 0) return;
    const moved = arrayMove(rest, from, to);
    const post = moved[to];
    const date = dateBetween(moved[to - 1], moved[to + 1], post.date);
    dispatch({ type: 'post', id: post.id, patch: { date } });
    const status = statusOf({ ...post, date }, now);
    say(
      status === 'draft'
        ? `Moved. This draft now sits at ${dateTime(date, now)}.`
        : status === 'scheduled'
          ? `Moved. Now scheduled for ${dateTime(date, now)}.`
          : `Moved. Post date is now ${dateTime(date, now)}.`,
    );
  }

  if (posts.length === 0) {
    return (
      <div className="grid-empty">
        <Icon name={tab === 'reels' ? 'play' : 'image'} size={30} />
        <strong>{tab === 'reels' ? 'No reels yet' : 'No posts yet'}</strong>
        {view === 'creator' && (
          <span>{tab === 'reels' ? 'Posts that open with a video show up here.' : 'Add posts to start building this profile.'}</span>
        )}
      </div>
    );
  }

  const tiles = (
    <div className="grid" data-tile={sandbox.settings.tile}>
      {pinned.map((p) => (
        <Tile key={p.id} post={p} />
      ))}
      {rest.map((p) => (sortable ? <SortableTile key={p.id} post={p} /> : <Tile key={p.id} post={p} />))}
    </div>
  );

  if (!sortable) return tiles;
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={rest.map((p) => p.id)} strategy={rectSortingStrategy}>
        {tiles}
      </SortableContext>
    </DndContext>
  );
}

function SortableTile({ post }: { post: Post }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: post.id });
  return (
    <Tile
      post={post}
      dragging={isDragging}
      sortableProps={{
        ref: setNodeRef,
        style: { transform: CSS.Transform.toString(transform), transition },
        ...attributes,
        ...listeners,
      }}
    />
  );
}

function Tile({
  post,
  dragging = false,
  sortableProps,
}: {
  post: Post;
  dragging?: boolean;
  sortableProps?: object;
}) {
  const { sandbox, view, now, selection, select, openPost } = useStage();
  const creator = view === 'creator';
  const cover = sandbox.media[post.media[0]];
  const status = statusOf(post, now);
  const selected = creator && selection?.type === 'post' && selection.id === post.id;

  const label = creator
    ? `Edit post${post.caption ? `: ${post.caption.slice(0, 60)}` : ''}`
    : `Open post${post.caption ? `: ${post.caption.slice(0, 60)}` : ''}`;

  return (
    <button
      type="button"
      {...sortableProps}
      className={cx('tile', selected && 'is-selected', dragging && 'is-dragging', creator && `is-${status}`)}
      aria-label={label}
      onClick={() => (creator ? select({ type: 'post', id: post.id }) : openPost(post.id))}
      onDoubleClick={() => creator && openPost(post.id)}
    >
      <MediaView item={cover} />
      <span className="tile-marks">
        {post.pinnedAt !== null && <Icon name="pin" size={17} fill />}
        {post.media.length > 1 && <Icon name="layers" size={17} />}
        {cover?.kind === 'video' && <Icon name="play" size={17} fill />}
      </span>
      {creator && status !== 'live' && (
        <span className={cx('chip', `chip-${status}`)}>
          {status === 'scheduled' ? (
            <>
              <Icon name="clock" size={13} />
              {shortDate(post.date, now)}
            </>
          ) : (
            'Draft'
          )}
        </span>
      )}
    </button>
  );
}
