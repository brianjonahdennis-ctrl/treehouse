'use client';
// Photos in private chats (port of anon-inbox/public/hy-photos.js): pick (camera or gallery), shrink
// on the phone (which also drops the photo's location data), preview and send, blurred until tapped,
// full-screen viewer. Photos unlock after a real conversation: the database decides.
import { useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { Icon } from './ui';
import { openSheet, toast } from './overlay';

export const MAX_PHOTOS = 10;
const MAX_SIDE = 1600;
const MAX_BYTES = 1400000;
export type Prepared = { blob: Blob; w: number; h: number; url: string };

// ---- Prepare: decode, turn upright, shrink, re-save as JPEG (no EXIF/GPS survives a canvas) -----
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
  const W = (src as HTMLImageElement).naturalWidth || src.width, H = (src as HTMLImageElement).naturalHeight || src.height;
  if (!W || !H) throw new Error('That photo can’t be opened.');
  const k = Math.min(1, MAX_SIDE / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k)), ht = Math.max(1, Math.round(H * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = ht;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, ht);
  ctx.drawImage(src, 0, 0, w, ht);
  if ('close' in src) src.close();
  let q = 0.82;
  const toBlob = (qq: number) => new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', qq));
  let blob = await toBlob(q);
  while (blob && blob.size > MAX_BYTES && q > 0.4) { q -= 0.14; blob = await toBlob(q); }
  if (!blob || blob.size > MAX_BYTES) throw new Error('That photo is too large.');
  return { blob, w, h: ht, url: URL.createObjectURL(blob) };
}

// ---- Choosing ---------------------------------------------------------------------------------------
function pickFiles({ camera = false } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.hidden = true;
    if (camera) input.setAttribute('capture', 'environment'); else input.multiple = true;
    let done = false;
    const finish = (files: File[]) => { if (done) return; done = true; input.remove(); resolve(files); };
    input.addEventListener('change', () => finish([...(input.files || [])]));
    input.addEventListener('cancel', () => finish([]));
    document.body.append(input);
    input.click();
  });
}

// "+" button: Camera or Photos.
export function chooseSource(): Promise<'camera' | 'library' | null> {
  return new Promise((resolve) => {
    let picked: 'camera' | 'library' | null = null;
    openSheet((close) => (
      <>
        <h2>Send a photo</h2>
        <div className="ph-sources">
          <button className="ph-source cam" onClick={() => { picked = 'camera'; close(); }}><Icon name="camera" /><span>Camera</span></button>
          <button className="ph-source lib" onClick={() => { picked = 'library'; close(); }}><Icon name="image" /><span>Photos</span></button>
        </div>
      </>
    ), { label: 'Send a photo', onClose: () => resolve(picked) });
  });
}

export async function pickPhotos(source: 'camera' | 'library') {
  const files = await pickFiles({ camera: source === 'camera' });
  if (files.length > MAX_PHOTOS) toast(`Up to ${MAX_PHOTOS} photos at a time`, 'image');
  return files.slice(0, MAX_PHOTOS);
}

// Preview before sending: remove any, then Send (n). Resolves with the prepared photos, or [] if cancelled.
export async function reviewPhotos(files: File[]): Promise<Prepared[]> {
  const list: Prepared[] = [];
  for (const f of files) {
    try { list.push(await preparePhoto(f)); }
    catch (e) { toast((e as Error).message || 'That photo can’t be used', 'x'); }
  }
  if (!list.length) return [];
  return new Promise((resolve) => {
    let result: Prepared[] = [];
    openSheet((close) => <Review initial={list} close={close} onSend={(l) => { result = l; close(); }} />,
      { label: 'Review photos', onClose: () => resolve(result) });
  });
}
function Review({ initial, close, onSend }: { initial: Prepared[]; close: () => void; onSend: (l: Prepared[]) => void }) {
  const [list, setList] = useState(initial);
  useEffect(() => { if (!list.length) close(); }, [list, close]);
  return (
    <>
      <div className="ph-review-head"><h2>Photos</h2><span className="tiny muted">They’ll be blurred until they tap to view.</span></div>
      <div className="ph-review">{list.map((p, i) => (
        <div key={p.url} className="ph-thumb">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.url} alt={`Photo ${i + 1}`} />
          <button className="ph-remove" aria-label="Remove this photo" onClick={() => setList((l) => l.filter((x) => x !== p))}><Icon name="x" cls="sm" /></button>
        </div>))}</div>
      <div className="sheet-actions row">
        <button className="btn btn-ghost" onClick={close}>Cancel</button>
        <button className="btn btn-primary grow" onClick={() => onSend(list.slice())}><Icon name="send" cls="sm" />{`Send (${list.length})`}</button>
      </div>
    </>
  );
}

