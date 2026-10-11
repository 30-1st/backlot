import { useEffect, useState } from 'react';
import type { Person, ShareRole } from '../lib/library';
import { listContacts, listShares, setShare } from '../lib/people';
import { Icon, Modal, Segmented } from './ui';

type Choice = 'off' | ShareRole;

/**
 * Where an author decides who gets into a narration and what each person may
 * do there. Every change is saved as it is made.
 */
export function ShareDialog({
  narrationId,
  name,
  onClose,
  onChanged,
  onPeople,
}: {
  narrationId: string;
  name: string;
  onClose: () => void;
  /** Told how many people the narration is shared with after each change. */
  onChanged?: (count: number) => void;
  /** Goes to the People screen, for when there is nobody to share with yet. */
  onPeople: () => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [roles, setRoles] = useState<Record<string, ShareRole>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([listContacts(), listShares(narrationId)]).then(
      ([contacts, shares]) => {
        if (!alive) return;
        setPeople(contacts.filter((c) => c.state === 'contact').map((c) => c.person));
        setRoles(Object.fromEntries(shares.map((s) => [s.person.id, s.role])));
      },
      () => {
        if (!alive) return;
        setPeople([]);
        setError('Backlot cannot reach the server. Check your connection and open this again.');
      },
    );
    return () => {
      alive = false;
    };
  }, [narrationId]);

  async function choose(person: Person, choice: Choice) {
    const before = roles;
    const next = { ...roles };
    if (choice === 'off') delete next[person.id];
    else next[person.id] = choice;
    setRoles(next);
    setError('');
    try {
      await setShare(narrationId, person.id, choice === 'off' ? null : choice);
      onChanged?.(Object.keys(next).length);
    } catch {
      setRoles(before);
      setError(`That change for @${person.username} did not go through. Try again.`);
    }
  }

  return (
    <Modal label={`Share ${name}`} className="sheet share" onClose={onClose}>
      <header className="sheet-head">
        <button type="button" className="sheet-x" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={20} />
        </button>
        <strong>Share</strong>
        <button type="button" className="sheet-done" onClick={onClose}>
          Done
        </button>
      </header>
      <div className="sheet-body">
        <div className="share-what">
          <b>{name}</b>
          <p>
            Choose who can open this narration and what they may do. They see all of it, drafts and scheduled posts
            included. Someone who can edit changes the page itself. Only you can rename it, delete it, set its save
            point, or share it.
          </p>
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {people && people.length === 0 && !error && (
          <div className="share-none">
            <p>You have no contacts yet. Add the people you work with, then come back to share with them.</p>
            <button type="button" className="btn sm" onClick={onPeople}>
              <Icon name="people" /> Open People
            </button>
          </div>
        )}

        <ul className="share-list">
          {(people ?? []).map((person) => (
            <li key={person.id} className="share-row">
              <b>@{person.username}</b>
              <Segmented<Choice>
                label={`What @${person.username} can do`}
                value={roles[person.id] ?? 'off'}
                options={[
                  { value: 'off', label: 'Off' },
                  { value: 'view', label: 'View' },
                  { value: 'edit', label: 'Edit' },
                ]}
                onChange={(choice) => void choose(person, choice)}
              />
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
