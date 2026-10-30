// Screenshot prep for Xev, all on the phone: load, shrink, cover the parts the client marks
// (names, usernames, profile photos, pictures in the chat) with heavy pixelation, and export
// a fresh JPEG. Re-drawing on a canvas also drops the photo's metadata (location, camera).
// The original never leaves the device.

export type Box = { x: number; y: number; w: number; h: number };

const MAX_SIDE = 1600;

export async function loadShot(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file is not a picture this phone can open.'));
      i.src = url;
    });
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d');
    if (!g) throw new Error('This browser cannot prepare pictures.');
    g.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Pixelates each box so heavily nothing underneath can be read back. */
export function coverBoxes(source: HTMLCanvasElement, boxes: Box[]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = source.width;
  c.height = source.height;
  const g = c.getContext('2d')!;
  g.drawImage(source, 0, 0);
  const tmp = document.createElement('canvas');
  const tg = tmp.getContext('2d')!;
  for (const b of boxes) {
    const x = Math.max(0, Math.round(b.x));
    const y = Math.max(0, Math.round(b.y));
    const w = Math.min(c.width - x, Math.round(b.w));
    const h = Math.min(c.height - y, Math.round(b.h));
    if (w < 2 || h < 2) continue;
    const cell = Math.max(10, Math.round(Math.min(w, h) / 3));
    tmp.width = Math.max(1, Math.ceil(w / cell));
    tmp.height = Math.max(1, Math.ceil(h / cell));
    tg.imageSmoothingEnabled = true;
    tg.drawImage(c, x, y, w, h, 0, 0, tmp.width, tmp.height);
    g.imageSmoothingEnabled = false;
    g.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h);
    g.imageSmoothingEnabled = true;
  }
  return c;
}

/** A JPEG under about 2 MB, as base64 without the data: prefix. */
export function exportShot(c: HTMLCanvasElement): { data: string; mediaType: 'image/jpeg' } {
  let q = 0.85;
  let url = c.toDataURL('image/jpeg', q);
  while (url.length > 2_600_000 && q > 0.4) {
    q -= 0.15;
    url = c.toDataURL('image/jpeg', q);
  }
  return { data: url.slice(url.indexOf(',') + 1), mediaType: 'image/jpeg' };
}
