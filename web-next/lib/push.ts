'use client';
// Push notifications for the home-screen web app (port of anon-inbox/public/hy-push.js).
// Notifications are private: they never include names or message text. The background worker is
// public/home-sw.js (a copy of the live one), registered for /home.
import * as api from './api';
import { store } from './util';

const UA = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);
const nativeApp = () => /TreehouseApp\//.test(UA());   // the Android/iOS app builds can't use web push
export const isIOS = () => /iPhone|iPad|iPod/.test(UA()) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;

export const isNative = nativeApp;
export const supported = () => !nativeApp() && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
// iPhone/iPad in a Safari tab: notifications only work after "Add to Home Screen".
export const needsInstall = () => !nativeApp() && isIOS() && !standalone();
export const permission = () => ('Notification' in window ? Notification.permission : 'unsupported');
export const isOn = () => supported() && permission() === 'granted' && store.get<boolean>('hy-push-on', false) === true;

let serverKey: string | null | undefined;   // undefined = not checked, null = not set up on the server
export const ready = () => Boolean(serverKey);
export async function available() {
  if (serverKey !== undefined) return Boolean(serverKey);
  try {
    const r = await fetch('/api/push/key');
    serverKey = r.ok ? (await r.json()).key : null;
  } catch { serverKey = null; }
  return Boolean(serverKey);
}

let reg: Promise<ServiceWorkerRegistration | null> | null = null;
export function registerWorker() {
  if (nativeApp() || !('serviceWorker' in navigator)) return Promise.resolve(null);
  reg = reg || navigator.serviceWorker.register('/home-sw.js', { scope: '/home' }).catch(() => null);
  return reg;
}

const bytes = (b64u: string) => {
  const s = atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64u.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const sameKey = (sub: PushSubscription, key: string) => {
  const k = sub.options && sub.options.applicationServerKey;
  if (!k) return true;
  const a = new Uint8Array(k), b = bytes(key);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};

async function subscription(create: boolean) {
  const r = await registerWorker();
  if (!r) return null;
  await navigator.serviceWorker.ready;
  let sub = await r.pushManager.getSubscription();
  if (sub && serverKey && !sameKey(sub, serverKey)) { await sub.unsubscribe().catch(() => {}); sub = null; }
  if (!sub && create && serverKey) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(serverKey) });
  return sub;
}

// Must be called from a tap (iPhone requires it). Resolves to 'granted', 'denied' or 'default'.
export async function enable() {
  if (!supported() || !(await available())) throw new Error('Notifications aren’t available on this device.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm;
  const sub = await subscription(true);
  if (sub) await api.savePushSubscription(sub);
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

const DISMISS = 'hy-push-dismissed';
export const dismissedRecently = () => Date.now() - (store.get<number>(DISMISS, 0) || 0) < 7 * 24 * 3600 * 1000;
export const dismiss = () => store.set(DISMISS, Date.now());
