import { createPortal } from 'react-dom';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Client, OnboardingStep, Workspace } from './data';

// Setting up a client, step by step. Three steps Backlot sees for itself (voice drafted,
// voice approved, first media in); three a person confirms (X access through Delegate, the
// first call, the agreement). The client sees it on Today until it is done; the team sees
// it on each client in Clients.

// The X account the team works from. VITE_TEAM_X_HANDLE can change it without a code change.
const TEAM_HANDLE = (import.meta.env.VITE_TEAM_X_HANDLE as string | undefined)?.trim().replace(/^@/, '') || 'backlotsocial';

type Who = 'team' | 'client' | 'either';
export type Step = {
  key: string;
  title: string;
  body: string;
  done: boolean;
  /** Who does it. Automatic steps say who acts; Backlot ticks them itself. */
  who: Who;
  /** Set for steps a person ticks by hand. */
  manual?: OnboardingStep;
  /** Where to go to do it. */
  path?: string;
};

export function stepsFor(ws: Workspace, client: Client): Step[] {
  const voice = ws.voices.find((v) => v.clientId === client.id);
  const ticked = (s: OnboardingStep) => ws.steps.some((x) => x.clientId === client.id && x.step === s);
  const media = ws.mediaCounts[client.id] ?? 0;
  return [
    { key: 'voice', title: 'Bil drafts the voice', body: 'Bil reads their posts and writes how they sound.', done: Boolean(voice), who: 'team', path: 'create.client' },
    { key: 'delegate', title: 'Delegate with the team!', body: 'Through Delegate, so the team can post by hand. No password changes hands.', done: ticked('delegate'), who: 'either', manual: 'delegate' },
    { key: 'approve', title: 'Approve the voice', body: 'Read what Bil wrote and say it sounds like you.', done: Boolean(voice?.approved), who: 'client', path: 'insights' },
    { key: 'media', title: 'First photos and videos', body: 'Bil plans posts around what is in Media.', done: media > 0, who: 'either', path: 'library' },
    { key: 'call', title: 'First call', body: 'Goals, offers and what is off limits, in person.', done: ticked('first_call'), who: 'team', manual: 'first_call' },
    { key: 'contract', title: 'Agreement signed', body: 'What the team does, for how long, at what price.', done: ticked('contract'), who: 'team', manual: 'contract' },
  ];
}

export function setupLeft(ws: Workspace, client: Client): number {
  return stepsFor(ws, client).filter((s) => !s.done).length;
}

async function mark(clientId: string, step: OnboardingStep, done: boolean) {
  if (!supabase) throw new Error('This build is offline.');
  const { error } = await supabase.rpc('onboarding_mark', { p_client: clientId, p_step: step, p_done: done });
  if (error) throw new Error(error.message);
}

