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
import { pruneMedia } from '../lib/media';
import { plural, shortDate } from '../lib/format';
import { makeExample } from '../sample';
import { Intake } from './Intake';
import { ConfirmButton, Icon, Logo, MediaView, PlatformMark } from './ui';

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
}: {
  platform: Platform;
  onHome: () => void;
  onOpen: (narrationId: string, flash?: string) => void;
}) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [intake, setIntake] = useState(false);
  const [failed, setFailed] = useState(false);
  const { name } = PLATFORM[platform];

  const refresh = useCallback(
    () =>
      listAccounts(platform).then(setAccounts, () => {
        setAccounts([]);
        setFailed(true);
      }),
    [platform],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function build(sandbox: Sandbox, count: number) {
    try {
      const meta = await createAccount(platform, sandbox);
      onOpen(
        meta.id,
        count
          ? `Your account is built with ${count} ${plural(count, 'post')}. This is its save point.`
          : 'Your account is built. Add posts to start filling the grid.',
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
      </header>

      <main className="lobby">
        <div className="lobby-in">
          <h1>Your {name} accounts</h1>
          <p className="lobby-line">
            Open an account to work on it. Each account can hold several narrations: copies of the same profile that
            you brand differently and compare.
          </p>

          {failed && (
            <div className="notice warn" role="status">
              <div>
                <strong>Accounts cannot be saved here.</strong> This browser is blocking storage for the page.
              </div>
            </div>
          )}

          {accounts && (
            <ul className="acct-grid">
              {accounts.map((account) => (
                <li key={account.id}>
                  <AccountCard account={account} onOpen={onOpen} onChanged={refresh} />
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
        </div>
      </main>

      {intake && <Intake onBuild={build} onClose={() => setIntake(false)} onExample={useExample} />}
    </div>
  );
}

function AccountCard({
  account,
  onOpen,
  onChanged,
}: {
  account: Account;
  onOpen: (narrationId: string, flash?: string) => void;
  onChanged: () => void;
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
