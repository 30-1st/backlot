// Takes identifying data out of photos and videos before they are kept: where they were
// taken (GPS), the camera or phone, its serial number, dates the owner wrote, names,
// comments and editing history. The picture itself is never re-encoded, so quality stays
// exactly the same; only the extra records around it are removed.
//
//   JPEG    every EXIF, XMP, IPTC and comment block goes. If the photo was taken sideways,
//           a tiny record holding only its rotation is put back, so it still shows upright.
//   PNG     text, EXIF and time chunks go.
//   WebP    EXIF and XMP chunks go.
//   GIF     comments and XMP go.
//   HEIC, HEIF, AVIF   the EXIF and XMP items are blanked out in place.
//   MP4, MOV   the user-data and metadata boxes (location, device, owner) are turned into
//           padding of the same size, so the video plays exactly as before.
//   WebM    passed through: browsers record WebM without location.
//
// Pure functions on bytes, so the same code runs in the browser before upload and on the
// server for files kept earlier. Anything it cannot read safely throws ScrubError, and
// the caller refuses the file rather than keep it with its metadata.

export class ScrubError extends Error {}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const u32le = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)) + ((b[at + 3] << 24) >>> 0);

function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** What kind of file the bytes are, from their first bytes, not the name. */
export function sniff(b: Uint8Array): 'jpeg' | 'png' | 'webp' | 'gif' | 'isobmff' | 'webm' | 'unknown' {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (b.length >= 6 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) return 'gif';
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') return 'isobmff';
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  return 'unknown';
}

// ---------- JPEG ----------

/** The EXIF orientation (1 to 8) inside an APP1 Exif segment's data, or 1. */
function exifOrientation(seg: Uint8Array): number {
  // seg starts at "Exif\0\0"
  if (seg.length < 14 || ascii(seg, 0, 4) !== 'Exif') return 1;
  const t = 6;
  const le = ascii(seg, t, 2) === 'II';
  const r16 = (at: number) => (le ? seg[at] | (seg[at + 1] << 8) : u16be(seg, at));
  const r32 = (at: number) => (le ? u32le(seg, at) : u32be(seg, at));
  const ifd = t + r32(t + 4);
  if (ifd + 2 > seg.length) return 1;
  const n = r16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > seg.length) return 1;
    if (r16(e) === 0x0112) {
      const v = r16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

/** A minimal APP1 Exif segment holding only the orientation. */
function orientationSegment(o: number): Uint8Array {
  const data = [
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF header, IFD at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, (o >> 8) & 0xff, o & 0xff, 0x00, 0x00, // Orientation, SHORT, 1
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ];
  const len = data.length + 2;
  return new Uint8Array([0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...data]);
}

export function scrubJpeg(b: Uint8Array): Uint8Array {
  if (sniff(b) !== 'jpeg') throw new ScrubError('not a JPEG');
  const keep: Uint8Array[] = [b.subarray(0, 2)];
  let orientation = 1;
  let at = 2;
  let insertAfter = 1; // index in keep after which the orientation segment goes
  while (at < b.length) {
    if (b[at] !== 0xff) throw new ScrubError('broken JPEG marker');
    let marker = b[at + 1];
    // Fill bytes before a marker are allowed.
    while (marker === 0xff && at + 2 < b.length) {
      at++;
      marker = b[at + 1];
    }
    if (marker === 0xd9) {
      // End of the photo. Anything after it (extra images some phones append, such as
      // depth or HDR maps, which carry their own metadata) is left out.
      keep.push(b.subarray(at, at + 2));
      break;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      keep.push(b.subarray(at, at + 2));
      at += 2;
      continue;
    }
    if (at + 4 > b.length) throw new ScrubError('cut-off JPEG');
    const len = u16be(b, at + 2);
    if (len < 2 || at + 2 + len > b.length) throw new ScrubError('bad JPEG segment length');
    const seg = b.subarray(at, at + 2 + len);
    const data = b.subarray(at + 4, at + 2 + len);
    if (marker === 0xda) {
      // Start of scan: keep the header and the picture data that follows it, up to the
      // next real marker (0xFF followed by anything but 0x00 or a restart marker).
      let q = at + 2 + len;
      while (q + 1 < b.length) {
        if (b[q] === 0xff) {
          const n = b[q + 1];
          if (n !== 0x00 && !(n >= 0xd0 && n <= 0xd7) && n !== 0xff) break;
        }
        q++;
      }
      if (q + 1 >= b.length) throw new ScrubError('JPEG has no end');
      keep.push(b.subarray(at, q));
      at = q;
      continue;
    }
    const isApp = marker >= 0xe0 && marker <= 0xef;
    let drop = false;
    if (marker === 0xfe) drop = true; // comment
    else if (isApp) {
      if (marker === 0xe0) drop = false; // JFIF
      else if (marker === 0xe2 && ascii(data, 0, 12) === 'ICC_PROFILE\0') drop = false; // colour profile
      else if (marker === 0xee) drop = false; // Adobe colour transform, needed for some CMYK files
      else {
        if (marker === 0xe1) orientation = Math.max(orientation, exifOrientation(data));
        drop = true;
      }
    }
    if (!drop) {
      keep.push(seg);
      if (marker === 0xe0) insertAfter = keep.length;
    }
    at += 2 + len;
  }
  if (orientation !== 1) keep.splice(insertAfter, 0, orientationSegment(orientation));
  return concat(keep);
}

// ---------- PNG ----------

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'dSIG']);

