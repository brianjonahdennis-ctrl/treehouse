// "Choose Your Avatar" and "Customize Avatar". Every avatar is painted:
//   Choose    – the 46 featured looks from the design, plus your own painted avatar.
//   Customize – build a painted avatar trait by trait: Style (outfit), Hair, Face (skin tone, beard),
//               Accessories (glasses or shades) and Background. Each choice shows the real painting.
// Male profiles only see male options, female profiles only female; non-binary profiles see all.

import * as api from './hy-api.js';
import { h, icon, toast, logo } from './hy-ui.js';
import { state } from './hy-state.js';
import { avatarSVG, normalize, BACKGROUNDS, SKINS, HAIR, BEARD, EYEWEAR, OUTFITS, setCachedAvatar, cachedAvatar,
  portraitsFor, modernPreset, paintDefault } from './hy-avatar.js';

const kindOf = () => (state.profile && state.profile.gender === 'female' ? 'f' : state.profile && state.profile.gender === 'male' ? 'm' : 'x');
const face = (cfg, cls = '') => {
  const el = h('span', { class: `av-face ${cls}`.trim() });
  el.innerHTML = avatarSVG(cfg, { size: /\bxl\b/.test(cls) ? 640 : 256 });   // our own fixed colours and pictures only
  return el;
};
const same = (a, b) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

function page(cls, ...children) {
  const el = h('section', { class: `av-page ${cls}`, role: 'dialog', 'aria-modal': 'true' }, ...children);
  document.body.append(el);
  document.body.style.overflow = 'hidden';
  return el;
}
function closePage(el) { el.remove(); if (!document.querySelector('.av-page, .chat')) document.body.style.overflow = ''; }

async function save(cfg, el) {
  const kind = kindOf();
  const clean = normalize(cfg);
  if (kind !== 'x' && clean.k !== kind) return toast('Pick an avatar that matches your profile', 'x');
  try {
    await api.setMyAvatar(clean);
    setCachedAvatar(state.profile.handle, clean);
    toast('Avatar saved', 'check');
    closePage(el);
    document.querySelectorAll('.av-page').forEach((p) => closePage(p));
  } catch (e) { toast(api.friendly(e), 'x'); }
}

// Where Customize starts: your painted avatar, or a painted one matching your profile.
function paintStart(cfg) {
  const kind = kindOf();
  const c = cfg ? normalize(cfg) : null;
  if (c && c.st === 'paint') return c;
  return paintDefault(c ? c.k : kind === 'm' ? 'm' : 'f', c ? c.b : 'pink');
}

// ---- Choose Your Avatar ------------------------------------------------------------------------
export function openAvatarPicker() {
  const kind = kindOf();
  let filter = kind === 'x' ? 'all' : kind;
  const mine = cachedAvatar(state.profile.handle);
  const myPaint = mine && normalize(mine).st === 'paint' ? normalize(mine) : null;
  let current = mine ? normalize(mine) : modernPreset(portraitsFor(kind === 'x' ? 'all' : kind)[0]);
  const preview = h('div', { class: 'av-preview' });
  const grid = h('div', { class: 'av-grid' });
  const tile = (cfg, label) => h('button', { class: `av-tile ${same(cfg, current) ? 'on' : ''}`, 'aria-label': label,
    'aria-pressed': String(same(cfg, current)), onclick: () => { current = normalize(cfg); draw(); } }, face(cfg));
  const draw = () => {
    preview.replaceChildren(face(current, 'xl'));
    grid.replaceChildren(
      ...(myPaint && (filter === 'all' || filter === myPaint.k) ? [tile(myPaint, 'Your custom avatar')] : []),
      ...portraitsFor(filter).map((p) => tile(modernPreset(p), 'Choose this avatar')));
  };
  const pills = kind === 'x' ? h('div', { class: 'cr-pills av-pills' }, [['all', 'All'], ['m', '♂ Male'], ['f', '♀ Female']].map(([id, label]) =>
    h('button', { class: `cr-pill ${filter === id ? 'on' : ''}`, onclick: (e) => { filter = id; e.currentTarget.parentElement.querySelectorAll('.cr-pill').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); draw(); } }, label))) : null;
  let el;
  el = page('av-choose',
    h('div', { class: 'av-top' }, h('button', { class: 'plain-btn', 'aria-label': 'Back', onclick: () => closePage(el) }, icon('back')), logo(), h('span')),
    h('div', { class: 'av-head' }, h('h1', {}, 'Choose Your Avatar'), h('p', {}, 'Create a unique look for your treehouse profile.')),
    preview, pills, grid,
    h('div', { class: 'av-actions' },
      h('button', { class: 'btn btn-soft btn-block', onclick: () => save(current, el) }, 'Use this avatar'),
      h('button', { class: 'av-cta', onclick: () => openAvatarEditor(current) }, icon('sparkles', 'sm'), 'Customize Avatar')));
  draw();
}

