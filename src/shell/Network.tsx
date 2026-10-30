import { useCallback, useEffect, useState } from 'react';
import { bil } from '../lib/team';
import { supabase } from '../lib/supabase';
import type { Workspace } from './data';

// Networking: the client's Network list (mutuals and viral pages in their niche) on the
// inspiration board, and the networking lane on the Schedule. Bil reads the list only when
// someone taps Find quotes now, never on a timer, and writes quotes for this one client.

type Account = { id: string; handle: string; kind: 'mutual' | 'viral' };
type Quote = { id: string; postId: string; handle: string | null; excerpt: string | null; draft: string; why: string | null; status: 'ready' | 'quoted' | 'skipped'; createdAt: string };

function useNetwork(clientId: string) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from('network_accounts').select('id, handle, kind').eq('client_id', clientId).order('created_at');
    setAccounts((data ?? []) as Account[]);
  }, [clientId]);
  useEffect(() => {
    setAccounts(null);
    void load();
  }, [load]);
  return { accounts, load };
}

/** The Network list, on the inspiration board. */
export function NetworkList({ clientId }: { clientId: string }) {
  const { accounts, load } = useNetwork(clientId);
  const [handle, setHandle] = useState('');
  const [kind, setKind] = useState<'mutual' | 'viral'>('mutual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function change(c: { add?: { handle: string; kind: 'mutual' | 'viral' }; remove?: string }) {
    setBusy(true);
    setError('');
    try {
      await bil.networkSet(clientId, c);
      if (c.add) setHandle('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bl-glass-card bl-network" aria-labelledby="net-t">
      <b id="net-t">Network</b>
      <span className="bl-small">
        Best results: add your mutuals and the viral pages in your niche. Quoting them checks in on friends, adds real weight to your page, and often earns some back. At the very least, it is more visibility.
      </span>
      <span className="bl-small">Bil reads these accounts only when you tap Find quotes now on the Schedule&rsquo;s Networking lane.</span>
      <form
        className="bl-network-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (handle.trim()) void change({ add: { handle: handle.trim(), kind } });
        }}
      >
        <label className="bl-sr" htmlFor="net-handle">
          X handle
        </label>
        <input id="net-handle" className="bl-input" placeholder="@handle" value={handle} maxLength={16} onChange={(e) => setHandle(e.target.value)} />
        <label className="bl-sr" htmlFor="net-kind">
          Kind
        </label>
        <select id="net-kind" className="bl-input" value={kind} onChange={(e) => setKind(e.target.value as 'mutual' | 'viral')}>
          <option value="mutual">Mutual</option>
          <option value="viral">Viral in my niche</option>
        </select>
        <button type="submit" className="bl-btn" disabled={busy || !handle.trim() || (accounts?.length ?? 0) >= 20}>
          Add
        </button>
      </form>
      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}
      {accounts === null ? (
        <span className="bl-small" aria-busy="true">
          Loading.
        </span>
      ) : accounts.length === 0 ? (
        <span className="bl-small">No accounts yet. Up to 20.</span>
      ) : (
        <ul className="bl-network-list">
          {accounts.map((a) => (
            <li key={a.id}>
              <span>
                <b>@{a.handle}</b> <span className="bl-small">{a.kind === 'mutual' ? 'Mutual' : 'Viral in your niche'}</span>
              </span>
              <button type="button" className="bl-ghost" disabled={busy} aria-label={`Remove @${a.handle}`} onClick={() => void change({ remove: a.id })}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="bl-small num">{accounts?.length ?? 0} of 20</span>
    </section>
  );
}

/** Bil's suggested networking windows: the client's two best times of day, from What works. */
function windowsFor(ws: Workspace, clientId: string): string[] {
  const card = ws.voices.find((v) => v.clientId === clientId)?.card as { whatWorks?: { stats?: { groups?: Array<{ label: string; posts: number; medianScorePer1k: number | null }> } } } | undefined;
  const groups = (card?.whatWorks?.stats?.groups ?? []).filter((g) => /posted in the/.test(g.label) && g.medianScorePer1k !== null && g.posts >= 2);
  const best = groups.sort((a, b) => (b.medianScorePer1k ?? 0) - (a.medianScorePer1k ?? 0)).slice(0, 2).map((g) => g.label.replace(/^posted in the /, ''));
  return best.length ? best : ['morning', 'evening'];
}

/** The networking lane: Bil's rhythm, Find quotes now, and the quote drafts. */
export function NetworkLane({ ws, clientId, go }: { ws: Workspace; clientId: string; go: (p: string) => void }) {
  const { accounts } = useNetwork(clientId);
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [links, setLinks] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('quote_drafts')
      .select('id, post_id, handle, excerpt, draft, why, status, created_at')
      .eq('client_id', clientId)
      .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(30);
    setQuotes((data ?? []).map((r) => ({ id: r.id, postId: r.post_id, handle: r.handle, excerpt: r.excerpt, draft: r.draft, why: r.why, status: r.status, createdAt: r.created_at })));
  }, [clientId]);
  useEffect(() => {
    setQuotes(null);
    void load();
  }, [load]);

  const windows = windowsFor(ws, clientId);
  const quotedToday = (quotes ?? []).filter((q) => q.status === 'quoted' && Date.now() - Date.parse(q.createdAt) < 86_400_000).length;

  async function find() {
    setBusy('find');
    setError('');
    setNote('');
    try {
      const r = await bil.quotesFind(clientId);
      setNote(r.drafts ? `Bil read ${r.postsRead} posts from your list and wrote ${r.drafts} ${r.drafts === 1 ? 'quote' : 'quotes'}. $${r.allowanceLeft.toFixed(2)} left of this month's quote allowance.` : `Bil read ${r.postsRead} posts and found nothing worth quoting right now. Try again in your next window.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bil could not look right now.');
    } finally {
      setBusy(null);
    }
  }
  async function decide(q: Quote, decision: 'quoted' | 'skipped') {
    setBusy(q.id);
    setError('');
    try {
      await bil.quoteDecide(clientId, q.id, decision, decision === 'quoted' ? links[q.id]?.trim() || undefined : undefined);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy(null);
    }
  }
  async function copy(q: Quote) {
    try {
      await navigator.clipboard.writeText(q.draft);
      setCopied(q.id);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setError('Copy did not work here. Select the text and copy it.');
    }
  }

  return (
    <div className="bl-network-lane">
      <section className="bl-glass-card bl-network">
        <b>Networking</b>
        <span className="bl-small">
          Bil&rsquo;s rhythm for you: 2 quote windows a day, in the {windows.join(' and the ')}, when your audience is most active. At most 3 quotes a day. {quotedToday ? `${quotedToday} quoted today.` : ''}
        </span>
        {accounts && accounts.length === 0 ? (
          <button type="button" className="bl-btn bl-start" onClick={() => go('board')}>
            Add your Network first
          </button>
        ) : (
          <button type="button" className="bl-btn bl-start" disabled={busy !== null || !accounts} onClick={() => void find()}>
            {busy === 'find' ? 'Bil is reading your list' : 'Find quotes now'}
          </button>
        )}
        <span className="bl-small">Each tap reads your Network list once (about 15 cents, from a $3 monthly quote allowance). You post every quote yourself.</span>
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
      </section>

      {quotes === null ? (
        <span className="bl-small" aria-busy="true">
          Loading quotes.
        </span>
      ) : (
        <ol className="bl-quote-list">
          {quotes
            .filter((q) => q.status === 'ready')
            .map((q) => (
              <li key={q.id} className="bl-glass-card bl-postcard">
                <span className="bl-label">Quote{q.handle ? ` @${q.handle}` : ''}</span>
                {q.excerpt && <p className="bl-small bl-quote-orig">&ldquo;{q.excerpt}&rdquo;</p>}
                <p className="bl-postcard-text">{q.draft}</p>
                {q.why && <span className="bl-small">{q.why}</span>}
                <div className="bl-row-actions">
                  <button type="button" className="bl-ghost" onClick={() => void copy(q)}>
                    {copied === q.id ? 'Copied' : 'Copy'}
                  </button>
                  <a className="bl-ghost" href={`https://x.com/i/status/${q.postId}`} target="_blank" rel="noopener noreferrer">
                    Open the post on X
                  </a>
                </div>
                <label className="bl-label" htmlFor={`ql-${q.id}`}>
                  Link to your quote (optional)
                </label>
                <input id={`ql-${q.id}`} className="bl-input" type="url" placeholder="https://x.com/you/status/..." value={links[q.id] ?? ''} onChange={(e) => setLinks({ ...links, [q.id]: e.target.value })} />
                <div className="bl-row-actions">
                  <button type="button" className="bl-btn" disabled={busy !== null} onClick={() => void decide(q, 'quoted')}>
                    Quoted it
                  </button>
                  <button type="button" className="bl-ghost" disabled={busy !== null} onClick={() => void decide(q, 'skipped')}>
                    Skip
                  </button>
                </div>
              </li>
            ))}
          {quotes.filter((q) => q.status === 'ready').length === 0 && <li className="bl-small">No quotes waiting. Tap Find quotes now in your next window.</li>}
        </ol>
      )}
    </div>
  );
}
