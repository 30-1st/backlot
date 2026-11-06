import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Check, Chevron } from './icons';
import type { ScreenProps } from './Shell';
import { AgentBar } from './AgentBar';
import { NextPostButton } from './Campaigns';
import { isNextPost } from './Notifications';
import { clock, timedPosts, when } from './timing';

// Ask Bil: what he can do for the team, each with its price shown before anything runs.
// Up next (Nov 6, 2026) comes first: the post next in line for the picked client, where it
// stands, and Bil's one-tap "Write the next post". With no client picked, it lists every
// client's next post so one tap opens the right one.

type Action = { key: string; title: string; body: string; path: string; ready: boolean };

function useTaggedCount(clientId: string | null): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (!clientId || !supabase) return;
    let alive = true;
    void supabase
      .from('library_items')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .is('removed_at', null)
      .neq('tags', '{}')
      .then(({ count }) => alive && setN(count ?? 0));
    return () => {
      alive = false;
    };
  }, [clientId]);
  return n;
}

export function CreateScreen({ ws, go, single, pick }: ScreenProps & { pick?: (id: string) => void }) {
  const client = ws.data?.clients.find((c) => c.id === single) ?? null;
  const voice = ws.data?.voices.find((v) => v.clientId === single);
  const measured = Boolean(voice?.card?.whatWorks?.measuredAt);
  const tagged = useTaggedCount(client?.id ?? null);

  const actions: Action[] = [
    {
      key: 'plan',
      title: 'Plan a campaign',
      body: client ? `A run of posts toward one goal for @${client.handle}.` : 'Bring in a client first.',
      path: 'create.plan',
      ready: Boolean(client),
    },
    { key: 'client', title: 'Add a client', body: 'Bil reads their page and drafts their voice for them to approve.', path: 'create.client', ready: true },
    { key: 'measure', title: 'Measure what works', body: 'Reads their latest posts and updates what performs.', path: 'create.measure', ready: Boolean(client) },
  ];

  const checks = [
    { ok: Boolean(voice?.approved), label: 'Voice approved by the client' },
    { ok: measured, label: 'What performs, measured' },
    { ok: (tagged ?? 0) > 0, label: tagged ? `${tagged} tagged ${tagged === 1 ? 'file' : 'files'} in Media` : 'Photos and videos tagged in Media' },
  ];

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 560 }}>
      <h1 className="bl-h1 bl-rise">Ask Bil</h1>
      <p className="bl-p bl-muted" style={{ margin: '-10px 0 0' }}>
        You see the price before anything runs.
      </p>

      <UpNext ws={ws} go={go} single={single} pick={pick} />

      <AgentBar clientId={single} clients={ws.data?.clients ?? []} go={go} pick={pick} />

      <ul className="bl-rows">
        {actions.map((a, i) => (
          <li key={a.key}>
            <a
              className="bl-row bl-in"
              style={{ animationDelay: `${i * 60}ms`, opacity: a.ready ? undefined : 0.55 }}
              href={`#${a.path}`}
              aria-disabled={!a.ready}
              onClick={(e) => {
                e.preventDefault();
                if (a.ready) go(a.path);
              }}
            >
              <span className="bl-row-txt">
                <b>{a.title}</b>
                <small>{a.body}</small>
              </span>
              <span className="bl-row-go" style={{ transform: 'rotate(-90deg)' }}>
                <Chevron size={16} />
              </span>
            </a>
          </li>
        ))}
      </ul>

      {client && (
        <section className="bl-glass-card bl-in" style={{ animationDelay: '200ms' }} aria-labelledby="ready">
          <h2 id="ready" className="bl-section-title" style={{ margin: 0 }}>
            Ready for a campaign for @{client.handle}
          </h2>
          {checks.map((c) => (
            <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 15 }}>
              <span className={`bl-ready${c.ok ? ' ok' : ''}`} aria-hidden="true">
                {c.ok && <Check />}
              </span>
              <span className={c.ok ? undefined : 'bl-muted'}>{c.label}</span>
              <span className="bl-sr">{c.ok ? 'done' : 'not yet'}</span>
            </div>
          ))}
          {(tagged ?? 0) === 0 && (
            <button type="button" className="bl-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => go('library')}>
              Add photos and videos
            </button>
          )}
        </section>
      )}
    </main>
  );
}

