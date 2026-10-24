import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { bil } from '../lib/team';

// K3, ways in: how a client sends people to their room with the tools they already have.
// Backlot never posts or sends anything; every step here is done by the client, by hand.
// Each way has its own link (?w=...), so the room can count opens per way without knowing
// who visited. The guides were checked against each platform's own pages on the date shown.

export const ROOMS_SITE = 'backlot-rooms.pages.dev';
const CHECKED = 'Oct 24, 2026';

export type Way = 'bio' | 'pinned' | 'post' | 'reply' | 'dm' | 'qr' | 'other';
export const WAY_LABELS: Record<Way | 'direct', string> = {
  bio: 'Bio link',
  pinned: 'Pinned post',
  post: 'Other posts',
  reply: 'Replies',
  dm: 'DMs',
  qr: 'QR code',
  other: 'Anywhere else',
  direct: 'No label',
};
export const wayLink = (slug: string, w: Way) => `https://${ROOMS_SITE}/k/${slug}?w=${w}`;

type Copy = { bio: string[]; pinned: string[]; reply: string[] };

function readCopy(clientId: string): Copy | null {
  try {
    const v = window.localStorage.getItem(`backlot.ways.${clientId}`);
    return v ? (JSON.parse(v) as Copy) : null;
  } catch {
    return null;
  }
}
function keepCopy(clientId: string, c: Copy) {
  try {
    window.localStorage.setItem(`backlot.ways.${clientId}`, JSON.stringify(c));
  } catch {
    // Only a convenience: the text can be written again.
  }
}