export function Checklist({
  ws,
  client,
  isTeam,
  go,
  onChanged,
}: {
  ws: Workspace;
  client: Client;
  isTeam: boolean;
  go: (p: string) => void;
  onChanged: () => void;
}) {
  const steps = stepsFor(ws, client);
  const done = steps.filter((s) => s.done).length;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [guide, setGuide] = useState(false);

  async function toggle(s: Step) {
    if (!s.manual) return;
    setBusy(s.key);
    setError('');
    try {
      await mark(client.id, s.manual, !s.done);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy(null);
    }
  }

  const mine = (s: Step) => s.who === 'either' || (isTeam ? s.who === 'team' : s.who === 'client');
  const canTick = (s: Step) => Boolean(s.manual) && (isTeam || s.manual === 'delegate');
  const whoWord = (s: Step) => (s.who === 'either' ? (isTeam ? 'You or the client' : 'You or your team') : s.who === 'client' ? (isTeam ? 'The client' : 'You') : isTeam ? 'You' : 'Your team');

  return (
    <div className="bl-check">
      <div className="bl-check-head">
        <span className="bl-small num">
          {done} of {steps.length} done
        </span>
        <span className="bl-check-bar" aria-hidden="true">
          <i style={{ width: `${(done / steps.length) * 100}%` }} />
        </span>
      </div>
      <ol className="bl-check-list">
        {steps.map((s) => (
          <li key={s.key} className={s.done ? 'done' : undefined}>
            <span className="bl-check-box" aria-hidden="true">
              {s.done ? '✓' : ''}
            </span>
            <span className="bl-check-txt">
              <b>{s.title}</b>
              <small>
                {s.done ? 'Done.' : `${whoWord(s)}. ${s.body}`}
              </small>
              {!s.done && mine(s) && (
                <span className="bl-row-actions">
                  {s.key === 'delegate' && (
                    <button type="button" className="bl-ghost" onClick={() => setGuide(true)}>
                      See how
                    </button>
                  )}
                  {s.path && !s.manual && (s.key !== 'voice' || isTeam) && (
                    <button type="button" className="bl-ghost" onClick={() => go(s.path!)}>
                      {s.key === 'approve' ? 'Read the voice' : s.key === 'media' ? 'Add photos and videos' : 'Ask Bil'}
                    </button>
                  )}
                  {canTick(s) && (
                    <button type="button" className="bl-btn" disabled={busy !== null} onClick={() => void toggle(s)}>
                      {busy === s.key ? 'Saving' : 'Mark done'}
                    </button>
                  )}
                </span>
              )}
              {s.done && canTick(s) && (
                <button type="button" className="bl-linkish" style={{ alignSelf: 'flex-start', fontSize: 13 }} disabled={busy !== null} onClick={() => void toggle(s)}>
                  Not done yet
                </button>
              )}
            </span>
          </li>
        ))}
      </ol>
      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}
      {guide && <DelegateGuide isTeam={isTeam} onClose={() => setGuide(false)} />}
    </div>
  );
}

/** X's own Delegate steps, drawn, with the team's handle filled in when it is set. */
function DelegateGuide({ isTeam, onClose }: { isTeam: boolean; onClose: () => void }) {
  const handle = TEAM_HANDLE ? `@${TEAM_HANDLE}` : '[THE TEAM’S X ACCOUNT]';
  const host = document.querySelector('.bl-root') ?? document.body;
  const steps: Array<[string, string, string[]]> = [
    ['Open X on a computer', 'Delegate is set up on X.com, not in the phone app.', ['x.com']],
    ['Find Delegate', 'In the menu on the left, open these one after another.', ['Your account', 'Security and account access', 'Delegate']],
    ['Invite the team', `Choose Invite a member and type ${handle}.`, ['Invite a member', handle]],
    ['Pick Contributor', 'Contributor lets the team post as you. It cannot add or remove people. Then send the invite.', ['Contributor', 'Send invite']],
  ];
  return createPortal(
    <div className="bl-sheet-back" onClick={onClose}>
      <section className="bl-sheet" role="dialog" aria-modal="true" aria-labelledby="dg-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="dg-title" className="bl-sheet-title">
          {isTeam ? 'How the client gives access' : 'Give your team access on X'}
        </h2>
        <p className="bl-small" style={{ margin: 0 }}>
          About a minute. Your password stays yours, and you can remove the team any time in the same place.
        </p>
        <ol className="bl-guide">
          {steps.map(([title, body, path], i) => (
            <li key={title}>
              <span className="bl-guide-n num">{i + 1}</span>
              <span className="bl-guide-txt">
                <DelegatePic step={i} handle={handle} />
                <b>{title}</b>
                <small>{body}</small>
                <span className="bl-guide-path" aria-label={path.join(', then ')}>
                  {path.map((p, j) => (
                    <span key={p}>
                      {j > 0 && <i aria-hidden="true">›</i>}
                      <em>{p}</em>
                    </span>
                  ))}
                </span>
              </span>
            </li>
          ))}
        </ol>
        <p className="bl-small" style={{ margin: 0 }}>
          Our own drawings of X&rsquo;s screens, checked against X&rsquo;s help page on Oct 29, 2026,{' '}
          <a className="bl-linkish" href="https://help.x.com/en/managing-your-account/how-to-use-the-delegate-feature" target="_blank" rel="noopener noreferrer">
            How to use the Delegate feature
          </a>
          .
        </p>
        <button type="button" className="bl-btn bl-wide" onClick={onClose}>
          Got it
        </button>
      </section>
    </div>,
    host,
  );
}

