import { Check, Narrate, Rings, Rising } from './icons';
import type { ScreenProps } from './Shell';

// Create with Bil: narrate a post (free, no campaign needed), see what is rising, or plan a
// campaign. Clients can narrate; paid work (trends, campaigns) is the team's.

export function CreateScreen({ ws, go, single, isTeam }: ScreenProps) {
  const voice = ws.data?.voices.find((v) => v.clientId === single);
  const client = ws.data?.clients.find((c) => c.id === single);
  const measured = Boolean(voice?.card?.whatWorks?.measuredAt);

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="bl-rise" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="bl-label accent">Bil · your strategist</span>
        <h1 className="bl-h1">
          What are we making <i>today?</i>
        </h1>
      </div>

      <div className="bl-grid2 bl-rise bl-d1">
        <a
          className="bl-card"
          href="#narrate"
          style={{ minHeight: 150, justifyContent: 'space-between', gap: 18 }}
          onClick={(e) => {
            e.preventDefault();
            go('narrate');
          }}
        >
          <span style={{ color: 'var(--accent-text)' }}>
            <Narrate />
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <b style={{ fontSize: 16 }}>Narrate a post</b>
            <span className="bl-small">Write around one piece of media</span>
            <span className="bl-label accent">Free</span>
          </span>
        </a>
        <div className="bl-card" style={{ minHeight: 150, justifyContent: 'space-between', gap: 18 }} aria-disabled="true">
          <span style={{ color: 'var(--ink-3)' }}>
            <Rising />
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <b style={{ fontSize: 16 }}>What's rising</b>
            <span className="bl-small">Rein checks trends when Bil plans a campaign. A standalone view comes with the dashboard.</span>
            <span className="bl-label">Next</span>
          </span>
        </div>
      </div>

      {isTeam && (
        <section className="bl-dark bl-rise bl-d2">
          <Rings size={220} style={{ right: -80, top: -80 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: 24 }}>Plan a campaign</div>
            <div className="bl-muted">
              A full run of posts aimed at one goal{client ? ` for @${client.handle}` : ''}.
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
            <Ready ok={Boolean(voice?.approved)} label="Voice approved" />
            <Ready ok={measured} label="What performs, measured" />
            <Ready ok={false} soft label="Media tagged in your Library (arrives with the Library)" />
          </div>
          <button type="button" className="bl-btn big" onClick={() => go('bil')} disabled={!client}>
            {client ? 'Plan it with Bil' : 'Onboard a client first'}
          </button>
          <div className="bl-small" style={{ textAlign: 'center' }}>
            You see the price before anything is spent. New clients are onboarded here too.
          </div>
        </section>
      )}
    </main>
  );
}

function Ready({ ok, label, soft }: { ok: boolean; label: string; soft?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {ok ? (
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            background: 'var(--accent)',
            color: 'var(--accent-ink)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 10px rgba(var(--glow), 0.7)',
            flexShrink: 0,
          }}
        >
          <Check />
        </span>
      ) : (
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            border: `1.5px dashed ${soft ? 'var(--dark-ink-2)' : 'var(--accent)'}`,
            flexShrink: 0,
          }}
        />
      )}
      <span className={soft ? 'bl-muted' : undefined}>{label}</span>
    </div>
  );
}
