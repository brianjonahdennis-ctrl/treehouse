'use client';
// Chat photos: pick (camera or gallery) and shrink on the phone before sending, which also drops the
// photo's location data (port of anon-inbox/public/hy-photos.js). The database decides when photos
// unlock (photos_unlocked); sending and viewing go through lib/api.ts.
export const MAX_PHOTOS = 10;
const MAX_SIDE = 1600;
const MAX_BYTES = 1400000;

export type Prepared = { blob: Blob; w: number; h: number; url: string };

export async function preparePhoto(file: File): Promise<Prepared> {
  if (file.type && !/^image\//.test(file.type)) throw new Error('That file isn’t a photo.');
  let src: ImageBitmap | HTMLImageElement;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    src = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That photo can’t be opened. Try a JPEG or PNG.'));
      img.src = URL.createObjectURL(file);
    });
  }
  const W = src.width || (src as HTMLImageElement).naturalWidth, H = src.height || (src as HTMLImageElement).naturalHeight;
  if (!W || !H) throw new Error('That photo can’t be opened.');
  const k = Math.min(1, MAX_SIDE / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  if ('close' in src) src.close();
  let q = 0.82;
  let blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q));
  while (blob && blob.size > MAX_BYTES && q > 0.4) { q -= 0.14; blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q)); }
  if (!blob || blob.size > MAX_BYTES) throw new Error('That photo is too large.');
  return { blob, w, h, url: URL.createObjectURL(blob) };
}

export function pickFiles(camera: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.hidden = true;
    if (camera) input.setAttribute('capture', 'environment'); else input.multiple = true;
    let done = false;
    const finish = (files: File[]) => { if (done) return; done = true; input.remove(); resolve(files); };
    input.addEventListener('change', () => finish([...(input.files || [])]));
    input.addEventListener('cancel', () => finish([]));
    document.body.append(input);
    input.click();
  });
}
