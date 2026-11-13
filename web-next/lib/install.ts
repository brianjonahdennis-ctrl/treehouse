'use client';
// "Add treehouse to your Home Screen" (port of anon-inbox/public/hy-install.js): the browser's own
// one-tap install prompt where there is one (Chrome on Android), otherwise short steps.
import { store } from './util';

const UA = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);
export const nativeApp = () => /TreehouseApp\//.test(UA());
export const isIOS = () => /iPhone|iPad|iPod/.test(UA()) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/i.test(UA());
export const inAppBrowser = () => /FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|TikTok|musical_ly|Twitter|WhatsApp/i.test(UA());
export const iosOtherBrowser = () => isIOS() && /CriOS|FxiOS|EdgiOS|OPiOS/.test(UA());
export const samsung = () => /SamsungBrowser/i.test(UA());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
export const canSuggest = () => !nativeApp() && !installed() && (isIOS() || isAndroid());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let deferred: any = null;
const listeners = new Set<() => void>();
let watching = false;
/** Start listening for the browser's install offer (call once on start-up). */
export function watchInstall() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; listeners.forEach((fn) => fn()); });
  window.addEventListener('appinstalled', () => { deferred = null; store.set('hy-installed', true); listeners.forEach((fn) => fn()); });
}
export const onChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** Use the browser's own prompt if it offered one. 'accepted' | 'dismissed' | null (no prompt: show steps). */
export async function prompt(): Promise<string | null> {
  if (!deferred) return null;
  const e = deferred;
  deferred = null;
  try { await e.prompt(); const { outcome } = await e.userChoice; return outcome; } catch { return null; }
}

const DISMISS = 'hy-install-dismissed';
export const dismissedRecently = () => Date.now() - (store.get<number>(DISMISS, 0) || 0) < 5 * 24 * 3600 * 1000;
export const dismiss = () => store.set(DISMISS, Date.now());
export const showCard = () => canSuggest() && !dismissedRecently() && !store.get('hy-installed', false);
