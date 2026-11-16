'use client';
// Message-timing check (Hydra, 15 Nov 2026): why do messages reach the Android app later than the website?
// Each phone counts, anonymously: app or website, how the live connection is doing (joined / errors /
// timeouts / backup route), and how many seconds each incoming message took to arrive. Every 5 minutes
// (and when treehouse leaves the screen) the totals go to /api/live-stats, which logs a summary per
// platform. No names, no message text, no account ids. Switches itself off after STOP.
const STOP = Date.parse('2026-11-22T00:00:00Z');
const on = () => typeof window !== 'undefined' && Date.now() < STOP;

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent || '');
function platform() {
  const u = ua();
  const app = /TreehouseApp\//.test(u);
  if (/Android/i.test(u)) return app ? 'android-app' : 'android-web';
  if (/iPhone|iPad|iPod/.test(u)) return app ? 'ios-app' : 'ios-web';
  return app ? 'other-app' : 'desktop-web';
}
const chrome = () => Number((/Chrome\/(\d+)/.exec(ua()) || [])[1] || 0);

let skew = 0;           // server clock − this phone's clock (ms)
let skewOk = false;
let d: number[] = [];   // delays, ms
let c: Record<string, number> = {};
let visibleSince = 0, visibleMs = 0;
const bump = (k: string, n = 1) => { c[k] = (c[k] || 0) + n; };

async function syncClock() {
  try {
    const t0 = Date.now();
    const r = await fetch('/api/live-stats', { cache: 'no-store' });
    const t1 = Date.now();
    const j = await r.json();
    if (j && j.now) { skew = j.now - (t0 + t1) / 2; skewOk = (t1 - t0) < 3000; }
  } catch { /* try again next flush */ }
}

/** A message from someone else just arrived live. `source`: 'chat' (open chat) or 'inbox' (chat list). */
export function arrived(source: string, createdAt?: string) {
  if (!on() || !createdAt || !skewOk || document.hidden) return;
  const ms = Date.now() + skew - Date.parse(createdAt);
  if (!isFinite(ms) || ms < -5000) return;
  if (ms > 600000) { bump(`${source}_over10min`); return; }
  // Every incoming message reaches the phone through the inbox signal (an open chat shows it from there
  // too), so that's the one timed; the open chat's own channel is only counted, to avoid timing twice.
  if (source === 'inbox') { d.push(Math.max(0, ms)); bump('inbox_n'); } else bump('chat_n');
  if (d.length > 400) d = d.slice(-400);
}
/** A live channel changed state ('chat' / 'inbox' + SUBSCRIBED, CHANNEL_ERROR, TIMED_OUT, CLOSED, fallback). */
export function status(kind: string, st: string) { if (on()) bump(`${kind}_${st}`); }
/** Catch-up found messages the live connection had missed. */
export function missed(n: number) { if (on() && n > 0) { bump('missed_msgs', n); bump('missed_events'); } }

function flush(beacon = false) {
  if (!on()) return;
  if (visibleSince) { visibleMs += Date.now() - visibleSince; visibleSince = document.hidden ? 0 : Date.now(); }
  if (!d.length && !Object.keys(c).length) return;
  const body = JSON.stringify({ p: platform(), cv: chrome(), vis: Math.round(visibleMs / 1000), d: d.map(Math.round), c, skew: Math.round(skew) });
  d = []; c = {}; visibleMs = 0;
  try {
    if (beacon && navigator.sendBeacon) navigator.sendBeacon('/api/live-stats', new Blob([body], { type: 'application/json' }));
    else fetch('/api/live-stats', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
  } catch { /* never mind */ }
}

let started = false;
export function startLiveStats() {
  if (started || !on()) return;
  started = true;
  visibleSince = document.hidden ? 0 : Date.now();
  syncClock();
  setInterval(() => { flush(); if (!skewOk) syncClock(); }, 5 * 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush(true);
    else { visibleSince = Date.now(); bump('returns'); }
  });
}
