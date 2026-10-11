import { useEffect, useState } from 'react';
import { listChats, listContacts, watchMessages } from '../lib/people';
import { Icon } from './ui';

/** How many things are waiting on the People screen: unread chats plus requests to answer. */
function useWaiting(): number {
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    let alive = true;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      void Promise.all([listContacts(), listChats()]).then(
        ([contacts, chats]) => {
          if (!alive) return;
          setWaiting(contacts.filter((c) => c.state === 'incoming').length + chats.filter((c) => c.unread).length);
        },
        () => undefined,
      );
    };
    check();
    const stop = watchMessages(check);
    const t = setInterval(check, 30_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      alive = false;
      stop();
      clearInterval(t);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  return waiting;
}

/** The way into contacts and chats, with a count when something is waiting. Hosted build only. */
export function PeopleButton({ onClick }: { onClick: () => void }) {
  const waiting = useWaiting();
  return (
    <button
      type="button"
      className="btn sm people-btn"
      aria-label={waiting > 0 ? `People, ${waiting} waiting` : 'People'}
      onClick={onClick}
    >
      <Icon name="people" /> <span>People</span>
      {waiting > 0 && <i className="badge">{waiting > 9 ? '9+' : waiting}</i>}
    </button>
  );
}
