// treehouse avatars: painted portraits only (the drawn cartoon builder was retired on 11 Nov 2026).
// Two kinds of saved avatar:
//   Painted (customizable): { st: 'paint', k: 'f'|'m', s: '1'|'2'|'3' (skin), h: hairstyle,
//     fh: 'n'|'b' (men: beard), g: 'none'|'glasses'|'shades', o: 'hoodie'|'denim', b: background }
//     Every combination exists as its own painting in /avatars/lib/.
//   Featured look: { st: 'modern', k, p: 'f01'…'f24' | 'm01'…'m22', b } (the 46 looks from the design).
// Old cartoon settings are converted to the closest painted avatar.
// Also: a small cache that finds avatars for nicknames on screen and swaps them in for initials.

import * as api from './hy-api.js';

// ---- Options -----------------------------------------------------------------------------------
export const BACKGROUNDS = [['pink', '#ff4fae', '#a21caf'], ['blue', '#38bdf8', '#2563eb'], ['teal', '#2dd4bf', '#0e7490'], ['sun', '#fde047', '#f59e0b'], ['lilac', '#c4b5fd', '#7c3aed'], ['night', '#4c1d95', '#0b0830']];
export const SKINS = [['1', 'Light', '#c98e62'], ['2', 'Medium', '#9a6038'], ['3', 'Deep', '#5a341c']];
export const HAIR = {
  f: [['braids', 'Box braids'], ['afro', 'Curly afro'], ['silk', 'Silk press'], ['bob', 'Bob'], ['puff', 'Puff'], ['wrap', 'Headwrap']],
  m: [['fade', 'Fade'], ['curly', 'Curly top'], ['locs', 'Locs'], ['bald', 'Bald'], ['durag', 'Durag'], ['cap', 'Cap']],
};
export const BEARD = [['n', 'No beard'], ['b', 'Beard']];
export const EYEWEAR = [['none', 'None'], ['glasses', 'Glasses'], ['shades', 'Shades']];
export const OUTFITS = [['hoodie', 'Hoodie'], ['denim', 'Denim jacket']];

