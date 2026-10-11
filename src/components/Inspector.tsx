import { useEffect, useState } from 'react';
import type { Highlight, Post, PostStatus } from '../types';
import { MAX_CAROUSEL, MAX_PINNED, patchForStatus, statusOf, useStage } from '../state';
import { storeFile } from '../lib/media';
import { dateTime, fromInput, toInput } from '../lib/format';
import { ConfirmButton, Field, FileButton, Icon, MediaView, NumberInput, Segmented, cx } from './ui';

const STATUS_COLOR: Record<PostStatus, string> = {
  live: 'var(--live)',
  scheduled: 'var(--sched)',
  draft: 'var(--draft)',
};

export function Inspector() {
  const { sandbox, selection, select } = useStage();
  const post = selection?.type === 'post' ? sandbox.posts.find((p) => p.id === selection.id) : undefined;
  const highlight =
    selection?.type === 'highlight' ? sandbox.highlights.find((h) => h.id === selection.id) : undefined;

  return (
    <aside className="panel" data-open={selection !== null} aria-label="Properties">
      <div className="panel-in">
        <button type="button" className="panel-close btn quiet sm" onClick={() => select(null)}>
          <Icon name="close" /> Close
        </button>
        {post ? (
          <PostPanel key={post.id} post={post} />
        ) : highlight ? (
          <HighlightPanel key={highlight.id} highlight={highlight} />
        ) : (
          <ProfilePanel />
        )}
      </div>
    </aside>
  );
}

/* ---------- Profile ---------- */

function ProfilePanel() {
  const { sandbox, dispatch, asOf } = useStage();
  const { profile, media, settings, posts } = sandbox;
  const set = (patch: Partial<typeof profile>) => dispatch({ type: 'profile', patch });
  const visible = posts.filter((p) => !p.draft && p.date <= asOf).length;

  async function changeAvatar(files: File[]) {
    const item = await storeFile(files[0]);
    dispatch({ type: 'media', items: [item] });
    set({ avatar: item.id });
  }

  return (
    <>
      <h2>Profile</h2>

      <div className="avatar-edit">
        <span className="avatar-thumb">
          <MediaView item={profile.avatar ? media[profile.avatar] : undefined} />
        </span>
        <div className="stack-sm">
          <FileButton label="Change photo" icon="swap" className="btn sm" imagesOnly onFiles={changeAvatar} />
          {profile.avatar && (
            <button type="button" className="btn quiet sm" onClick={() => set({ avatar: null })}>
              Remove photo
            </button>
          )}
        </div>
      </div>

      <Field label="Username">
        <input
          id="pf-username"
          value={profile.username}
          maxLength={30}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => set({ username: e.target.value.replace(/\s/g, '').toLowerCase() })}
        />
      </Field>
      <Field label="Name">
        <input id="pf-name" value={profile.name} maxLength={64} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label="Category">
        <input
          id="pf-category"
          value={profile.category}
          maxLength={40}
          placeholder="Artist, Digital creator, Shop"
          onChange={(e) => set({ category: e.target.value })}
        />
      </Field>
      <Field label="Bio" hint={`${profile.bio.length} of 150`}>
        <textarea id="pf-bio" rows={4} maxLength={150} value={profile.bio} onChange={(e) => set({ bio: e.target.value })} />
      </Field>
      <Field label="Link">
        <input
          id="pf-link"
          value={profile.link}
          maxLength={80}
          autoComplete="off"
          spellCheck={false}
          placeholder="yoursite.com"
          onChange={(e) => set({ link: e.target.value })}
        />
      </Field>

      <div className="row2">
        <Field label="Followers">
          <NumberInput id="pf-followers" value={profile.followers} onChange={(v) => set({ followers: v ?? 0 })} />
        </Field>
        <Field label="Following">
          <NumberInput id="pf-following" value={profile.following} onChange={(v) => set({ following: v ?? 0 })} />
        </Field>
      </div>
      <Field label="Post count" hint="Leave empty to count the posts visitors can see.">
        <NumberInput
          id="pf-postcount"
          value={profile.postCount}
          allowEmpty
          placeholder={`Auto (${visible})`}
          onChange={(v) => set({ postCount: v })}
        />
      </Field>

      <hr />

      <h3>Set</h3>
      <div className="field">
        <span className="field-label">Lighting</span>
        <Segmented
          block
          label="Lighting"
          value={settings.lighting}
          options={[
            { value: 'light', label: 'Light mode' },
            { value: 'dark', label: 'Dark mode' },
          ]}
          onChange={(lighting) => dispatch({ type: 'settings', patch: { lighting } })}
        />
      </div>
      <div className="field">
        <span className="field-label">Grid crop</span>
        <Segmented
          block
          label="Grid crop"
          value={settings.tile}
          options={[
            { value: 'portrait', label: 'Tall 4:5' },
            { value: 'square', label: 'Square' },
          ]}
          onChange={(tile) => dispatch({ type: 'settings', patch: { tile } })}
        />
      </div>
    </>
  );
}

