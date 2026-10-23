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
  SaveConflict,
  duplicateNarration,
  mediaInUse,
  savesToAccount,
  nextNarrationName,
  openNarration,
  peekNarration,
  renameNarration,
  saveSandbox,
  saveSavePoint,
  type Account,
  type NarrationState,
  type OpenNarration,
} from './lib/library';
import { MediaOwner, pruneMedia, setUploadFolder, storeFiles, uid } from './lib/media';
import { listShares } from './lib/people';
import { dateTime, fromInput, plural, toInput } from './lib/format';
import { ConfirmButton, FileButton, Icon, Logo, PlatformMark, Segmented, useMedia } from './components/ui';
import { ShareDialog } from './components/ShareDialog';
import { NarrationMenu } from './components/NarrationMenu';
import { ProfileSet } from './components/ProfileSet';
import { EditSheet, Inspector } from './components/Inspector';
import { PostsFeed } from './components/PostsFeed';
import { Intake } from './components/Intake';
import { XProfileSet } from './components/XProfileSet';
import { DayChips, LayerPicker, useCampaignLayer } from './components/CampaignLayer';

/** The working screen for one narration of one account: the set, its tools, and saving. */
export function Studio({
  platform,
  narrationId,
  flash,
  onHome,
  onAccounts,
  onOpen,
  onPeople,
}: {
  platform: Platform;
  narrationId: string;
  /** A message to show once on arrival, for example after making a copy. */
  flash?: string;
  onHome: () => void;
  /** Back to the list of accounts, optionally with a message to show there. */
  onAccounts: (message?: string) => void;
  onOpen: (narrationId: string, flash?: string) => void;
  /** Set in the hosted build, where narrations can be shared with other people. */
  onPeople?: () => void;
}) {
  const [sandbox, dispatch] = useReducer(reducer, undefined, emptySandbox);
  const [account, setAccount] = useState<Account | null>(null);
  const [savePoint, setSavePoint] = useState<SavePoint | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(true);
  // Set when this narration belongs to someone else, who shared it.
  const [shared, setShared] = useState<OpenNarration['shared']>(undefined);
  const [canEdit, setCanEdit] = useState(true);
  // How many people the creator shared this narration with, and whether the share screen is open.
  const [shareCount, setShareCount] = useState(0);
  const [sharing, setSharing] = useState(false);

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

  // Saving, and keeping up with other people who can change this narration.
  const latest = useRef(sandbox);
  latest.current = sandbox;
  const unsaved = useRef(false);
  const retry = useRef<number | undefined>(undefined);
  /** The revision this screen last saw. A save only lands on top of that one. */
  const revision = useRef(0);
  /** The page as the server last handed it over. Showing it is not a change to save. */
  const fromServer = useRef<Sandbox | null>(null);
  const mayEdit = useRef(true);
  const lent = useRef(false);
  const gone = useRef(false);
  /** Saves and catch-ups wait their turn here, so they never overlap. */
  const line = useRef<Promise<void>>(Promise.resolve());
  const flushLater = useRef<() => void>(() => undefined);

  const inLine = useCallback((work: () => Promise<void>) => {
    const run = line.current.then(work, work);
    line.current = run.catch(() => undefined);
    return line.current;
  }, []);

  // Open the narration and pick up where the creator left off.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const open = await openNarration(narrationId);
        if (!alive) return;
        if (!open || open.account.platform !== platform) return onAccounts();
        let point = open.savePoint;
        if (!point && !open.shared) {
          point = { sandbox: open.sandbox, savedAt: Date.now() };
          await saveSavePoint(narrationId, point);
        }
        // Tidy up unused files in the background. Never let it block opening.
        void mediaInUse().then(pruneMedia, () => undefined);
        if (!alive) return;
        const may = !open.shared || open.shared.role === 'edit';
        revision.current = open.revision;
        fromServer.current = open.sandbox;
        mayEdit.current = may;
        lent.current = !!open.shared;
        // An editor's new photos and videos belong next to the rest of the author's narration.
        setUploadFolder(open.shared ? open.shared.owner.id : null);
        dispatch({ type: 'load', sandbox: open.sandbox });
        setAccount(open.account);
        setSavePoint(point ?? null);
        setShared(open.shared);
        setCanEdit(may);
        setLoaded(true);
        if (savesToAccount() && !open.shared) void listShares(narrationId).then((list) => alive && setShareCount(list.length), () => undefined);
      } catch {
        if (alive) onAccounts();
      }
    })();
    return () => {
      alive = false;
      setUploadFolder(null);
    };
    // onAccounts is stable enough for this one-time load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrationId, platform]);

  /** Keep the change and try again shortly, for example once the connection is back. */
  const keepTrying = useCallback(() => {
    if (gone.current) return;
    unsaved.current = true;
    setSaving(false);
    window.clearTimeout(retry.current);
    retry.current = window.setTimeout(() => flushLater.current(), 4000);
  }, []);

  // Bring this screen up to date with the server: what the caller may do now,
  // and the page itself if someone else changed it. `afterClash` means a save
  // was just turned away because the page had moved on.
  const catchUp = useCallback(
    async (afterClash: boolean) => {
      let state: NarrationState | null;
      try {
        state = await peekNarration(narrationId);
      } catch {
        if (afterClash) keepTrying();
        return;
      }
      if (gone.current) return;
      const closed = () => {
        unsaved.current = false;
        onAccounts(lent.current ? 'That narration is no longer shared with you.' : 'That narration was deleted.');
      };
      if (!state) return closed();

      const may = state.role !== 'view';
      if (may !== mayEdit.current) {
        mayEdit.current = may;
        setCanEdit(may);
        setSelection(null);
        say(
          may
            ? 'The author now lets you edit this narration.'
            : 'The author changed your access. You can look, but not edit.',
        );
      }
      if (state.revision === revision.current && !afterClash) return;
      if (state.revision === revision.current && may) return keepTrying();

      let fresh: OpenNarration | null;
      try {
        fresh = await openNarration(narrationId);
      } catch {
        if (afterClash) keepTrying();
        return;
      }
      if (gone.current) return;
      if (!fresh) return closed();
      revision.current = fresh.revision;
      fromServer.current = fresh.sandbox;
      dispatch({ type: 'load', sandbox: fresh.sandbox });
      if (fresh.savePoint) setSavePoint(fresh.savePoint);
      setSaving(true);
      if (afterClash && may) {
        say('Someone else changed this narration at the same moment. You are on their version now, so make your last change again.');
      } else if (!afterClash) {
        say('Updated with the latest changes.');
      }
    },
    // onAccounts is stable enough here too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [narrationId, keepTrying, say],
  );

  // Save every change shortly after it happens, and never lose the last one:
  // leaving the screen or hiding the tab writes whatever is still waiting.
  const flush = useCallback(
    () =>
      inLine(async () => {
        if (!unsaved.current) return;
        unsaved.current = false;
        window.clearTimeout(retry.current);
        if (!mayEdit.current) return;
        try {
          revision.current = await saveSandbox(narrationId, latest.current, revision.current);
          setSaving(true);
        } catch (err) {
          if (err instanceof SaveConflict) {
            if (!gone.current) await catchUp(true);
          } else {
            keepTrying();
          }
        }
      }),
    [narrationId, inLine, catchUp, keepTrying],
  );
  flushLater.current = () => void flush();

  useEffect(() => () => window.clearTimeout(retry.current), []);

  useEffect(() => {
    if (!loaded) return;
    // What the server just handed over is already saved.
    if (fromServer.current === sandbox) return;
    unsaved.current = true;
    // Saving to the server is a network call, so wait a little longer between them.
    const t = setTimeout(() => void flush(), savesToAccount() ? 700 : 250);
    return () => clearTimeout(t);
  }, [sandbox, loaded, flush]);

  useEffect(() => {
    gone.current = false;
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      gone.current = true;
      void flush();
    };
  }, [flush]);

  // While other people can reach this narration, look for their changes now and then.
  const watching = savesToAccount() && loaded && (!!shared || shareCount > 0);
  useEffect(() => {
    if (!watching) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && !unsaved.current) void inLine(() => catchUp(false));
    }, 8000);
    return () => clearInterval(t);
  }, [watching, inLine, catchUp]);

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
    say(`Reverted to ${shared ? 'the author\u2019s' : 'your'} save point from ${dateTime(savePoint.savedAt)}.`);
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
    const hiddenFrom = shared || shareCount > 0 ? 'Visitors cannot' : 'Only you can';
    say(
      [`Added ${posts.length} ${plural(posts.length, 'draft')}. ${hiddenFrom} see ${them} until you set ${them} live.`, ...problems].join(' '),
    );
  }

  /** X: a post can be words alone. */
  function addTextPost() {
    const post = newPost([], { draft: true });
    dispatch({ type: 'addPosts', posts: [post] });
    setSelection({ type: 'post', id: post.id });
    say('Added a draft post. Only you can see it until you set it live.');
  }

  function addHighlight() {
    const id = uid('h');
    dispatch({ type: 'addHighlight', highlight: { id, title: 'New', cover: null } });
    setSelection({ type: 'highlight', id });
  }

  function build(next: Sandbox, count: number, notes: string[] = []) {
    dispatch({ type: 'load', sandbox: next });
    setPoint(next, true);
    setIntake(false);
    setView('creator');
    setSelection(null);
    say(
      [
        count
          ? `Your sandbox is built with ${count} ${plural(count, 'post')}. This is now your save point.`
          : 'Your sandbox is built. Add posts to start filling the grid.',
        ...notes,
      ].join(' '),
    );
  }

  const asOf = view === 'visitor' && seenOn !== null ? seenOn : now;
  // A Bil campaign shown on top of an X narration, for the team or that client.
  const campaign = useCampaignLayer(narrationId, platform === 'x' && !shared, sandbox.profile.username);

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
      canEdit,
      native,
      platform,
    }),
    [sandbox, view, now, asOf, selection, say, canEdit, native, platform],
  );

  const tally = useMemo(() => {
    const t = { live: 0, scheduled: 0, draft: 0 };
    for (const p of sandbox.posts) t[statusOf(p, now)] += 1;
    return t;
  }, [sandbox.posts, now]);

  if (!loaded) return <div className="app" aria-busy="true" />;

  const creator = view === 'creator';
  const hidden = tally.scheduled + tally.draft;
  const tools = creator && canEdit;
  const panel = tools && !native;

  return (
    // A shared narration keeps its photos and videos in its author's folder.
    <MediaOwner.Provider value={shared ? shared.owner.id : null}>
    <StageContext.Provider value={stage}>
      <div className={tools ? 'app studio has-tools' : 'app studio'}>
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
          {account && meta && !shared && (
            <NarrationMenu
              platform={platform}
              account={account}
              current={meta}
              username={sandbox.profile.username}
              onOpen={(id) => void leave(() => onOpen(id))}
              onCopy={() => void copyNarration()}
              onRename={rename}
              onAccounts={() => void leave(() => onAccounts())}
            />
          )}
          {meta && shared && (
            <div className="nmenu">
              <button
                type="button"
                className="nmenu-btn"
                aria-label={`${meta.name}, shared by ${shared.owner.username}. Back to your accounts`}
                title="Back to your accounts"
                onClick={() => void leave(() => onAccounts())}
              >
                <PlatformMark platform={platform} size={14} />
                <span className="nmenu-who">@{sandbox.profile.username || 'username'}</span>
                <span className="nmenu-name">{meta.name}</span>
              </button>
            </div>
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

          {tools && (
            <div className="tools">
              {platform === 'x' && (
                <button type="button" className="btn primary" onClick={addTextPost}>
                  <Icon name="plus" /> <span>New post</span>
                </button>
              )}
              <FileButton label={platform === 'x' ? 'Add media' : 'Add posts'} icon={platform === 'x' ? 'image' : 'plus'} className={platform === 'x' ? 'btn' : 'btn primary'} multiple onFiles={addPosts} />
              {!shared && (
                <button type="button" className="btn" onClick={() => setPoint(sandbox)}>
                  <Icon name="flag" /> <span>Save point</span>
                </button>
              )}
              {savePoint && (
                <ConfirmButton className="quiet" icon="undo" label="Revert" confirmLabel="Undo all?" onConfirm={revert} />
              )}
              {!shared && onPeople && (
                <button
                  type="button"
                  className="btn tools-share"
                  aria-label={shareCount > 0 ? `Share. Shared with ${shareCount}` : 'Share'}
                  onClick={() => setSharing(true)}
                >
                  <Icon name="share" /> <span>Share</span>
                  {shareCount > 0 && <i className="badge">{shareCount}</i>}
                </button>
              )}
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
              {shared && (
                <div className="notice" role="status">
                  <div>
                    <strong>Shared by @{shared.owner.username || 'someone'}.</strong>{' '}
                    {canEdit
                      ? 'You can change the page. Only they can rename it, set its save point or share it.'
                      : 'You can look around, but not change anything.'}
                  </div>
                </div>
              )}
              {sandbox.isExample && !shared && (
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
                    {savesToAccount()
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
                    {campaign.available && <LayerPicker options={campaign.options} chosen={campaign.chosen} onChoose={campaign.choose} />}
                    {canEdit && platform !== 'x' && (
                      <span className="tally-hint">
                        {small
                          ? 'Hold a post, then drag it onto another to swap them.'
                          : 'Drag one post onto another to swap them.'}
                      </span>
                    )}
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
                    {campaign.layer && <DayChips layer={campaign.layer} asOf={asOf} onPick={setSeenOn} />}
                  </>
                )}
              </div>

              <div className="set-wrap">
                <i className="mark tl" />
                <i className="mark tr" />
                <i className="mark bl" />
                <i className="mark br" />
                {platform === 'x' ? <XProfileSet layer={campaign.layer} /> : <ProfileSet onAddHighlight={addHighlight} />}
              </div>
            </div>
          </div>

          {panel && <Inspector />}
        </main>

        {openId && <PostsFeed startId={openId} onClose={() => setOpenId(null)} />}
        {tools && selection && (native || openId !== null) && <EditSheet />}
        {intake && <Intake platform={platform} onBuild={build} onClose={() => setIntake(false)} />}
        {sharing && meta && onPeople && (
          <ShareDialog
            narrationId={narrationId}
            name={meta.name}
            onClose={() => setSharing(false)}
            onChanged={setShareCount}
            onPeople={() => void leave(onPeople)}
          />
        )}

        <div className="toast-zone" aria-live="polite">
          {toast && (
            <div key={toast.id} className="toast">
              {toast.text}
            </div>
          )}
        </div>
      </div>
    </StageContext.Provider>
    </MediaOwner.Provider>
  );
}
