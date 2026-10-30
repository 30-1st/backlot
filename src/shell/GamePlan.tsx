import { useCallback, useEffect, useState } from 'react';
import { bil } from '../lib/team';
import { supabase } from '../lib/supabase';
import type { Me } from '../lib/team';

// Game Plan: who the client sells to, who their content appeals to, their products and goals
// (free to edit, any time), and Bil's opportunity meeting, which is what the client pays for:
// one free every 14 days, more by request, run by the executive until payments open.

type Product = { name: string; note: string };
type Plan = { sellsTo: string; appealsTo: string; products: Product[]; goals: string };
type Meeting = {
  id: string;
  kind: 'free' | 'extra';
  status: 'requested' | 'ready' | 'failed' | 'declined';
  createdAt: string;
  readyAt: string | null;
  meeting: {
    headline: string;
    history: string[];
    now: string[];
    moves: Array<{ move: string; why: string }>;
    audience: string;
    reception: { performs: string; flops: string };
  } | null;
};

const EMPTY: Plan = { sellsTo: '', appealsTo: '', products: [], goals: '' };
const FREE_DAYS = 14;

export function GamePlanPanel({ clientId, me }: { clientId: string; me: Me }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [draft, setDraft] = useState<Plan>(EMPTY);
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [busy, setBusy] = useState<'save' | 'meet' | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const isOwner = me.role === 'owner';

  const load = useCallback(async () => {
    if (!supabase) return;
    const [p, m] = await Promise.all([
      supabase.from('game_plans').select('sells_to, appeals_to, products, goals').eq('client_id', clientId).maybeSingle(),
      supabase.from('game_plan_meetings').select('id, kind, status, created_at, ready_at, meeting').eq('client_id', clientId).order('created_at', { ascending: false }).limit(10),
    ]);
    const got: Plan = p.data
      ? { sellsTo: p.data.sells_to ?? '', appealsTo: p.data.appeals_to ?? '', products: (p.data.products as Product[]) ?? [], goals: p.data.goals ?? '' }
      : EMPTY;
    setPlan(got);
    setDraft(got);
    setMeetings(
      (m.data ?? []).map((r) => ({ id: r.id, kind: r.kind, status: r.status, createdAt: r.created_at, readyAt: r.ready_at, meeting: r.meeting as Meeting['meeting'] })),
    );
  }, [clientId]);

  useEffect(() => {
    setPlan(null);
    setMeetings(null);
    void load();
  }, [load]);

  const lastFree = (meetings ?? []).find((x) => x.kind === 'free' && x.status === 'ready');
  const freeAgainAt = lastFree ? Date.parse(lastFree.createdAt) + FREE_DAYS * 86_400_000 : 0;
  const freeNow = !lastFree || Date.now() >= freeAgainAt;
  const requested = (meetings ?? []).filter((x) => x.status === 'requested');
  const latest = (meetings ?? []).find((x) => x.status === 'ready');
  const dirty = JSON.stringify(plan) !== JSON.stringify(draft);

  async function save() {
    setBusy('save');
    setError('');
    try {
      await bil.gamePlanSave(clientId, { ...draft, products: draft.products.filter((p) => p.name.trim()) });
      setNote('Saved. Bil uses it in your next meeting and campaign.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(null);
    }
  }
  async function meet(runRequest?: string) {
    setBusy('meet');
    setError('');
    setNote('');
    try {
      if (dirty) await bil.gamePlanSave(clientId, { ...draft, products: draft.products.filter((p) => p.name.trim()) });
      const r = await bil.gamePlanMeeting(clientId, runRequest);
      if ('requested' in r && r.requested) setNote(r.already ? 'Your request is already with the executive.' : 'Requested. The executive runs extra meetings, and you will see it here when it is ready.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bil could not meet right now.');
    } finally {
      setBusy(null);
    }
  }

  const setProduct = (i: number, p: Partial<Product>) => setDraft((d) => ({ ...d, products: d.products.map((x, k) => (k === i ? { ...x, ...p } : x)) }));

  return (
    <>
      <section className="bl-card bl-rise" aria-labelledby="gp-in">
        <h2 id="gp-in" className="bl-h2">
          Your plan
        </h2>
        <span className="bl-small">Free to change any time. Bil reads it in every meeting and campaign.</span>
        {plan === null ? (
          <span className="bl-small" aria-busy="true">
            Loading.
          </span>
        ) : (
          <form
            className="bl-gp-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label className="bl-field">
              <span className="bl-label">Who you sell to</span>
              <textarea className="bl-input" rows={2} maxLength={1000} value={draft.sellsTo} onChange={(e) => setDraft({ ...draft, sellsTo: e.target.value })} placeholder="[The people who buy from you]" />
            </label>
            <label className="bl-field">
              <span className="bl-label">Who your content appeals to</span>
              <textarea className="bl-input" rows={2} maxLength={1000} value={draft.appealsTo} onChange={(e) => setDraft({ ...draft, appealsTo: e.target.value })} placeholder="[The people who follow and engage]" />
            </label>
            <fieldset className="bl-gp-products">
              <legend className="bl-label">What you sell</legend>
              {draft.products.map((p, i) => (
                <div key={i} className="bl-gp-product">
                  <label className="bl-sr" htmlFor={`gp-p-${i}`}>
                    Product {i + 1}
                  </label>
                  <input id={`gp-p-${i}`} className="bl-input" maxLength={80} value={p.name} onChange={(e) => setProduct(i, { name: e.target.value })} placeholder="[Product]" />
                  <label className="bl-sr" htmlFor={`gp-n-${i}`}>
                    Note for product {i + 1}
                  </label>
                  <input id={`gp-n-${i}`} className="bl-input" maxLength={200} value={p.note} onChange={(e) => setProduct(i, { note: e.target.value })} placeholder="[Price, who it is for]" />
                  <button type="button" className="bl-ghost" aria-label={`Remove product ${i + 1}`} onClick={() => setDraft((d) => ({ ...d, products: d.products.filter((_, k) => k !== i) }))}>
                    Remove
                  </button>
                </div>
              ))}
              {draft.products.length < 20 && (
                <button type="button" className="bl-ghost bl-start" onClick={() => setDraft((d) => ({ ...d, products: [...d.products, { name: '', note: '' }] }))}>
                  Add a product
                </button>
              )}
            </fieldset>
            <label className="bl-field">
              <span className="bl-label">Your goals</span>
              <textarea className="bl-input" rows={2} maxLength={1000} value={draft.goals} onChange={(e) => setDraft({ ...draft, goals: e.target.value })} placeholder="[What you want in the next 1 to 3 months]" />
            </label>
            <button type="submit" className="bl-ghost bl-start" disabled={!dirty || busy !== null}>
              {busy === 'save' ? 'Saving' : 'Save the plan'}
            </button>
          </form>
        )}
      </section>

      <section className="bl-card bl-rise" aria-labelledby="gp-meet">
        <h2 id="gp-meet" className="bl-h2">
          Opportunity meeting with Bil
        </h2>
        <span className="bl-small">
          {freeNow
            ? 'Your free meeting is ready to book. Bil goes through what has worked for you, what is working in your niche now, and how to get in on it.'
            : `Your next free meeting opens ${new Date(freeAgainAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}. ${isOwner ? 'You can run an extra one now.' : 'You can request an extra one, and the executive runs it.'}`}
        </span>
        <button type="button" className="bl-btn bl-start" disabled={busy !== null || plan === null} onClick={() => void meet()}>
          {busy === 'meet' ? 'Bil is preparing, about a minute' : freeNow ? 'Meet with Bil' : isOwner ? 'Run an extra meeting' : 'Request an extra meeting'}
        </button>
        {isOwner &&
          requested.map((r) => (
            <div key={r.id} className="bl-wash" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="bl-small">Extra meeting requested {new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.</span>
              <button type="button" className="bl-btn" disabled={busy !== null} onClick={() => void meet(r.id)}>
                Run it
              </button>
            </div>
          ))}
        {!isOwner && requested.length > 0 && <span className="bl-small">An extra meeting is requested and waiting on the executive.</span>}
        {note && (
          <p className="bl-small" role="status">
            {note}
          </p>
        )}
        {error && (
          <p className="bl-error" role="alert">
            {error}
          </p>
        )}
        {latest?.meeting && <MeetingView m={latest.meeting} at={latest.readyAt ?? latest.createdAt} />}
      </section>
    </>
  );
}

function MeetingView({ m, at }: { m: NonNullable<Meeting['meeting']>; at: string }) {
  return (
    <article className="bl-gp-meeting">
      <span className="bl-label">Latest meeting, {new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
      <p className="bl-p" style={{ margin: 0, fontWeight: 600 }}>
        {m.headline}
      </p>
      {m.history.length > 0 && (
        <div>
          <b>What has worked for you</b>
          <ul className="bl-report-list">{m.history.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      {m.now.length > 0 && (
        <div>
          <b>What is working now</b>
          <ul className="bl-report-list">{m.now.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      <div>
        <b>How to get in on it</b>
        <ol className="bl-report-list">
          {m.moves.map((x, i) => (
            <li key={i}>
              {x.move} <span className="bl-small">{x.why}</span>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <b>Audience (an estimate)</b>
        <p className="bl-small" style={{ margin: 0 }}>{m.audience}</p>
      </div>
      <div>
        <b>How content lands</b>
        <p className="bl-small" style={{ margin: 0 }}>Performs: {m.reception.performs}</p>
        <p className="bl-small" style={{ margin: 0 }}>Falls flat: {m.reception.flops}</p>
      </div>
    </article>
  );
}
