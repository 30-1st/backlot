import { createPortal } from 'react-dom';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Client, OnboardingStep, Workspace } from './data';

// Setting up a client, step by step. Three steps Backlot sees for itself (voice drafted,
// voice approved, first media in); three a person confirms (X access through Delegate, the
// first call, the agreement). The client sees it on Today until it is done; the team sees
// it on each client in Clients.

// The X account the team works from. Set VITE_TEAM_X_HANDLE when it exists.
const TEAM_HANDLE = (import.meta.env.VITE_TEAM_X_HANDLE as string | undefined)?.trim().replace(/^@/, '') || '';

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
    { key: 'delegate', title: 'Give the team access on X', body: 'Through Delegate, so the team can post by hand. No password changes hands.', done: ticked('delegate'), who: 'either', manual: 'delegate' },
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
                      Show me how
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
          Steps from X&rsquo;s help page,{' '}
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
