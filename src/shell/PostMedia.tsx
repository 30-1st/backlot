import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { signedUrls } from '../lib/clientMedia';

// A post's own photo or video from the client's Media, matched by Bil. When a post has
// none yet but Bil described one, the frame shows the shot to take instead.

export type File = { kind: string; url: string; path: string; mime: string };
const cache = new Map<string, File | 'gone'>();

/** A Media file's signed link and kind, cached for the visit. 'gone' when it was removed. */
export function useFile(id: string | null): File | 'gone' | null {
  const [file, setFile] = useState<File | 'gone' | null>(id ? cache.get(id) ?? null : null);
  useEffect(() => {
    if (!id || !supabase) return;
    let alive = true;
    void (async () => {
      const { data } = await supabase!.from('library_items').select('path, kind, mime, removed_at').eq('id', id).maybeSingle();
      if (!data || data.removed_at) {
        cache.set(id, 'gone');
        if (alive) setFile('gone');
        return;
      }
      const urls = await signedUrls([data.path]);
      const f = urls[data.path] ? { kind: String(data.kind), url: urls[data.path], path: String(data.path), mime: String(data.mime ?? '') } : 'gone';
      cache.set(id, f as File | 'gone');
      if (alive) setFile(f as File | 'gone');
    })().catch(() => alive && setFile('gone'));
    return () => {
      alive = false;
    };
  }, [id]);
  return file;
}

export function PostMedia({ id, size = 'full', saveAs }: { id: string; size?: 'full' | 'hero' | 'thumb'; saveAs?: string }) {
  const file = useFile(id);
  if (file === 'gone') {
    return size === 'thumb' ? <span className="bl-pm thumb empty" /> : <div className="bl-small">The file Bil picked for this post was removed from Media.</div>;
  }
  if (!file) return <div className={`bl-pm ${size}`} aria-busy="true" />;
  const frame = (
    <div className={`bl-pm ${size}`}>
      {file.kind === 'video' ? (
        <video src={`${file.url}#t=0.1`} controls={size !== 'thumb'} muted={size === 'thumb'} playsInline preload="metadata" />
      ) : (
        <img src={file.url} alt="The photo for this post" />
      )}
    </div>
  );
  if (size === 'thumb') return frame;
  return (
    <div className="bl-pm-wrap">
      {frame}
      <SaveMedia file={file} name={saveAs ?? 'backlot-post'} />
    </div>
  );
}

const saved = new Map<string, globalThis.File>();

/**
 * Saves a post's photo or video to the phone, so it can be posted or scheduled from X.
 * On iPhone a plain download link cannot put media in Photos, so this opens the share
 * sheet with the file itself ("Save Image" or "Save Video"). Elsewhere it downloads.
 * A large file may need a second tap: iPhone only opens the share sheet straight after a
 * tap, and a big video can take longer than that to fetch.
 */
function SaveMedia({ file, name }: { file: File; name: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'done' | 'error'>(saved.has(file.path) ? 'ready' : 'idle');
  const [note, setNote] = useState('');
  const ext = file.path.split('.').pop() ?? (file.kind === 'video' ? 'mp4' : 'jpg');
  const fileName = `${name.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 60)}.${ext}`;

  async function fetchFile(): Promise<globalThis.File> {
    const have = saved.get(file.path);
    if (have) return have;
    const res = await fetch(file.url);
    if (!res.ok) throw new Error('fetch');
    const blob = await res.blob();
    const f = new globalThis.File([blob], fileName, { type: file.mime || blob.type || (file.kind === 'video' ? 'video/mp4' : 'image/jpeg') });
    saved.set(file.path, f);
    return f;
  }

  async function hand(f: globalThis.File) {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare && nav.share && nav.canShare({ files: [f] })) {
      try {
        await nav.share({ files: [f] });
        setState('done');
        setNote(file.kind === 'video' ? 'Choose Save Video to put it in Photos.' : 'Choose Save Image to put it in Photos.');
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          setState('ready');
          return;
        }
        if (e instanceof DOMException && e.name === 'NotAllowedError') {
          setState('ready');
          setNote('Ready. Tap Save to phone again.');
          return;
        }
        // Any other refusal: fall through to a plain download.
      }
    }
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    setState('done');
    setNote('Downloaded.');
  }

  async function onTap() {
    setNote('');
    const have = saved.get(file.path);
    if (have) return void hand(have);
    setState('loading');
    const started = performance.now();
    try {
      const f = await fetchFile();
      // A quick fetch still counts as part of the tap; a slow one needs a second tap on iPhone.
      if (performance.now() - started < 3000) await hand(f);
      else {
        setState('ready');
        setNote('Ready. Tap Save to phone again.');
      }
    } catch {
      setState('error');
      setNote('The file did not download. Check your connection and try again.');
    }
  }

  return (
    <div className="bl-pm-save">
      <button type="button" className="bl-ghost" disabled={state === 'loading'} onClick={() => void onTap()}>
        {state === 'loading' ? 'Getting it' : 'Save to phone'}
      </button>
      {note && (
        <span className="bl-small" role="status">
          {note}
        </span>
      )}
    </div>
  );
}

/** The shot Bil asked for, framed like a storyboard card, when no file is matched yet. */
export function ShotFrame({ idea, size = 'hero' }: { idea: string; size?: 'hero' | 'thumb' }) {
  if (size === 'thumb') return <span className="bl-pm thumb shot" aria-hidden="true" />;
  return (
    <div className="bl-pm hero shot">
      <span className="bl-shot-label">Shot to take</span>
      <span className="bl-shot-text">{idea}</span>
      <span className="bl-shot-hint">Add it in Media and tag it, and Bil will match it next time.</span>
    </div>
  );
}
