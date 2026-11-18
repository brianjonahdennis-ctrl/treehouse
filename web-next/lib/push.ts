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

// The Android app (1.8+) has Firebase notifications through the Capacitor PushNotifications plugin.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cap = (): any => (typeof window !== 'undefined' ? (window as any).Capacitor : null);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const capPush = (): any => {
  const c = cap();
  if (!c || !c.isNativePlatform || !c.isNativePlatform() || c.getPlatform() !== 'android') return null;
  if (c.isPluginAvailable && !c.isPluginAvailable('PushNotifications')) return null;
  return (c.Plugins && c.Plugins.PushNotifications) || null;
};
/** In the Android app with notifications built in. */
export const appPush = () => nativeApp() && !!capPush();
/** In an older Android app (1.6/1.7) that can't get notifications until it's updated. */
export const appNeedsUpdate = () => nativeApp() && /Android/i.test(UA()) && !capPush();
export const isNative = nativeApp;
export const supported = () => appPush() || (!nativeApp() && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
// iPhone/iPad in a Safari tab: notifications only work after "Add to Home Screen".
export const needsInstall = () => !nativeApp() && isIOS() && !standalone();
let appPerm: NotificationPermission = 'default';   // the Android app's answer (checked at start-up)
export const permission = () => (appPush() ? appPerm : 'Notification' in window ? Notification.permission : 'unsupported');
export const isOn = () => supported() && permission() === 'granted' && store.get<boolean>('hy-push-on', false) === true;

// ---- Android app: Firebase device token -----------------------------------------------------------
const toPerm = (r: string): NotificationPermission => (r === 'granted' ? 'granted' : r === 'denied' ? 'denied' : 'default');
async function appChannels() {
  const P = capPush();
  // Android groups notifications into channels people can tune in Settings; the server picks one.
  await P.createChannel({ id: 'treehouse', name: 'Messages and matches', description: 'New messages, requests, likes, matches and friends', importance: 4, visibility: 0, vibration: true }).catch(() => {});
  await P.createChannel({ id: 'calls', name: 'Calls', description: 'Incoming and missed calls', importance: 5, visibility: 0, vibration: true }).catch(() => {});
}
function appToken(): Promise<string> {
  const P = capPush();
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hs: any[] = [];
    const done = (fn: () => void) => { clearTimeout(t); hs.forEach((h) => h && h.remove && h.remove()); fn(); };
    const t = setTimeout(() => done(() => reject(new Error('The phone didn’t answer. Try again in a moment.'))), 20000);
    Promise.all([
      P.addListener('registration', (tok: { value: string }) => done(() => resolve(tok.value))),
      P.addListener('registrationError', () => done(() => reject(new Error('Couldn’t turn on notifications on this phone.')))),
    ]).then((h) => { hs.push(...h); return P.register(); }).catch((e: Error) => done(() => reject(e)));
  });
}
async function appEnable(ask: boolean): Promise<NotificationPermission> {
  const P = capPush();
  let r = (await P.checkPermissions()).receive;
  if (ask && r !== 'granted' && r !== 'denied') r = (await P.requestPermissions()).receive;
  appPerm = toPerm(r);
  if (appPerm !== 'granted') return appPerm;
  await appChannels();
  const tok = await appToken();
  await api.saveNativePush(tok);
  store.set('hy-app-push-token', tok);
  return 'granted';
}
/** Android app: learn the permission, and open the right screen when a notification is tapped. */
export async function watchApp(open: (url: string) => void) {
  const P = capPush();
  if (!P) return;
  try { appPerm = toPerm((await P.checkPermissions()).receive); } catch { /* ask later */ }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  P.addListener('pushNotificationActionPerformed', (a: any) => {
    const url = a && a.notification && a.notification.data && a.notification.data.url;
    open(typeof url === 'string' && url.startsWith('/home') ? url : '/home');
  });
}

let serverKey: string | null | undefined;   // undefined = not checked, null = not set up on the server
export const ready = () => Boolean(serverKey);
export async function available() {
  if (appPush()) { serverKey = serverKey || 'app'; return true; }
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
  if (appPush()) {
    const r = await appEnable(true);
    if (r === 'granted') store.set('hy-push-on', true);
    return r;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm;
  const sub = await subscription(true);
  if (sub) await api.savePushSubscription(sub);
  store.set('hy-push-on', true);
  return 'granted';
}

export async function disable() {
  store.set('hy-push-on', false);
  if (appPush()) {
    const tok = store.get<string>('hy-app-push-token', '');
    if (tok) await api.deletePushSubscription(`fcm:${tok}`).catch(() => {});
    await capPush().unregister().catch(() => {});
    return;
  }
  const sub = await subscription(false).catch(() => null);
  if (!sub) return;
  await api.deletePushSubscription(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

// On start-up: if notifications are on, make sure this device is saved for the account signed in now.
export async function sync() {
  if (!isOn() || !(await available())) return;
  if (appPush()) { try { await appEnable(false); } catch { /* try again next start */ } return; }
  try {
    const sub = await subscription(true);
    if (sub) await api.savePushSubscription(sub);
  } catch {}
}

// Before signing out: stop sending this account's notifications to this device.
export async function forget() {
  if (appPush()) {
    const tok = store.get<string>('hy-app-push-token', '');
    if (tok) await api.deletePushSubscription(`fcm:${tok}`).catch(() => {});
    return;
  }
  try {
    const r = await registerWorker();
    const sub = r && await r.pushManager.getSubscription();
    if (sub) await api.deletePushSubscription(sub.endpoint);
  } catch {}
}

const DISMISS = 'hy-push-dismissed';
export const dismissedRecently = () => Date.now() - (store.get<number>(DISMISS, 0) || 0) < 7 * 24 * 3600 * 1000;
export const dismiss = () => store.set(DISMISS, Date.now());
