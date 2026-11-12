// treehouse UI kit: element builder, icons, avatars, sheets, toasts, formatting.
// Everything is built with h() so user text always goes in as text, never as HTML.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;            // only ever used with our own icon markup
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// ---- Icons (24px line icons) ------------------------------------------------------------
const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  inbox: '<path d="M4 4h16v12H4z" opacity="0"/><path d="M21 12h-5l-2 3h-4l-2-3H3"/><path d="M5.5 5h13L21 12v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6z"/>',
  flame: '<path d="M12 22c4 0 7-2.7 7-7 0-3.5-2.4-6.2-4-8-.4 2-1.6 3.3-3 3.8C12.6 7.6 11.4 4.7 9 2c0 4-4 6.6-4 13 0 4.3 3 7 7 7z"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8 3.6 4.5 7.1 4.5c2 0 3.5 1.1 4.9 2.8 1.4-1.7 2.9-2.8 4.9-2.8 3.5 0 5.6 3.5 4.4 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/>',
  chat: '<path d="M21 12a8.5 8.5 0 0 1-12.4 7.5L3 21l1.6-5A8.5 8.5 0 1 1 21 12z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  rooms: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.8"/><path d="M16.2 14.1c3-.2 5.3 2 5.3 5.4"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  share: '<path d="M12 3v13"/><path d="m7 8 5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="3"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M9 7V4h6v3"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  reply: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  dot: '<circle cx="12" cy="12" r="8.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  map: '<path d="M9 4 3 6.5v13.5L9 17.5l6 2.5 6-2.5V4L15 6.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
  minus: '<path d="M5 12h14"/>',
  target: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  sent: '<circle cx="12" cy="12" r="8.5"/><path d="m8.3 12.3 2.6 2.6 5-5.4"/>',
  delivered: '<circle cx="12" cy="12" r="9.5" fill="currentColor" stroke="none"/><path d="m8.3 12.3 2.6 2.6 5-5.4" stroke="#fff"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17 4.5-4.5 3.5 3.5 2.5-2.5 5.5 5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>',
  send: '<path d="M21 3 10 14"/><path d="M21 3 14.5 21l-4-7.5L3 9.5z"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  person: '<circle cx="12" cy="7.5" r="5.5"/><path d="M1 25c0-6.5 5-11 11-11s11 4.5 11 11z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  rewind: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.6"/>',
  pushpin: '<path d="M14.5 3.5 20.5 9.5l-3 1-3.5 3.5.5 4-2 2-4-4-4.5 4.5-1-1L7.5 15l-4-4 2-2 4 .5L13 6z"/>',
  userplus: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3.1-7 7-7s7 3 7 7"/><path d="M19 8v6M16 11h6"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  cake: '<path d="M4 21V12h16v9z"/><path d="M4 16c2 1.5 4 1.5 6 0s4-1.5 6 0 3 1 4 0"/><path d="M12 12V8"/><path d="M12 5.5c.8-.6 1-1.5 0-2.5-1 1-.8 1.9 0 2.5z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  // Speed Dating call controls
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  videooff: '<path d="M16 16v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h2m4 0h5a1 1 0 0 1 1 1v3.3l5-3.3v10"/><path d="m2 2 20 20"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  micoff: '<path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5M5 11a7 7 0 0 0 11.3 5.5M19 11a7 7 0 0 1-.5 2.6M12 18v3"/><path d="m2 2 20 20"/>',
  flip: '<path d="M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2"/><path d="M20 16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2"/><path d="m8 11-3-3-3 3M16 13l3 3 3-3"/>',
  phoneoff: '<path d="M3.6 13.4c5-4.5 11.8-4.5 16.8 0 .5.5.5 1.2.1 1.7l-1.6 1.8a1.2 1.2 0 0 1-1.6.2l-2-1.4a1.2 1.2 0 0 1-.5-1.1l.2-1.6a12 12 0 0 0-5.2 0l.2 1.6c0 .4-.2.9-.5 1.1l-2 1.4a1.2 1.2 0 0 1-1.6-.2l-1.6-1.8a1.2 1.2 0 0 1 .1-1.7z"/>',
  stopwatch: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M10 2h4M19 6l-1.5 1.5"/>',
  pluscircle: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>',
  hydra: '<path d="M12 21c-3.5-1.6-5.5-4.6-5.5-8.2 0-2 .7-3.8 2-5.3"/><path d="M12 21c3.5-1.6 5.5-4.6 5.5-8.2 0-2-.7-3.8-2-5.3"/><path d="M12 21V9"/><circle cx="8.5" cy="5.5" r="2"/><circle cx="15.5" cy="5.5" r="2"/><circle cx="12" cy="6.5" r="2"/>',
};
function svg(attrs, inner) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  s.innerHTML = inner;
  return s;
}
export function icon(name, cls = '') {
  return svg({ class: `icon ${cls}`.trim(), viewBox: '0 0 24 24', 'aria-hidden': 'true' }, PATHS[name] || '');
}
export function logo() {
  return h('a', { class: 'logo', href: '/home', 'aria-label': 'treehouse home' },
    h('img', { class: 'logo-mark', src: '/treehouse-mark.svg', alt: '', width: '36', height: '36' }),
    h('span', { class: 'wordmark' }, 'treehouse', h('i', { class: 'dot', 'aria-hidden': 'true' })));
}

