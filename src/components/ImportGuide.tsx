import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { Sandbox } from '../types';
import {
  ExportProblem,
  buildFromExport,
  openExport,
  type ExportPost,
  type ExportProfile,
  type OpenedExport,
} from '../lib/instagramExport';
import { BlobWriter } from '@zip.js/zip.js';
import { compact, longDate, plural } from '../lib/format';
import { Icon, NumberInput, Segmented, cx, useMedia } from './ui';

/* ---------- drawings ---------- */

interface SketchRow {
  label: string;
  value?: string;
  /** The thing to tap. */
  hot?: boolean;
  button?: boolean;
}

/**
 * A simple drawing of the screen a step happens on, with the thing to tap
 * ringed in gold. Drawn, not a screenshot, so it never shows anyone's account.
 */
function Sketch({ device, title, rows, url }: { device: 'phone' | 'computer'; title: string; rows: SketchRow[]; url?: string }) {
  return (
    <div className={cx('sk', device === 'phone' ? 'sk-phone' : 'sk-window')} aria-hidden="true">
      {device === 'phone' ? (
        <div className="sk-top">
          <i className="sk-notch" />
        </div>
      ) : (
        <div className="sk-bar">
          <i />
          <i />
          <i />
          <span>{url ?? 'accountscenter.instagram.com'}</span>
        </div>
      )}
      <div className="sk-title">{title}</div>
      {rows.map((row) => (
        <div key={row.label} className={cx('sk-row', row.hot && 'is-hot', row.button && 'is-button')}>
          <span>{row.label}</span>
          {row.value && <b>{row.value}</b>}
          {!row.button && !row.value && <em>›</em>}
          {row.hot && <i className="sk-tap" />}
        </div>
      ))}
    </div>
  );
}

interface Step {
  title: string;
  body: ReactNode;
  sketch: { title: string; rows: SketchRow[] };
}

function steps(device: 'phone' | 'computer'): Step[] {
  const tap = device === 'phone' ? 'Tap' : 'Click';
  return [
    {
      title: 'Open Accounts Center',
      body:
        device === 'phone' ? (
          <p>In Instagram, open your profile, tap the menu at the top right (the three lines), then tap Accounts Center.</p>
        ) : (
          <p>
            Go to{' '}
            <a href="https://accountscenter.instagram.com/info_and_permissions/" target="_blank" rel="noopener noreferrer">
              accountscenter.instagram.com
            </a>{' '}
            and sign in with your Instagram account.
          </p>
        ),
      sketch:
        device === 'phone'
          ? { title: 'Settings and activity', rows: [{ label: 'Accounts Center', hot: true }, { label: 'Saved' }, { label: 'Archive' }, { label: 'Your activity' }] }
          : { title: 'Accounts Center', rows: [{ label: 'Profiles' }, { label: 'Personal details' }, { label: 'Password and security' }, { label: 'Your information and permissions', hot: true }] },
    },
    {
      title: 'Find Export your information',
      body: <p>{tap} Your information and permissions, then Export your information.</p>,
      sketch: {
        title: 'Your information and permissions',
        rows: [{ label: 'Export your information', hot: true }, { label: 'Access your information' }, { label: 'Search history' }],
      },
    },
    {
      title: 'Start an export to your device',
      body: <p>{tap} Create export, pick your Instagram account, then choose Export to device.</p>,
      sketch: { title: 'Choose where to export', rows: [{ label: 'Export to device', hot: true }, { label: 'Export to external service' }] },
    },
    {
      title: 'Set these four things',
      body: (
        <ul className="ig-settings">
          <li>
            <b>Customize information:</b> keep Your Instagram activity (your posts), Personal information (your bio and
            photo) and Connections (your follower counts). Untick the rest to make the file smaller and quicker.
          </li>
          <li>
            <b>Date range:</b> All time.
          </li>
          <li>
            <b>Format:</b> JSON. This one matters. Backlot cannot read the HTML version.
          </li>
          <li>
            <b>Media quality:</b> Higher.
          </li>
        </ul>
      ),
      sketch: {
        title: 'Export to device',
        rows: [
          { label: 'Customize information', value: '3 picked' },
          { label: 'Date range', value: 'All time' },
          { label: 'Format', value: 'JSON', hot: true },
          { label: 'Media quality', value: 'Higher' },
          { label: 'Start export', button: true },
        ],
      },
    },
    {
      title: 'Wait for Instagram',
      body: (
        <p>
          Instagram sends a notification and an email when the file is ready. Small accounts often take under an hour.
          Big ones can take a few days. The download link lasts about four days, so grab it when it arrives. You can close
          Backlot in the meantime and come back to this screen.
        </p>
      ),
      sketch: {
        title: 'Notifications',
        rows: [{ label: 'Your information is ready to download' }, { label: 'Download', button: true, hot: true }],
      },
    },
    {
      title: 'Bring the file here',
      body: (
        <p>
          Download the .zip and leave it exactly as it is, without opening or unzipping it. Then drop it in the box at
          the top, or choose it from your {device === 'phone' ? 'Files app, usually under Downloads' : 'Downloads folder'}
          . If Instagram split it into parts, add them all at once.
        </p>
      ),
      sketch: { title: 'Downloads', rows: [{ label: 'instagram-yourname.zip', hot: true }] },
    },
  ];
}

