'use client';
// Pictures every member downloads (announcement covers, ads) are shrunk before upload: at most
// 1200 px wide, WebP (or JPEG where the browser can't make WebP) at ~0.8 quality. A 1.4 MB picture
// usually becomes 100-250 KB and looks the same on a phone. GIFs and already-small files are left as they are.
export async function shrinkImage(file: File, maxSide = 1200): Promise<File> {
  if (typeof document === 'undefined' || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 120_000) return file;
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { return file; }
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); if (!x) return file;
  x.drawImage(bmp, 0, 0, w, h); bmp.close();
  const make = (type: string, q: number) => new Promise<Blob | null>((r) => c.toBlob(r, type, q));
  let blob = await make('image/webp', 0.8);
  if (!blob || blob.type !== 'image/webp') { x.globalCompositeOperation = 'destination-over'; x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); blob = await make('image/jpeg', 0.8); }
  if (!blob || blob.size >= file.size) return file;
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, '') + '.' + ext, { type: blob.type });
}
