import { useMemo, useState, type DragEvent, type FormEvent } from 'react';
import type { Sandbox } from '../types';
import { isMediaFile, storeFile } from '../lib/media';
import { newPost } from '../state';
import { FileButton, Icon, Modal, NumberInput, cx } from './ui';

/**
 * How a creator's own profile gets onto the set: they type the basics and hand
 * over their own photos and videos. Nothing is fetched from any other service.
 */
export function Intake({
  onBuild,
  onClose,
  onExample,
}: {
  onBuild: (sandbox: Sandbox, count: number) => void;
  onClose: () => void;
  /** When given, offers the example profile as a quicker way in. */
  onExample?: () => void;
}) {
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

  const avatarUrl = useMemo(() => (avatar ? URL.createObjectURL(avatar) : ''), [avatar]);

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
    if (!username.trim()) return setError('Add your username so the profile has a name.');
    if (!consent) return setError('Tick the box to confirm this is your own profile and content.');
    setBusy(true);
    setError('');
    try {
      const avatarItem = avatar ? await storeFile(avatar) : null;
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

      onBuild(
        {
          version: 1,
          isExample: false,
          profile: {
            username: username.trim(),
            name: name.trim(),
            category: '',
            bio,
            link: '',
            avatar: avatarItem?.id ?? null,
            followers: followers ?? 0,
            following: following ?? 0,
            postCount: null,
          },
          highlights: [],
          posts,
          media,
          settings: { lighting: 'light', tile: 'portrait' },
        },
        posts.length,
      );
    } catch {
      setBusy(false);
      setError('Those files could not be read. Try again with fewer or smaller files.');
    }
  }

  return (
    <Modal label="Bring in your profile" className="intake" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <header className="intake-head">
          <h2>Bring in your profile</h2>
          <p>
            Type in the basics and add your own photos and videos. Everything stays in this browser, and you can change
            all of it once the set is built.
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

          <div className="row2">
            <label className="field">
              <span className="field-label">Username</span>
              <input
                id="in-username"
                value={username}
                maxLength={30}
                autoComplete="off"
                spellCheck={false}
                placeholder="yourhandle"
                onChange={(e) => setUsername(e.target.value.replace(/[\s@]/g, '').toLowerCase())}
              />
            </label>
            <label className="field">
              <span className="field-label">Name</span>
              <input id="in-name" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>

          <label className="field">
            <span className="field-label">Bio</span>
            <textarea id="in-bio" rows={3} maxLength={150} value={bio} onChange={(e) => setBio(e.target.value)} />
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
            <strong>{files.length ? `${files.length} ${files.length === 1 ? 'post' : 'posts'} ready` : 'Your posts'}</strong>
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
          {onExample && (
            <button type="button" className="btn quiet intake-alt" onClick={onExample}>
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