/* ---------- Post ---------- */

function PostPanel({ post }: { post: Post }) {
  const { sandbox, dispatch, now, select, openPost, say } = useStage();
  const [shot, setShot] = useState(0);
  const set = (patch: Partial<Post>) => dispatch({ type: 'post', id: post.id, patch });
  const status = statusOf(post, now);
  const index = Math.min(shot, post.media.length - 1);
  const pinnedCount = sandbox.posts.filter((p) => p.pinnedAt !== null).length;

  useEffect(() => {
    if (shot > post.media.length - 1) setShot(Math.max(0, post.media.length - 1));
  }, [shot, post.media.length]);

  async function addMedia(files: File[]) {
    const room = MAX_CAROUSEL - post.media.length;
    const items = await Promise.all(files.slice(0, room).map(storeFile));
    dispatch({ type: 'media', items });
    set({ media: [...post.media, ...items.map((m) => m.id)] });
    if (files.length > room) say(`A post holds up to ${MAX_CAROUSEL} photos or videos. Added the first ${room}.`);
  }

  async function replaceMedia(files: File[]) {
    const item = await storeFile(files[0]);
    dispatch({ type: 'media', items: [item] });
    set({ media: post.media.map((id, i) => (i === index ? item.id : id)) });
  }

  function moveShot(dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= post.media.length) return;
    const next = [...post.media];
    [next[index], next[j]] = [next[j], next[index]];
    set({ media: next });
    setShot(j);
  }

  function removeShot() {
    set({ media: post.media.filter((_, i) => i !== index) });
    setShot(Math.max(0, index - 1));
  }

  function togglePin() {
    if (post.pinnedAt !== null) return set({ pinnedAt: null });
    if (pinnedCount >= MAX_PINNED) return say(`Up to ${MAX_PINNED} posts can be pinned. Unpin one first.`);
    set({ pinnedAt: Date.now() });
  }

  return (
    <>
      <h2>Post</h2>

      <div className="shots">
        {post.media.map((id, i) => (
          <button
            key={`${id}-${i}`}
            type="button"
            className={cx('shot', i === index && 'is-selected')}
            aria-label={`Photo or video ${i + 1} of ${post.media.length}`}
            aria-pressed={i === index}
            onClick={() => setShot(i)}
          >
            <MediaView item={sandbox.media[id]} />
            {i === 0 && post.media.length > 1 && <span className="shot-cover">Cover</span>}
          </button>
        ))}
      </div>
      <div className="shot-tools">
        <FileButton label="Swap" icon="swap" className="btn sm" onFiles={replaceMedia} />
        {post.media.length < MAX_CAROUSEL && (
          <FileButton label="Add" icon="plus" className="btn sm" multiple onFiles={addMedia} />
        )}
        {post.media.length > 1 && (
          <>
            <button type="button" className="btn sm" disabled={index === 0} onClick={() => moveShot(-1)} aria-label="Move earlier">
              <Icon name="left" />
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={index === post.media.length - 1}
              onClick={() => moveShot(1)}
              aria-label="Move later"
            >
              <Icon name="right" />
            </button>
            <button type="button" className="btn sm danger" onClick={removeShot} aria-label="Remove this photo or video">
              <Icon name="trash" />
            </button>
          </>
        )}
      </div>

      <div className="field">
        <span className="field-label">Status</span>
        <Segmented
          block
          label="Status"
          value={status}
          options={[
            { value: 'live', label: 'Live', dot: STATUS_COLOR.live },
            { value: 'scheduled', label: 'Scheduled', dot: STATUS_COLOR.scheduled },
            { value: 'draft', label: 'Draft', dot: STATUS_COLOR.draft },
          ]}
          onChange={(next) => set(patchForStatus(post, next, now))}
        />
        <span className="field-hint">
          {status === 'live' && 'Visitors see this post.'}
          {status === 'scheduled' && `Visitors see this from ${dateTime(post.date, now)}.`}
          {status === 'draft' && 'Only you see this. Its date decides where it sits in the grid.'}
        </span>
      </div>

      <Field label="Date and time">
        <input
          id="post-date"
          type="datetime-local"
          value={toInput(post.date)}
          onChange={(e) => {
            const date = fromInput(e.target.value);
            if (date !== null) set({ date });
          }}
        />
      </Field>

      <Field label="Caption" hint={`${post.caption.length} of 2,200`}>
        <textarea
          id="post-caption"
          rows={5}
          maxLength={2200}
          value={post.caption}
          onChange={(e) => set({ caption: e.target.value })}
        />
      </Field>
      <Field label="Location">
        <input id="post-location" value={post.location} maxLength={60} onChange={(e) => set({ location: e.target.value })} />
      </Field>

      <div className="row2">
        <Field label="Likes">
          <NumberInput id="post-likes" value={post.likes} onChange={(v) => set({ likes: v ?? 0 })} />
        </Field>
        <Field label="Comments">
          <NumberInput id="post-comments" value={post.comments} onChange={(v) => set({ comments: v ?? 0 })} />
        </Field>
      </div>

      <div className="panel-actions">
        <button type="button" className="btn" aria-pressed={post.pinnedAt !== null} onClick={togglePin}>
          <Icon name="pin" fill={post.pinnedAt !== null} /> {post.pinnedAt !== null ? 'Unpin' : 'Pin to top'}
        </button>
        <button type="button" className="btn" onClick={() => openPost(post.id)}>
          <Icon name="eye" /> Open post
        </button>
        <ConfirmButton
          className="danger"
          icon="trash"
          label="Delete post"
          confirmLabel="Delete for good?"
          onConfirm={() => {
            dispatch({ type: 'deletePost', id: post.id });
            select(null);
            say('Post deleted. Revert to your save point to bring it back.');
          }}
        />
      </div>
    </>
  );
}