/** What Bil has next in line, before anything else on his tab. */
function UpNext({ ws, go, single, pick }: Pick<ScreenProps, 'ws' | 'go' | 'single'> & { pick?: (id: string) => void }) {
  const data = ws.data;
  if (!data || data.clients.length === 0) return null;
  const now = Date.now();
  const due = (focus: string | null) => timedPosts(data, focus).filter((t) => t.end.getTime() > now && t.post.review !== 'posted' && t.post.review !== 'not_posted');
  const client = data.clients.find((c) => c.id === single) ?? null;
  const writing = (id: string) => data.campaigns.some((c) => c.clientId === id && isNextPost(c) && (c.status === 'planning' || c.status === 'drafting'));
  const word = (r: string, st: string) => (st === 'blocked' ? 'Needs a detail' : r === 'approved' ? 'Approved' : r === 'changes' ? 'Changes asked' : 'Waiting for a yes');

  if (!client) {
    return (
      <section className="bl-cmd-card bl-upnext bl-in" aria-labelledby="upnext">
        <h2 id="upnext" className="bl-section-title">
          Up next
        </h2>
        <ul className="bl-cmd-board">
          {data.clients.map((c) => {
            const t = due(c.id)[0];
            return (
              <li key={c.id}>
                <a
                  href="#create"
                  className="bl-cmd-client"
                  onClick={(e) => {
                    e.preventDefault();
                    pick?.(c.id);
                  }}
                >
                  <span className="bl-cmd-what">
                    <b>@{c.handle}</b>
                    <span className="bl-small">{writing(c.id) ? 'Bil is writing the next post' : t ? `${when(t)} · ${word(t.post.review, t.post.status)}` : 'Nothing scheduled ahead'}</span>
                  </span>
                  <span className="bl-band-go" aria-hidden="true">
                    Open ›
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  const list = due(client.id);
  const t = list[0];
  const text = t ? String(t.post.status === 'blocked' ? t.post.post.idea ?? 'Waiting on a detail' : t.post.post.draft ?? t.post.post.hook ?? '') : '';
  const c = t ? clock(t.start, t.tz) : null;
  return (
    <section className="bl-cmd-card bl-upnext bl-in" aria-labelledby="upnext">
      <h2 id="upnext" className="bl-section-title">
        Up next for @{client.handle}
      </h2>
      {t && c ? (
        <a
          href="#campaigns"
          className="bl-upnext-post"
          onClick={(e) => {
            e.preventDefault();
            go('campaigns');
          }}
        >
          <span className="bl-wk-time num">
            {c.time}
            <small>{c.half}</small>
          </span>
          <span className="bl-wk-text">
            <b>{when(t)}</b>
            <span>{text || 'No text yet'}</span>
          </span>
          <span className={`bl-chip${t.post.status === 'blocked' ? ' changes' : t.post.review === 'approved' ? ' approved' : ' needs'}`}>{word(t.post.review, t.post.status)}</span>
        </a>
      ) : (
        <p className="bl-small" style={{ margin: 0 }}>
          {writing(client.id) ? 'Bil is writing the next post now. It lands here and first on the Schedule.' : 'Nothing is scheduled ahead. Bil can write the next one from their latest posts and goals.'}
        </p>
      )}
      <div className="bl-row-actions">
        <NextPostButton clientId={client.id} ws={ws} label="Write the next post" />
        {list.length > 1 && (
          <button type="button" className="bl-ghost" onClick={() => go('campaigns')}>
            {list.length - 1} more on the Schedule
          </button>
        )}
      </div>
      <span className="bl-small">Bil reads their latest posts on X and their goals, then writes one post for the next good hour. About 3 to 6 cents.</span>
    </section>
  );
}
