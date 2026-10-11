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
import { pruneMedia, storeFile, uid } from './lib/media';
import { dateTime, fromInput, plural, toInput } from './lib/format';
import { ConfirmButton, FileButton, Icon, Logo, Segmented } from './components/ui';
import { NarrationMenu } from './components/NarrationMenu';
import { ProfileSet } from './components/ProfileSet';
import { Inspector } from './components/Inspector';
import { PostViewer } from './components/PostViewer';
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
        const keep = await mediaInUse();
        void pruneMedia(keep);
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

  const flush = useCallback(async () => {
    if (!unsaved.current) return;
    unsaved.current = false;
    await saveSandbox(narrationId, latest.current).then(
      () => setSaving(true),
      () => setSaving(false),
    );
  }, [narrationId]);

  useEffect(() => {
    if (!loaded) return;
    unsaved.current = true;
    const t = setTimeout(() => void flush(), 250);
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
    const items = await Promise.all(files.map(storeFile));
    const stamp = Date.now();
    const posts = items.map((item, i) => newPost([item.id], { draft: true, date: stamp - i }));
    dispatch({ type: 'media', items });
    dispatch({ type: 'addPosts', posts });
    setSelection({ type: 'post', id: posts[0].id });
    say(
      `Added ${posts.length} ${plural(posts.length, 'draft')}. Only you can see ${posts.length === 1 ? 'it' : 'them'} until you set ${posts.length === 1 ? 'it' : 'them'} live.`,
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
  const openPost = openId ? sandbox.posts.find((p) => p.id === openId) : undefined;

  const stage = useMemo<Stage>(
    () => ({ sandbox, dispatch, view, now, asOf, selection, select: setSelection, openPost: setOpenId, say }),
    [sandbox, view, now, asOf, selection, say],
  );

  const tally = useMemo(() => {
    const t = { live: 0, scheduled: 0, draft: 0 };
    for (const p of sandbox.posts) t[statusOf(p, now)] += 1;
    return t;
  }, [sandbox.posts, now]);

  if (!loaded) return <div className="app" aria-busy="true" />;

  const creator = view === 'creator';
  const hidden = tally.scheduled + tally.draft;

  return (
    <StageContext.Provider value={stage}>
      <div className="app">
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
              { value: 'creator', label: 'Creator view' },
              { value: 'visitor', label: 'Visitor view' },
            ]}
            onChange={(v) => {
              setView(v);
              setOpenId(null);
              if (v === 'visitor') setSelection(null);
            }}
          />

          <div className="bar-tools">
            {creator ? (
              <>
                <FileButton label="Add posts" icon="plus" className="btn primary" multiple onFiles={addPosts} />
                <button type="button" className="btn" onClick={() => setPoint(sandbox)}>
                  <Icon name="flag" /> Set save point
                </button>
                <ConfirmButton
                  className="quiet"
                  icon="undo"
                  label="Revert"
                  confirmLabel="Undo all changes?"
                  onConfirm={revert}
                />
              </>
            ) : (
              <label className="seen">
                <span>Seen on</span>
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
            )}
          </div>
        </header>

        <main id="top" className={creator ? 'stage with-panel' : 'stage'}>
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
                    <strong>Changes are not being saved.</strong> This browser is blocking storage for the page, so
                    the sandbox will reset when you close it.
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
                    <span className="tally-hint">Drag a post to move it. Its date changes to fit the new spot.</span>
                  </>
                ) : (
                  <span>
                    <Icon name="eye" /> What a visitor sees
                    {seenOn !== null ? ` on ${dateTime(seenOn, now)}` : ' right now'}.
                    {seenOn === null && hidden > 0 && ` ${hidden} scheduled or draft ${plural(hidden, 'post')} hidden.`}
                  </span>
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

          {creator && <Inspector />}
        </main>

        {openPost && <PostViewer key={openPost.id} post={openPost} onClose={() => setOpenId(null)} />}
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