/**
 * A small drawing of the X screen for each Delegate step: grey shapes for the page, the one
 * thing to tap picked out in the accent color. Our own drawings, not screenshots; no X logo.
 */
function DelegatePic({ step, handle }: { step: number; handle: string }) {
  const lines = (x: number, y: number, n: number, w = 70) =>
    Array.from({ length: n }, (_, k) => <rect key={k} x={x} y={y + k * 16} width={w - (k % 3) * 12} height="7" rx="3.5" className="dp-soft" />);
  return (
    <svg className="bl-delegate-pic" viewBox="0 0 280 150" role="img" aria-label={['A browser open at x.com', 'Settings: Your account, then Security and account access, then Delegate', `The Delegate page: Invite a member, with ${handle} typed in`, 'Contributor picked, then Send invite'][step]}>
      <rect x="1" y="1" width="278" height="148" rx="12" className="dp-frame" />
      <rect x="1" y="1" width="278" height="22" rx="12" className="dp-bar" />
      <circle cx="14" cy="12" r="3" className="dp-soft" /><circle cx="24" cy="12" r="3" className="dp-soft" /><circle cx="34" cy="12" r="3" className="dp-soft" />
      <rect x="48" y="6" width="150" height="12" rx="6" className={step === 0 ? 'dp-pick' : 'dp-soft'} />
      <text x="58" y="15.5" className={step === 0 ? 'dp-pick-t' : 'dp-t'}>x.com</text>
      {step === 0 && (
        <g>{lines(18, 40, 6, 50)}<rect x="90" y="38" width="170" height="96" rx="8" className="dp-soft" /></g>
      )}
      {step === 1 && (
        <g>
          <text x="16" y="44" className="dp-t">Settings</text>
          <rect x="12" y="54" width="112" height="16" rx="5" className="dp-pick" /><text x="18" y="65" className="dp-pick-t">Your account</text>
          <rect x="12" y="74" width="112" height="16" rx="5" className="dp-pick" /><text x="18" y="85" className="dp-pick-t">Security and access</text>
          {lines(14, 98, 3, 90)}
          <rect x="138" y="54" width="128" height="16" rx="5" className="dp-pick" /><text x="144" y="65" className="dp-pick-t">Delegate</text>
          {lines(140, 80, 4, 110)}
        </g>
      )}
      {step === 2 && (
        <g>
          <text x="16" y="44" className="dp-t">Delegate</text>
          {lines(16, 54, 2, 160)}
          <rect x="16" y="88" width="104" height="22" rx="11" className="dp-pick" /><text x="28" y="102.5" className="dp-pick-t">Invite a member</text>
          <rect x="132" y="88" width="132" height="22" rx="6" className="dp-field" /><text x="140" y="102.5" className="dp-t">{handle.length > 22 ? handle.slice(0, 21) + '…' : handle}</text>
        </g>
      )}
      {step === 3 && (
        <g>
          <text x="16" y="44" className="dp-t">Choose a role</text>
          <rect x="16" y="54" width="248" height="22" rx="6" className="dp-pick" /><circle cx="28" cy="65" r="5" className="dp-dot" /><text x="40" y="69" className="dp-pick-t">Contributor</text>
          <rect x="16" y="82" width="248" height="22" rx="6" className="dp-soft" /><circle cx="28" cy="93" r="5" className="dp-field" /><text x="40" y="97" className="dp-t">Admin</text>
          <rect x="176" y="114" width="88" height="24" rx="12" className="dp-pick" /><text x="190" y="130" className="dp-pick-t">Send invite</text>
        </g>
      )}
    </svg>
  );
}