/* ---------- Highlight ---------- */

function HighlightPanel({ highlight }: { highlight: Highlight }) {
  const { sandbox, dispatch, select } = useStage();
  const i = sandbox.highlights.findIndex((h) => h.id === highlight.id);
  const set = (patch: Partial<Highlight>) => dispatch({ type: 'highlight', id: highlight.id, patch });

  async function changeCover(files: File[]) {
    const item = await storeFile(files[0]);
    dispatch({ type: 'media', items: [item] });
    set({ cover: item.id });
  }

  return (
    <>
      <h2>Highlight</h2>

      <div className="avatar-edit">
        <span className="avatar-thumb">
          <MediaView item={highlight.cover ? sandbox.media[highlight.cover] : undefined} />
        </span>
        <FileButton label="Change cover" icon="swap" className="btn sm" imagesOnly onFiles={changeCover} />
      </div>

      <Field label="Title">
        <input id="hl-title" value={highlight.title} maxLength={15} onChange={(e) => set({ title: e.target.value })} />
      </Field>

      <div className="panel-actions">
        <button
          type="button"
          className="btn"
          disabled={i <= 0}
          onClick={() => dispatch({ type: 'moveHighlight', id: highlight.id, dir: -1 })}
        >
          <Icon name="left" /> Move left
        </button>
        <button
          type="button"
          className="btn"
          disabled={i >= sandbox.highlights.length - 1}
          onClick={() => dispatch({ type: 'moveHighlight', id: highlight.id, dir: 1 })}
        >
          Move right <Icon name="right" />
        </button>
        <ConfirmButton
          className="danger"
          icon="trash"
          label="Delete highlight"
          confirmLabel="Delete for good?"
          onConfirm={() => {
            dispatch({ type: 'deleteHighlight', id: highlight.id });
            select(null);
          }}
        />
      </div>
    </>
  );
}
