// Photos in private chats: pick (camera or gallery), shrink on the phone (which also drops the photo's
// location data), preview and send, show blurred until tapped, full-screen viewer.
// Photos unlock after a real conversation (50 messages, some from each of you): the database decides.

import * as api from './hy-api.js';
import { h, icon, toast, sheet } from './hy-ui.js';

export const MAX_PHOTOS = 10;
const MAX_SIDE = 1600;
const MAX_BYTES = 1400000;

// ---- Prepare: decode, turn upright, shrink, re-save as JPEG (no EXIF/GPS survives a canvas) -----
export async function preparePhoto(file) {
  if (file.type && !/^image\//.test(file.type)) throw new Error('That file isn’t a photo.');
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That photo can’t be opened. Try a JPEG or PNG.'));
      img.src = URL.createObjectURL(file);
    });
  }
  const W = src.width || src.naturalWidth, H = src.height || src.naturalHeight;
  if (!W || !H) throw new Error('That photo can’t be opened.');
  const k = Math.min(1, MAX_SIDE / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k)), ht = Math.max(1, Math.round(H * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = ht;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, ht);
  ctx.drawImage(src, 0, 0, w, ht);
  if (src.close) src.close();
  let q = 0.82;
  let blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
  while (blob && blob.size > MAX_BYTES && q > 0.4) { q -= 0.14; blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q)); }
  if (!blob || blob.size > MAX_BYTES) throw new Error('That photo is too large.');
  return { blob, w, h: ht, url: URL.createObjectURL(blob) };
}

// ---- Choosing ---------------------------------------------------------------------------------------
function pickFiles({ camera = false } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*', hidden: true });
    if (camera) input.setAttribute('capture', 'environment'); else input.multiple = true;
    let done = false;
    const finish = (files) => { if (done) return; done = true; input.remove(); resolve(files); };
    input.addEventListener('change', () => finish([...(input.files || [])]));
    input.addEventListener('cancel', () => finish([]));
    document.body.append(input);
    input.click();
  });
}

// "+" button: Camera or Photos, like the design.
export function chooseSource() {
  return new Promise((resolve) => {
    let picked = null;
    sheet((close) => [
      h('h2', {}, 'Send a photo'),
      h('div', { class: 'ph-sources' },
        h('button', { class: 'ph-source cam', onclick: () => { picked = 'camera'; close(); } }, icon('camera'), h('span', {}, 'Camera')),
        h('button', { class: 'ph-source lib', onclick: () => { picked = 'library'; close(); } }, icon('image'), h('span', {}, 'Photos'))),
    ], { label: 'Send a photo', onClose: () => resolve(picked) });
  });
}

export async function pickPhotos(source) {
  const files = await pickFiles({ camera: source === 'camera' });
  if (files.length > MAX_PHOTOS) toast(`Up to ${MAX_PHOTOS} photos at a time`, 'image');
  return files.slice(0, MAX_PHOTOS);
}

// Preview before sending: remove any, then Send (n). Resolves with the prepared photos, or [] if cancelled.
export function reviewPhotos(files) {
  return new Promise(async (resolve) => {
    const list = [];
    for (const f of files) {
      try { list.push(await preparePhoto(f)); }
      catch (e) { toast(e.message || 'That photo can’t be used', 'x'); }
    }
    if (!list.length) return resolve([]);
    let result = [];
    sheet((close) => {
      const grid = h('div', { class: 'ph-review' });
      const sendBtn = h('button', { class: 'btn btn-primary grow' });
      const draw = () => {
        grid.replaceChildren(...list.map((p, i) => h('div', { class: 'ph-thumb' },
          h('img', { src: p.url, alt: `Photo ${i + 1}` }),
          h('button', { class: 'ph-remove', 'aria-label': 'Remove this photo', onclick: () => { list.splice(i, 1); if (!list.length) close(); else draw(); } }, icon('x', 'sm')))));
        sendBtn.replaceChildren(icon('send', 'sm'), `Send (${list.length})`);
      };
      sendBtn.onclick = () => { result = list.slice(); close(); };
      draw();
      return [
        h('div', { class: 'ph-review-head' }, h('h2', {}, 'Photos'), h('span', { class: 'tiny muted' }, 'They’ll be blurred until they tap to view.')),
        grid,
        h('div', { class: 'sheet-actions row' }, h('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'), sendBtn),
      ];
    }, { label: 'Review photos', onClose: () => resolve(result) });
  });
}

