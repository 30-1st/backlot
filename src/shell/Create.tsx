import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Check, Chevron } from './icons';
import type { ScreenProps } from './Shell';

// Ask Bil: what he can do for the team, each with its price shown before anything runs.

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

export function CreateScreen({ ws, go, single }: ScreenProps) {
  const client = ws.data?.clients.find((c) => c.id === single) ?? null;
  const voice = ws.data?.voices.find((v) => v.clientId === single);
  const measured = Boolean(voice?.card?.whatWorks?.measuredAt);
  const tagged = useTaggedCount(client?.id ?? null);

  const actions: Action[] = [
    {
      key: 'plan',
      title: 'Plan a campaign',
      body: client ? `A run of posts toward one goal for @${client.handle}.` : 'Bring in a client first.',
      path: 'bil',
      ready: Boolean(client),
    },
    { key: 'client', title: 'Add a client', body: 'Bil reads their page and drafts their voice for them to approve.', path: 'bil', ready: true },
    { key: 'measure', title: 'Measure what works', body: 'Reads their latest posts and updates what performs.', path: 'bil', ready: Boolean(client) },
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