export function scrubPng(b: Uint8Array): Uint8Array {
  if (sniff(b) !== 'png') throw new ScrubError('not a PNG');
  const keep: Uint8Array[] = [b.subarray(0, 8)];
  let at = 8;
  while (at < b.length) {
    if (at + 12 > b.length) throw new ScrubError('cut-off PNG');
    const len = u32be(b, at);
    const type = ascii(b, at + 4, 4);
    const end = at + 12 + len;
    if (end > b.length) throw new ScrubError('bad PNG chunk length');
    if (!PNG_DROP.has(type)) keep.push(b.subarray(at, end));
    at = end;
    if (type === 'IEND') break;
  }
  return concat(keep);
}

// ---------- WebP ----------

export function scrubWebp(b: Uint8Array): Uint8Array {
  if (sniff(b) !== 'webp') throw new ScrubError('not a WebP');
  const keep: Uint8Array[] = [];
  let at = 12;
  while (at + 8 <= b.length) {
    const type = ascii(b, at, 4);
    const size = u32le(b, at + 4);
    const end = at + 8 + size + (size % 2);
    if (at + 8 + size > b.length) throw new ScrubError('bad WebP chunk length');
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = b.slice(at, Math.min(end, b.length));
      if (type === 'VP8X' && chunk.length > 8) chunk[8] &= ~(0x08 | 0x04); // clear the EXIF and XMP flags
      keep.push(chunk);
    }
    at = end;
  }
  const body = concat(keep);
  const head = new Uint8Array(12);
  head.set(b.subarray(0, 4), 0);
  const total = body.length + 4;
  head[4] = total & 0xff;
  head[5] = (total >> 8) & 0xff;
  head[6] = (total >> 16) & 0xff;
  head[7] = (total >>> 24) & 0xff;
  head.set(b.subarray(8, 12), 8);
  return concat([head, body]);
}

// ---------- GIF ----------