// ---- Customize Avatar --------------------------------------------------------------------------
const TABS = [
  ['style', 'Style', 'user'],
  ['hair', 'Hair', 'sparkles'],
  ['face', 'Face', 'smile'],
  ['acc', 'Accessories', 'eye'],
  ['bg', 'Background', 'image'],
];

export function openAvatarEditor(start) {
  const kind = kindOf();
  let cfg = paintStart(start || cachedAvatar(state.profile.handle));
  if (kind !== 'x' && cfg.k !== kind) cfg = paintDefault(kind, cfg.b);
  let tab = 'style';
  const preview = h('div', { class: 'av-preview big' });
  const tabsEl = h('div', { class: 'av-tabs', role: 'tablist' });
  const body = h('div', { class: 'av-body' });
  const set = (next) => { cfg = normalize(next); draw(); };

  // A row of choices, each showing the real painting it gives.
  const row = (title, key, list) => h('section', { class: 'av-sec' }, h('h3', {}, title),
    h('div', { class: 'av-row' }, list.map(([v, label]) => {
      const next = normalize({ ...cfg, [key]: v });
      return h('button', { class: `av-opt ${cfg[key] === v ? 'on' : ''}`, 'aria-label': label, 'aria-pressed': String(cfg[key] === v), onclick: () => set(next) },
        face(next), h('span', {}, label));
    })));
  const swatches = (title, key, list, bg) => h('section', { class: 'av-sec' }, h('h3', {}, title),
    h('div', { class: 'av-swatches' }, list.map((item) => h('button', { class: `av-swatch ${cfg[key] === item[0] ? 'on' : ''}`, 'aria-label': item[1] || item[0],
      'aria-pressed': String(cfg[key] === item[0]), style: { background: bg(item) }, onclick: () => set({ ...cfg, [key]: item[0] }) }))));

  const draw = () => {
    preview.replaceChildren(face(cfg, 'xl'), h('span', { class: 'av-pencil' }, icon('edit', 'sm')));
    tabsEl.replaceChildren(...TABS.map(([id, label, ico]) => h('button', { role: 'tab', 'aria-selected': String(tab === id), class: tab === id ? 'on' : '', onclick: () => { tab = id; draw(); } }, icon(ico), h('span', {}, label))));
    const parts = {
      style: [row('Outfit', 'o', OUTFITS),
        kind === 'x' ? h('section', { class: 'av-sec' }, h('h3', {}, 'Avatar type'), h('div', { class: 'cr-pills' },
          [['m', 'Masculine'], ['f', 'Feminine']].map(([v, label]) => h('button', { class: `cr-pill ${cfg.k === v ? 'on' : ''}`,
            onclick: () => set({ ...paintDefault(v, cfg.b), s: cfg.s, g: cfg.g, o: cfg.o }) }, label)))) : null],
      hair: [row('Hairstyle', 'h', HAIR[cfg.k])],
      face: [swatches('Skin tone', 's', SKINS, (c) => c[2]), cfg.k === 'm' ? row('Facial hair', 'fh', BEARD) : null],
      acc: [row('Eyewear', 'g', EYEWEAR)],
      bg: [swatches('Background', 'b', BACKGROUNDS, (c) => `linear-gradient(135deg, ${c[1]}, ${c[2]})`)],
    }[tab];
    body.replaceChildren(...parts.filter(Boolean));
  };

  let el;
  el = page('av-edit',
    h('div', { class: 'av-top' },
      h('button', { class: 'plain-btn', 'aria-label': 'Back', onclick: () => closePage(el) }, icon('back')),
      h('h1', {}, 'Customize Avatar'),
      h('button', { class: 'av-save', onclick: () => save(cfg, el) }, 'Save')),
    preview, tabsEl, body);
  draw();
}
