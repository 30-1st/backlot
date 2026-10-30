import { useEffect, useState } from 'react';
import { team, type People, type Person } from '../lib/team';
import { ChangePassword } from './ChangePassword';
import { Rings } from './icons';
import type { ThemeChoice } from './theme';
import { useBanterOn } from '../lib/banter';
import type { ScreenProps } from './Shell';

// Team and account: invites and password resets (team only), then the person's own
// settings: night mode, password, people and chats, sign out.

export function TeamScreen({
  me,
  go,
  ws,
  isTeam,
  theme,
  onSignOut,
  onChanged,
}: ScreenProps & { theme: { choice: ThemeChoice; setChoice: (c: ThemeChoice) => void }; onSignOut: () => void; onChanged: () => void }) {
  const [changing, setChanging] = useState(false);
  const [banter, setBanter] = useBanterOn();
  if (changing) return <ChangePassword onBack={() => setChanging(false)} onDone={() => { setChanging(false); onChanged(); }} />;

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <h1 className="bl-sr">Account</h1>

      {isTeam && <TeamPanel isOwner={me.role === 'owner'} clientStages={(ws.data?.clients ?? []).map((c) => ({ id: c.id, handle: c.handle, stage: c.stage }))} onStage={() => void ws.refresh()} />}

      <section className="bl-card">
        <h2 className="bl-h2">You</h2>
        <span className="bl-small">
          Signed in as <b>@{me.username}</b>, {me.role === 'client' ? `client${me.clientHandle ? ` (@${me.clientHandle})` : ''}` : me.role === 'visitor' ? 'Playground member' : me.role}
        </span>
        <span className="bl-label" style={{ marginTop: 6 }}>
          Look
        </span>
        <div className="bl-seg" role="group" aria-label="Look">
          {(
            [
              ['light', 'Light'],
              ['night', 'Night'],
              ['system', 'Match phone'],
            ] as const
          ).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={theme.choice === v} onClick={() => theme.setChoice(v)}>
              {l}
            </button>
          ))}
        </div>
        <span className="bl-label" style={{ marginTop: 6 }}>
          Agent banter
        </span>
        <div className="bl-seg" role="group" aria-label="Agent banter">
          {(
            [
              [true, 'On'],
              [false, 'Off'],
            ] as const
          ).map(([v, l]) => (
            <button key={l} type="button" aria-pressed={banter === v} onClick={() => setBanter(v)}>
              {l}
            </button>
          ))}
        </div>
        <span className="bl-small">Short lines from Bil, Rein and Kris while things load. This device only.</span>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
          <button type="button" className="bl-ghost" onClick={() => setChanging(true)}>
            Change password
          </button>
          {me.role !== 'visitor' && (
            <button type="button" className="bl-ghost" onClick={() => go('people')}>
              People and chats
            </button>
          )}
          <button type="button" className="bl-ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </section>
    </main>
  );
}