/* ---------- the flow ---------- */

type Stage =
  | { name: 'guide'; problem?: string }
  | { name: 'reading' }
  | { name: 'review' }
  | { name: 'building'; done: number; total: number };

/**
 * Bring a profile in from the download Instagram gives every account holder.
 * First a short, drawn guide to getting that file, then a review of what was
 * found, then the copy itself.
 */
export function ImportGuide({
  onBuild,
  onTypeInstead,
  onClose,
  onExample,
}: {
  onBuild: (sandbox: Sandbox, count: number, notes: string[]) => void;
  onTypeInstead: () => void;
  onClose: () => void;
  /** When given, offers the example profile as a quicker way in. */
  onExample?: () => void;
}) {
  const small = useMedia('(max-width: 720px)');
  const [device, setDevice] = useState<'phone' | 'computer'>(small ? 'phone' : 'computer');
  const [stage, setStage] = useState<Stage>({ name: 'guide' });
  const [over, setOver] = useState(false);
  const opened = useRef<OpenedExport | null>(null);
  const stop = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  // Found in the download, and adjustable before building.
  const [profile, setProfile] = useState<ExportProfile | null>(null);
  const [posts, setPosts] = useState<ExportPost[]>([]);
  const [take, setTake] = useState(0);
  const [consent, setConsent] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(
    () => () => {
      stop.current = true;
      void opened.current?.close();
    },
    [],
  );
  useEffect(() => () => URL.revokeObjectURL(avatarUrl), [avatarUrl]);

  async function open(files: File[]) {
    if (files.length === 0) return;
    setStage({ name: 'reading' });
    setError('');
    await opened.current?.close();
    try {
      const found = await openExport(files);
      opened.current = found;
      setProfile(found.profile);
      setPosts(found.posts);
      setTake(found.posts.length);
      const avatar = found.profile.avatar ? found.file(found.profile.avatar.path) : undefined;
      if (avatar) {
        const blob = await avatar.getData(new BlobWriter('image/jpeg'));
        setAvatarUrl(URL.createObjectURL(blob));
      } else {
        setAvatarUrl('');
      }
      setStage({ name: 'review' });
    } catch (err) {
      setStage({
        name: 'guide',
        problem: err instanceof ExportProblem ? err.sentence : 'That file could not be read. Try choosing it again.',
      });
    }
  }

  async function build() {
    if (!opened.current || !profile) return;
    if (!profile.username.trim()) return setError('Add your username so the profile has a name.');
    if (!consent) return setError('Tick the box to confirm this is your own profile and content.');
    setError('');
    stop.current = false;
    const chosen = posts.slice(0, take);
    try {
      const built = await buildFromExport(
        opened.current,
        { posts: chosen, profile },
        ({ done, total }) => setStage({ name: 'building', done, total }),
        () => stop.current,
      );
      if (stop.current) return;
      const left = posts.length - chosen.length;
      const notes = [...built.problems];
      if (left > 0) notes.push(`${left} older ${plural(left, 'post')} stayed out, as you chose.`);
      onBuild(built.sandbox, built.sandbox.posts.length, notes);
    } catch {
      setStage({ name: 'review' });
      setError('Something went wrong while copying. Check your connection and try again.');
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    void open(Array.from(e.dataTransfer.files));
  }

  const choices = useMemo(() => {
    const all = posts.length;
    const list = [30, 90].filter((n) => n < all).map((n) => ({ value: String(n), label: `Latest ${n}` }));
    return [...list, { value: String(all), label: `All ${all}` }];
  }, [posts.length]);

  const range = posts.length > 0 ? `${longDate(posts[Math.min(take, posts.length) - 1]?.date ?? posts[0].date)} to ${longDate(posts[0].date)}` : '';
  const files = posts.slice(0, take).reduce((n, p) => n + p.media.length, 0);
  const videos = posts.slice(0, take).reduce((n, p) => n + p.media.filter((m) => m.kind === 'video').length, 0);

  /* ----- reading and building ----- */
  if (stage.name === 'reading' || stage.name === 'building') {
    const pct = stage.name === 'building' && stage.total > 0 ? Math.round((stage.done / stage.total) * 100) : null;
    return (
      <div className="intake-flow">
        <header className="intake-head">
          <h2>{stage.name === 'reading' ? 'Reading your download' : 'Building your account'}</h2>
          <p>
            {stage.name === 'reading'
              ? 'Looking for your profile and posts. Messages and everything else in the file are left alone.'
              : `Copying ${stage.done} of ${stage.total} photos and videos. Keep this open until it finishes.`}
          </p>
        </header>
        <div className="intake-body">
          <div className="ig-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
            <i style={{ width: pct === null ? '35%' : `${pct}%` }} className={pct === null ? 'is-busy' : undefined} />
          </div>
        </div>
        {stage.name === 'building' && (
          <footer className="intake-foot">
            <button
              type="button"
              className="btn quiet"
              onClick={() => {
                stop.current = true;
                setStage({ name: 'review' });
              }}
            >
              Stop
            </button>
          </footer>
        )}
      </div>
    );
  }

  /* ----- review ----- */
  if (stage.name === 'review' && profile) {
    const opener = opened.current;
    return (
      <div className="intake-flow">
        <header className="intake-head">
          <h2>Here is what we found</h2>
          <p>Check it over. You can change any of it later in the studio too.</p>
          <button type="button" className="btn quiet sm intake-close" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="intake-body">
          <div className="ig-found">
            <span className="avatar-thumb">
              {avatarUrl ? <img src={avatarUrl} alt="" /> : <span className="media-empty"><Icon name="image" size={20} /></span>}
            </span>
            <div className="ig-found-text">
              <label className="field">
                <span className="field-label">Username</span>
                <input
                  id="ig-username"
                  value={profile.username}
                  maxLength={30}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setProfile({ ...profile, username: e.target.value.replace(/[\s@]/g, '').toLowerCase() })}
                />
              </label>
              {profile.name && <b>{profile.name}</b>}
              {profile.bio && <p>{profile.bio}</p>}
            </div>
          </div>

          <div className="row2">
            <label className="field">
              <span className="field-label">Followers</span>
              <NumberInput
                id="ig-followers"
                value={profile.followers}
                allowEmpty
                placeholder="0"
                onChange={(v) => setProfile({ ...profile, followers: v })}
              />
            </label>
            <label className="field">
              <span className="field-label">Following</span>
              <NumberInput
                id="ig-following"
                value={profile.following}
                allowEmpty
                placeholder="0"
                onChange={(v) => setProfile({ ...profile, following: v })}
              />
            </label>
          </div>
          {(profile.followers === null || profile.following === null) && (
            <p className="field-hint">
              The counts were not in this download, because Connections was not ticked. Type them in, or leave them for
              later.
            </p>
          )}

          <div className="field">
            <span className="field-label">Posts to bring in</span>
            {choices.length > 1 && (
              <Segmented block label="Posts to bring in" value={String(take)} options={choices} onChange={(v) => setTake(Number(v))} />
            )}
            <span className="field-hint">
              {take} {plural(take, 'post')} from {range}: {files} {plural(files, 'photo or video', 'photos and videos')}
              {videos > 0 ? `, ${videos} of them ${plural(videos, 'video', 'videos')}` : ''}. Captions and dates come
              across. Likes and comments are not in the download, so they start at zero.
            </span>
          </div>

          {opener && (opener.missing > 0 || opener.unsupported > 0) && (
            <p className="field-hint ig-warn">
              {opener.missing > 0 &&
                `${compact(opener.missing)} ${plural(opener.missing, 'file')} the download points at ${opener.missing === 1 ? 'is' : 'are'} not in it. If Instagram split it into parts, go back and add all the parts together. `}
              {opener.unsupported > 0 && `${compact(opener.unsupported)} ${plural(opener.unsupported, 'file')} in a format browsers cannot show will be left out.`}
            </p>
          )}
          <p className="field-hint">Highlights are not part of the download. Add them in the studio.</p>

          <label className="check">
            <input id="ig-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
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
          <button type="button" className="btn quiet intake-alt" onClick={() => setStage({ name: 'guide' })}>
            Use a different file
          </button>
          <button type="button" className="btn primary" onClick={() => void build()}>
            Build my account
          </button>
        </footer>
      </div>
    );
  }

  /* ----- the guide ----- */
  const problem = stage.name === 'guide' ? stage.problem : undefined;
  return (
    <div className="intake-flow">
      <header className="intake-head">
        <h2>Bring in your Instagram</h2>
        <button type="button" className="btn quiet sm intake-close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </header>

      <div className="intake-body">
        <p className="ig-intro">
          Instagram lets every account download a copy of its own profile and posts. Get that file once, drop it here,
          and Backlot rebuilds your page from it: photo, bio, posts, captions and dates.
        </p>
        <div
          className={cx('drop', 'ig-drop', over && 'is-over')}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <strong>Already have your download?</strong>
          <span>Drop the .zip file here. If Instagram split it into parts, add them all at once.</span>
          <div className="drop-actions">
            <button type="button" className="btn sm primary" onClick={() => input.current?.click()}>
              <Icon name="plus" /> Choose file
            </button>
          </div>
          <input
            ref={input}
            id="ig-file"
            type="file"
            hidden
            multiple
            accept=".zip,application/zip,application/x-zip-compressed"
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              e.target.value = '';
              void open(list);
            }}
          />
        </div>

        {problem && (
          <p className="form-error" role="alert">
            {problem}
          </p>
        )}

        <div className="ig-guide-head">
          <h3>How to get it</h3>
          <Segmented
            label="Show steps for"
            value={device}
            options={[
              { value: 'phone', label: 'On my phone' },
              { value: 'computer', label: 'On a computer' },
            ]}
            onChange={setDevice}
          />
        </div>

        <ol className="ig-steps">
          {steps(device).map((step, i) => (
            <li key={step.title} className="ig-step">
              <span className="ig-num">{i + 1}</span>
              <div className="ig-text">
                <b>{step.title}</b>
                {step.body}
              </div>
              <Sketch device={device} title={step.sketch.title} rows={step.sketch.rows} />
            </li>
          ))}
        </ol>
        <p className="field-hint">
          Instagram moves its buttons around now and then, so a label may read slightly differently on your screen. The
          file only ever comes from Instagram itself; Backlot never asks for your Instagram password.
        </p>
      </div>

      <footer className="intake-foot">
        <button type="button" className="btn quiet intake-alt" onClick={onTypeInstead}>
          Type it in instead
        </button>
        {onExample ? (
          <button type="button" className="btn quiet" onClick={onExample}>
            Use the example profile instead
          </button>
        ) : (
          <button type="button" className="btn quiet" onClick={onClose}>
            Close
          </button>
        )}
      </footer>
    </div>
  );
}