// Tapped while locked.
export function lockedSheet(reason: 'chat' | 'request') {
  openSheet((close) => (
    <>
      <div className="ph-locked">
        <span className="ph-lock-ico"><Icon name="lock" /></span>
        <h2>Keep chatting first</h2>
        <p>{reason === 'request'
          ? 'Photos unlock after your chat is accepted and you two have chatted enough.'
          : 'You two haven’t chatted enough to exchange pictures yet. Keep the conversation going and photos will unlock.'}</p>
      </div>
      <div className="sheet-actions"><button className="btn btn-primary btn-block" onClick={close}>Okay</button></div>
    </>
  ), { label: 'Photos are locked' });
}

// ---- Showing ----------------------------------------------------------------------------------------
const SEEN_KEY = 'th-photos-seen';
let seen: Set<string> | null = null;
const seenSet = () => {
  if (seen) return seen;
  try { seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { seen = new Set(); }
  return seen!;
};
export const wasSeen = (id: string) => seenSet().has(String(id));
export function markSeen(id: string) {
  const s = seenSet();
  s.add(String(id));
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-400))); } catch {}
}
export const expired = (m: { created_at: string }) => Date.now() - new Date(m.created_at).getTime() > 30 * 864e5;

type PhotoMsg = { id: string; created_at: string; photo?: string | null; photo_w?: number; photo_h?: number };
// The picture inside a chat bubble. Theirs are blurred until tapped once (the parent un-blurs it).
export function PhotoBox({ m, mine, localUrl, blur }: { m: PhotoMsg; mine: boolean; localUrl?: string; blur: boolean }) {
  const [src, setSrc] = useState<string | null>(localUrl || null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const gone = expired(m);
  useEffect(() => {
    if (gone || localUrl || !m.photo) return;
    let alive = true;
    api.photoUrl(m.photo).then((u: string) => { if (alive) setSrc(u); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [m.photo, localUrl, gone]);
  const ratio = m.photo_w && m.photo_h ? Math.max(0.5, Math.min(2, m.photo_w / m.photo_h)) : 4 / 3;
  if (gone || failed) return <div className="ph ph-gone" style={{ aspectRatio: String(ratio) }}><span className="ph-note"><Icon name="image" cls="sm" />{gone ? 'Photo expired' : 'Photo unavailable'}</span></div>;
  return (
    <div className={`ph ${blur && !mine ? 'blur' : ''} ${loaded ? 'loaded' : ''}`.trim()} style={{ aspectRatio: String(ratio) }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt={mine ? 'Photo you sent' : 'Photo'} decoding="async" draggable={false} onLoad={() => setLoaded(true)} /> : null}
      {blur && !mine ? <span className="ph-veil"><Icon name="eye" cls="sm" />Tap to view</span> : null}
    </div>
  );
}

// Full screen: tap outside or ✕ to close; "⋯" for the message options.
export function openViewer(m: PhotoMsg, { onMore }: { onMore?: () => void } = {}) {
  openSheet((close) => <Viewer m={m} close={close} onMore={onMore} />, { label: 'Photo', raw: true });
}
function Viewer({ m, close, onMore }: { m: PhotoMsg; close: () => void; onMore?: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    api.photoUrl(m.photo!).then(setSrc).catch(() => { close(); toast('That photo isn’t available any more', 'image'); });
    return () => document.removeEventListener('keydown', onKey);
  }, [m.photo, close]);
  return (
    <div className="ph-viewer" role="dialog" aria-modal="true" aria-label="Photo" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="ph-viewer-top">
        <button className="plain-btn" aria-label="Close" onClick={close}><Icon name="x" /></button>
        {onMore ? <button className="plain-btn" aria-label="Photo options" onClick={() => { close(); onMore(); }}><Icon name="more" /></button> : <span />}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="Photo" draggable={false} /> : null}
    </div>
  );
}
