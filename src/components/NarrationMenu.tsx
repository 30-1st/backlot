import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PLATFORM, type Platform } from '../platforms';
import type { Account, NarrationMeta } from '../lib/library';
import { Icon, PlatformMark, cx } from './ui';

/**
 * The control in the studio's top bar that says which account and narration is
 * open, and lets the creator jump to another telling of the same account.
 */
export function NarrationMenu({
  platform,
  account,
  current,
  username,
  onOpen,
  onCopy,
  onRename,
  onAccounts,
}: {
  platform: Platform;
  account: Account;
  current: NarrationMeta;
  username: string;
  onOpen: (narrationId: string) => void;
  onCopy: () => void;
  onRename: (name: string) => void;
  onAccounts: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(current.name);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function submitRename(e: FormEvent) {
    e.preventDefault();
    const name = draft.trim();
    if (name && name !== current.name) onRename(name);
    setRenaming(false);
  }

  return (
    <div className="nmenu" ref={root}>
      <button
        type="button"
        className="nmenu-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Narration: ${current.name}. Switch narration`}
        onClick={() => {
          setOpen((o) => !o);
          setRenaming(false);
        }}
      >
        <PlatformMark platform={platform} size={14} />
        <span className="nmenu-who">@{username || 'username'}</span>
        <span className="nmenu-name">{current.name}</span>
        <Icon name="down" size={14} />
      </button>

      {open && (
        <div className="nmenu-pop">
          <div className="nmenu-head">Narrations of this account</div>
          {account.narrations.map((n) => (
            <button
              key={n.id}
              type="button"
              className={cx('nmenu-item', n.id === current.id && 'is-current')}
              aria-current={n.id === current.id ? 'true' : undefined}
              onClick={() => {
                setOpen(false);
                if (n.id !== current.id) onOpen(n.id);
              }}
            >
              <span className="nmenu-label">{n.name}</span>
              {n.id === current.id && <Icon name="check" />}
            </button>
          ))}

          <hr />

          {renaming ? (
            <form className="nmenu-rename" onSubmit={submitRename}>
              <input
                id="narration-name"
                aria-label="Narration name"
                value={draft}
                maxLength={40}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
              />
              <button type="submit" className="btn sm primary">
                Save
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="nmenu-item"
              onClick={() => {
                setDraft(current.name);
                setRenaming(true);
              }}
            >
              <Icon name="pencil" />
              <span className="nmenu-label">Rename this narration</span>
            </button>
          )}
          <button
            type="button"
            className="nmenu-item"
            onClick={() => {
              setOpen(false);
              onCopy();
            }}
          >
            <Icon name="copy" />
            <span className="nmenu-label">New narration from this one</span>
          </button>
          <button
            type="button"
            className="nmenu-item"
            onClick={() => {
              setOpen(false);
              onAccounts();
            }}
          >
            <Icon name="people" />
            <span className="nmenu-label">All {PLATFORM[platform].name} accounts</span>
          </button>
        </div>
      )}
    </div>
  );
}