// ---- Avatars --------------------------------------------------------------------------------
// Anonymous people get a colour from their handle, so the same person always looks the same.
const PALETTES = [
  ['#ff3d9a', '#a855f7'], ['#a855f7', '#38bdf8'], ['#f97316', '#ec4899'], ['#14b8a6', '#6366f1'],
  ['#f43f5e', '#f59e0b'], ['#8b5cf6', '#ec4899'], ['#0ea5e9', '#22c55e'], ['#6366f1', '#14b8a6'],
];
export function hash(s) { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) | 0; return Math.abs(x); }
export function avatarBg(seed) { const [a, b] = PALETTES[hash(seed) % PALETTES.length]; return `linear-gradient(135deg, ${a}, ${b})`; }
export function initials(name) {
  const words = String(name || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).filter((w) => !/^\d+$/.test(w));
  return ((words[0] || '?')[0] + (words[1] ? words[1][0] : '')).toUpperCase();
}
export function avatar(seed, label, cls = '') {
  // data-av-handle: hy-avatar.js swaps in the person's custom avatar when they've made one.
  return h('span', { class: `avatar ${cls}`.trim(), style: { '--av': avatarBg(seed) }, 'aria-hidden': 'true', 'data-av-handle': seed }, initials(label || seed));
}

// The "Anonymous" sender: a soft purple silhouette, the same for every message.
export function anonAvatar(cls = '') {
  return h('span', { class: `avatar anon ${cls}`.trim(), 'aria-hidden': 'true' }, svg({ class: 'icon', viewBox: '0 0 24 24' }, PATHS.person));
}

// The deep-purple header used at the top of each screen.
export function hero({ title, sub, top, actions = [], cls = '' } = {}, ...children) {
  return h('header', { class: `hero ${cls}`.trim() },
    top || title || actions.length ? h('div', { class: 'hero-top' }, top || h('h1', {}, title), actions.length ? h('div', { class: 'hero-actions' }, actions) : null) : null,
    top && title ? h('h1', {}, title) : null,
    sub ? h('p', { class: 'sub' }, sub) : null,
    children);
}
export function heroBtn(ico, label, onclick, badgeCount = 0) {
  return h('button', { class: 'hero-btn', 'aria-label': label, onclick }, icon(ico), badgeCount ? h('span', { class: 'badge' }, badgeCount > 99 ? '99+' : badgeCount) : null);
}

// ---- Feedback --------------------------------------------------------------------------------
let toastWrap = null;
export function toast(text, ico = 'check') {
  if (!toastWrap) { toastWrap = h('div', { class: 'toast-wrap', role: 'status', 'aria-live': 'polite' }); document.body.append(toastWrap); }
  const t = h('div', { class: 'toast' }, icon(ico, 'sm'), text);
  toastWrap.replaceChildren(t);
  setTimeout(() => { if (t.isConnected) t.remove(); }, 2600);
}

// A bottom sheet on phones, a centred dialog on wider screens. Returns { close }.
export function sheet(build, { label = 'Dialog', onClose } = {}) {
  const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
  const scrim = h('div', { class: 'scrim' }, box);
  const prevFocus = document.activeElement;
  const close = () => {
    scrim.remove();
    document.removeEventListener('keydown', onKey);
    if (prevFocus && prevFocus.focus) prevFocus.focus();
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', onKey);
  box.append(...[].concat(build(close)).flat(Infinity).filter((x) => x != null && x !== false));
  document.body.append(scrim);
  const first = box.querySelector('input, textarea, button, select');
  if (first) setTimeout(() => first.focus({ preventScroll: true }), 50);
  return { close, box };
}

export function confirmSheet({ title, text, yes = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    sheet((close) => [
      h('h2', {}, title),
      text ? h('p', { class: 'muted' }, text) : null,
      h('div', { class: 'sheet-actions' },
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-dark'} btn-block`, onclick: () => { answered = true; close(); resolve(true); } }, yes),
        h('button', { class: 'btn btn-soft btn-block', onclick: () => close() }, 'Cancel')),
    ], { label: title, onClose: () => { if (!answered) resolve(false); } });
  });
}