export function scrubGif(b: Uint8Array): Uint8Array {
  if (sniff(b) !== 'gif') throw new ScrubError('not a GIF');
  const keep: Uint8Array[] = [];
  let at = 13;
  const flags = b[10];
  if (flags & 0x80) at += 3 * (1 << ((flags & 0x07) + 1));
  if (at > b.length) throw new ScrubError('cut-off GIF');
  keep.push(b.subarray(0, at));
  /** The end of a run of sub-blocks starting at `p`. */
  const subEnd = (p: number) => {
    while (p < b.length) {
      const n = b[p];
      p += 1 + n;
      if (n === 0) return p;
    }
    throw new ScrubError('cut-off GIF data');
  };
  while (at < b.length) {
    const kind = b[at];
    if (kind === 0x3b) {
      keep.push(b.subarray(at, at + 1));
      break;
    }
    if (kind === 0x21) {
      const label = b[at + 1];
      const end = subEnd(at + 2);
      let drop = label === 0xfe; // comment
      if (label === 0xff && b[at + 2] === 11 && ascii(b, at + 3, 11) === 'XMP DataXMP') drop = true;
      if (!drop) keep.push(b.subarray(at, end));
      at = end;
      continue;
    }
    if (kind === 0x2c) {
      let p = at + 10;
      const f = b[at + 9];
      if (f & 0x80) p += 3 * (1 << ((f & 0x07) + 1));
      p += 1; // LZW minimum code size
      const end = subEnd(p);
      keep.push(b.subarray(at, end));
      at = end;
      continue;
    }
    throw new ScrubError('unknown GIF block');
  }
  return concat(keep);
}

// ---------- ISOBMFF: HEIC, HEIF, AVIF, MP4, MOV ----------

type Box = { type: string; start: number; header: number; end: number };

function boxes(b: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = u32be(b, at);
    const type = ascii(b, at + 4, 4);
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) throw new ScrubError('cut-off box');
      const hi = u32be(b, at + 8);
      const lo = u32be(b, at + 12);
      size = hi * 2 ** 32 + lo;
      header = 16;
    } else if (size === 0) size = to - at;
    if (size < header || at + size > to) throw new ScrubError(`bad ${type} box`);
    out.push({ type, start: at, header, end: at + size });
    at += size;
  }
  return out;
}

/** Turns a box into padding of the same size: renamed "free" and its contents zeroed. */
const rename = (b: Uint8Array, box: Box, to = 'free') => {
  for (let i = 0; i < 4; i++) b[box.start + 4 + i] = to.charCodeAt(i);
  b.fill(0, box.start + box.header, box.end);
};

/** Images in a HEIF container: blank the EXIF and XMP items, wherever they sit. */
function scrubHeifMeta(b: Uint8Array, meta: Box) {
  const inner = boxes(b, meta.start + meta.header + 4, meta.end); // meta is a full box
  const iinf = inner.find((x) => x.type === 'iinf');
  const iloc = inner.find((x) => x.type === 'iloc');
  const idat = inner.find((x) => x.type === 'idat');
  if (!iinf || !iloc) return;
  // Which items are metadata.
  const wipe = new Set<number>();
  {
    const v = b[iinf.start + iinf.header];
    const first = iinf.start + iinf.header + 4 + (v === 0 ? 2 : 4);
    for (const e of boxes(b, first, iinf.end)) {
      if (e.type !== 'infe') continue;
      const ev = b[e.start + e.header];
      if (ev < 2) continue;
      let p = e.start + e.header + 4;
      const id = ev === 2 ? u16be(b, p) : u32be(b, p);
      p += ev === 2 ? 2 : 4;
      p += 2; // protection index
      const type = ascii(b, p, 4);
      p += 4;
      if (type === 'Exif') wipe.add(id);
      if (type === 'mime') {
        // item_name, then content_type, both zero-terminated
        let q = p;
        while (q < e.end && b[q] !== 0) q++;
        const ctStart = q + 1;
        let r = ctStart;
        while (r < e.end && b[r] !== 0) r++;
        const ct = ascii(b, ctStart, r - ctStart).toLowerCase();
        if (ct.includes('xmp') || ct.includes('rdf+xml')) wipe.add(id);
      }
    }
  }
  if (!wipe.size) return;
  // Where those items' bytes are.
  const v = b[iloc.start + iloc.header];
  let p = iloc.start + iloc.header + 4;
  const offSize = b[p] >> 4;
  const lenSize = b[p] & 0x0f;
  const baseSize = b[p + 1] >> 4;
  const idxSize = v === 1 || v === 2 ? b[p + 1] & 0x0f : 0;
  p += 2;
  const readN = (n: number) => {
    let x = 0;
    for (let i = 0; i < n; i++) x = x * 256 + b[p + i];
    p += n;
    return x;
  };
  const count = v < 2 ? readN(2) : readN(4);
  for (let i = 0; i < count; i++) {
    const id = v < 2 ? readN(2) : readN(4);
    let method = 0;
    if (v === 1 || v === 2) method = readN(2) & 0x0f;
    readN(2); // data reference index
    const base = readN(baseSize);
    const extents = readN(2);
    for (let j = 0; j < extents; j++) {
      if (idxSize) readN(idxSize);
      const off = readN(offSize);
      const len = readN(lenSize);
      if (wipe.has(id) && (method === 0 || method === 1)) {
        const origin = method === 0 ? 0 : idat ? idat.start + idat.header : -1;
        if (origin < 0) throw new ScrubError('metadata item in a missing idat box');
        const s = origin + base + off;
        if (s + len > b.length) throw new ScrubError('metadata item outside the file');
        b.fill(0, s, s + len);
      }
    }
    if (p > iloc.end) throw new ScrubError('bad iloc box');
  }
}

