// Push notifications for the home-screen web app: turning them on and off, and keeping this device
// linked to whoever is signed in. Notifications are private: they never include names or message text.

import * as api from './hy-api.js';
import { h, icon, sheet, toast, toggle, store } from './hy-ui.js';

const UA = navigator.userAgent;
const nativeApp = /TreehouseApp\//.test(UA);   // the Android/iOS app builds can't use web push
export const isIOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// Can this browser receive push at all?
export const supported = () => !nativeApp && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
// iPhone/iPad in a Safari tab: notifications only work after "Add to Home Screen".
export const needsInstall = () => !nativeApp && isIOS && !standalone;
export const permission = () => ('Notification' in window ? Notification.permission : 'unsupported');
export const isOn = () => supported() && permission() === 'granted' && store.get('hy-push-on', false) === true;

let serverKey;   // undefined = not checked, null = notifications not set up on the server
export const ready = () => Boolean(serverKey);
export async function available() {
  if (serverKey !== undefined) return Boolean(serverKey);
  try {
    const r = await fetch('/api/push/key');
    serverKey = r.ok ? (await r.json()).key : null;
  } catch { serverKey = null; }
  return Boolean(serverKey);
}

let reg;
export function registerWorker() {
  if (nativeApp || !('serviceWorker' in navigator)) return Promise.resolve(null);
  reg = reg || navigator.serviceWorker.register('/home-sw.js', { scope: '/home' }).catch(() => null);
  return reg;
}

const bytes = (b64u) => {
  const s = atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64u.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const sameKey = (sub, key) => {
  const k = sub.options && sub.options.applicationServerKey;
  if (!k) return true;
  const a = new Uint8Array(k), b = bytes(key);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};

async function subscription(create) {
  const r = await registerWorker();
  if (!r) return null;
  await navigator.serviceWorker.ready;
  let sub = await r.pushManager.getSubscription();
  if (sub && serverKey && !sameKey(sub, serverKey)) { await sub.unsubscribe().catch(() => {}); sub = null; }
  if (!sub && create) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(serverKey) });
  return sub;
}

// Must be called from a tap (iPhone requires it). Resolves to 'granted', 'denied' or 'default'.
export async function enable() {
  if (!supported() || !(await available())) throw new Error('Notifications aren’t available on this device.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm;
  const sub = await subscription(true);
  await api.savePushSubscription(sub);
  store.set('hy-push-on', true);
  return 'granted';
}

export async function disable() {
  store.set('hy-push-on', false);
  const sub = await subscription(false).catch(() => null);
  if (!sub) return;
  await api.deletePushSubscription(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

// On start-up: if notifications are on, make sure this device is saved for the account signed in now.
export async function sync() {
  if (!isOn() || !(await available())) return;
  try {
    const sub = await subscription(true);
    if (sub) await api.savePushSubscription(sub);
  } catch {}
}

// Before signing out: stop sending this account's notifications to this device.
export async function forget() {
  try {
    const r = await registerWorker();
    const sub = r && await r.pushManager.getSubscription();
    if (sub) await api.deletePushSubscription(sub.endpoint);
  } catch {}
}

// ---- On-screen controls ----------------------------------------------------------------------------
const DISMISS = 'hy-push-dismissed';
const dismissedRecently = () => Date.now() - store.get(DISMISS, 0) < 7 * 24 * 3600 * 1000;

export function installSheet() {
  sheet((close) => [
    h('h2', {}, '🔔 Notifications on iPhone'),
    h('p', { class: 'muted' }, 'iPhone only sends notifications to apps on your Home Screen. It takes a few seconds:'),
    h('ol', { class: 'steps-list' },
      h('li', {}, 'Open treehouse in ', h('b', {}, 'Safari'), '.'),
      h('li', {}, 'Tap the ', h('b', {}, 'Share'), ' button (the square with an arrow).'),
      h('li', {}, 'Choose ', h('b', {}, 'Add to Home Screen'), ', then ', h('b', {}, 'Add'), '.'),
      h('li', {}, 'Open treehouse from your Home Screen and turn on notifications in Profile.')),
    h('p', { class: 'tiny muted' }, 'Needs iOS 16.4 or newer.'),
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn btn-primary btn-block', onclick: close }, 'Got it'))], { label: 'Notifications on iPhone' });
}

function blockedSheet() {
  sheet((close) => [
    h('h2', {}, 'Notifications are blocked'),
    h('p', { class: 'muted' }, isIOS
      ? 'Open your iPhone Settings → Notifications → treehouse, and turn on Allow Notifications.'
      : 'Open your phone Settings → Apps → your browser (or treehouse) → Notifications, and allow them for treehouse. In Chrome you can also tap the lock icon next to the address.'),
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn btn-primary btn-block', onclick: close }, 'OK'))], { label: 'Notifications are blocked' });
}

async function turnOn(after) {
  try {
    const r = await enable();
    if (r === 'granted') toast('Notifications are on', 'bell');
    else if (r === 'denied') blockedSheet();
  } catch (e) { toast(e.message || 'Couldn’t turn on notifications', 'x'); }
  if (after) after();
}

// Card on Home asking to turn notifications on (or how to, on iPhone in Safari).
export function pushCard(refresh) {
  if (dismissedRecently()) return null;
  const notNow = h('button', { class: 'btn btn-soft btn-sm', onclick: () => { store.set(DISMISS, Date.now()); refresh(); } }, 'Not now');
  const card = (text, btn) => h('div', { class: 'card push-card' },
    h('span', { class: 'push-icon' }, icon('bell')),
    h('div', { class: 'grow' }, h('b', {}, 'Never miss a message'), h('p', { class: 'small muted' }, text)),
    h('div', { class: 'push-actions' }, btn, notNow));
  if (needsInstall()) return null;   // the "Add to Home Screen" card covers this
  if (!supported() || !ready() || isOn() || permission() === 'denied') return null;
  return card('Get a notification when someone messages, likes or matches with you.',
    h('button', { class: 'btn btn-primary btn-sm', onclick: () => turnOn(refresh) }, 'Turn on'));
}

// Row for Profile → Notifications.
export function pushSettingsRow(refresh) {
  const rowEl = (sub, control, onclick) => h(onclick ? 'button' : 'div', { class: 'settings-row', style: onclick ? null : { cursor: 'default' }, onclick },
    icon('bell'), h('span', { class: 'grow' }, 'Push notifications', h('span', { class: 'sub' }, sub)), control);
  if (needsInstall()) return rowEl('Add treehouse to your Home Screen first', h('span', { class: 'chev' }, icon('chev', 'sm')), installSheet);
  if (nativeApp) return rowEl('Coming soon in the app. For now, use treehouse from your Home Screen', null);
  if (!supported()) return rowEl('Not available in this browser', null);
  if (!ready()) return rowEl('Not available right now', null);
  if (permission() === 'denied') return rowEl('Blocked in your phone settings. Tap to see how to allow them', h('span', { class: 'chev' }, icon('chev', 'sm')), blockedSheet);
  return rowEl(isOn() ? 'On for this device. They never show names or messages' : 'Get notified about messages, likes and matches',
    toggle(isOn(), async (on, input) => {
      if (on) { await turnOn(); input.checked = isOn(); }
      else { await disable(); toast('Notifications are off', 'bell'); }
      refresh();
    }, 'Push notifications'));
}