export const PORTRAITS = [
  ...Array.from({ length: 24 }, (_, i) => `f${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 22 }, (_, i) => `m${String(i + 1).padStart(2, '0')}`),
];
export const portraitsFor = (kind) => PORTRAITS.filter((p) => kind === 'x' || kind === 'all' || p[0] === kind);
const PORTRAIT_BG = ['pink', 'lilac', 'blue', 'sun', 'teal', 'pink', 'lilac', 'night'];
export const modernPreset = (p) => ({ st: 'modern', k: p[0], p, b: PORTRAIT_BG[Number(p.slice(1)) % PORTRAIT_BG.length] });
export const paintDefault = (k = 'f', b = 'pink') => ({ st: 'paint', k, s: '2', h: k === 'f' ? 'braids' : 'fade', fh: k === 'f' ? 'n' : 'b', g: 'none', o: 'hoodie', b });

const has = (list, v) => list.some((x) => x[0] === v);
const pick = (list, v, i = 0) => (list.find((x) => x[0] === v) || list[i]);

// Closest painted avatar for an old cartoon config.
function fromCartoon(c) {
  const fHair = { puff: 'puff', braids: 'braids', curly: 'afro', bun: 'puff', long: 'silk', bob: 'bob', ftwists: 'braids', wrap: 'wrap' };
  const mHair = { fade: 'fade', waves: 'fade', hightop: 'curly', twists: 'locs', afro: 'curly', locsm: 'locs', buzz: 'fade', bald: 'bald', none: 'bald' };
  const k = c.k === 'f' || (c.k === 'x' && fHair[c.h]) ? 'f' : 'm';
  const n = Number(c.s);
  let h = k === 'f' ? fHair[c.h] || 'braids' : mHair[c.h] || 'fade';
  if (k === 'm' && (c.hw === 'cap' || c.hw === 'durag')) h = c.hw;
  return {
    st: 'paint', k, s: n >= 5 ? '3' : n >= 3 ? '2' : '1', h,
    fh: k === 'm' && ['beard', 'goatee', 'stache'].includes(c.fh) ? 'b' : 'n',
    g: c.g === 'shades' ? 'shades' : c.g === 'round' || c.g === 'square' ? 'glasses' : 'none',
    o: c.o === 'denim' || c.o === 'bomber' ? 'denim' : 'hoodie', b: c.b,
  };
}

export function normalize(cfg = {}) {
  const bg = (v) => (has(BACKGROUNDS, v) ? v : 'pink');
  if (cfg.st === 'modern') {
    const p = PORTRAITS.includes(cfg.p) ? cfg.p : (cfg.k === 'f' ? 'f01' : 'm01');
    return { st: 'modern', k: p[0], p, b: bg(cfg.b) };
  }
  const c = cfg.st === 'paint' ? cfg : fromCartoon(cfg);
  const k = c.k === 'f' ? 'f' : 'm';
  return {
    st: 'paint', k, s: has(SKINS, c.s) ? c.s : '2', h: has(HAIR[k], c.h) ? c.h : HAIR[k][0][0],
    fh: k === 'm' && c.fh === 'b' ? 'b' : 'n', g: has(EYEWEAR, c.g) ? c.g : 'none', o: has(OUTFITS, c.o) ? c.o : 'hoodie', b: bg(c.b),
  };
}

// Which picture file shows this avatar. Sizes: 96 (lists, chats, rooms), 256 (picker tiles), 640 (big preview).
// The paintings live on Cloudflare (img.treehouse.ng), not on our own server.
const AV = 'https://img.treehouse.ng';
export function pictureOf(raw, size = 96) {
  const c = normalize(raw);
  const px = size === true ? 640 : size === false ? 96 : size;
  if (c.st === 'modern') return `${AV}/avatars/${c.p}-${px}.webp`;
  return `${AV}/avatars/lib/${c.k}-${c.s}-${c.h}${c.k === 'm' ? `-${c.fh}` : ''}-${c.g[0]}-${c.o[0]}-${px}.webp`;
}

// Returns the avatar's markup: a background colour and the painting (only our own fixed classes and
// file names, never user text). The picture loads only when it's on screen ("lazy"), so a room full of
// people doesn't download everyone's avatar at once.
// big: the large picture (previews); size: pick a size directly.
export function avatarSVG(raw, { big = false, size } = {}) {
  const c = normalize(raw);
  const px = size || (big ? 640 : 96);
  return `<span class="av-svg av-modern av-bg-${c.b}"><img src="${pictureOf(c, px)}" alt="" loading="lazy" decoding="async" draggable="false"></span>`;
}

// ---- Avatars for nicknames on screen ------------------------------------------------------------
const cache = new Map();        // handle -> config | null (no avatar)
const pending = new Set();
let timer = null;

export function setCachedAvatar(handle, cfg) { cache.set(handle, cfg || null); upgrade(document.body); }
export const cachedAvatar = (handle) => cache.get(handle);

function paint(el, cfg) {
  if (el.dataset.avPainted === JSON.stringify(cfg)) return;
  el.dataset.avPainted = JSON.stringify(cfg);
  if (cfg) { el.innerHTML = avatarSVG(cfg); el.classList.add('has-av'); }
  else if (el.dataset.avInitials != null) { el.textContent = el.dataset.avInitials; el.classList.remove('has-av'); }
}

function upgrade(root) {
  if (!root || !root.querySelectorAll) return;
  const els = root.matches && root.matches('[data-av-handle]') ? [root, ...root.querySelectorAll('[data-av-handle]')] : [...root.querySelectorAll('[data-av-handle]')];
  for (const el of els) {
    const handle = el.dataset.avHandle;
    if (!handle) continue;
    if (el.dataset.avInitials == null) el.dataset.avInitials = el.textContent;
    if (cache.has(handle)) paint(el, cache.get(handle));
    else pending.add(handle);
  }
  if (pending.size && !timer) timer = setTimeout(fetchPending, 60);
}

async function fetchPending() {
  timer = null;
  const handles = [...pending].slice(0, 100);
  handles.forEach((x) => pending.delete(x));
  if (!handles.length || !api.sb) return;
  try {
    const rows = await api.getAvatars(handles);
    handles.forEach((x) => cache.set(x, null));
    rows.forEach((r) => cache.set(r.handle, r.config));
    upgrade(document.body);
  } catch { handles.forEach((x) => cache.set(x, null)); }
  if (pending.size) timer = setTimeout(fetchPending, 60);
}

// Watch the page: any avatar placeholder that appears gets its custom avatar when there is one.
export function startAvatars() {
  upgrade(document.body);
  new MutationObserver((list) => { for (const m of list) m.addedNodes.forEach((n) => { if (n.nodeType === 1) upgrade(n); }); })
    .observe(document.body, { childList: true, subtree: true });
}
