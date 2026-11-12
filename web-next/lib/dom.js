// A tiny element builder for the few screens kept as plain browser code (Speed Dating's video call),
// the same as h()/icon()/avatar() in anon-inbox/public/hy-ui.js. Text always goes in as text, never HTML.
import { PATHS } from './icons';
import { avatarBg, initials } from './util';
import { cachedAvatar } from './avatars';
import { normalize, pictureOf } from './avatar-core.js';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', `icon ${cls}`.trim());
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = PATHS[name] || '';   // our own fixed icon markup only
  return s;
}

// Initials on a colour from the name, or their custom avatar when we already know it.
export function avatar(seed, label, cls = '') {
  const el = h('span', { class: `avatar ${cls}`.trim(), style: { '--av': avatarBg(seed || '') }, 'aria-hidden': 'true' });
  const cfg = seed ? cachedAvatar(seed) : null;
  if (cfg) {
    const c = normalize(cfg);
    el.classList.add('has-av');
    el.append(h('span', { class: `av-svg av-modern av-bg-${c.b}` }, h('img', { src: pictureOf(c, 96), alt: '', draggable: 'false' })));
  } else el.textContent = initials(label || seed || '?');
  return el;
}
