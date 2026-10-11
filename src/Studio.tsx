import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Sandbox, SavePoint, Selection, View } from './types';
import {
  StageContext,
  compactSandbox,
  emptySandbox,
  newPost,
  reducer,
  referencedMedia,
  statusOf,
  type Stage,
} from './state';
import type { Platform } from './platforms';
import {
  duplicateNarration,
  mediaInUse,
  nextNarrationName,
  openNarration,
  renameNarration,
  saveSandbox,
  saveSavePoint,
  type Account,
} from './lib/library';
import { pruneMedia, storeFiles, uid } from './lib/media';
import { hosted } from './lib/supabase';
import { dateTime, fromInput, plural, toInput } from './lib/format';
import { ConfirmButton, FileButton, Icon, Logo, Segmented, useMedia } from './components/ui';
import { NarrationMenu } from './components/NarrationMenu';
import { ProfileSet } from './components/ProfileSet';
import { EditSheet, Inspector } from './components/Inspector';
import { PostsFeed } from './components/PostsFeed';
import { Intake } from './components/Intake';

/** The working screen for one narration of one account: the set, its tools, and saving. */
export function Studio({
  platform,
  narrationId,
  flash,
  onHome,
  onAccounts,
  onOpen,
}: {
  platform: Platform;
  narrationId: string;
  /** A message to show once on arrival, for example after making a copy. */
  flash?: string;
  onHome: () => void;
  onAccounts: () => void;
  onOpen: (narrationId: string, flash?: string) => void;
}) {
  const [sandbox, dispatch] = useReducer(reducer, undefined, emptySandbox);
  const [account, setAccount] = useState<Account | null>(null);
  const [savePoint, setSavePoint] = useState<SavePoint | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(true);

  const [view, setView] = useState<View>('creator');
  const [seenOn, setSeenOn] = useState<number | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [intake, setIntake] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(() =>
    flash ? { id: Date.now(), text: flash } : null,
  );
  const [now, setNow] = useState(() => Date.now());

  // The side editor is a wide-screen tool. Turning it off shows the page bare,
  // the way the real app looks, and phones always work that way.
  const small = useMedia('(max-width: 980px)');
  const [editorOn, setEditorOn] = useState(() => {
    try {
      return window.localStorage.getItem('backlot.editor') !== 'off';
    } catch {
      return true;
    }
  });
  const native = small || !editorOn;

  function toggleEditor() {
    const next = !editorOn;
    setEditorOn(next);
    setSelection(null);
    try {
      window.localStorage.setItem('backlot.editor', next ? 'on' : 'off');
    } catch {
      // The choice just will not be remembered.
    }
  }

  // Scheduled posts turn live on their own, so the clock has to keep moving.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);

  const say = useCallback((text: string) => setToast({ id: Date.now(), text }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  // Open the narration and pick up where the creator left off.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const open = await openNarration(narrationId);
        if (!alive) return;
        if (!open || open.account.platform !== platform) return onAccounts();
        let point = open.savePoint;
        if (!point) {
          point = { sandbox: open.sandbox, savedAt: Date.now() };
          await saveSavePoint(narrationId, point);
        }
        // Tidy up unused files in the background. Never let it block opening.
        void mediaInUse().then(pruneMedia, () => undefined);
        if (!alive) return;
        dispatch({ type: 'load', sandbox: open.sandbox });
        setAccount(open.account);
        setSavePoint(point);
        setLoaded(true);
      } catch {
        if (alive) onAccounts();
      }
    })();
    return () => {
      alive = false;
    };
    // onAccounts is stable enough for this one-time load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrationId, platform]);

  // Save every change shortly after it happens, and never lose the last one:
  // leaving the screen or hiding the tab writes whatever is still waiting.
  const latest = useRef(sandbox);
  latest.current = sandbox;
  const unsaved = useRef(false);

  const retry = useRef<number | undefined>(undefined);

  const flush = useCallback(async () => {
    if (!unsaved.current) return;
    unsaved.current = false;
    window.clearTimeout(retry.current);
    try {
      await saveSandbox(narrationId, latest.current);
      setSaving(true);
    } catch {
      // Keep the change and try again shortly, for example once the connection is back.
      unsaved.current = true;
      setSaving(false);
      retry.current = window.setTimeout(() => void flush(), 4000);
    }
  }, [narrationId]);

  useEffect(() => () => window.clearTimeout(retry.current), []);

  useEffect(() => {
    if (!loaded) return;
    unsaved.current = true;
    // Saving to the server is a network call, so wait a little longer between them.
    const t = setTimeout(() => void flush(), hosted ? 700 : 250);
    return () => clearTimeout(t);
  }, [sandbox, loaded, flush]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      if (unsaved.current) {
        unsaved.current = false;
        void saveSandbox(narrationId, latest.current).catch(() => undefined);
      }
    };
  }, [flush, narrationId]);

  const setPoint = useCallback(
    (next: Sandbox, quiet = false) => {
      const clean = compactSandbox(next);
      const point: SavePoint = { sandbox: clean, savedAt: Date.now() };
      setSavePoint(point);
      saveSavePoint(narrationId, point).then(
        async () => {
          const keep = await mediaInUse(narrationId);
          for (const id of referencedMedia(clean)) keep.add(id);
          void pruneMedia(keep);
        },
        () => setSaving(false),
      );
      if (!quiet) say('Save point set. Revert brings the profile back to exactly this.');
    },
    [say, narrationId],
  );

  const meta = account?.narrations.find((n) => n.id === narrationId);

  async function copyNarration() {
    if (!account) return;
    await flush();
    const copy = await duplicateNarration(narrationId, nextNarrationName(account)).catch(() => null);
    if (!copy) return say('That copy could not be made. Try again.');
    onOpen(copy.id, `You are in "${copy.name}", a copy. Change anything here and the other narrations stay as they were.`);
  }

  function rename(name: string) {
    if (!account) return;
    setAccount({ ...account, narrations: account.narrations.map((n) => (n.id === narrationId ? { ...n, name } : n)) });
    renameNarration(narrationId, name).catch(() => setSaving(false));
  }

  async function leave(go: () => void) {
    await flush();
    go();
  }

  function revert() {
    if (!savePoint) return;
    dispatch({ type: 'load', sandbox: savePoint.sandbox });
    setSelection(null);
    setOpenId(null);
    say(`Reverted to your save point from ${dateTime(savePoint.savedAt)}.`);
  }

  async function addPosts(files: File[]) {
    const { items, problems } = await storeFiles(files);
    if (items.length === 0) return say(problems.join(' '));
    const stamp = Date.now();
    const posts = items.map((item, i) => newPost([item.id], { draft: true, date: stamp - i }));
    dispatch({ type: 'media', items });
    dispatch({ type: 'addPosts', posts });
    setSelection({ type: 'post', id: posts[0].id });
    const them = posts.length === 1 ? 'it' : 'them';
    say(
      [`Added ${posts.length} ${plural(posts.length, 'draft')}. Only you can see ${them} until you set ${them} live.`, ...problems].join(' '),
    );
  }

  function addHighlight() {
    const id = uid('h');
    dispatch({ type: 'addHighlight', highlight: { id, title: 'New', cover: null } });
    setSelection({ type: 'highlight', id });
  }

  function build(next: Sandbox, count: number) {
    dispatch({ type: 'load', sandbox: next });
    setPoint(next, true);
    setIntake(false);
    setView('creator');
    setSelection(null);
    say(
      count
        ? `Your sandbox is built with ${count} ${plural(count, 'post')}. This is now your save point.`
        : 'Your sandbox is built. Add posts to start filling the grid.',
    );
  }

  const asOf = view === 'visitor' && seenOn !== null ? seenOn : now;

  const stage = useMemo<Stage>(
    () => ({
      sandbox,
      dispatch,
      view,
      now,
      asOf,
      selection,
      select: setSelection,
      // Opening the posts view lets go of whatever the side editor had picked,
      // so anything chosen from inside that view opens as a sheet on top of it.
      openPost: (id: string) => {
        setSelection(null);
        setOpenId(id);
      },
      say,
      canEdit: true,
      native,
    }),
    [sandbox, view, now, asOf, selection, say, native],
  );

  const tally = useMemo(() => {
    const t = { live: 0, scheduled: 0, draft: 0 };
    for (const p of sandbox.posts) t[statusOf(p, now)] += 1;
    return t;
  }, [sandbox.posts, now]);

  if (!loaded) return <div className="app" aria-busy="true" />;

  const creator = view === 'creator';
  const hidden = tally.scheduled + tally.draft;
  const panel = creator && !native;

  return (
    <StageContext.Provider value={stage}>
      <div className={creator ? 'app studio has-tools' : 'app studio'}>
        <header className="bar">
          <a
            className="brand"
            href="#home"
            aria-label="Backlot home"
            onClick={(e) => {
              e.preventDefault();
              void leave(onHome);
            }}
          >
            <Logo />
            <b>Backlot</b>
          </a>
          {account && meta && (
            <NarrationMenu
              platform={platform}
              account={account}
              current={meta}
              username={sandbox.profile.username}
              onOpen={(id) => void leave(() => onOpen(id))}
              onCopy={() => void copyNarration()}
              onRename={rename}
              onAccounts={() => void leave(onAccounts)}
            />
          )}

          <Segmented
            label="View"
            value={view}
            options={[
              { value: 'creator', label: 'Creator' },
              { value: 'visitor', label: 'Visitor' },
            ]}
            onChange={(v) => {
              setView(v);
              setOpenId(null);
              setSelection(null);
            }}
          />

          {creator && (
            <div className="tools">
              <FileButton label="Add posts" icon="plus" className="btn primary" multiple onFiles={addPosts} />
              <button type="button" className="btn" onClick={() => setPoint(sandbox)}>
                <Icon name="flag" /> <span>Save point</span>
              </button>
              <ConfirmButton className="quiet" icon="undo" label="Revert" confirmLabel="Undo all?" onConfirm={revert} />
              <button
                type="button"
                className="btn only-wide"
                aria-pressed={editorOn}
                title={editorOn ? 'Hide the editor and show the page bare' : 'Show the editor beside the page'}
                onClick={toggleEditor}
              >
                <Icon name="panel" /> <span>Editor</span>
              </button>
            </div>
          )}
        </header>

        <main id="top" className={panel ? 'stage with-panel' : 'stage'}>
          <div className="floor">
            <div className="floor-in">
              {sandbox.isExample && (
                <div className="notice">
                  <div>
                    <strong>This is an example profile.</strong> Change anything to see how the sandbox works, then
                    bring in your own.
                  </div>
                  <button type="button" className="btn sm" onClick={() => setIntake(true)}>
                    Bring in your profile
                  </button>
                </div>
              )}
              {!saving && (
                <div className="notice warn" role="status">
                  <div>
                    <strong>Changes are not being saved.</strong>{' '}
                    {hosted
                      ? 'Backlot cannot reach the server. Your changes are still on this screen and it will keep trying. Check your connection.'
                      : 'This browser is blocking storage for the page, so the sandbox will reset when you close it.'}
                  </div>
                </div>
              )}

              <div className="tally">
                {creator ? (
                  <>
                    <span>
                      <i className="dot" style={{ background: 'var(--live)' }} />
                      {tally.live} live
                    </span>
                    <span>
                      <i className="dot" style={{ background: 'var(--sched)' }} />
                      {tally.scheduled} scheduled
                    </span>
                    <span>
                      <i className="dot" style={{ background: 'var(--draft)' }} />
                      {tally.draft} {plural(tally.draft, 'draft')}
                    </span>
                    <span className="tally-hint">
                      {small ? 'Hold a post, then drag it onto another to swap them.' : 'Drag one post onto another to swap them.'}
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      <Icon name="eye" /> What a visitor sees
                      {seenOn === null && hidden > 0 && `. ${hidden} scheduled or draft ${plural(hidden, 'post')} hidden`}
                    </span>
                    <label className="seen">
                      <span>on</span>
                      <input
                        id="seen-on"
                        type="datetime-local"
                        value={toInput(asOf)}
                        onChange={(e) => setSeenOn(fromInput(e.target.value))}
                      />
                      {seenOn !== null && (
                        <button type="button" className="btn quiet sm" onClick={() => setSeenOn(null)}>
                          Back to now
                        </button>
                      )}
                    </label>
                  </>
                )}
              </div>

              <div className="set-wrap">
                <i className="mark tl" />
                <i className="mark tr" />
                <i className="mark bl" />
                <i className="mark br" />
                <ProfileSet onAddHighlight={addHighlight} />
              </div>
            </div>
          </div>

          {panel && <Inspector />}
        </main>

        {openId && <PostsFeed startId={openId} onClose={() => setOpenId(null)} />}
        {creator && selection && (native || openId !== null) && <EditSheet />}
        {intake && <Intake onBuild={build} onClose={() => setIntake(false)} />}

        <div className="toast-zone" aria-live="polite">
          {toast && (
            <div key={toast.id} className="toast">
              {toast.text}
            </div>
          )}
        </div>
      </div>
    </StageContext.Provider>
  );
}
