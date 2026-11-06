import { useEffect, useState } from 'react';
import { bil, type Product, type ProductKind } from '../lib/team';
import { listLibrary, type LibraryItem } from '../lib/clientMedia';
import { PostMedia } from './PostMedia';
import type { ScreenProps } from './Shell';

// Products (approved Nov 6, 2026): what the client sells, in a shape every agent reads the
// same way. Bil names them in posts, Xev sells from them, the public page points to them, and
// none of them ever invents one. Add them one at a time, or paste a whole list (a menu, a
// price list, rows from a spreadsheet, the text of a link-in-bio page) and Bil turns it into
// products to check before anything is saved. Nothing is fetched from the web.

const KINDS: Array<[ProductKind, string]> = [
  ['product', 'Product'],
  ['digital', 'Digital'],
  ['subscription', 'Subscription'],
  ['service', 'Service'],
  ['booking', 'Booking'],
  ['tip', 'Tip or send'],
  ['bundle', 'Bundle'],
  ['other', 'Other'],
];
const kindWord = (k?: string) => KINDS.find(([v]) => v === k)?.[1] ?? 'Product';
const blank = (): Product => ({ name: '', kind: 'product', what: '' });

export function ProductsScreen({ ws, single, isTeam }: ScreenProps) {
  const client = ws.data?.clients.find((c) => c.id === single) ?? null;
  const saved: Product[] = Array.isArray(client?.profile?.offers) ? (client!.profile.offers as Product[]) : [];
  const [list, setList] = useState<Product[]>(saved);
  const [open, setOpen] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<LibraryItem[] | null>(null);

  useEffect(() => {
    setList(saved);
    setOpen(null);
    if (client) listLibrary(client.id).then((f) => setFiles(f.filter((x) => !x.removedAt && x.status !== 'retired')), () => setFiles([]));
  }, [client?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ws.data) return <main aria-busy="true" />;
  if (!client) {
    return (
      <main className="bl-flow">
        <h1 className="bl-h1 bl-rise">Products</h1>
        <p className="bl-p bl-muted">Pick a client first.</p>
      </main>
    );
  }

  const dirty = JSON.stringify(list) !== JSON.stringify(saved);
  const set = (i: number, patch: Partial<Product>) => setList(list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const bad = list.findIndex((p) => !p.name.trim() || !p.what.trim() || (p.link && !/^https:\/\/[^\s/]+\.[^\s]+$/.test(p.link)) || (p.deal?.code && !/^[A-Za-z0-9_-]{3,24}$/.test(p.deal.code)));

  async function save() {
    setBusy(true);
    setError('');
    setNote('');
    try {
      const clean = list.map((p) => {
        const deal = p.deal && (p.deal.code?.trim() || p.deal.note?.trim()) ? { ...(p.deal.code?.trim() ? { code: p.deal.code.trim() } : {}), ...(p.deal.note?.trim() ? { note: p.deal.note.trim() } : {}), ...(p.deal.ends ? { ends: p.deal.ends } : {}) } : undefined;
        return {
          name: p.name.trim(),
          kind: p.kind ?? 'product',
          what: p.what.trim(),
          ...(p.price?.trim() ? { price: p.price.trim() } : {}),
          ...(p.forWho?.trim() ? { forWho: p.forWho.trim() } : {}),
          ...(p.link?.trim() ? { link: p.link.trim() } : {}),
          ...(deal ? { deal } : {}),
          ...(p.mediaId ? { mediaId: p.mediaId } : {}),
        };
      });
      const r = await bil.productsSave(client!.id, clean);
      await ws.refresh();
      setList(r.products);
      setOpen(null);
      setNote(r.leftOff.length ? `Saved. ${r.leftOff.join(', ')} kept no link: there are already 12 approved links. Remove one in the brand kit to add more.` : 'Saved. Bil, Xev and the public page use these now.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the products.');
    } finally {
      setBusy(false);
    }
  }

  if (importing) {
    return (
      <Importer
        clientId={client.id}
        onBack={() => setImporting(false)}
        onAdd={(found) => {
          const names = new Set(list.map((p) => p.name.toLowerCase()));
          setList([...list, ...found.filter((p) => !names.has(p.name.toLowerCase()))].slice(0, 30));
          setImporting(false);
          setNote('Added below. Check them, then Save.');
        }}
      />
    );
  }

  return (
    <main className="bl-flow bl-wide">
      <div className="bl-sched-top">
        <h1 className="bl-h1 bl-rise">Products</h1>
        <span className="bl-row-actions">
          <button type="button" className="bl-ghost" onClick={() => setImporting(true)}>
            Import a list
          </button>
          <button
            type="button"
            className="bl-ghost"
            disabled={list.length >= 30}
            onClick={() => {
              setList([...list, blank()]);
              setOpen(list.length);
            }}
          >
            Add one
          </button>
        </span>
      </div>
      <p className="bl-p bl-muted" style={{ margin: '-6px 0 0' }}>
        What {isTeam ? `@${client.handle} sells` : 'you sell'}. Bil names these in posts, Xev sells from them, and nobody makes one up.
      </p>

      {list.length === 0 ? (
        <section className="bl-cmd-card">
          <b>No products yet</b>
          <span className="bl-small">Paste your menu, price list or link-in-bio text into Import a list, and Bil sorts it out.</span>
        </section>
      ) : (
        <ul className="bl-prods">
          {list.map((p, i) => (
            <li key={i} className="bl-cmd-card">
              <button type="button" className="bl-prod-head" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                <span className="bl-wk-thumb" aria-hidden="true">
                  {p.mediaId ? <PostMedia id={p.mediaId} size="thumb" /> : <span className="bl-pm thumb text">{(p.name || '?').slice(0, 1).toUpperCase()}</span>}
                </span>
                <span className="bl-wk-text">
                  <b>{kindWord(p.kind)}</b>
                  <span>
                    {p.name || 'New product'}
                    {p.price ? ` · ${p.price}` : ''}
                  </span>
                </span>
                {p.deal?.note || p.deal?.code ? <span className="bl-chip approved">Deal</span> : null}
              </button>
              {open === i && (
                <div className="bl-prod-body">
                  <label className="bl-label">
                    Name
                    <input className="bl-input" maxLength={60} value={p.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="e.g. Monthly subscription" />
                  </label>
                  <label className="bl-label">
                    Kind
                    <select className="bl-input" value={p.kind ?? 'product'} onChange={(e) => set(i, { kind: e.target.value as ProductKind })}>
                      {KINDS.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="bl-label">
                    What is included
                    <textarea className="bl-input" rows={2} maxLength={300} value={p.what} onChange={(e) => set(i, { what: e.target.value })} />
                  </label>
                  <div className="bl-prod-row">
                    <label className="bl-label">
                      Price, as you say it
                      <input className="bl-input" maxLength={40} value={p.price ?? ''} onChange={(e) => set(i, { price: e.target.value })} placeholder="$15 a month" />
                    </label>
                    <label className="bl-label">
                      Who it suits
                      <input className="bl-input" maxLength={120} value={p.forWho ?? ''} onChange={(e) => set(i, { forWho: e.target.value })} placeholder="first-timers" />
                    </label>
                  </div>
                  <label className="bl-label">
                    Link (https)
                    <input className="bl-input" type="url" maxLength={500} value={p.link ?? ''} onChange={(e) => set(i, { link: e.target.value })} placeholder="https://" />
                  </label>
                  <div className="bl-prod-row">
                    <label className="bl-label">
                      Deal
                      <input className="bl-input" maxLength={80} value={p.deal?.note ?? ''} onChange={(e) => set(i, { deal: { ...p.deal, note: e.target.value } })} placeholder="20% off the first month" />
                    </label>
                    <label className="bl-label">
                      Code
                      <input className="bl-input" maxLength={24} value={p.deal?.code ?? ''} onChange={(e) => set(i, { deal: { ...p.deal, code: e.target.value } })} />
                    </label>
                    <label className="bl-label">
                      Ends
                      <input className="bl-input" type="date" value={p.deal?.ends ?? ''} onChange={(e) => set(i, { deal: { ...p.deal, ends: e.target.value || undefined } })} />
                    </label>
                  </div>
                  <span className="bl-label">Photo from Media</span>
                  {files && files.length > 0 ? (
                    <ul className="bl-upn-grid small">
                      {files.slice(0, 24).map((f) => (
                        <li key={f.id}>
                          <button type="button" className={`bl-upn-tile${p.mediaId === f.id ? ' on' : ''}`} aria-pressed={p.mediaId === f.id} aria-label={f.tags.join(', ') || f.kind} onClick={() => set(i, { mediaId: p.mediaId === f.id ? undefined : f.id })}>
                            <PostMedia id={f.id} size="thumb" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="bl-small">Add photos in Media to pick one here.</span>
                  )}
                  <button type="button" className="bl-linkish" style={{ alignSelf: 'flex-start' }} onClick={() => { setList(list.filter((_, j) => j !== i)); setOpen(null); }}>
                    Remove this product
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {bad >= 0 && dirty && <p className="bl-small">Each product needs a name and what is included; links start with https, and codes use letters and numbers.</p>}
      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}
      {note && (
        <p className="bl-small" role="status">
          {note}
        </p>
      )}
      <div className="bl-row-actions">
        <button type="button" className="bl-btn" disabled={busy || !dirty || bad >= 0} onClick={() => void save()}>
          {busy ? 'Saving' : 'Save products'}
        </button>
        {dirty && (
          <button type="button" className="bl-ghost" onClick={() => setList(saved)}>
            Undo changes
          </button>
        )}
      </div>
    </main>
  );
}

/** Paste a list; Bil turns it into products to check. Nothing is saved here. */
function Importer({ clientId, onBack, onAdd }: { clientId: string; onBack: () => void; onAdd: (p: Product[]) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [found, setFound] = useState<{ products: Product[]; unclear: string[] } | null>(null);
  const [keep, setKeep] = useState<Set<number>>(new Set());

  async function read() {
    setBusy(true);
    setError('');
    try {
      const r = await bil.productsParse(clientId, text);
      setFound({ products: r.products ?? [], unclear: r.unclear ?? [] });
      setKeep(new Set((r.products ?? []).map((_, i) => i)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bil could not read that.');
    } finally {
      setBusy(false);
    }
  }

  async function fromFile(f: File) {
    if (f.size > 200_000) return setError('That file is too big. Paste the list instead.');
    setText((await f.text()).slice(0, 8000));
  }

  return (
    <main className="bl-flow bl-wide">
      <button type="button" className="bl-linkish" style={{ alignSelf: 'flex-start' }} onClick={onBack}>
        ‹ Back to Products
      </button>
      <h1 className="bl-h1 bl-rise">Import a list</h1>
      {!found ? (
        <>
          <p className="bl-p bl-muted" style={{ margin: '-6px 0 0' }}>
            Paste anything that lists what you sell: a menu, a price list, rows from a spreadsheet, or the text of your link-in-bio page. Bil turns it into products for you to check. Nothing is saved yet.
          </p>
          <textarea className="bl-input" rows={10} maxLength={8000} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Custom video, 5 minutes, $40\nMonthly fan club, $12 a month, 20% off first month with code NEW20 until Dec 31\nCoffee send, $5'} />
          <label className="bl-linkish" style={{ alignSelf: 'flex-start', cursor: 'pointer' }}>
            Or load a CSV or text file
            <input type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={(e) => e.target.files?.[0] && void fromFile(e.target.files[0])} />
          </label>
          {error && (
            <p className="bl-error" role="alert">
              {error}
            </p>
          )}
          <div className="bl-row-actions">
            <button type="button" className="bl-btn" disabled={busy || text.trim().length < 3} onClick={() => void read()}>
              {busy ? 'Bil is reading it' : 'Read it'}
            </button>
            <span className="bl-small">About a third of a cent.</span>
          </div>
        </>
      ) : (
        <>
          <p className="bl-p bl-muted" style={{ margin: '-6px 0 0' }}>
            Bil found {found.products.length} {found.products.length === 1 ? 'product' : 'products'}. Untick any that are wrong; you can edit the rest after.
          </p>
          <ul className="bl-prods">
            {found.products.map((p, i) => (
              <li key={i} className="bl-cmd-card">
                <label className="bl-check-line">
                  <input
                    type="checkbox"
                    checked={keep.has(i)}
                    onChange={(e) => {
                      const k = new Set(keep);
                      if (e.target.checked) k.add(i);
                      else k.delete(i);
                      setKeep(k);
                    }}
                  />
                  <span>
                    <b>{p.name}</b> <span className="bl-small">· {kindWord(p.kind)}{p.price ? ` · ${p.price}` : ''}</span>
                    <br />
                    <span className="bl-small">
                      {p.what}
                      {p.deal?.note ? ` · Deal: ${p.deal.note}` : ''}
                      {p.deal?.code ? ` · Code ${p.deal.code}` : ''}
                      {p.deal?.ends ? ` · until ${p.deal.ends}` : ''}
                      {p.link ? ` · ${p.link}` : ''}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {found.unclear.length > 0 && (
            <p className="bl-small">
              Bil could not place: {found.unclear.join('; ')}. Add those by hand if they are products.
            </p>
          )}
          <div className="bl-row-actions">
            <button type="button" className="bl-btn" disabled={keep.size === 0} onClick={() => onAdd(found.products.filter((_, i) => keep.has(i)))}>
              Add {keep.size} to Products
            </button>
            <button type="button" className="bl-ghost" onClick={() => setFound(null)}>
              Paste again
            </button>
          </div>
        </>
      )}
    </main>
  );
}
