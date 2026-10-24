import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { team } from '../lib/team';
import { PostMedia } from './PostMedia';
import { ARCHETYPES, type Archetype } from '../lib/archetypes';
import type { ScreenProps } from './Shell';

// A client's room (K1): the page their audience opens from a bio link or an auto-reply,
// hosted on its own site apart from Backlot. The team sets it up; the client can open
// its preview. Every field is checked again on the server (room_set).

const ROOMS_URL = 'https://backlot-rooms.pages.dev';

type Status = 'draft' | 'preview' | 'open' | 'closed';
type Button = { label: string; link: number };
type Room = { slug: string; status: Status; preset: Archetype; accent: string; greeting: string; buttons: Button[]; heroId: string | null; heroClean: boolean; chatOn: boolean };
type Media = { id: string; kind: 'photo' | 'video'; note: string | null; tags: string[] };

const STATUS: Array<[Status, string, string]> = [
  ['draft', 'Draft', 'Only the team sees it here.'],
  ['preview', 'Preview', 'Opens only with a preview link.'],
  ['open', 'Open', 'Anyone with the address can visit.'],
  ['closed', 'Closed', 'Visitors see that the room is not open.'],
];

const slugFrom = (handle: string) => handle.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30);

export function RoomScreen({ ws, single, isTeam }: ScreenProps) {
  const client = ws.data?.clients.find((c) => c.id === single) ?? null;
  const profile = (client?.profile ?? {}) as { adultContent?: boolean; links?: Array<{ label: string; url: string }>; displayName?: string };
  const adult = Boolean(profile.adultContent);
  const links = useMemo(() => (Array.isArray(profile.links) ? profile.links : []), [profile.links]);

  const [room, setRoom] = useState<Room | null>(null);
  const [saved, setSaved] = useState<Room | null>(null);
  const [media, setMedia] = useState<Media[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<{ url: string; expiresAt: string } | null>(null);

  useEffect(() => {
    if (!supabase || !client) return;
    setRoom(null);
    setSaved(null);
    setPreview(null);
    setError('');
    setNote('');
    void (async () => {
      const [r, m] = await Promise.all([
        supabase!.from('rooms').select('slug, status, preset, accent, greeting, buttons, hero_id, hero_clean_by, chat_on').eq('client_id', client.id).maybeSingle(),
        supabase!.from('library_items').select('id, kind, note, tags').eq('client_id', client.id).eq('kris_ok', true).neq('status', 'retired').is('removed_at', null).order('created_at', { ascending: false }).limit(30),
      ]);
      if (r.error) return setError(r.error.message);
      const start: Room = r.data
        ? { slug: r.data.slug, status: r.data.status, preset: r.data.preset, accent: r.data.accent, greeting: r.data.greeting, buttons: Array.isArray(r.data.buttons) ? r.data.buttons : [], heroId: r.data.hero_id, heroClean: Boolean(r.data.hero_clean_by), chatOn: Boolean(r.data.chat_on) }
        : { slug: slugFrom(client.handle), status: 'draft', preset: adult ? 'ruler' : 'creator', accent: adult ? '#d8b98a' : '#5b4bff', greeting: '', buttons: [], heroId: null, heroClean: false, chatOn: false };
      setRoom(start);
      setSaved(r.data ? start : null);
      setMedia((m.data ?? []) as Media[]);
    })();
  }, [client?.id, adult]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!client) {
    return (
      <main className="bl-flow">
        <h1 className="bl-h1 bl-rise">Room</h1>
        <p className="bl-p bl-muted">Pick a client first.</p>
      </main>
    );
  }
  if (!room) {
    return error ? (
      <main className="bl-flow">
        <h1 className="bl-h1 bl-rise">Room</h1>
        <p className="bl-error" role="alert">
          {error}
        </p>
      </main>
    ) : (
      <main className="bl-flow" aria-busy="true" />
    );
  }

  const set = (patch: Partial<Room>) => setRoom((r) => (r ? { ...r, ...patch } : r));
  const changed = JSON.stringify(room) !== JSON.stringify(saved);
  const publicUrl = `${ROOMS_URL}/k/${saved?.slug ?? room.slug}`;
  const buttonsOk = room.buttons.every((b) => b.label.trim() && links[b.link]);
  // In an adult room, a newly picked file needs the team's word that it is not explicit.
  const needsClean = adult && !!room.heroId && !(saved && saved.heroId === room.heroId && saved.heroClean);
  const cleanOk = !needsClean || room.heroClean;

  async function save() {
    if (!supabase) return;
    setBusy(true);
    setError('');
    setNote('');
    const { error: e } = await supabase.rpc('room_set', {
      p_client: client!.id,
      p_slug: room!.slug.trim().toLowerCase(),
      p_status: room!.status,
      p_preset: room!.preset,
      p_accent: room!.accent.toLowerCase(),
      p_greeting: room!.greeting.trim(),
      p_buttons: room!.buttons.map((b) => ({ label: b.label.trim(), link: b.link })),
      p_hero: room!.heroId,
      p_hero_clean: needsClean ? room!.heroClean : false,
      p_chat_on: room!.chatOn,
    });
    setBusy(false);
    if (e) return setError(e.message);
    const now = { ...room!, slug: room!.slug.trim().toLowerCase(), accent: room!.accent.toLowerCase(), greeting: room!.greeting.trim() };
    setRoom(now);
    setSaved(now);
    setNote(now.status === 'open' ? 'Saved. The room is open to anyone with its address.' : 'Saved.');
  }

  async function makePreview() {
    setError('');
    try {
      setPreview(await team.roomPreview(client!.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make a preview link.');
    }
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNote(`${what} copied.`);
    } catch {
      setNote('Copying is blocked here. Press and hold the link to copy it.');
    }
  }

  return (
    <main className="bl-flow bl-brand">
      <div>
        <h1 className="bl-h1 bl-rise">Room</h1>
        <p className="bl-small" style={{ margin: '6px 0 0' }}>
          @{client.handle}&rsquo;s page for their audience, on its own site, where Kris hosts and answers. Visitors never see her name, only that it is the client's AI assistant.
        </p>
      </div>

      {saved && (
        <section className="bl-glass-card bl-brand-group" aria-label="Links to the room">
          {saved.status === 'open' ? (
            <>
              <span className="bl-label">Public address</span>
              <a className="bl-linkish" href={publicUrl} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: 'anywhere' }}>
                {publicUrl}
              </a>
              <button type="button" className="bl-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => void copy(publicUrl, 'Address')}>
                Copy the address
              </button>
            </>
          ) : (
            <span className="bl-small">Not open to the public. Use a preview link to see it.</span>
          )}
          {preview ? (
            <>
              <span className="bl-label">Preview link, until {new Date(preview.expiresAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
              <div className="bl-row-actions" style={{ justifyContent: 'flex-start' }}>
                <a className="bl-btn" href={preview.url} target="_blank" rel="noopener noreferrer">
                  Open the preview
                </a>
                <button type="button" className="bl-ghost" onClick={() => void copy(preview.url, 'Preview link')}>
                  Copy it
                </button>
              </div>
              <span className="bl-small">Anyone with this link can see the room until then, so share it only with the client.</span>
            </>
          ) : (
            <button type="button" className="bl-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => void makePreview()}>
              Make a preview link
            </button>
          )}
        </section>
      )}

      {!isTeam ? (
        <p className="bl-small">Your team sets up your room. Ask them for changes.</p>
      ) : (
        <>
          <section className="bl-glass-card bl-brand-group" aria-labelledby="room-basics">
            <h2 id="room-basics" className="bl-section-title">Basics</h2>
            <label className="bl-field">
              <span className="bl-label">Room name</span>
              <input className="bl-input" value={room.slug} maxLength={30} autoCapitalize="none" spellCheck={false} onChange={(e) => set({ slug: e.target.value.toLowerCase() })} />
              <span className="bl-small" style={{ overflowWrap: 'anywhere' }}>
                {ROOMS_URL}/k/{room.slug || 'name'}. Letters, numbers and underscores.
              </span>
            </label>
            <fieldset className="bl-knob-humor">
              <legend className="bl-label">Who can visit</legend>
              {STATUS.map(([v, label, hint]) => (
                <label key={v} className="bl-brand-check">
                  <input type="radio" name="room-status" checked={room.status === v} onChange={() => set({ status: v })} />
                  <span>
                    <b>{label}.</b> {hint}
                  </span>
                </label>
              ))}
            </fieldset>
            {room.status === 'open' && adult && (
              <p className="bl-small bl-knob-warn" role="note">
                Adult room: visitors confirm they are 18 or older before seeing anything, any photo or video must be confirmed as not explicit, and search engines are asked not to list it.
              </p>
            )}
          </section>

          <section className="bl-glass-card bl-brand-group" aria-labelledby="room-chat">
            <h2 id="room-chat" className="bl-section-title">Kris chat</h2>
            <label className="bl-brand-check">
              <input type="checkbox" checked={room.chatOn} onChange={(e) => set({ chatOn: e.target.checked })} />
              <span>Kris answers visitors in this room. Turns on once the 50 test chats pass.</span>
            </label>
            {!room.chatOn && (
              <span className="bl-small">Until then, anyone opening a preview link can chat as a test, paid from the separate test budget.</span>
            )}
          </section>

          <section className="bl-glass-card bl-brand-group" aria-labelledby="room-look">
            <h2 id="room-look" className="bl-section-title">Look</h2>
            <fieldset className="bl-knob-humor">
              <legend className="bl-label">Archetype</legend>
              {ARCHETYPES.map((a) => (
                <label key={a.id} className="bl-brand-check">
                  <input type="radio" name="room-archetype" checked={room.preset === a.id} onChange={() => set({ preset: a.id })} />
                  <span>
                    <b>{a.name}.</b> {a.fits}. <span className="bl-muted">{a.object}.</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {adult && (
              <p className="bl-small" style={{ margin: 0 }}>
                Adult niche: every look keeps the 18+ step and stays out of search.
              </p>
            )}
            <label className="bl-field">
              <span className="bl-label">Accent color</span>
              <input className="bl-input" type="color" value={room.accent} onChange={(e) => set({ accent: e.target.value.toLowerCase() })} style={{ height: 48, padding: 4 }} />
            </label>
            {room.accent !== ARCHETYPES.find((a) => a.id === room.preset)!.accent && (
              <button type="button" className="bl-linkish" style={{ alignSelf: 'flex-start' }} onClick={() => set({ accent: ARCHETYPES.find((a) => a.id === room.preset)!.accent })}>
                Use the {ARCHETYPES.find((a) => a.id === room.preset)!.name} color
              </button>
            )}
            <label className="bl-field">
              <span className="bl-label">Greeting</span>
              <textarea className="bl-input" rows={3} maxLength={280} value={room.greeting} placeholder="One or two lines in their voice" onChange={(e) => set({ greeting: e.target.value })} />
              <span className="bl-small num">{room.greeting.length} of 280</span>
            </label>
          </section>

          <section className="bl-glass-card bl-brand-group" aria-labelledby="room-buttons">
            <h2 id="room-buttons" className="bl-section-title">Buttons</h2>
            {links.length === 0 ? (
              <p className="bl-small" style={{ margin: 0 }}>
                Add the client&rsquo;s links in their brand kit first. Rooms only link to those.
              </p>
            ) : (
              <>
                {room.buttons.map((b, i) => (
                  <div key={i} className="bl-brand-goal">
                    <input className="bl-input" aria-label={`Button ${i + 1} label`} value={b.label} maxLength={40} placeholder="What the button says" onChange={(e) => set({ buttons: room.buttons.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                    <select className="bl-input" aria-label={`Button ${i + 1} link`} value={b.link} onChange={(e) => set({ buttons: room.buttons.map((x, j) => (j === i ? { ...x, link: Number(e.target.value) } : x)) })}>
                      {links.map((l, k) => (
                        <option key={k} value={k}>
                          {l.label}: {l.url}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="bl-linkish" onClick={() => set({ buttons: room.buttons.filter((_, j) => j !== i) })}>
                      Remove
                    </button>
                  </div>
                ))}
                {room.buttons.length < 4 && (
                  <button type="button" className="bl-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => set({ buttons: [...room.buttons, { label: links[0].label.slice(0, 40), link: 0 }] })}>
                    Add a button
                  </button>
                )}
              </>
            )}
          </section>

          <section className="bl-glass-card bl-brand-group" aria-labelledby="room-hero">
              <h2 id="room-hero" className="bl-section-title">Photo or video</h2>
              {media.length === 0 ? (
                <p className="bl-small" style={{ margin: 0 }}>
                  Upload a photo or video in Media and mark it OK for Kris to use it here.
                </p>
              ) : (
                <div className="bl-room-media">
                  <label className="bl-brand-check">
                    <input type="radio" name="room-hero" checked={!room.heroId} onChange={() => set({ heroId: null, heroClean: false })} />
                    <span>None</span>
                  </label>
                  {media.map((m) => (
                    <label key={m.id} className="bl-room-pick">
                      <input type="radio" name="room-hero" checked={room.heroId === m.id} onChange={() => set({ heroId: m.id, heroClean: false })} />
                      <PostMedia id={m.id} size="thumb" />
                      <span className="bl-small">{m.note || m.tags.join(', ') || (m.kind === 'video' ? 'Video' : 'Photo')}</span>
                    </label>
                  ))}
                </div>
              )}
              {needsClean && (
                <label className="bl-brand-check bl-knob-warn">
                  <input type="checkbox" checked={room.heroClean} onChange={(e) => set({ heroClean: e.target.checked })} />
                  <span>I confirm this photo or video shows no nudity or sexual activity. Explicit media on a public page can bring in state age-check laws.</span>
                </label>
              )}
            </section>

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
          <button type="button" className="bl-btn bl-wide" disabled={busy || !changed || !buttonsOk || !cleanOk || !room.slug} onClick={() => void save()}>
            {busy ? 'Saving' : !changed ? 'No changes' : room.status === 'open' && saved?.status !== 'open' ? 'Save and open the room' : 'Save'}
          </button>
        </>
      )}
      <RoomActivity clientId={client.id} isTeam={isTeam} />
      {!isTeam && error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}
      {!isTeam && note && (
        <p className="bl-small" role="status">
          {note}
        </p>
      )}
    </main>
  );
}

type Counts = { visits: number; chats: number; ai_replies: number; faq_taps: number; link_taps: number; redirects: number; handoffs: number; handoff_taps: number };
type Visit = { id: string; started_at: string; ai_replies: number; minor: boolean; crisis: boolean; spending: boolean; test: boolean };
type Line = { seq: number; role: 'visitor' | 'kris'; body: string; source: string };

/** The last 7 days of counts (team and client), and recent visitor chats (team only). */
function RoomActivity({ clientId, isTeam }: { clientId: string; isTeam: boolean }) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase) return;
    const since = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    void (async () => {
      const c = await supabase!.from('room_counts').select('visits, chats, ai_replies, faq_taps, link_taps, redirects, handoffs, handoff_taps').eq('client_id', clientId).gte('day', since);
      if (c.error) return setError(c.error.message);
      const sum: Counts = { visits: 0, chats: 0, ai_replies: 0, faq_taps: 0, link_taps: 0, redirects: 0, handoffs: 0, handoff_taps: 0 };
      for (const row of c.data ?? []) for (const k of Object.keys(sum) as Array<keyof Counts>) sum[k] += Number((row as Record<string, unknown>)[k] ?? 0);
      setCounts(sum);
      if (isTeam) {
        const v = await supabase!.from('room_visits').select('id, started_at, ai_replies, minor, crisis, spending, test').eq('client_id', clientId).order('started_at', { ascending: false }).limit(20);
        if (v.error) return setError(v.error.message);
        setVisits((v.data ?? []) as Visit[]);
      }
    })();
  }, [clientId, isTeam]);

  async function show(id: string) {
    if (!supabase) return;
    if (open === id) return setOpen(null);
    setOpen(id);
    const { data, error: e } = await supabase.from('room_messages').select('seq, role, body, source').eq('visit_id', id).order('seq').limit(200);
    if (e) return setError(e.message);
    setLines((data ?? []) as Line[]);
  }

  async function remove(id: string) {
    if (!supabase) return;
    const { error: e } = await supabase.rpc('room_visit_delete', { p_visit: id });
    if (e) return setError(e.message);
    setVisits((v) => v.filter((x) => x.id !== id));
    if (open === id) setOpen(null);
  }

  return (
    <section className="bl-glass-card bl-brand-group" aria-labelledby="room-activity">
      <h2 id="room-activity" className="bl-section-title">Last 7 days</h2>
      {counts ? (
        <dl className="bl-room-counts">
          {(
            [
              ['visits', 'Visits'],
              ['chats', 'Chats'],
              ['ai_replies', 'AI replies'],
              ['faq_taps', 'FAQ taps'],
              ['link_taps', 'Link taps'],
              ['handoffs', 'Ready to buy'],
              ['redirects', 'Steered from sexual talk'],
              ['handoff_taps', 'Taps after a handoff'],
            ] as Array<[keyof Counts, string]>
          ).map(([k, label]) => (
            <div key={k}>
              <dt className="bl-small">{label}</dt>
              <dd className="num">{counts[k]}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <span className="bl-small" aria-busy="true">Loading.</span>
      )}
      {isTeam && (
        <>
          <h3 className="bl-label" style={{ margin: '8px 0 0' }}>Recent visitor chats</h3>
          <span className="bl-small">For safety review. Only your team sees these, and they go after 30 days.</span>
          {visits.length === 0 && <span className="bl-small">No chats yet.</span>}
          <ul className="bl-room-visits">
            {visits.map((v) => (
              <li key={v.id}>
                <div className="bl-row-actions" style={{ justifyContent: 'space-between' }}>
                  <button type="button" className="bl-linkish" aria-expanded={open === v.id} onClick={() => void show(v.id)}>
                    {new Date(v.started_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    {v.test ? ', test' : ''}
                    {v.crisis ? ', crisis words' : ''}
                    {v.minor ? ', said under 18' : ''}
                    {v.spending ? ', money worries' : ''}
                  </button>
                  <button type="button" className="bl-linkish" onClick={() => void remove(v.id)}>
                    Delete
                  </button>
                </div>
                {open === v.id && (
                  <ol className="bl-room-lines">
                    {lines.map((l) => (
                      <li key={l.seq} className={l.role}>
                        <span className="bl-label">{l.role === 'kris' ? `Kris${l.source !== 'ai' ? ` (${l.source})` : ''}` : 'Visitor'}</span>
                        <span>{l.body}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
