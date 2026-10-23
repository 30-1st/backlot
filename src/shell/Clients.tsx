import { useState } from 'react';
import { Checklist, setupLeft, stepsFor } from './Checklist';
import type { ScreenProps } from './Shell';

// Clients: every client in the workspace, with a way into their schedule, what works for
// them, and their media. People and invite codes live in Account.

export function ClientsScreen({ ws, go, pick }: ScreenProps & { pick: (clientId: string) => void }) {
  const clients = ws.data?.clients ?? [];
  const voiceOf = (id: string) => ws.data?.voices.find((v) => v.clientId === id);
  const [open, setOpen] = useState<string | null>(null);
  const goFor = (id: string, path: string) => {
    pick(id);
    go(path);
  };

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 className="bl-h1 bl-rise">Clients</h1>
      {!ws.data && !ws.error && <p className="bl-p bl-muted">Loading your clients.</p>}
      {ws.data && clients.length === 0 && (
        <div className="bl-glass-card bl-rise">
          <b>No clients yet</b>
          <p className="bl-p bl-muted" style={{ margin: 0 }}>
            Ask Bil to bring in your first client. He reads their page and drafts their voice.
          </p>
          <button type="button" className="bl-btn" onClick={() => go('create.client')}>
            Add a client
          </button>
        </div>
      )}
      {clients.map((c) => {
        const v = voiceOf(c.id);
        const left = ws.data ? setupLeft(ws.data, c) : 0;
        const total = ws.data ? stepsFor(ws.data, c).length : 0;
        return (
          <section key={c.id} className="bl-glass-card bl-rise" aria-label={`@${c.handle}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <b style={{ fontSize: 17 }}>@{c.handle}</b>
              <span className="bl-chip-ink">{v ? (v.approved ? 'Voice approved' : 'Voice waiting') : 'No voice yet'}</span>
            </div>
            <div className="bl-row-actions">
              <button type="button" className="bl-ghost" onClick={() => goFor(c.id, 'campaigns')}>
                Schedule
              </button>
              <button type="button" className="bl-ghost" onClick={() => goFor(c.id, 'insights')}>
                What works
              </button>
              <button type="button" className="bl-ghost" onClick={() => goFor(c.id, 'library')}>
                Media
              </button>
              <button type="button" className="bl-ghost" onClick={() => goFor(c.id, 'brand')}>
                Brand kit{c.pending ? ' · new' : ''}
              </button>
              <button type="button" className="bl-ghost" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>
                {left ? `Setup ${total - left} of ${total}` : 'Set up'}
              </button>
            </div>
            {open === c.id && ws.data && (
              <Checklist
                ws={ws.data}
                client={c}
                isTeam
                go={(path) => goFor(c.id, path)}
                onChanged={() => void ws.refresh()}
              />
            )}
          </section>
        );
      })}
      <button type="button" className="bl-linkish" style={{ alignSelf: 'flex-start' }} onClick={() => go('account')}>
        People and invite codes
      </button>
    </main>
  );
}
