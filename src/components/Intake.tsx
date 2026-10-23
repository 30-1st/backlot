import { useMemo, useState, type DragEvent, type FormEvent } from 'react';
import type { Sandbox } from '../types';
import type { Platform } from '../platforms';
import { MediaError, isMediaFile, storeFile } from '../lib/media';
import { newPost } from '../state';
import { savesToAccount } from '../lib/library';
import { bil, fileFromDataUrl, useCanLookup } from '../lib/team';
import { ImportGuide } from './ImportGuide';
import { FileButton, Icon, Modal, NumberInput, cx } from './ui';

/**
 * How a creator's own profile gets onto the set. Two ways in:
 *   - from the download Instagram gives every account holder (the default)
 *   - typing the basics and handing over their own photos and videos
 * Nothing is fetched from Instagram or any other service.
 */
export function Intake({
  onBuild,
  onClose,
  onExample,
  platform = 'instagram',
}: {
  /** Which app the profile is staged as. X has no download to bring in, so it starts typed. */
  platform?: Platform;
  onBuild: (sandbox: Sandbox, count: number, notes?: string[]) => void;
  onClose: () => void;
  /** When given, offers the example profile as a quicker way in. */
  onExample?: () => void;
}) {
  const isX = platform === 'x';
  const [mode, setMode] = useState<'download' | 'manual'>(isX ? 'manual' : 'download');
  const [banner, setBanner] = useState<File | null>(null);
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [followers, setFollowers] = useState<number | null>(0);
  const [following, setFollowing] = useState<number | null>(0);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Filled from X when the team looks the handle up; all of it stays editable afterwards.
  const [link, setLink] = useState('');
  const [place, setPlace] = useState('');
  const [postCount, setPostCount] = useState<number | null>(null);
  const [filling, setFilling] = useState(false);
  const [filled, setFilled] = useState('');
  const canLookup = useCanLookup(isX);

  async function fillFromX() {
    const handle = username.trim();
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return setError('Type the handle first.');
    setFilling(true);
    setError('');
    setFilled('');
    try {
      const p = await bil.lookup(handle, true);
      setUsername(p.handle);
      setName(p.name.slice(0, 50));
      setBio((p.bio ?? '').slice(0, 160));
      setFollowers(p.followers);
      setFollowing(p.following);
      setPostCount(p.posts);
      setLink(p.link ?? '');
      setPlace(p.location ?? '');
      const photo = p.photo ? fileFromDataUrl(p.photo, `${p.handle}-photo`) : null;
      const header = p.banner ? fileFromDataUrl(p.banner, `${p.handle}-header`) : null;
      if (photo) setAvatar(photo);
      if (header) setBanner(header);
      setFilled(`Filled from @${p.handle} on X. Change anything you like before building.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'X could not be reached. Type the basics instead.');
    } finally {
      setFilling(false);
    }
  }

  const avatarUrl = useMemo(() => (avatar ? URL.createObjectURL(avatar) : ''), [avatar]);
  const bannerUrl = useMemo(() => (banner ? URL.createObjectURL(banner) : ''), [banner]);

  function addFiles(list: File[]) {
    const good = list.filter(isMediaFile);
    if (good.length) setFiles((prev) => [...prev, ...good]);
    if (good.length < list.length) setError('Some files were skipped. Backlot takes photos and videos.');
    else setError('');
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim()) return setError(isX ? 'Add your handle so the profile has a name.' : 'Add your username so the profile has a name.');
    if (!consent) return setError('Tick the box to confirm this is your own profile and content.');
    setBusy(true);
    setError('');
    try {
      const avatarItem = avatar ? await storeFile(avatar) : null;
      const bannerItem = isX && banner ? await storeFile(banner) : null;
      const items = await Promise.all(files.map(storeFile));
      const now = Date.now();
      // A file's own date is the best first guess at when it was posted.
      // The creator can change any of them afterwards.
      const posts = items.map((item, i) => {
        const stamp = files[i].lastModified;
        const date = stamp && stamp < now ? stamp : now - (i + 1) * 3_600_000;
        return newPost([item.id], { date: date - i });
      });
      const media: Sandbox['media'] = {};
      for (const item of items) media[item.id] = item;
      if (avatarItem) media[avatarItem.id] = avatarItem;
      if (bannerItem) media[bannerItem.id] = bannerItem;

      onBuild(
        {
          version: 1,
          isExample: false,
          profile: {
            username: username.trim(),
            name: name.trim(),
            category: isX ? place.trim() : '',
            bio,
            link: isX ? link.trim() : '',
            avatar: avatarItem?.id ?? null,
            followers: followers ?? 0,
            following: following ?? 0,
            postCount: isX ? postCount : null,
            ...(bannerItem ? { banner: bannerItem.id } : {}),
          },
          highlights: [],
          posts,
          media,
          settings: { lighting: 'light', tile: 'portrait' },
        },
        posts.length,
      );
    } catch (err) {
      setBusy(false);
      setError(
        err instanceof MediaError ? err.sentence : 'Those files could not be read. Try again with fewer or smaller files.',
      );
    }
  }

  if (mode === 'download') {
    return (
      <Modal label="Bring in your Instagram" className="intake is-guide" onClose={onClose}>
        <ImportGuide onBuild={onBuild} onTypeInstead={() => setMode('manual')} onClose={onClose} onExample={onExample} />
      </Modal>
    );
  }

  const maxBio = isX ? 160 : 150;
  return (
    <Modal label={isX ? 'Set up your X profile' : 'Bring in your profile'} className="intake" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <header className="intake-head">
          <h2>{isX ? 'Set up your X profile' : 'Bring in your profile'}</h2>
          <p>
            {isX ? 'Type in the basics. Add photos and videos for posts with media, or write posts once the set is built.' : 'Type in the basics and add your own photos and videos.'}{' '}
            {savesToAccount() ? 'They are copied into your Backlot account' : 'Everything stays in this browser'}, and you can
            change all of it once the set is built.
          </p>
          <button type="button" className="btn quiet sm intake-close" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>

        <div className="intake-body">
          <div className="avatar-edit">
            <span className="avatar-thumb">
              {avatarUrl ? <img src={avatarUrl} alt="" /> : <span className="media-empty"><Icon name="image" size={20} /></span>}
            </span>
            <FileButton
              label={avatar ? 'Change profile photo' : 'Add profile photo'}
              icon="image"
              className="btn sm"
              imagesOnly
              onFiles={(f) => setAvatar(f[0])}
            />
          </div>

          {isX && (
            <div className="avatar-edit">
              <span className="banner-thumb">
                {bannerUrl ? <img src={bannerUrl} alt="" /> : <span className="media-empty"><Icon name="image" size={20} /></span>}
              </span>
              <FileButton label={banner ? 'Change header image' : 'Add header image'} icon="image" className="btn sm" imagesOnly onFiles={(f) => setBanner(f[0])} />
            </div>
          )}

          <div className="row2">
            <label className="field">
              <span className="field-label">{isX ? 'Handle' : 'Username'}</span>
              <input
                id="in-username"
                value={username}
                maxLength={isX ? 15 : 30}
                autoComplete="off"
                spellCheck={false}
                placeholder="yourhandle"
                onChange={(e) => setUsername(isX ? e.target.value.replace(/[^A-Za-z0-9_]/g, '') : e.target.value.replace(/[\s@]/g, '').toLowerCase())}
              />
            </label>
            <label className="field">
              <span className="field-label">Name</span>
              <input id="in-name" value={name} maxLength={isX ? 50 : 64} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>

          {canLookup && (
            <div className="fill-x">
              <button type="button" className="btn sm" disabled={filling || !username.trim()} onClick={() => void fillFromX()}>
                {filling ? 'Reading X' : 'Fill in from X'}
              </button>
              <span className="field-hint">
                {filled || "Brings in the photo, header, name, bio and counts through X's official API. About $0.01."}
              </span>
            </div>
          )}

          <label className="field">
            <span className="field-label">Bio</span>
            <textarea id="in-bio" rows={3} maxLength={maxBio} value={bio} onChange={(e) => setBio(e.target.value)} />
          </label>

          <div className="row2">
            <label className="field">
              <span className="field-label">Followers</span>
              <NumberInput id="in-followers" value={followers} allowEmpty placeholder="0" onChange={setFollowers} />
            </label>
            <label className="field">
              <span className="field-label">Following</span>
              <NumberInput id="in-following" value={following} allowEmpty placeholder="0" onChange={setFollowing} />
            </label>
          </div>

          <div
            className={cx('drop', over && 'is-over')}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            <strong>{files.length ? `${files.length} ${files.length === 1 ? 'post' : 'posts'} ready` : isX ? 'Posts with media (optional)' : 'Your posts'}</strong>
            <span>Drop photos and videos here, one file per post. Each post takes its date from the file.</span>
            <div className="drop-actions">
              <FileButton label={files.length ? 'Add more' : 'Choose files'} icon="plus" className="btn sm" multiple onFiles={addFiles} />
              {files.length > 0 && (
                <button type="button" className="btn quiet sm" onClick={() => setFiles([])}>
                  Clear
                </button>
              )}
            </div>
          </div>

          <label className="check">
            <input id="in-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              This is my own profile, and I have the right to use these photos and videos. I agree to Backlot copying
              them into my sandbox.
            </span>
          </label>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className="intake-foot">
          {!isX && (
            <button type="button" className="btn quiet intake-alt" onClick={() => setMode('download')}>
              Use my Instagram download
            </button>
          )}
          {onExample && (
            <button type="button" className="btn quiet" onClick={onExample}>
              Use the example profile instead
            </button>
          )}
          <button type="button" className="btn quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Building your sandbox' : 'Build my sandbox'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