export function emptyState(emoji, title, text, ...actions) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-art' }, h('span', {}, emoji)), h('h3', {}, title), h('p', {}, text), ...actions);
}
export function skeletonList(n = 3, cls = 'sk-card') {
  return h('div', { class: 'list', 'aria-busy': 'true', 'aria-label': 'Loading' }, Array.from({ length: n }, () => h('div', { class: `skeleton ${cls}` })));
}

// Single-select (radio) or multi-select chips. Returns { el, value() }.
export function chipGroup(options, { selected = [], multi = false, max = Infinity, onChange } = {}) {
  let picked = new Set([].concat(selected));
  const el = h('div', { class: 'chips', role: multi ? 'group' : 'radiogroup' });
  const render = () => {
    el.replaceChildren(...options.map(([value, label]) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(picked.has(value)),
      onclick: () => {
        if (multi) {
          if (picked.has(value)) picked.delete(value);
          else if (picked.size < max) picked.add(value);
          else return toast(`Pick up to ${max}`, 'sparkles');
        } else picked = new Set([value]);
        render();
        if (onChange) onChange(multi ? [...picked] : value);
      },
    }, label)));
  };
  render();
  return { el, value: () => (multi ? [...picked] : [...picked][0]) };
}

// A dropdown of Nigerian states. `anywhere` adds an "Anywhere in Nigeria" option (value '').
export function stateSelect(states, selected, { anywhere = false, placeholder = 'Choose your state', label } = {}) {
  const el = h('select', { class: 'select', 'aria-label': label || placeholder },
    anywhere ? h('option', { value: '' }, 'Anywhere in Nigeria') : h('option', { value: '', disabled: true }, placeholder),
    states.map((st) => h('option', { value: st }, st === 'FCT' ? 'FCT (Abuja)' : st)));
  el.value = selected || '';
  return el;
}

// ---- Date of birth: Day / Month / Year menus (easier than a calendar on phones) -------------------
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Today's date in Nigeria, as [year, month, day].
export function lagosToday() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date());
  const get = (t) => Number(parts.find((x) => x.type === t).value);
  return [get('year'), get('month'), get('day')];
}
// Full years old on a 'YYYY-MM-DD' date of birth (Nigeria time), like the database works it out.
export function yearsOld(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const [ty, tm, td] = lagosToday();
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}
export const formatDob = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
// value(): 'YYYY-MM-DD', '' if not filled in, or 'invalid' (e.g. 31 February or a future date).
export function dobPicker(initial) {
  const [ty] = lagosToday();
  const pick = (label, opts) => { const el = h('select', { class: 'select', 'aria-label': label }, h('option', { value: '', disabled: true }, label), opts); el.value = ''; return el; };
  const day = pick('Day', Array.from({ length: 31 }, (_, i) => h('option', { value: String(i + 1) }, String(i + 1))));
  const month = pick('Month', MONTHS.map((m, i) => h('option', { value: String(i + 1) }, m)));
  const year = pick('Year', Array.from({ length: 101 }, (_, i) => h('option', { value: String(ty - i) }, String(ty - i))));
  if (initial) { const [y, m, d] = initial.split('-').map(Number); year.value = String(y); month.value = String(m); day.value = String(d); }
  const el = h('div', { class: 'dob-row' }, day, month, year);
  return {
    el,
    value() {
      if (!day.value || !month.value || !year.value) return '';
      const y = Number(year.value), m = Number(month.value), d = Number(day.value);
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (dt.getUTCDate() !== d) return 'invalid';
      const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const [cy, cm, cd] = lagosToday();
      if (iso > `${cy}-${String(cm).padStart(2, '0')}-${String(cd).padStart(2, '0')}`) return 'invalid';
      return iso;
    },
    set disabled(v) { [day, month, year].forEach((s) => { s.disabled = v; }); },
  };
}

export function toggle(checked, onChange, label) {
  const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked, input));
  return h('span', { class: 'toggle' }, input, h('i'));
}

// ---- Formatting ------------------------------------------------------------------------------
export function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export function agoLong(iso) {
  const a = ago(iso);
  return a === 'just now' ? a : /\d[mhd]$/.test(a) ? `${a} ago` : a;
}
export const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export function dayLabel(iso) {
  const d = new Date(iso), today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
export async function shareOrCopy({ title, text, url }) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  }
  return (await copyText(url)) ? 'copied' : 'failed';
}

export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
