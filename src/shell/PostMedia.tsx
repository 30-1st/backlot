import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { signedUrls } from '../lib/clientMedia';

// A post's own photo or video from the client's Media, matched by Bil. When a post has
// none yet but Bil described one, the frame shows the shot to take instead.

export type File = { kind: string; url: string };
const cache = new Map<string, File | 'gone'>();

/** A Media file's signed link and kind, cached for the visit. 'gone' when it was removed. */
export function useFile(id: string | null): File | 'gone' | null {
  const [file, setFile] = useState<File | 'gone' | null>(id ? cache.get(id) ?? null : null);
  useEffect(() => {
    if (!id || !supabase) return;
    let alive = true;
    void (async () => {
      const { data } = await supabase!.from('library_items').select('path, kind, removed_at').eq('id', id).maybeSingle();
      if (!data || data.removed_at) {
        cache.set(id, 'gone');
        if (alive) setFile('gone');
        return;
      }
      const urls = await signedUrls([data.path]);
      const f = urls[data.path] ? { kind: String(data.kind), url: urls[data.path] } : 'gone';
      cache.set(id, f as File | 'gone');
      if (alive) setFile(f as File | 'gone');
    })().catch(() => alive && setFile('gone'));
    return () => {
      alive = false;
    };
  }, [id]);
  return file;
}

export function PostMedia({ id, size = 'full' }: { id: string; size?: 'full' | 'hero' | 'thumb' }) {
  const file = useFile(id);
  if (file === 'gone') {
    return size === 'thumb' ? <span className="bl-pm thumb empty" /> : <div className="bl-small">The file Bil picked for this post was removed from Media.</div>;
  }
  if (!file) return <div className={`bl-pm ${size}`} aria-busy="true" />;
  return (
    <div className={`bl-pm ${size}`}>
      {file.kind === 'video' ? (
        <video src={`${file.url}#t=0.1`} controls={size !== 'thumb'} muted={size === 'thumb'} playsInline preload="metadata" />
      ) : (
        <img src={file.url} alt="The photo for this post" />
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