/** XMP stored in a top-level uuid box. */
const XMP_UUID = 'be7acfcb97a942e89c71999491e3afac';
const hex = (b: Uint8Array, at: number, n: number) => Array.from(b.subarray(at, at + n), (x) => x.toString(16).padStart(2, '0')).join('');

/** Inside a moov box's own bytes (starting at its header): user data and metadata become padding. */
export function scrubMoov(b: Uint8Array, moov: Box = { type: 'moov', start: 0, header: 8, end: b.length }) {
  for (const m of boxes(b, moov.start + moov.header, moov.end)) {
    if (m.type === 'udta' || m.type === 'meta') rename(b, m);
    if (m.type === 'trak') {
      for (const t of boxes(b, m.start + m.header, m.end)) if (t.type === 'udta' || t.type === 'meta') rename(b, t);
    }
  }
}

/** Top-level boxes that are metadata on their own. */
export function isMetaTop(b: Uint8Array, box: Box): boolean {
  return box.type === 'udta' || (box.type === 'uuid' && hex(b, box.start + box.header, 16) === XMP_UUID);
}

/**
 * The whole file in memory. `inPlace` skips the copy, for callers that own the bytes
 * (the server's sweep), so a 50 MB video never needs twice the memory.
 */
export function scrubIsobmff(input: Uint8Array, inPlace = false): Uint8Array {
  if (sniff(input) !== 'isobmff') throw new ScrubError('not an ISO media file');
  const b = inPlace ? input : input.slice();
  for (const top of boxes(b, 0, b.length)) {
    if (top.type === 'meta') scrubHeifMeta(b, top);
    if (isMetaTop(b, top)) rename(b, top);
    if (top.type === 'moov') scrubMoov(b, top);
  }
  return b;
}

export type { Box };
export { boxes };

/** Scrubs any supported file. Returns the cleaned bytes, or throws ScrubError. */
export function scrubBytes(b: Uint8Array, inPlace = false): Uint8Array {
  switch (sniff(b)) {
    case 'jpeg':
      return scrubJpeg(b);
    case 'png':
      return scrubPng(b);
    case 'webp':
      return scrubWebp(b);
    case 'gif':
      return scrubGif(b);
    case 'isobmff':
      return scrubIsobmff(b, inPlace);
    case 'webm':
      return b;
    default:
      throw new ScrubError('not a photo or video Backlot can clean');
  }
}
