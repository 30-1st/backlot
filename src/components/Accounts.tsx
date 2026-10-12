import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Sandbox } from '../types';
import { PLATFORM, type Platform } from '../platforms';
import {
  createAccount,
  deleteAccount,
  deleteNarration,
  duplicateNarration,
  listAccounts,
  mediaInUse,
  nextNarrationName,
  renameNarration,
  type Account,
} from '../lib/library';
import { MediaOwner, pruneMedia } from '../lib/media';
import { leaveShare, listSharedWithMe, shareCounts, type NarrationCard } from '../lib/people';
import { hosted } from '../lib/supabase';
import { plural, shortDate } from '../lib/format';
import { makeExample } from '../sample';
import { Intake } from './Intake';
import { PeopleButton } from './PeopleButton';
import { ShareDialog } from './ShareDialog';
import { ConfirmButton, Icon, Logo, MediaView, PlatformMark, cx } from './ui';

/** Remove stored photos and videos that no narration uses any more. */
function tidyMedia() {
  void mediaInUse().then(pruneMedia, () => undefined);
}

/**
 * The first screen after choosing a platform: every account the creator has
 * made there, the narrations inside each, and a plus to add another account.
 */
export function Accounts({
  platform,
  onHome,
  onOpen,
  username,
  onSignOut,
  onPeople,
  flash,
}: {
  platform: Platform;
  onHome: () => void;
  onOpen: (narrationId: string, flash?: string) => void;
  /** Set in the hosted build, where a creator is signed in. */
  username?: string;
  onSignOut?: () => void;
  onPeople?: () => void;
  /** A message to show once on arrival, for example why a narration closed. */
  flash?: string;
}) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [intake, setIntake] = useState(false);
  const [failed, setFailed] = useState(false);
  // Sharing exists only where there are logins.
  const [shared, setShared] = useState<NarrationCard[]>([]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [sharing, setSharing] = useState<{ id: string; name: string } | null>(null);
  const { name } = PLATFORM[platform];

  const refreshShares = useCallback(() => {
    if (!hosted) return;
    void listSharedWithMe(platform).then(setShared, () => undefined);
    void shareCounts().then(setCounts, () => undefined);
  }, [platform]);

  const refresh = useCallback(() => {
    refreshShares();
    return listAccounts(platform).then(setAccounts, () => {
      setAccounts([]);
      setFailed(true);
    });
  }, [platform, refreshShares]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function build(sandbox: Sandbox, count: number, notes: string[] = []) {
    try {
      const meta = await createAccount(platform, sandbox);
      onOpen(
        meta.id,
        [
          count
            ? `Your account is built with ${count} ${plural(count, 'post')}. This is its save point.`
            : 'Your account is built. Add posts to start filling the grid.',
          ...notes,
        ].join(' '),
      );
    } catch {
      setIntake(false);
      setFailed(true);
    }
  }

  async function useExample() {
    try {
      const meta = await createAccount(platform, makeExample());
      onOpen(meta.id);
    } catch {
      setIntake(false);
      setFailed(true);
    }
  }

  return (
    <div className="app">
      <header className="bar">
        <a
          className="brand"
          href="#home"
          aria-label="Backlot home"
          onClick={(e) => {
            e.preventDefault();
            onHome();
          }}
        >
          <Logo />
          <b>Backlot</b>
        </a>
        <span className="on-platform">
          <PlatformMark platform={platform} size={14} />
          {name}
        </span>
        {onSignOut && (
          <div className="bar-tools who-inline">
            {onPeople && <PeopleButton onClick={onPeople} />}
            <span>@{username}</span>
            <button type="button" className="btn quiet sm" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        )}
      </header>

      <main className="lobby">
        <div className="lobby-in">
          <h1>Your {name} accounts</h1>
          <p className="lobby-line">
            Open an account to work on it. Each account can hold several narrations: copies of the same profile that
            you brand differently and compare.
          </p>

          {flash && (
            <div className="notice" role="status">
              <div>{flash}</div>
            </div>
          )}

          {failed && (
            <div className="notice warn" role="status">
              <div>
                <strong>{hosted ? 'Backlot cannot reach the server.' : 'Accounts cannot be saved here.'}</strong>{' '}
                {hosted ? 'Check your connection and reload the page.' : 'This browser is blocking storage for the page.'}
              </div>
            </div>
          )}

          {accounts && (
            <ul className="acct-grid">
              {accounts.map((account) => (
                <li key={account.id}>
                  <AccountCard
                    account={account}
                    counts={counts}
                    onOpen={onOpen}
                    onChanged={refresh}
                    onShare={hosted ? setSharing : undefined}
                  />
                </li>
              ))}
              <li>
                <button type="button" className="acct-new" onClick={() => setIntake(true)}>
                  <span className="acct-plus">
                    <Icon name="plus" size={30} />
                  </span>
                  <b>New account</b>
                  {accounts.length === 0 && <span>Bring in a profile, or start from the example.</span>}
                </button>
              </li>
            </ul>
          )}

          {shared.length > 0 && (
            <section className="shared">
              <h2>Shared with you</h2>
              <p className="lobby-line">
                Narrations other people let you into. The author decides whether you can edit or only look.
              </p>
              <ul className="acct-grid">
                {shared.map((card) => (
                  <li key={card.meta.id}>
                    <SharedCard
                      card={card}
                      onOpen={() => onOpen(card.meta.id)}
                      onLeave={async () => {
                        await leaveShare(card.meta.id).catch(() => undefined);
                        refreshShares();
                      }}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>

      {intake && <Intake onBuild={build} onClose={() => setIntake(false)} onExample={useExample} />}
      {sharing && onPeople && (
        <ShareDialog
          narrationId={sharing.id}
          name={sharing.name}
          onClose={() => setSharing(null)}
          onChanged={refreshShares}
          onPeople={onPeople}
        />
      )}
    </div>
  );
}

/** A narration someone else shared. Its photos and videos live in the author's folder. */
function SharedCard({ card, onOpen, onLeave }: { card: NarrationCard; onOpen: () => void; onLeave: () => void }) {
  const { meta } = card;
  return (
    <article className="acct">
      <header className="acct-head">
        <span className="acct-avatar">
          <MediaOwner.Provider value={card.ownerId}>
            <MediaView item={meta.avatar ?? undefined} />
          </MediaOwner.Provider>
        </span>
        <div className="acct-who">
          <b>@{meta.username || 'username'}</b>
          <span>
            {meta.name}, {meta.posts} {plural(meta.posts, 'post')}
          </span>
        </div>
      </header>
      <p className="shared-from">
        <Icon name={card.role === 'edit' ? 'pencil' : 'eye'} />
        From @{card.owner?.username || 'someone'}. {card.role === 'edit' ? 'You can edit it.' : 'You can look, not edit.'}
      </p>
      <div className="shared-actions">
        <button type="button" className="btn sm primary" onClick={onOpen}>
          Open
        </button>
        <ConfirmButton
          className="quiet sm"
          label="Remove from my list"
          confirmLabel="Remove it?"
          onConfirm={onLeave}
        />
      </div>
    </article>
  );
}

function AccountCard({
  account,
  counts,
  onOpen,
  onChanged,
  onShare,
}: {
  account: Account;
  /** How many people each narration is shared with. */
  counts: Map<string, number>;
  onOpen: (narrationId: string, flash?: string) => void;
  onChanged: () => void;
  /** Set where sharing exists. Opens the share screen for one narration. */
  onShare?: (narration: { id: string; name: string }) => void;
}) {
  const lead = account.narrations[0];
  const count = account.narrations.length;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [from, setFrom] = useState(lead.id);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  async function create(e: FormEvent) {
    e.preventDefault();
    const copy = await duplicateNarration(from, name.trim() || nextNarrationName(account)).catch(() => null);
    if (!copy) return onChanged();
    onOpen(copy.id, `You are in "${copy.name}", a copy. Change anything here and the other narrations stay as they were.`);
  }

  async function rename(e: FormEvent) {
    e.preventDefault();
    const next = draft.trim();
    if (renaming && next) await renameNarration(renaming, next).catch(() => undefined);
    setRenaming(null);
    onChanged();
  }

  return (
    <article className="acct">
      <header className="acct-head">
        <span className="acct-avatar">
          <MediaView item={lead.avatar ?? undefined} />
        </span>
        <div className="acct-who">
          <b>@{lead.username || 'username'}</b>
          <span>
            {count} {plural(count, 'narration')}
            {lead.isExample ? ', example profile' : ''}
          </span>
        </div>
        <ConfirmButton
          className="quiet sm danger"
          label="Delete"
          confirmLabel="Delete account?"
          ariaLabel={`Delete account ${lead.username}`}
          onConfirm={async () => {
            await deleteAccount(account.id).catch(() => undefined);
            tidyMedia();
            onChanged();
          }}
        />
      </header>

      <ul className="narr-list">
        {account.narrations.map((n) => (
          <li key={n.id} className="narr">
            {renaming === n.id ? (
              <form className="narr-rename" onSubmit={rename}>
                <input
                  id={`rename-${n.id}`}
                  aria-label="Narration name"
                  value={draft}
                  maxLength={40}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button type="submit" className="btn sm primary">
                  Save
                </button>
                <button type="button" className="btn quiet sm" onClick={() => setRenaming(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <button type="button" className="narr-open" onClick={() => onOpen(n.id)}>
                  <b>{n.name}</b>
                  <span>
                    {n.posts} {plural(n.posts, 'post')}, edited {shortDate(n.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn quiet sm"
                  aria-label={`Rename ${n.name}`}
                  onClick={() => {
                    setDraft(n.name);
                    setRenaming(n.id);
                  }}
                >
                  <Icon name="pencil" />
                </button>
                {onShare && (
                  <button
                    type="button"
                    className={cx('btn quiet sm narr-share', (counts.get(n.id) ?? 0) > 0 && 'is-shared')}
                    aria-label={
                      (counts.get(n.id) ?? 0) > 0
                        ? `Share ${n.name}. Shared with ${counts.get(n.id)}`
                        : `Share ${n.name}`
                    }
                    title="Share"
                    onClick={() => onShare({ id: n.id, name: n.name })}
                  >
                    <Icon name="share" />
                    {(counts.get(n.id) ?? 0) > 0 && <span>{counts.get(n.id)}</span>}
                  </button>
                )}
                {count > 1 && (
                  <ConfirmButton
                    className="quiet sm danger"
                    icon="trash"
                    label=""
                    confirmLabel="Delete?"
                    ariaLabel={`Delete ${n.name}`}
                    onConfirm={async () => {
                      await deleteNarration(n.id).catch(() => undefined);
                      tidyMedia();
                      onChanged();
                    }}
                  />
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      {adding ? (
        <form className="narr-new" onSubmit={create}>
          <label className="field">
            <span className="field-label">Name</span>
            <input
              id={`new-narration-${account.id}`}
              value={name}
              maxLength={40}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {count > 1 && (
            <label className="field">
              <span className="field-label">Copy of</span>
              <select id={`copy-of-${account.id}`} value={from} onChange={(e) => setFrom(e.target.value)}>
                {account.narrations.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="narr-new-actions">
            <button type="submit" className="btn sm primary">
              Create narration
            </button>
            <button type="button" className="btn quiet sm" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="btn sm acct-add"
          onClick={() => {
            setName(nextNarrationName(account));
            setFrom(lead.id);
            setAdding(true);
          }}
        >
          <Icon name="copy" /> New narration
        </button>
      )}
    </article>
  );
}