function TeamPanel({ isOwner, clientStages, onStage }: { isOwner: boolean; clientStages: Array<{ id: string; handle: string; stage: 'onboarding' | 'active' | 'paused' }>; onStage: () => void }) {
  const [data, setData] = useState<People | null>(null);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<'team' | 'client'>('team');
  const [clientId, setClientId] = useState('');
  const [code, setCode] = useState<{ code: string; label: string } | null>(null);
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = () =>
    team.people().then(
      (d) => {
        setData(d);
        setError('');
      },
      (e: Error) => setError(e.message),
    );
  useEffect(() => {
    void load();
  }, []);

  const open = data?.clients.filter((c) => !c.hasLogin) ?? [];
  useEffect(() => {
    if (kind === 'client' && !open.some((c) => c.clientId === clientId)) setClientId(open[0]?.clientId ?? '');
  }, [kind, open, clientId]);

  async function makeCode() {
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      const r = await team.invite(kind, kind === 'client' ? clientId : undefined);
      const handle = data?.clients.find((c) => c.clientId === clientId)?.handle;
      setCode({ code: r.code, label: kind === 'client' ? `Client invite for @${handle}` : 'Teammate invite' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make the code.');
    } finally {
      setBusy(false);
    }
  }

  async function reset(p: Person) {
    if (!window.confirm(`Set a temporary password for @${p.username}? Their current password stops working.`)) return;
    setBusy(true);
    setError('');
    try {
      const r = await team.resetPassword(p.userId);
      setTemp({ name: p.username ?? '', password: r.temporaryPassword });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset the password.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError('Copying is blocked here. Press and hold the code to copy it.');
    }
  }

  const teamPeople = (data?.people ?? []).filter((p) => p.role === 'team');
  const has = (m: string, c: string) => (data?.grants ?? []).some((g) => g.memberId === m && g.clientId === c);
  async function grant(m: string, c: string, on: boolean) {
    setBusy(true);
    try {
      await team.accessSet(m, c, on);
      setData((d) => (d ? { ...d, grants: on ? [...(d.grants ?? []), { memberId: m, clientId: c }] : (d.grants ?? []).filter((g) => !(g.memberId === m && g.clientId === c)) } : d));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change access.');
    } finally {
      setBusy(false);
    }
  }
  async function stage(c: string, st: 'onboarding' | 'active' | 'paused') {
    setBusy(true);
    try {
      await team.clientStage(c, st);
      onStage();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the stage.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}

      {isOwner && data && (
        <section className="bl-card bl-rise">
          <h2 className="bl-h2">Who sees which clients</h2>
          <span className="bl-small">A team member sees a client&rsquo;s info and media only when you tick it here. You always see every client.</span>
          {teamPeople.length === 0 || data.clients.length === 0 ? (
            <span className="bl-small">{teamPeople.length === 0 ? 'No team members yet.' : 'No clients yet.'}</span>
          ) : (
            <div className="bl-access">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Team member</th>
                    {data.clients.map((c) => (
                      <th key={c.clientId} scope="col">
                        @{c.handle}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {teamPeople.map((p) => (
                    <tr key={p.userId}>
                      <th scope="row">@{p.username}</th>
                      {data.clients.map((c) => (
                        <td key={c.clientId}>
                          <input
                            type="checkbox"
                            aria-label={`@${p.username} sees @${c.handle}`}
                            checked={has(p.userId, c.clientId)}
                            disabled={busy}
                            onChange={(e) => void grant(p.userId, c.clientId, e.target.checked)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {isOwner && clientStages.length > 0 && (
        <section className="bl-card bl-rise">
          <h2 className="bl-h2">Client stages</h2>
          <span className="bl-small">Onboarding keeps campaigns closed until the checklist is done, then moves to Active by itself. Paused locks the client&rsquo;s portal to Home.</span>
          <ul className="bl-list">
            {clientStages.map((c) => (
              <li key={c.id}>
                <div className="bl-list-main">
                  <span style={{ fontWeight: 500 }}>@{c.handle}</span>
                </div>
                <label className="bl-sr" htmlFor={`stage-${c.id}`}>
                  Stage for @{c.handle}
                </label>
                <select id={`stage-${c.id}`} className="bl-input" style={{ width: 'auto' }} value={c.stage} disabled={busy} onChange={(e) => void stage(c.id, e.target.value as 'onboarding' | 'active' | 'paused')}>
                  <option value="onboarding">Onboarding</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                </select>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bl-card bl-rise">
        <h2 className="bl-h2">Invite someone</h2>
        <div className="bl-seg" role="group" aria-label="Invite who">
          <button type="button" aria-pressed={kind === 'team'} onClick={() => { setKind('team'); setCode(null); }}>
            Teammate
          </button>
          <button type="button" aria-pressed={kind === 'client'} onClick={() => { setKind('client'); setCode(null); }}>
            Client
          </button>
        </div>
        {kind === 'client' &&
          (open.length ? (
            <label className="bl-field">
              <span className="bl-label">For which client</span>
              <select className="bl-select" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                {open.map((c) => (
                  <option key={c.clientId} value={c.clientId}>
                    @{c.handle}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="bl-small">Every client already has a login. Onboard a new client with Bil first.</span>
          ))}
        <span className="bl-small">
          {kind === 'client'
            ? 'A client sees only their own voice, results and posts. They approve posts and answer Bil. They cannot spend the budget.'
            : 'A teammate sees every client, plans campaigns with Bil, and can reset passwords.'}
        </span>
        {code ? (
          <div className="bl-dark" style={{ borderRadius: 22, padding: 18, gap: 10 }}>
            <Rings size={160} style={{ right: -60, top: -60 }} />
            <span className="bl-label" style={{ color: 'var(--dark-ink-2)' }}>
              {code.label}
            </span>
            <span className="bl-ticket-code">{code.code}</span>
            <span className="bl-small">Works once. Expires in 7 days. Send it privately. It will not be shown again.</span>
            <button type="button" className="bl-btn" onClick={() => void copy(code.code)}>
              {copied ? 'Copied' : 'Copy code'}
            </button>
          </div>
        ) : (
          <button type="button" className="bl-btn" disabled={busy || (kind === 'client' && !clientId)} onClick={() => void makeCode()}>
            {busy ? 'Making the code' : 'Make invite code'}
          </button>
        )}
      </section>

      {temp && (
        <section className="bl-wash" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <b>Temporary password for @{temp.name}</b>
          <span className="bl-ticket-code" style={{ color: 'var(--accent-text)', textShadow: 'none', fontSize: 20 }}>
            {temp.password}
          </span>
          <span className="bl-small">Tell them privately. They pick their own password the next time they sign in. It will not be shown again.</span>
          <button type="button" className="bl-ghost bl-start" onClick={() => setTemp(null)}>
            Done
          </button>
        </section>
      )}

      <section style={{ display: 'flex', flexDirection: 'column' }}>
        <h2 className="bl-h2" style={{ marginBottom: 4 }}>
          People
        </h2>
        {!data ? (
          <span className="bl-small" aria-busy="true">
            Loading
          </span>
        ) : (
          <ul className="bl-list">
            {data.people.map((p) => (
              <li key={p.userId}>
                <span className={`bl-avatar${p.role === 'client' ? ' soft' : ''}`} style={{ width: 40, height: 40 }}>
                  {(p.username ?? '?').slice(0, 1)}
                </span>
                <div className="bl-list-main">
                  <span style={{ fontWeight: 500 }}>{p.isYou ? 'You' : `@${p.username}`}</span>
                  <span className="bl-label">{p.role === 'client' ? `Client, @${p.clientHandle}` : p.role}</span>
                </div>
                {isOwner && !p.isYou && p.role !== 'owner' && (
                  <button type="button" className="bl-ghost" disabled={busy} onClick={() => void reset(p)}>
                    Reset password
                  </button>
                )}
              </li>
            ))}
            {data.clients
              .filter((c) => !c.hasLogin)
              .map((c) => (
                <li key={c.clientId}>
                  <span className="bl-avatar soft" style={{ width: 40, height: 40 }}>
                    {c.handle.slice(0, 1)}
                  </span>
                  <div className="bl-list-main">
                    <span style={{ fontWeight: 500 }}>@{c.handle}</span>
                    <span className="bl-label">Client, not joined yet</span>
                  </div>
                  <button
                    type="button"
                    className="bl-ghost accent"
                    onClick={() => {
                      setKind('client');
                      setClientId(c.clientId);
                      setCode(null);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  >
                    Invite
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>
    </>
  );
}
