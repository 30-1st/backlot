import { useCallback, useEffect, useState } from 'react';
import { bil } from '../lib/team';
import { supabase } from '../lib/supabase';
import type { Me } from '../lib/team';
import { Working } from './Working';

// Game Plan: who the client sells to, who their content appeals to, their products and goals,
// free to edit any time. Rein reads it in every Opportunity Meeting for this client (the
// meeting itself moved to Rein, in the Playground, on Nov 2, 2026; clients also edit these
// answers there, one question at a time).

type Product = { name: string; note: string };
type Plan = { sellsTo: string; appealsTo: string; products: Product[]; goals: string };
const EMPTY: Plan = { sellsTo: '', appealsTo: '', products: [], goals: '' };

export function GamePlanPanel({ clientId }: { clientId: string; me?: Me }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [draft, setDraft] = useState<Plan>(EMPTY);
  const [busy, setBusy] = useState<'save' | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    const p = await supabase.from('game_plans').select('sells_to, appeals_to, products, goals').eq('client_id', clientId).maybeSingle();
    const got: Plan = p.data
      ? { sellsTo: p.data.sells_to ?? '', appealsTo: p.data.appeals_to ?? '', products: (p.data.products as Product[]) ?? [], goals: p.data.goals ?? '' }
      : EMPTY;
    setPlan(got);
    setDraft(got);
  }, [clientId]);

  useEffect(() => {
    setPlan(null);
    void load();
  }, [load]);

  const dirty = JSON.stringify(plan) !== JSON.stringify(draft);

  async function save() {
    setBusy('save');
    setError('');
    try {
      await bil.gamePlanSave(clientId, { ...draft, products: draft.products.filter((p) => p.name.trim()) });
      setNote('Saved. Rein reads it in every Opportunity Meeting, and Bil in every campaign.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
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
        <span className="bl-small">Free to change any time. Rein reads it in every Opportunity Meeting, and Bil in every campaign.</span>
        {plan === null ? (
          <Working label="Loading" />
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
    </>
  );
}
