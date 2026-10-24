import { isMetaTop, scrubBytes, scrubMoov, ScrubError, sniff, type Box } from '../../supabase/functions/_shared/scrub';

// Cleans a photo or video on this device before it is uploaded, so its location, device
// and owner details never leave the phone. See supabase/functions/_shared/scrub.ts for
// what is removed. A file that cannot be cleaned safely is refused, never kept as it is.

export { ScrubError };

/** Big videos are cleaned without loading the picture data into memory. */
const STREAM_FROM = 8 * 1024 * 1024;

async function bytes(blob: Blob, from: number, to: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(from, to).arrayBuffer());
}

/** Reads only box headers and the small metadata boxes; the picture data is passed through untouched. */
async function scrubVideo(file: File): Promise<Blob> {
  const parts: BlobPart[] = [];
  let at = 0;
  while (at + 8 <= file.size) {
    const head = await bytes(file, at, Math.min(at + 16, file.size));
    let size = ((head[0] << 24) >>> 0) + (head[1] << 16) + (head[2] << 8) + head[3];
    let header = 8;
    if (size === 1) {
      size = (((head[8] << 24) >>> 0) + (head[9] << 16) + (head[10] << 8) + head[11]) * 2 ** 32 + ((head[12] << 24) >>> 0) + (head[13] << 16) + (head[14] << 8) + head[15];
      header = 16;
    } else if (size === 0) size = file.size - at;
    if (size < header || at + size > file.size) throw new ScrubError('bad box in video');
    const type = String.fromCharCode(head[4], head[5], head[6], head[7]);
    if (type === 'moov' || type === 'udta' || type === 'uuid' || type === 'meta') {
      if (size > 64 * 1024 * 1024) throw new ScrubError('metadata box too large');
      const box = await bytes(file, at, at + size);
      const one: Box = { type, start: 0, header, end: box.length };
      if (type === 'moov') scrubMoov(box, one);
      else if (type === 'meta' || isMetaTop(box, one)) {
        // A top-level meta box in a video holds only metadata; HEIC files never come here.
        for (let i = 0; i < 4; i++) box[4 + i] = 'free'.charCodeAt(i);
        box.fill(0, header, box.length);
      }
      parts.push(box as Uint8Array<ArrayBuffer>);
    } else parts.push(file.slice(at, at + size));
    at += size;
  }
  if (at !== file.size) parts.push(file.slice(at));
  return new Blob(parts, { type: file.type });
}

/** The same file with its metadata removed, or throws ScrubError. */
export async function scrubFile(file: File): Promise<File> {
  const head = await bytes(file, 0, 16);
  const kind = sniff(head);
  const brand = String.fromCharCode(...head.subarray(8, 12));
  const isImageBrand = /^(heic|heix|hevc|heim|heis|mif1|msf1|avif|avis)$/.test(brand);
  let out: Blob;
  if (kind === 'isobmff' && !isImageBrand && file.size >= STREAM_FROM) out = await scrubVideo(file);
  else out = new Blob([scrubBytes(new Uint8Array(await file.arrayBuffer()), true) as Uint8Array<ArrayBuffer>], { type: file.type });
  return new File([out], file.name, { type: file.type });
}