export function WaysIn({ clientId, handle, slug, open, isTeam }: { clientId: string; handle: string; slug: string; open: boolean; isTeam: boolean }) {
  const [ready, setReady] = useState<boolean | null>(null);
  const [tab, setTab] = useState<'x' | 'anywhere'>('x');
  const [copy, setCopy] = useState<Copy | null>(() => readCopy(clientId));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase) return;
    void supabase.rpc('ways_guides_ready').then(({ data }) => setReady(Boolean(data)));
  }, []);
  useEffect(() => setCopy(readCopy(clientId)), [clientId]);

  if (ready === null) return null;
  if (!ready && !isTeam) return null;

  async function put(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNote(`${what} copied.`);
    } catch {
      setNote('Copying is blocked here. Press and hold the text to copy it.');
    }
  }

  async function write() {
    setBusy(true);
    setError('');
    setNote('');
    try {
      const r = await bil.waysCopy(clientId);
      const c = { bio: r.bio, pinned: r.pinned, reply: r.reply };
      setCopy(c);
      keepCopy(clientId, c);
      if (!r.bio.length && !r.pinned.length && !r.reply.length) setError('Kris could not write text that fits the rules this time. Try again.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not write the text.');
    } finally {
      setBusy(false);
    }
  }

  const Link = ({ w, label }: { w: Way; label: string }) => (
    <div className="bl-way-link">
      <code>{wayLink(slug, w)}</code>
      <button type="button" className="bl-ghost" onClick={() => void put(wayLink(slug, w), label)}>
        Copy
      </button>
    </div>
  );
  const Options = ({ list, what }: { list: string[]; what: string }) =>
    list.length ? (
      <ul className="bl-way-options">
        {list.map((t, i) => (
          <li key={i}>
            <p>{t}</p>
            <button type="button" className="bl-ghost" onClick={() => void put(t, `${what} ${i + 1}`)}>
              Copy
            </button>
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <section className="bl-glass-card bl-brand-group" aria-labelledby="ways-in">
      <h2 id="ways-in" className="bl-section-title">
        Ways in
      </h2>
      <p className="bl-small" style={{ margin: 0 }}>
        Send people to the room with the tools you already have. Backlot never posts or sends anything: every step below is yours, by hand. Each way has its own link, so
        the numbers below show which one brings people.
      </p>
      {!ready && isTeam && (
        <p className="bl-small bl-knob-warn" role="note">
          Only your team sees this until each guide has been tried on a real account. Clients see it after that.
        </p>
      )}
      {!open && (
        <p className="bl-small bl-knob-warn" role="note">
          The room is not open yet, so these links show visitors a closed page. Open it above first.
        </p>
      )}

      <div className="bl-seg" role="tablist" aria-label="Where">
        <button type="button" role="tab" aria-selected={tab === 'x'} aria-pressed={tab === 'x'} onClick={() => setTab('x')}>
          X
        </button>
        <button type="button" role="tab" aria-selected={tab === 'anywhere'} aria-pressed={tab === 'anywhere'} onClick={() => setTab('anywhere')}>
          Anywhere
        </button>
      </div>

      {tab === 'x' ? (
        <ol className="bl-way-steps">
          <li>
            <b>Write the text.</b>
            <span className="bl-small">Kris writes three options each for your bio, a pinned post and the reply people get when they ask, in your voice.</span>
            <button type="button" className="bl-btn" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => void write()}>
              {busy ? 'Kris is writing' : copy ? 'Write new options' : 'Write the text with Kris'}
            </button>
            <span className="bl-small">About half a cent, from {isTeam ? 'the client’s' : 'your'} Kris allowance.</span>
          </li>
          <li>
            <b>Bio and website.</b>
            <span className="bl-small">On X, open your profile and tap Edit profile. Paste this link in Website:</span>
            <Link w="bio" label="Bio link" />
            <span className="bl-small">Then paste one of these into Bio (160 characters at most):</span>
            <Options list={copy?.bio ?? []} what="Bio line" />
          </li>
          <li>
            <b>Pinned post.</b>
            <span className="bl-small">Post one of these from your account, then tap the three dots on the post and choose Pin to your profile.</span>
            <Options list={copy?.pinned ?? []} what="Pinned post" />
            {!copy && <Link w="pinned" label="Pinned post link" />}
          </li>
          <li>
            <b>When someone asks.</b>
            <span className="bl-small">Send one of these by hand, in a reply or a DM. Only send it to people who asked: X&rsquo;s rules do not allow sending links to people who did not, or bots that reply on their own.</span>
            <Options list={copy?.reply ?? []} what="Reply" />
            <span className="bl-small">The link for DMs, so they count on their own:</span>
            <Link w="dm" label="DM link" />
            <span className="bl-small">
              Save your reply as a keyboard shortcut so it takes one tap. iPhone: Settings, General, Keyboard, Text Replacement. Android with Gboard: Gboard settings, Dictionary,
              Personal dictionary.
            </span>
          </li>
          <li>
            <b>Posts that mention the room.</b>
            <span className="bl-small">When a post points to the room, use this link:</span>
            <Link w="post" label="Post link" />
          </li>
        </ol>
      ) : (
        <ol className="bl-way-steps">
          <li>
            <b>A QR code.</b>
            <span className="bl-small">For the counter, packaging, flyers or a screen at an event. It is made on this device; no outside service sees the link.</span>
            <QrCard slug={slug} handle={handle} />
          </li>
          <li>
            <b>Everywhere else.</b>
            <span className="bl-small">Link-in-bio pages, stories, email signatures, other sites:</span>
            <Link w="other" label="Link" />
          </li>
        </ol>
      )}
      <span className="bl-small">Checked against each platform&rsquo;s own pages on {CHECKED}.</span>
      {note && (
        <p className="bl-small" role="status" style={{ margin: 0 }}>
          {note}
        </p>
      )}
      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * The QR code, drawn here with an open-source library loaded only on this screen. Dark on
 * white with a quiet border, which every phone camera reads. The image adds one line
 * under the code so people know what it opens.
 */
function QrCard({ slug, handle }: { slug: string; handle: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const url = wayLink(slug, 'qr');
  const caption = `Scan to visit @${handle}'s room`;

  useEffect(() => {
    let live = true;
    void import('qrcode').then(
      async (QR) => {
        if (!live || !canvas.current) return;
        const size = 1024;
        const c = canvas.current;
        c.width = size;
        c.height = size + 140;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        const code = document.createElement('canvas');
        await QR.toCanvas(code, url, { width: size, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#111716', light: '#ffffff' } });
        ctx.drawImage(code, 0, 0, size, size);
        ctx.fillStyle = '#111716';
        ctx.font = '600 44px "Hanken Grotesk", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(caption, size / 2, size + 70, size - 80);
        setSvg(await QR.toString(url, { type: 'svg', margin: 4, errorCorrectionLevel: 'M', color: { dark: '#111716', light: '#ffffff' } }));
      },
      () => live && setError('The QR maker did not load. Check your connection and open this screen again.'),
    );
    return () => {
      live = false;
    };
  }, [url, caption]);

  function download(name: string, href: string) {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (href.startsWith('blob:')) window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
  }

  return (
    <div className="bl-qr">
      <canvas ref={canvas} className="bl-qr-canvas" role="img" aria-label={`QR code that opens ${url}`} />
      <div className="bl-row-actions">
        <button type="button" className="bl-ghost" disabled={!svg} onClick={() => canvas.current && download(`${slug}-room-qr.png`, canvas.current.toDataURL('image/png'))}>
          Download image
        </button>
        <button type="button" className="bl-ghost" disabled={!svg} onClick={() => download(`${slug}-room-qr.svg`, URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })))}>
          Download for print
        </button>
      </div>
      <span className="bl-small">Print it at least 2 cm (0.8 in) wide, dark on a light background, and scan a test print with two different phones before printing a batch.</span>
      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