// Tapped while locked.
export function lockedSheet(reason) {
  sheet((close) => [
    h('div', { class: 'ph-locked' },
      h('span', { class: 'ph-lock-ico' }, icon('lock')),
      h('h2', {}, 'Keep chatting first'),
      h('p', {}, reason === 'request'
        ? 'Photos unlock after your chat is accepted and you two have chatted enough.'
        : 'You two haven’t chatted enough to exchange pictures yet. Keep the conversation going and photos will unlock.')),
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn btn-primary btn-block', onclick: close }, 'Okay')),
  ], { label: 'Photos are locked' });
}

// ---- Showing ----------------------------------------------------------------------------------------
const SEEN_KEY = 'th-photos-seen';
let seen;
const seenSet = () => {
  if (seen) return seen;
  try { seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { seen = new Set(); }
  return seen;
};
export const wasSeen = (id) => seenSet().has(String(id));
export function markSeen(id) {
  const s = seenSet();
  s.add(String(id));
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-400))); } catch {}
}

export const expired = (m) => Date.now() - new Date(m.created_at).getTime() > 30 * 864e5;

// The picture inside a chat bubble. Theirs are blurred until tapped once.
export function photoBox(m, mine, localUrl) {
  const ratio = m.photo_w && m.photo_h ? Math.max(0.5, Math.min(2, m.photo_w / m.photo_h)) : 4 / 3;
  const box = h('div', { class: 'ph', style: { aspectRatio: String(ratio) } });
  if (expired(m)) {
    box.classList.add('ph-gone');
    box.append(h('span', { class: 'ph-note' }, icon('image', 'sm'), 'Photo expired'));
    return box;
  }
  const blur = !mine && !wasSeen(m.id);
  if (blur) box.classList.add('blur');
  const img = h('img', { alt: mine ? 'Photo you sent' : 'Photo', decoding: 'async', draggable: 'false' });
  img.addEventListener('load', () => box.classList.add('loaded'));
  box.append(img);
  if (blur) box.append(h('span', { class: 'ph-veil' }, icon('eye', 'sm'), 'Tap to view'));
  if (localUrl) img.src = localUrl;
  else if (m.photo) {
    api.photoUrl(m.photo).then((u) => { img.src = u; }).catch(() => {
      box.className = 'ph ph-gone';
      box.replaceChildren(h('span', { class: 'ph-note' }, icon('image', 'sm'), 'Photo unavailable'));
    });
  }
  return box;
}

// Full screen: tap outside or ✕ to close; "⋯" for the message options.
export function openViewer(m, { onMore } = {}) {
  const img = h('img', { alt: 'Photo', draggable: 'false' });
  let el;
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  el = h('div', { class: 'ph-viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photo', onclick: (e) => { if (e.target === el) close(); } },
    h('div', { class: 'ph-viewer-top' },
      h('button', { class: 'plain-btn', 'aria-label': 'Close', onclick: close }, icon('x')),
      onMore ? h('button', { class: 'plain-btn', 'aria-label': 'Photo options', onclick: () => { close(); onMore(); } }, icon('more')) : h('span')),
    img);
  document.body.append(el);
  document.addEventListener('keydown', onKey);
  api.photoUrl(m.photo).then((u) => { img.src = u; }).catch(() => { close(); toast('That photo isn’t available any more', 'image'); });
}
