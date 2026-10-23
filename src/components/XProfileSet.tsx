import { useMemo, useState } from 'react';
import type { MediaItem, Post } from '../types';
import { isPublic, orderPosts, statusOf, useStage } from '../state';
import { compact, plural, shortDate } from '../lib/format';
import { Icon, MediaView, cx } from './ui';
import { useFile } from '../shell/PostMedia';
import { ArcStrip, stageOf, type Layer, type LayerPost } from './CampaignLayer';

// An X profile on the set: header image, photo, name and handle, bio, counts, then the
// timeline. A post can be words alone, or words with up to 4 photos or videos. Nothing
// here talks to X; it is the creator's own page, staged to plan and narrate.

type Tab = 'posts' | 'media';

/** "2h", "5d", or "Oct 3", the way X dates a post in the timeline. */
function age(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

function MediaGrid({ items }: { items: Array<MediaItem | undefined> }) {
  const shown = items.slice(0, 4);
  if (shown.length === 0) return null;
  return (
    <div className={cx('x-media', `n${shown.length}`)}>
      {shown.map((m, i) => (
        <span key={i} className="x-media-cell">
          <MediaView item={m} />
          {m?.kind === 'video' && (
            <span className="x-play">
              <Icon name="play" size={18} fill />
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

function XPost({ post }: { post: Post }) {
  const { sandbox, view, now: realNow, asOf, selection, select, canEdit } = useStage();
  // A visitor looking from another day sees post ages as they would be on that day.
  const now = view === 'visitor' ? asOf : realNow;
  const { profile, media } = sandbox;
  const creator = view === 'creator';
  const editing = creator && canEdit;
  const status = statusOf(post, now);
  const selected = editing && selection?.type === 'post' && selection.id === post.id;
  const counts: Array<[Parameters<typeof Icon>[0]['name'], number, string]> = [
    ['comment', post.comments, 'replies'],
    ['repost', post.reposts ?? 0, 'reposts'],
    ['heart', post.likes, 'likes'],
    ['views', post.views ?? 0, 'views'],
  ];
  const body = (
    <>
      <span className="x-post-avatar">
        <MediaView item={profile.avatar ? media[profile.avatar] : undefined} />
      </span>
      <span className="x-post-main">
        {post.pinnedAt !== null && (
          <span className="x-pinned">
            <Icon name="pin" size={12} fill /> Pinned
          </span>
        )}
        <span className="x-post-head">
          <b>{profile.name || profile.username || 'Name'}</b>
          <span className="x-muted">
            @{profile.username || 'handle'}
            {post.date <= now && ` · ${age(post.date, now)}`}
          </span>
          {creator && status !== 'live' && (
            <span className={cx('x-status', `is-${status}`)}>{status === 'scheduled' ? `Goes live ${shortDate(post.date, now)}` : 'Draft'}</span>
          )}
        </span>
        {post.caption ? <span className="x-text">{post.caption}</span> : editing && post.media.length === 0 ? <span className="x-text x-muted">Tap to write this post.</span> : null}
        <MediaGrid items={post.media.map((id) => media[id])} />
        <span className="x-actions">
          {counts.map(([icon, n, label]) => (
            <span key={label} className="x-act" aria-label={`${n} ${label}`}>
              <Icon name={icon} size={16} />
              {n > 0 ? compact(n) : ''}
            </span>
          ))}
        </span>
      </span>
    </>
  );
  return editing ? (
    <button type="button" className={cx('x-post', selected && 'is-selected', `is-${status}`)} onClick={() => select({ type: 'post', id: post.id })} aria-label={`Edit post${post.caption ? `: ${post.caption.slice(0, 60)}` : ''}`}>
      {body}
    </button>
  ) : (
    <article className={cx('x-post', creator && `is-${status}`)}>{body}</article>
  );
}

/** A campaign photo or video from the client's Media, drawn in X's grid. */
function LayerMedia({ id }: { id: string }) {
  const file = useFile(id);
  if (!file || file === 'gone') return file === 'gone' ? null : <div className="x-media n1"><span className="x-media-cell" aria-busy="true" /></div>;
  return (
    <div className="x-media n1">
      <span className="x-media-cell">
        {file.kind === 'video' ? <video src={`${file.url}#t=0.1`} controls playsInline preload="metadata" /> : <img src={file.url} alt="" />}
      </span>
    </div>
  );
}

/** A post from the campaign layer. Read only: approving and details happen in the Schedule. */
function LayerPostView({ post, layer }: { post: LayerPost; layer: Layer }) {
  const { sandbox, view, now: realNow, asOf } = useStage();
  const { profile, media } = sandbox;
  const creator = view === 'creator';
  const now = creator ? realNow : asOf;
  const stage = stageOf(post.stage);
  return (
    <article id={`layer-${post.key}`} className={cx('x-post', creator && 'is-layer', creator && post.held && 'is-held')}>
      <span className="x-post-avatar">
        <MediaView item={profile.avatar ? media[profile.avatar] : undefined} />
      </span>
      <span className="x-post-main">
        {creator && (
          <span className="x-layer-tag">
            {stage && <i className={`arc-dot is-${stage.id}`}>{stage.n}</i>}
            {layer.title}
            {stage ? ` · ${stage.word}` : ''}
          </span>
        )}
        <span className="x-post-head">
          <b>{profile.name || profile.username || 'Name'}</b>
          <span className="x-muted">
            @{profile.username || 'handle'}
            {post.at <= now && ` · ${age(post.at, now)}`}
          </span>
          {creator && post.at > now && <span className="x-status is-scheduled">Goes live {shortDate(post.at, now)}</span>}
        </span>
        {post.held ? (
          <span className="x-held">
            <b>Needs a detail.</b> {post.idea}
            {post.missing.length > 0 && <span className="x-muted"> Missing: {post.missing.join(' ')}</span>}
            <a className="x-held-link" href={`#campaigns.${post.campaignId}`}>
              Answer it in the Schedule
            </a>
          </span>
        ) : (
          <span className="x-text">{post.text}</span>
        )}
        {post.mediaId && !post.held && <LayerMedia id={post.mediaId} />}
        <span className="x-actions" aria-hidden="true">
          {(['comment', 'repost', 'heart', 'views'] as const).map((icon) => (
            <span key={icon} className="x-act">
              <Icon name={icon} size={16} />
            </span>
          ))}
        </span>
      </span>
    </article>
  );
}

type Item = { kind: 'own'; post: Post; at: number } | { kind: 'layer'; post: LayerPost; at: number };

export function XProfileSet({ layer = null }: { layer?: Layer | null }) {
  const { sandbox, view, asOf, selection, select, canEdit } = useStage();
  const { profile, posts, media, settings } = sandbox;
  const [tab, setTab] = useState<Tab>('posts');
  const creator = view === 'creator';
  const editing = creator && canEdit;

  const shown = useMemo(() => {
    const base = creator ? posts : posts.filter((p) => isPublic(p, asOf));
    return tab === 'media' ? base.filter((p) => p.media.length > 0) : base;
  }, [creator, posts, asOf, tab]);
  const { pinned, rest } = useMemo(() => orderPosts(shown), [shown]);
  // Campaign posts: everything for the creator; for a visitor, only written posts that
  // are already out at the moment they are looking from.
  const layerShown = useMemo(() => {
    if (!layer) return [];
    const base = creator ? layer.posts : layer.posts.filter((p) => !p.held && p.at <= asOf);
    return tab === 'media' ? base.filter((p) => p.mediaId && !p.held) : base;
  }, [layer, creator, asOf, tab]);
  const timeline = useMemo<Item[]>(
    () =>
      [
        ...rest.map((p): Item => ({ kind: 'own', post: p, at: p.date })),
        ...layerShown.map((p): Item => ({ kind: 'layer', post: p, at: p.at })),
      ].sort((a, b) => b.at - a.at),
    [rest, layerShown],
  );
  const publicCount = useMemo(() => posts.filter((p) => isPublic(p, asOf)).length, [posts, asOf]);
  const layerOut = layer ? layer.posts.filter((p) => !p.held && p.at <= asOf).length : 0;
  const postCount = (profile.postCount ?? publicCount) + layerOut;
  const jump = (key: string) => document.getElementById(`layer-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const pick = () => editing && select({ type: 'profile' });
  const profileSelected = editing && selection?.type === 'profile';

  return (
    <div className="set lit x-set" data-lighting={settings.lighting}>
      <header className={cx('x-head', profileSelected && 'is-selected')}>
        <div className="x-topbar">
          <b>{profile.name || profile.username || 'Name'}</b>
          <span className="x-muted">
            {compact(postCount)} {plural(postCount, 'post')}
          </span>
        </div>
        <div className="x-banner" onClick={pick} role={editing ? 'button' : undefined} tabIndex={editing ? 0 : undefined} aria-label={editing ? 'Edit header image' : undefined}>
          {profile.banner ? <MediaView item={media[profile.banner]} /> : null}
        </div>
        <div className="x-id">
          {editing ? (
            <button type="button" className="x-avatar" onClick={pick} aria-label="Edit profile photo">
              <MediaView item={profile.avatar ? media[profile.avatar] : undefined} />
            </button>
          ) : (
            <span className="x-avatar">
              <MediaView item={profile.avatar ? media[profile.avatar] : undefined} />
            </span>
          )}
          <span className="x-id-btn">
            {editing ? (
              <button type="button" className="app-btn x-pill" onClick={pick}>
                Edit profile
              </button>
            ) : creator ? null : (
              <span className="app-btn solid x-pill">Follow</span>
            )}
          </span>
        </div>
        <div className="x-bio">
          <h1 className="x-name">{profile.name || 'Name'}</h1>
          <span className="x-muted">@{profile.username || 'handle'}</span>
          {profile.bio && <p>{profile.bio}</p>}
          {(profile.category || profile.link) && (
            <span className="x-meta x-muted">
              {profile.category && <span>{profile.category}</span>}
              {profile.link && (
                <span className="x-link">
                  <Icon name="link" size={14} />
                  {profile.link}
                </span>
              )}
            </span>
          )}
          <span className="x-counts">
            <span>
              <b>{compact(profile.following)}</b> <span className="x-muted">Following</span>
            </span>
            <span>
              <b>{compact(profile.followers)}</b> <span className="x-muted">{plural(profile.followers, 'Follower')}</span>
            </span>
          </span>
        </div>
      </header>

      <div className="tabs x-tabs" role="tablist" aria-label="Profile sections">
        <button type="button" role="tab" aria-selected={tab === 'posts'} onClick={() => setTab('posts')}>
          Posts
        </button>
        <button type="button" role="tab" aria-selected={tab === 'media'} onClick={() => setTab('media')}>
          Media
        </button>
      </div>

      {creator && layer && tab === 'posts' && <ArcStrip posts={layer.posts} onJump={jump} />}

      {shown.length === 0 && layerShown.length === 0 ? (
        <div className="grid-empty">
          <Icon name={tab === 'media' ? 'image' : 'chat'} size={30} />
          <strong>{tab === 'media' ? 'No media yet' : 'No posts yet'}</strong>
          {editing && <span>{tab === 'media' ? 'Posts with photos or videos show up here.' : 'Write a new post, or add media to start this profile.'}</span>}
        </div>
      ) : (
        <div className="x-timeline">
          {pinned.map((p) => (
            <XPost key={p.id} post={p} />
          ))}
          {timeline.map((it) =>
            it.kind === 'own' ? <XPost key={it.post.id} post={it.post} /> : <LayerPostView key={it.post.key} post={it.post} layer={layer!} />,
          )}
        </div>
      )}
    </div>
  );
}
