// "Add treehouse to your Home Screen": a card for people using treehouse in a browser tab on a phone.
// Android/Chrome gets the real one-tap install prompt when the browser offers it; everyone else
// (iPhone, Samsung Internet, in-app browsers) gets short steps for their browser.

import { h, icon, sheet, toast, store } from './hy-ui.js';

const UA = navigator.userAgent;
const nativeApp = /TreehouseApp\//.test(UA);
const isIOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(UA);
const inAppBrowser = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|TikTok|musical_ly|Twitter|WhatsApp/i.test(UA);
const iosOtherBrowser = isIOS && /CriOS|FxiOS|EdgiOS|OPiOS/.test(UA);
const samsung = /SamsungBrowser/i.test(UA);

export const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// Only offered on phones and tablets, in a browser, when treehouse isn't already on the Home Screen.
export const canSuggest = () => !nativeApp && !installed() && (isIOS || isAndroid);

// Chrome on Android offers a real install prompt; keep it for when the person taps Install.
let deferred = null;
const listeners = new Set();
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; listeners.forEach((fn) => fn()); });
window.addEventListener('appinstalled', () => { deferred = null; store.set('hy-installed', true); listeners.forEach((fn) => fn()); });
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

const step = (...parts) => h('li', {}, ...parts);
const shareIcon = () => h('span', { class: 'kbd-icon', 'aria-label': 'Share' }, icon('share', 'sm'));

function stepsFor() {
  if (inAppBrowser) return {
    title: 'Open treehouse in your browser first',
    intro: 'You’re inside another app’s browser, which can’t add treehouse to your Home Screen.',
    steps: [
      step('Tap the ', h('b', {}, '⋯'), ' or ', h('b', {}, '⋮'), ' menu at the top of this screen.'),
      step('Choose ', h('b', {}, isIOS ? 'Open in Safari' : 'Open in browser'), ' (or ', h('b', {}, 'Open in Chrome'), ').'),
      step('Then come back here and tap ', h('b', {}, 'Add to Home Screen'), ' again.')],
  };
  if (isIOS) return {
    title: 'Add treehouse to your Home Screen',
    intro: iosOtherBrowser ? 'This works best in Safari, but you can do it here too:' : 'It takes a few seconds:',
    steps: [
      step('Tap the ', shareIcon(), ' ', h('b', {}, 'Share'), ' button', iosOtherBrowser ? ' (in the address bar or menu).' : ' at the bottom of Safari.'),
      step('Scroll down and tap ', h('b', {}, 'Add to Home Screen'), '.'),
      step('Tap ', h('b', {}, 'Add'), '. Then open treehouse from your Home Screen.')],
    note: 'Don’t see the Share button? Tap the address bar once and it appears.',
  };
  if (samsung) return {
    title: 'Add treehouse to your Home screen',
    intro: 'In Samsung Internet:',
    steps: [
      step('Tap the ', h('b', {}, '☰'), ' menu at the bottom right.'),
      step('Tap ', h('b', {}, 'Add page to'), ', then ', h('b', {}, 'Home screen'), '.'),
      step('Tap ', h('b', {}, 'Add'), '. Then open treehouse from your Home screen.')],
  };
  return {
    title: 'Add treehouse to your Home screen',
    intro: 'In Chrome:',
    steps: [
      step('Tap the ', h('b', {}, '⋮'), ' menu at the top right.'),
      step('Tap ', h('b', {}, 'Add to Home screen'), ' or ', h('b', {}, 'Install app'), '.'),
      step('Tap ', h('b', {}, 'Install'), ' (or ', h('b', {}, 'Add'), '). Then open treehouse from your Home screen.')],
  };
}

export function installSheet() {
  const s = stepsFor();
  sheet((close) => [
    h('div', { class: 'install-art' }, h('img', { src: '/icon-192.png', alt: '', width: 64, height: 64 })),
    h('h2', { class: 'center' }, s.title),
    h('p', { class: 'muted center' }, s.intro),
    h('ol', { class: 'steps-list' }, s.steps),
    s.note ? h('p', { class: 'tiny muted' }, s.note) : null,
    h('p', { class: 'small muted' }, 'You’ll get the full-screen app with its own icon, and you can turn on notifications for new messages and matches.'),
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn btn-primary btn-block', onclick: close }, 'Got it'))], { label: s.title });
}

// Tap "Add to Home Screen": the browser's own prompt where there is one, otherwise the steps.
export async function install(after) {
  if (deferred) {
    const e = deferred;
    deferred = null;
    try {
      await e.prompt();
      const { outcome } = await e.userChoice;
      if (outcome === 'accepted') toast('treehouse is on your Home screen', 'check');
    } catch { installSheet(); }
    if (after) after();
    return;
  }
  installSheet();
}

const DISMISS = 'hy-install-dismissed';
const dismissedRecently = () => Date.now() - store.get(DISMISS, 0) < 5 * 24 * 3600 * 1000;

// Card on Home. Hidden once installed, in the app builds, on computers, or for a few days after "Not now".
export function installCard(refresh) {
  if (!canSuggest() || dismissedRecently() || store.get('hy-installed', false)) return null;
  return h('div', { class: 'card install-card' },
    h('img', { class: 'install-icon', src: '/icon-192.png', alt: '', width: 48, height: 48 }),
    h('div', { class: 'grow' },
      h('b', {}, 'Get the treehouse app'),
      h('p', { class: 'small muted' }, 'Add it to your Home Screen: it opens full screen, like a real app, and can notify you about new messages.')),
    h('div', { class: 'push-actions' },
      h('button', { class: 'btn btn-primary btn-sm', onclick: () => install(refresh) }, icon('plus', 'sm'), 'Add to Home Screen'),
      h('button', { class: 'btn btn-soft btn-sm', onclick: () => { store.set(DISMISS, Date.now()); refresh(); } }, 'Not now')));
}

// Row for Profile, always available on phones until it's installed.
export function installRow() {
  if (!canSuggest()) return null;
  return h('button', { class: 'settings-row', onclick: () => install() }, icon('plus'),
    h('span', { class: 'grow' }, 'Add to Home Screen', h('span', { class: 'sub' }, 'Use treehouse like an app, with its own icon')),
    h('span', { class: 'chev' }, icon('chev', 'sm')));
}
