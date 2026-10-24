import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { team } from '../lib/team';
import { PostMedia } from './PostMedia';
import type { ScreenProps } from './Shell';

// A client's room (K1): the page their audience opens from a bio link or an auto-reply,
// hosted on its own site apart from Backlot. The team sets it up; the client can open
// its preview. Every field is checked again on the server (room_set).

const ROOMS_URL = 'https://backlot-rooms.pages.dev';

type Status = 'draft' | 'preview' | 'open' | 'closed';
type Button = { label: string; link: number };
type Room = { slug: string; status: Status; preset: 'creator' | 'creator_adult'; accent: string; greeting: string; buttons: Button[]; heroId: string | null };
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
        supabase!.from('rooms').select('slug, status, preset, accent, greeting, buttons, hero_id').eq('client_id', client.id).maybeSingle(),
        supabase!.from('library_items').select('id, kind, note, tags').eq('client_id', client.id).eq('kris_ok', true).neq('status', 'retired').is('removed_at', null).order('created_at', { ascending: false }).limit(30),
      ]);
      if (r.error) return setError(r.error.message);
      const start: Room = r.data
        ? { slug: r.data.slug, status: r.data.status, preset: r.data.preset, accent: r.data.accent, greeting: r.data.greeting, buttons: Array.isArray(r.data.buttons) ? r.data.buttons : [], heroId: r.data.hero_id }
        : { slug: slugFrom(client.handle), status: 'draft', preset: adult ? 'creator_adult' : 'creator', accent: adult ? '#d8b98a' : '#3048e8', greeting: '', buttons: [], heroId: null };
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

  async function save() {
    if (!supabase) return;
    setBusy(true);
    setError('');
    setNote('');
    const { error: e } = await supabase.rpc('room_set', {
      p_client: client!.id,
      p_slug: room!.slug.trim().toLowerCase(),
      p_status: room!.status,
      p_preset: adult ? 'creator_adult' : room!.preset,
      p_accent: room!.accent.toLowerCase(),
      p_greeting: room!.greeting.trim(),
      p_buttons: room!.buttons.map((b) => ({ label: b.label.trim(), link: b.link })),
      p_hero: adult ? null : room!.heroId,
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
          @{client.handle}&rsquo;s page for their audience, on its own site. Kris starts chatting there in the next step; for now it shows the greeting and links.
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
                Adult room: visitors confirm they are 18 or older before seeing anything, the page shows no photos or videos, and search engines are asked not to list it.
              </p>
            )}
          </section>

          <section className="bl-glass-card bl-brand-group" aria-labelledby="room-look">
            <h2 id="room-look" className="bl-section-title">Look</h2>
            {adult ? (
              <p className="bl-small" style={{ margin: 0 }}>
                Creator, 18+. Adult niches always use this look.
              </p>
            ) : (
              <label className="bl-field">
                <span className="bl-label">Look</span>
                <select className="bl-input" value={room.preset} onChange={(e) => set({ preset: e.target.value as Room['preset'] })}>
                  <option value="creator">Creator</option>
                </select>
              </label>
            )}
            <label className="bl-field">
              <span className="bl-label">Accent color</span>
              <input className="bl-input" type="color" value={room.accent} onChange={(e) => set({ accent: e.target.value.toLowerCase() })} style={{ height: 48, padding: 4 }} />
            </label>
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

          {!adult && (
            <section className="bl-glass-card bl-brand-group" aria-labelledby="room-hero">
              <h2 id="room-hero" className="bl-section-title">Photo or video</h2>
              {media.length === 0 ? (
                <p className="bl-small" style={{ margin: 0 }}>
                  Mark a file OK for Kris in Media to use it here.
                </p>
              ) : (
                <div className="bl-room-media">
                  <label className="bl-brand-check">
                    <input type="radio" name="room-hero" checked={!room.heroId} onChange={() => set({ heroId: null })} />
                    <span>None</span>
                  </label>
                  {media.map((m) => (
                    <label key={m.id} className="bl-room-pick">
                      <input type="radio" name="room-hero" checked={room.heroId === m.id} onChange={() => set({ heroId: m.id })} />
                      <PostMedia id={m.id} size="thumb" />
                      <span className="bl-small">{m.note || m.tags.join(', ') || (m.kind === 'video' ? 'Video' : 'Photo')}</span>
                    </label>
                  ))}
                </div>
              )}
            </section>
          )}

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
          <button type="button" className="bl-btn bl-wide" disabled={busy || !changed || !buttonsOk || !room.slug} onClick={() => void save()}>
            {busy ? 'Saving' : !changed ? 'No changes' : room.status === 'open' && saved?.status !== 'open' ? 'Save and open the room' : 'Save'}
          </button>
        </>
      )}
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
