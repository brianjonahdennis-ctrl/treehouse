// Speed Dating: three-minute anonymous one-on-one video dates.
//   Discover banner → landing (what it is, your preferences, safety) → camera & microphone check →
//   queue (the database pairs two compatible people) → video call (WebRTC; call setup passes through
//   the date's private channel; video goes through Cloudflare's relay when needed) → three minutes on
//   the database's clock → Like or Pass, privately → match (an ordinary chat in Matches) or "Date complete".
// Rules (who can be paired, the clock, decisions, matches) are enforced in the database, not here.
// Calls are never recorded. Not shown in the iPhone app for now (App Store review).

import * as api from './hy-api.js';
import { h, icon, toast, sheet, confirmSheet, avatar } from './hy-ui.js';
import { state, nav, go, loadDating, stateLabel } from './hy-state.js';
import { editPrefs } from './hy-profile.js';

const DATE_MINUTES = 5;
const ua = navigator.userAgent || '';
const appVersion = (/TreehouseApp\/(\d+)\.(\d+)/.exec(ua) || []).slice(1).map(Number);
const inApp = appVersion.length === 2 || !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const iosApp = inApp && /iPhone|iPad|iPod/i.test(ua);
// The Android app needs version 1.7+ for camera and microphone.
const oldAndroidApp = inApp && !iosApp && appVersion.length === 2 && (appVersion[0] < 1 || (appVersion[0] === 1 && appVersion[1] < 7));

let config = null;
const loadConfig = () => (config ? Promise.resolve(config) : api.speedConfig().then((c) => (config = c || { enabled: false })));

// ---- Breaks (the database decides) ------------------------------------------------------------------------
// Two reasons Speed Dating greys out with a countdown: 5 dates used in 24 hours ('limit'), or a
// match in the last 12 hours ('match': time to get to know them).
const loadQuota = () => api.speedQuota().catch(() => null);
const coolingDown = (q) => !!(q && q.available_at);
const matchBreak = (q) => coolingDown(q) && q.reason === 'match';
function untilText(q, clockOffset = 0) {
  const ms = Math.max(0, new Date(q.available_at).getTime() - (Date.now() + clockOffset));
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
// A live countdown in `el`; when it reaches zero, `done()` runs (e.g. redraw as available again).
function countdown(el, q, done) {
  const offset = q.now ? new Date(q.now).getTime() - Date.now() : 0;
  let shown = false;
  const tick = () => {
    if (el.isConnected) shown = true;
    else if (shown) return clearInterval(t);   // left the screen: stop (but wait for it to appear first)
    el.textContent = untilText(q, offset);
    if (new Date(q.available_at).getTime() <= Date.now() + offset) { clearInterval(t); if (done) done(); }
  };
  const t = setInterval(tick, 1000); tick();
}

// ---- Discover banner ---------------------------------------------------------------------------------
export function speedBanner() {
  if (iosApp || !state.profile || state.profile.suspended) return null;
  const tag = h('span', { class: 'sd-tag' }, h('i'), 'Speed Dating');
  const sub = h('span', { class: 'sd-sub' }, '3-minute anonymous video dates with real people.');
  const cta = h('span', { class: 'sd-cta' }, 'Start Speed Dating', icon('chev', 'sm'));
  const el = h('button', { class: 'sd-banner', onclick: () => openSpeedDating(), 'aria-label': 'Speed Dating: 3-minute anonymous video dates' },
    h('span', { class: 'sd-banner-art', 'aria-hidden': 'true' },
      h('span', { class: 'sd-art-call' }, h('span', { class: 'sd-art-face a' }), h('span', { class: 'sd-art-face b' })),
      h('span', { class: 'sd-art-watch' }, icon('stopwatch', 'sm'))),
    h('span', { class: 'sd-banner-text' }, tag, h('b', {}, 'Speed Dating'), sub, cta));
  // Honest status: "Live now" only when the service is on and people are waiting.
  Promise.all([loadConfig(), api.speedWaiting().catch(() => 0), loadQuota()]).then(([c, waiting, q]) => {
    if (!c.enabled) { tag.replaceChildren(icon('clock', 'sm'), 'Coming soon'); tag.classList.add('off'); cta.replaceChildren('See how it works', icon('chev', 'sm')); return; }
    if (coolingDown(q)) {
      el.classList.add('cool');
      tag.replaceChildren(icon('clock', 'sm'), 'Cooling down'); tag.classList.add('off');
      const left = h('b', { class: 'sd-count' });
      sub.replaceChildren(matchBreak(q) ? 'You matched recently 💞 Next speed date in ' : `You’ve had your ${q.limit} speed dates for today. Next date in `, left);
      countdown(left, q, () => { el.replaceWith(speedBanner() || h('span')); });
      cta.replaceChildren('See details', icon('chev', 'sm'));
      return;
    }
    if (waiting > 0) { tag.replaceChildren(h('i'), 'Live now'); sub.textContent = waiting >= 3 ? `${waiting} people waiting for a date right now.` : '3-minute anonymous video dates with real people.'; }
    else { tag.replaceChildren(icon('video', 'sm'), 'Find a date'); sub.textContent = 'Join the queue and we’ll pair you with someone new.'; }
  });
  return el;
}

// ---- Full-screen pages ---------------------------------------------------------------------------------
let page = null;
let flow = null;   // { stream, session, pc, channel, timers… } for the date in progress

// Android app: screenshots and screen recordings come out black while Speed Dating is open.
// (Browsers can't block them; the watermark on the video and the rules deter it instead.)
function secureScreen(on) {
  try { const p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SecureScreen; if (p && p.set) p.set({ on }).catch(() => {}); } catch {}
}

function show(...children) {
  if (!page) {
    secureScreen(true);
    page = h('section', { class: 'sd-page', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Speed Dating' });
    document.body.append(page);
    document.body.style.overflow = 'hidden';
  }
  page.replaceChildren(...children);
  page.scrollTop = 0;
}
function closeAll() {
  stopFlow();
  secureScreen(false);
  if (page) page.remove();
  page = null;
  if (!document.querySelector('.av-page, .chat, .sd-page')) document.body.style.overflow = '';
}
const topBar = (title, onBack) => h('div', { class: 'sd-top' },
  h('button', { class: 'plain-btn', 'aria-label': 'Back', onclick: onBack }, icon('back')),
  h('b', {}, title), h('span'));

// ---- Landing ---------------------------------------------------------------------------------------------
export async function openSpeedDating() {
  const c = await loadConfig();
  const p = state.profile;
  const prefs = h('div', { class: 'sd-prefs' });
  const drawPrefs = () => prefs.replaceChildren(
    h('div', { class: 'sd-pref' }, h('small', {}, 'Looking for'), h('b', {}, whoLabel(p))),
    h('div', { class: 'sd-pref' }, h('small', {}, 'Ages'), h('b', {}, `${p.min_age}–${p.max_age >= 99 ? '99+' : p.max_age}`)),
    h('div', { class: 'sd-pref' }, h('small', {}, 'Where'), h('b', {}, p.pref_state ? stateLabel(p.pref_state) : 'All of Nigeria')));
  drawPrefs();
  const waitingEl = h('p', { class: 'sd-waiting' });
  if (c.enabled) api.speedWaiting().then((n) => { if (n >= 3) waitingEl.textContent = `${n} people are waiting for a date right now`; }).catch(() => {});

  const q = c.enabled ? await loadQuota() : null;
  let primary;
  if (c.enabled && coolingDown(q)) {
    const left = h('b', { class: 'sd-count' });
    primary = matchBreak(q)
      ? h('div', { class: 'stack' },
        h('div', { class: 'sd-break' },
          h('span', { class: 'sd-break-ico' }, '💞'),
          h('b', {}, 'You’ve already matched once in the last 12 hours'),
          h('p', {}, 'Go build a bond with your recent match, then come back when the countdown ends.')),
        q.match_conversation ? h('button', { class: 'btn btn-primary btn-block', onclick: () => { const c = q.match_conversation; closeAll(); nav.openChat(c); } }, icon('chat', 'sm'), 'Chat with your match') : null,
        h('button', { class: 'btn btn-block sd-go cool', disabled: true, 'aria-disabled': 'true' }, icon('clock', 'sm'), 'Next speed date in ', left))
      : h('div', { class: 'stack' },
        h('button', { class: 'btn btn-block sd-go cool', disabled: true, 'aria-disabled': 'true' }, icon('clock', 'sm'), 'Next date in ', left),
        h('p', { class: 'small muted center' }, `You’ve had ${q.limit} speed dates in the last 24 hours. Speed Dating opens again when the timer runs out.`));
    countdown(left, q, () => openSpeedDating());
  } else if (!c.enabled) primary = h('div', { class: 'notice' }, icon('clock', 'sm'), h('span', {}, h('b', {}, 'Speed Dating is almost here. '), 'Video dates aren’t switched on yet. Check back soon.'));
  else if (oldAndroidApp) primary = h('div', { class: 'stack' }, h('div', { class: 'notice' }, icon('info', 'sm'), h('span', {}, h('b', {}, 'Update treehouse to video date. '), 'This version of the app can’t use the camera. Update from Google Play, or open treehouse.ng in your browser.')),
    h('a', { class: 'btn btn-primary btn-block', href: 'https://play.google.com/store/apps/details?id=com.brianjonahdennis.treehouse', target: '_blank', rel: 'noopener' }, 'Update treehouse'));
  else if (!p.is_active) primary = h('div', { class: 'notice' }, icon('pause', 'sm'), h('span', {}, 'Your dating profile is paused. Turn it on in Profile to speed date.'));
  else primary = h('button', { class: 'btn btn-primary btn-block sd-go', onclick: () => openCheck() }, icon('video', 'sm'), 'Start Speed Dating');

  show(
    topBar('Speed Dating', closeAll),
    h('div', { class: 'sd-body' },
      h('div', { class: 'sd-hero' },
        h('div', { class: 'sd-hero-art', 'aria-hidden': 'true' },
          h('span', { class: 'sd-hero-frame a' }, h('span', { class: 'sd-art-face a' })),
          h('span', { class: 'sd-hero-frame b' }, h('span', { class: 'sd-art-face b' })),
          h('span', { class: 'sd-hero-timer' }, icon('stopwatch', 'sm'), '03:00')),
        h('h1', {}, 'Three minutes. One connection. No pressure.'),
        h('p', {}, 'Meet someone new through a private anonymous video date. If you both like each other, you can continue chatting.'),
        q && !coolingDown(q) ? h('span', { class: 'sd-left' }, icon('video', 'sm'), `${q.left} of ${q.limit} speed dates left today`) : null,
        waitingEl),
      h('div', { class: 'sd-steps' },
        step('🎥', 'A 3-minute video date', 'One-on-one, with someone whose preferences match yours.'),
        step('❤️', 'Like or pass, privately', 'Nobody sees your choice. Only two likes make a match.'),
        step('💬', 'Match? Keep talking', 'You’ll find each other in Matches, still anonymous.')),
      h('section', { class: 'sd-card' },
        h('div', { class: 'row-between' }, h('b', {}, 'Your dating preferences'),
          h('button', { class: 'link-btn small', onclick: () => { editPrefs(); waitPrefs(drawPrefs); } }, 'Dating Preferences')),
        prefs,
        h('p', { class: 'tiny muted' }, 'The same preferences as Discover. You’ll only be paired with someone who fits yours, and whose preferences you fit.')),
      h('section', { class: 'sd-card sd-safety' },
        h('b', {}, icon('shield', 'sm'), 'Before you start'),
        h('ul', {},
          h('li', {}, 'This is a video call: the other person sees and hears you. Your front camera stays on for the whole date (no audio-only dates), and a date ends if a camera is covered or turned off. Your name, email and phone number are never shown.'),
          h('li', {}, 'Calls are never recorded by treehouse. Screenshots and recordings of dates aren’t allowed: they get accounts banned. Your nickname is shown faintly over the video you see, so leaks can be traced.'),
          h('li', {}, 'Don’t share your full name, address or contact details. You can end the call, report or block at any time.'),
          h('li', {}, 'Speed Dating is for adults 18 and over.'))),
      primary));
}
const step = (emoji, title, text) => h('div', { class: 'sd-step' }, h('span', { class: 'sd-step-ico' }, emoji), h('span', {}, h('b', {}, title), h('small', {}, text)));
function whoLabel(p) {
  const who = p.interested_in || [];
  if (!who.length || who.length >= 3) return 'Everyone';
  return who.map((g) => ({ female: 'Women', male: 'Men', other: 'Non-binary' }[g])).join(' & ');
}
// Redraw the summary after the preferences sheet saves.
function waitPrefs(redraw) {
  const t = setInterval(() => { if (!document.querySelector('.sheet')) { clearInterval(t); redraw(); } }, 400);
}

// Show a stream in a <video> and make sure it actually starts (some web views miss the first play()).
function attach(video, stream) {
  if (video.srcObject !== stream) video.srcObject = stream;
  const go = () => video.play().catch(() => {});
  video.onloadedmetadata = go;
  go();
  setTimeout(() => { if (video.isConnected && video.readyState < 2) go(); }, 600);
  setTimeout(() => { if (video.isConnected && video.readyState < 2) go(); }, 1800);
}

// ---- Camera & microphone check ----------------------------------------------------------------------------
async function openCheck() {
  flow = flow || {};
  const video = h('video', { class: 'sd-preview', autoplay: true, muted: true, playsinline: true });
  video.muted = true;
  const camState = h('span', { class: 'sd-perm' }, icon('video', 'sm'), 'Camera', h('em', {}, 'Checking…'));
  const micState = h('span', { class: 'sd-perm' }, icon('mic', 'sm'), 'Microphone', h('em', {}, 'Checking…'));
  const meter = h('span', { class: 'sd-meter' }, h('i'));
  const help = h('div');
  const agree = h('input', { type: 'checkbox' });
  const next = h('button', { class: 'btn btn-primary btn-block', disabled: true, onclick: () => {
    if (!agree.checked) return toast('Please tick the box first', 'info');
    openQueue();
  } }, 'Continue');
  show(
    topBar('Camera & microphone', () => { stopFlow(); openSpeedDating(); }),
    h('div', { class: 'sd-body' },
      h('div', { class: 'sd-preview-wrap' }, video),
      h('div', { class: 'sd-perms' }, camState, micState),
      h('div', { class: 'sd-mictest' }, h('small', {}, 'Say something to test your microphone'), meter),
      help,
      h('p', { class: 'small muted' }, 'Your camera and microphone are needed for the video date. They’re only on while you’re in Speed Dating.'),
      h('label', { class: 'check' }, agree, h('span', {}, 'I understand the other person will see and hear me, and I’ll keep my face on camera for the whole date. I won’t share personal details, and I won’t screenshot or record the date.')),
      next,
      h('button', { class: 'btn btn-soft btn-block', onclick: () => { stopFlow(); openSpeedDating(); } }, 'Not now')));
  try {
    await startCamera(video);
    camState.querySelector('em').textContent = 'Ready'; camState.classList.add('ok');
    micState.querySelector('em').textContent = 'Ready'; micState.classList.add('ok');
    next.disabled = false;
    listenMeter(meter);
  } catch (e) {
    const denied = /denied|notallowed|permission/i.test(`${e && (e.name || '')} ${e && (e.message || '')}`);
    camState.querySelector('em').textContent = denied ? 'Blocked' : 'Not found'; camState.classList.add('bad');
    micState.querySelector('em').textContent = denied ? 'Blocked' : 'Not found'; micState.classList.add('bad');
    help.replaceChildren(h('div', { class: 'notice warn' }, icon('info', 'sm'), h('span', {},
      denied
        ? (inApp ? 'treehouse needs your camera and microphone. Open your phone’s Settings → Apps → treehouse → Permissions, allow Camera and Microphone, then come back.'
                 : 'Your browser blocked the camera or microphone. Tap the lock icon next to treehouse.ng in the address bar, allow Camera and Microphone, then try again.')
        : 'We couldn’t find a working camera and microphone on this device.'),
      h('button', { class: 'btn btn-white btn-sm', onclick: () => openCheck() }, 'Try again')));
  }
}

// Front camera only (Speed Dating is face to face). Phones get exactly the front camera; computers,
// whose webcams don't say which way they face, get their usual camera.
async function startCamera(video) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('NotSupported');
  const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  const size = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } };
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: 'user' }, ...size }, audio }); }
  catch (e) {
    if (/denied|notallowed|permission/i.test(`${e && e.name} ${e && e.message}`)) throw e;
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', ...size }, audio });
  }
  if (flow && flow.stream) flow.stream.getTracks().forEach((t) => t.stop());
  flow.stream = stream;
  attach(video, stream);
  return stream;
}
// Camera stopped mid-date (the phone took it away)? Get the front camera back and keep sending it.
async function restartCamera() {
  try {
    const s2 = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
    const track = s2.getVideoTracks()[0];
    const old = flow.stream.getVideoTracks()[0];
    if (old) { flow.stream.removeTrack(old); old.stop(); }
    flow.stream.addTrack(track);
    if (flow.pc) { const sender = flow.pc.getSenders().find((x) => x.track === null || (x.track && x.track.kind === 'video')); if (sender) await sender.replaceTrack(track); }
    if (flow.ui) { flow.ui.local.srcObject = null; attach(flow.ui.local, flow.stream); }
    return true;
  } catch { return false; }
}
function listenMeter(meter) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx(); const src = ctx.createMediaStreamSource(flow.stream); const an = ctx.createAnalyser();
    an.fftSize = 256; src.connect(an); const data = new Uint8Array(an.frequencyBinCount);
    flow.audioCtx = ctx;
    const tick = () => {
      if (!meter.isConnected) return;
      an.getByteFrequencyData(data); const level = Math.min(1, data.reduce((a, b) => a + b, 0) / data.length / 60);
      meter.firstChild.style.width = `${Math.round(level * 100)}%`;
      requestAnimationFrame(tick);
    };
    tick();
  } catch {}
}

// ---- Queue ------------------------------------------------------------------------------------------------
async function openQueue() {
  if (flow && flow.audioCtx) { try { flow.audioCtx.close(); } catch {} flow.audioCtx = null; }
  const status = h('p', { class: 'sd-qstatus' }, 'Joining the queue…');
  const self = h('video', { class: 'sd-qself', autoplay: true, muted: true, playsinline: true });
  self.muted = true; attach(self, flow.stream);
  const started = Date.now();
  show(
    h('div', { class: 'sd-queue' },
      h('div', { class: 'sd-rings', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('span', { class: 'sd-ring-core' }, self)),
      h('h1', {}, 'Finding your speed date…'),
      status,
      h('p', { class: 'small muted' }, 'This can take a moment. We only pair you with someone whose preferences match yours.'),
      h('button', { class: 'btn btn-soft', onclick: cancelQueue }, 'Cancel')));
  flow.queueing = true;
  const handle = (r) => {
    if (!flow || !flow.queueing || !r) return;
    if (r.id) { flow.queueing = false; clearTimeout(flow.pollTimer); if (flow.qch) flow.qch.leave(); startDate(r); return; }
    if (r.status === 'limit') { flow.queueing = false; clearTimeout(flow.pollTimer); if (flow.qch) flow.qch.leave(); stopMedia(); flow = null; openSpeedDating(); return; }
    const secs = Math.round((Date.now() - started) / 1000);
    status.textContent = secs < 20 ? 'You’re in the queue' : `Still looking… ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  };
  const poll = async () => {
    if (!flow || !flow.queueing) return;
    try { handle(await api.speedPoll()); } catch (e) { status.textContent = api.friendly(e); }
    if (flow && flow.queueing) flow.pollTimer = setTimeout(poll, 3000 + Math.random() * 1500);
  };
  try {
    flow.qch = api.speedQueueChannel(state.user.id, () => { if (flow && flow.queueing) { clearTimeout(flow.pollTimer); poll(); } });
    handle(await api.speedJoin());
    if (flow && flow.queueing) flow.pollTimer = setTimeout(poll, 3000);
  } catch (e) { status.textContent = api.friendly(e); }
}
async function cancelQueue() {
  if (flow) { flow.queueing = false; clearTimeout(flow.pollTimer); if (flow.qch) flow.qch.leave(); }
  api.speedLeaveQueue().catch(() => {});
  closeAll();
}

// ---- The video date ------------------------------------------------------------------------------------
async function startDate(s) {
  flow.session = s; flow.ended = false;
  const remote = h('video', { class: 'sd-remote', autoplay: true, playsinline: true });
  const local = h('video', { class: 'sd-local', autoplay: true, muted: true, playsinline: true });
  local.muted = true; attach(local, flow.stream);
  const timer = h('span', { class: 'sd-timer' }, icon('stopwatch', 'sm'), h('b', {}, '03:00'));
  const quality = h('span', { class: 'sd-quality', title: 'Connection' }, h('i'), h('i'), h('i'));
  const overlay = h('div', { class: 'sd-overlay' }, h('div', { class: 'spinner' }), h('p', {}, 'Connecting your video…'));
  // Your own nickname and the time, faintly across the video you're watching: a screenshot or
  // recording shows who made it.
  const mark = h('div', { class: 'sd-watermark', 'aria-hidden': 'true' });
  // Camera must stay on: a warning for you if yours is covered or off, a notice if theirs is.
  const camWarn = h('div', { class: 'sd-camwarn', hidden: true, role: 'alert' });
  const theirCam = h('div', { class: 'sd-camnote', hidden: true }, icon('videooff', 'sm'), 'Their camera is off. The date ends if it doesn’t come back.');
  const drawMark = () => {
    const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date());
    const text = `${(state.profile && state.profile.handle) || 'treehouse'} · ${t}`;
    mark.replaceChildren(...Array.from({ length: 18 }, () => h('span', {}, text)));
  };
  drawMark();
  const micBtn = h('button', { class: 'sd-ctl', 'aria-label': 'Mute microphone', onclick: () => {
    const t = flow.stream.getAudioTracks()[0]; if (!t) return; t.enabled = !t.enabled;
    micBtn.replaceChildren(icon(t.enabled ? 'mic' : 'micoff')); micBtn.classList.toggle('off', !t.enabled);
    micBtn.setAttribute('aria-label', t.enabled ? 'Mute microphone' : 'Unmute microphone');
  } }, icon('mic'));
  const endBtn = h('button', { class: 'sd-ctl end', 'aria-label': 'End call', onclick: async () => {
    if (!(await confirmSheet({ title: 'End this date?', text: 'The call ends for both of you.', yes: 'End call', danger: true }))) return;
    api.speedEnd(s.id).catch(() => {}); finishCall();
  } }, icon('phoneoff'));
  const moreBtn = h('button', { class: 'sd-ctl', 'aria-label': 'Report or block', onclick: () => reportSheet(s) }, icon('flag'));
  const other = s.other || {};
  show(h('div', { class: 'sd-call' },
    remote, mark, overlay,
    h('div', { class: 'sd-call-top' },
      h('span', { class: 'sd-who' }, avatar(other.handle, other.handle, 'sm'), h('span', {}, h('b', {}, other.handle || 'Your date'), h('small', {}, [other.age, other.state ? stateLabel(other.state) : ''].filter(Boolean).join(' · ')))),
      h('span', { class: 'sd-call-meta' }, quality, timer)),
    local,
    camWarn, theirCam,
    h('div', { class: 'sd-controls' }, micBtn, moreBtn, endBtn)));
  flow.ui = { remote, local, timer, overlay, quality, camWarn, theirCam };
  flow.markTimer = setInterval(drawMark, 30000);

  // Live channel: call setup messages and "ended".
  // Call setup, step by step so nothing gets lost while either phone is still getting ready:
  //  1. both listen on the date's channel and fetch relay passwords (can take a few seconds on data);
  //  2. messages that arrive before this phone is ready are kept and handled once it is;
  //  3. B says "ready" (and repeats it) until A's offer arrives; A only makes the offer once B is ready;
  //  4. each side re-sends its network addresses with every offer/answer, so a late joiner gets them;
  //  5. not connected after a while? Try again with a fresh route.
  flow.pending = []; flow.early = []; flow.localCands = []; flow.ready = false; flow.lastSig = 0; flow.seenSig = new Set();
  flow.channel = api.speedChannel(s.id, {
    onSignal: (m) => { if (m && m.from !== s.role) takeSignal({ ...m, live: true }); },
    onEnded: () => finishCall(),
    onStatus: (st) => { if (st === 'SUBSCRIBED') { flow.subscribed = true; if (flow.ready) sendSignal({ t: 'hello' }); } },
  });
  try {
    const ice = await api.speedIce();
    if (!flow || flow.ended) return;
    flow.relay = !!ice.relay;
    flow.pc = makePeer(ice.iceServers || []);
    flow.ready = true;
    flow.early.splice(0).forEach((d) => onSignal(d));
    if (flow.subscribed) sendSignal({ t: 'hello' });
  } catch (e) { overlay.replaceChildren(h('p', {}, api.friendly(e))); }
  // Collect the other phone's call-setup messages from the mailbox, about every second while not
  // connected (live delivery can be slow or lose them under load; duplicates are ignored).
  pullSignals();
  // Keep saying "ready" until connected (the other phone may subscribe or get ready a moment later).
  flow.helloTimer = setInterval(() => { if (flow && flow.ready && !flow.connected) sendSignal({ t: 'hello' }); }, 2500);
  // Not connected yet? Retry with a fresh route at 15 s and 30 s (the server allows 60 s to connect).
  flow.retry1 = setTimeout(() => retryRoute(), 15000);
  flow.retry2 = setTimeout(() => retryRoute(), 30000);
  // Heartbeat: keeps the date alive on the server and tells us if it ended.
  flow.beat = setInterval(heartbeat, 5000);
  // A date that never connects ends by itself (the server gives it 60 s).
  flow.noShow = setTimeout(() => { if (flow && !flow.startedAt) heartbeat(); }, 62000);
}

const sendSignal = (data) => { if (flow && flow.session) api.speedSignal(flow.session.id, data).catch(() => {}); };
// One call-setup message from either path (mailbox or live), handled once, in order of arrival.
function takeSignal(m) {
  if (!flow || !m) return;
  if (m.id != null) {
    if (flow.seenSig.has(m.id)) return;
    flow.seenSig.add(m.id);
    if (m.id > flow.lastSig && !m.live) flow.lastSig = m.id;
  }
  onSignal(m.data || {});
}
async function pullSignals() {
  if (!flow || flow.ended || !flow.session) return;
  const id = flow.session.id;
  try {
    const list = await api.speedPull(id, flow.lastSig);
    (list || []).forEach((m) => takeSignal(m));
  } catch {}
  if (!flow || flow.ended || !flow.session || flow.session.id !== id) return;
  // Fast while connecting or reconnecting; slow once the video is up.
  flow.pullTimer = setTimeout(pullSignals, flow.connected ? 5000 : 900);
}

function makePeer(iceServers) {
  const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
  flow.stream.getTracks().forEach((t) => pc.addTrack(t, flow.stream));
  pc.onicecandidate = (e) => { if (e.candidate) { const c = e.candidate.toJSON(); flow.localCands.push(c); sendSignal({ t: 'ice', c }); } };
  pc.ontrack = (e) => { const r = flow.ui.remote; if (r.srcObject !== e.streams[0]) attach(r, e.streams[0]); };
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === 'connected') onConnected();
    else if (st === 'disconnected' || st === 'failed') onTrouble(st);
  };
  return pc;
}
const desc = (d) => d && { type: d.type, sdp: d.sdp };   // plain data, safe to send anywhere
async function offer(restart = false) {
  const pc = flow && flow.pc; if (!pc) return;
  if (pc.signalingState === 'have-local-offer' && !restart) {
    // Repeat the offer, and our addresses with it (the other phone may have missed them).
    sendSignal({ t: 'offer', sdp: desc(pc.localDescription) });
    resendCands();
    return;
  }
  if (restart && pc.signalingState === 'have-local-offer') { try { await pc.setLocalDescription({ type: 'rollback' }); } catch {} }
  if (pc.signalingState !== 'stable') return;
  if (restart) flow.localCands = [];
  const o = await pc.createOffer({ iceRestart: restart });
  await pc.setLocalDescription(o);
  sendSignal({ t: 'offer', sdp: desc(pc.localDescription) });
}
function resendCands() { (flow.localCands || []).forEach((c) => sendSignal({ t: 'ice', c })); }
function retryRoute() {
  if (!flow || flow.ended || flow.connected || !flow.pc) return;
  if (flow.session.role === 'a') offer(true); else sendSignal({ t: 'restart' });
}
async function onSignal(d) {
  if (!flow || flow.ended) return;
  const pc = flow.pc;
  if (!pc) { if (flow.early && flow.early.length < 300) flow.early.push(d); return; }   // not ready yet: keep it
  try {
    // B is ready: make (or repeat) the offer, until B's answer arrives.
    if (d.t === 'hello') { if (flow.session.role === 'a' && !flow.connected && !pc.remoteDescription) offer(); return; }
    if (d.t === 'offer' && flow.session.role === 'b') {
      // The same offer again (A didn't get our answer yet): just repeat the answer and our addresses.
      if (pc.remoteDescription && pc.localDescription && pc.remoteDescription.sdp === d.sdp.sdp) {
        sendSignal({ t: 'answer', sdp: desc(pc.localDescription) }); resendCands(); return;
      }
      await pc.setRemoteDescription(d.sdp);
      await pc.setLocalDescription(await pc.createAnswer());
      sendSignal({ t: 'answer', sdp: desc(pc.localDescription) });
      resendCands();
      flushIce();
    } else if (d.t === 'answer' && flow.session.role === 'a' && pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription(d.sdp);
      flushIce();
    } else if (d.t === 'ice') {
      if (pc.remoteDescription) await pc.addIceCandidate(d.c).catch(() => {});
      else flow.pending.push(d.c);
    } else if (d.t === 'restart' && flow.session.role === 'a') offer(true);
    else if (d.t === 'cam' && flow.ui) flow.ui.theirCam.hidden = !!d.on;
  } catch {}
}
function flushIce() { const pc = flow.pc; (flow.pending || []).splice(0).forEach((c) => pc.addIceCandidate(c).catch(() => {})); }

async function onConnected() {
  flow.connected = true; flow.troubleSince = null;
  if (!flow.camWatch) flow.camWatch = setInterval(watchCamera, 2000);
  flow.ui.overlay.hidden = true;
  setQuality(3);
  if (flow.startedAt) return;
  // Both connected? The database starts the three minutes (and tells us the exact times).
  for (let i = 0; i < 20 && flow && !flow.startedAt && !flow.ended; i++) {
    try { applyServer(await api.speedReady(flow.session.id)); } catch {}
    if (flow && !flow.startedAt) await new Promise((r) => setTimeout(r, 1500));
  }
}
function onTrouble(st) {
  if (!flow || flow.ended) return;
  flow.connected = false;
  flow.troubleSince = flow.troubleSince || Date.now();
  setQuality(st === 'failed' ? 0 : 1);
  flow.ui.overlay.hidden = false;
  flow.ui.overlay.replaceChildren(h('div', { class: 'spinner' }), h('p', {}, 'Reconnecting…'));
  // Try a fresh route; the three minutes keep running (the date can't be extended).
  if (flow.session.role === 'a') offer(true); else sendSignal({ t: 'restart' });
  setTimeout(() => { if (flow && !flow.ended && !flow.connected && Date.now() - flow.troubleSince >= 19000) { api.speedEnd(flow.session.id).catch(() => {}); finishCall(); } }, 20000);
}
// ---- Camera must stay on --------------------------------------------------------------------------------
// Every 2 s: is my camera live and showing something (not stopped, not covered/black)? If not for
// 6 s, warn me (and tell the other person); if still not after 15 s more, the date ends.
const CAM_WARN_AFTER = 6, CAM_END_AFTER = 21;
let camCanvas = null;
function cameraLooksOff() {
  const t = flow.stream && flow.stream.getVideoTracks()[0];
  if (!t || t.readyState === 'ended' || !t.enabled) return 'stopped';
  if (t.muted) return 'stopped';
  const v = flow.ui && flow.ui.local;
  if (!v || v.readyState < 2 || !v.videoWidth) return null;   // still starting: don't judge yet
  try {
    camCanvas = camCanvas || Object.assign(document.createElement('canvas'), { width: 32, height: 24 });
    const g = camCanvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(v, 0, 0, 32, 24);
    const px = g.getImageData(0, 0, 32, 24).data;
    let sum = 0, sq = 0; const n = px.length / 4;
    for (let i = 0; i < px.length; i += 4) { const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; sum += y; sq += y * y; }
    const mean = sum / n, sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
    if (mean < 12 || (mean < 28 && sd < 4)) return 'covered';   // black, or a flat dark blank: lens covered
  } catch {}
  return null;
}
async function watchCamera() {
  if (!flow || flow.ended || !flow.connected) return;
  const bad = cameraLooksOff();
  if (!bad) {
    if (flow.camBad) { flow.camBad = 0; flow.ui.camWarn.hidden = true; sendSignal({ t: 'cam', on: true }); }
    return;
  }
  flow.camBad = (flow.camBad || 0) + 2;
  if (bad === 'stopped' && flow.camBad === 2) restartCamera();   // try to get it back first
  if (flow.camBad >= CAM_WARN_AFTER) {
    if (flow.camBad === CAM_WARN_AFTER) sendSignal({ t: 'cam', on: false });
    const left = Math.max(0, CAM_END_AFTER - flow.camBad);
    flow.ui.camWarn.hidden = false;
    flow.ui.camWarn.replaceChildren(icon('video', 'sm'), h('span', {}, h('b', {}, bad === 'covered' ? 'Your camera looks covered. ' : 'Your camera is off. '),
      `Keep your face on camera: Speed Dating is video only. The date ends in ${left}s.`));
  }
  if (flow.camBad >= CAM_END_AFTER) {
    flow.ended = true;
    api.speedEnd(flow.session.id).catch(() => {});
    stopMedia();
    neutralEnd('Date ended', 'Your camera has to stay on for the whole date. Speed Dating is video only: keep your face on camera next time.');
  }
}

function setQuality(n) { if (flow && flow.ui) flow.ui.quality.dataset.level = String(n); }

// Server times → the countdown. The server's clock decides; ours is only corrected to it.
function applyServer(v) {
  if (!v || !flow) return;
  const offset = new Date(v.now).getTime() - Date.now();
  flow.offset = flow.offset == null ? offset : (flow.offset + offset) / 2;
  if (v.status === 'ended') { finishCall(v); return; }
  if (v.started_at && !flow.startedAt) {
    flow.startedAt = new Date(v.started_at).getTime();
    flow.endsAt = new Date(v.ends_at).getTime();
    if (!flow.clock) flow.clock = setInterval(drawClock, 250);
    drawClock();
  }
}
function drawClock() {
  if (!flow || !flow.endsAt) return;
  const left = Math.max(0, flow.endsAt - (Date.now() + (flow.offset || 0)));
  const s = Math.ceil(left / 1000);
  flow.ui.timer.querySelector('b').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  flow.ui.timer.classList.toggle('soon', s <= 30);
  if (left <= 0) { heartbeat(); finishCall(); }
}
async function heartbeat() {
  if (!flow || !flow.session || flow.ended) return;
  try { applyServer(await api.speedHeartbeat(flow.session.id)); } catch {}
  // Connection quality from the network stats.
  try {
    if (flow && flow.pc && flow.connected) {
      const stats = await flow.pc.getStats(); let rtt = null;
      stats.forEach((r) => { if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime != null) rtt = r.currentRoundTripTime; });
      if (rtt != null) setQuality(rtt < 0.25 ? 3 : rtt < 0.6 ? 2 : 1);
    }
  } catch {}
}

// The call is over (time, someone left, dropped, blocked): stop media, then decide.
async function finishCall() {
  if (!flow || flow.ended) return;
  flow.ended = true;
  const id = flow.session.id;
  const hadStarted = !!flow.startedAt;
  stopMedia();
  let v = null;
  try { v = await api.speedSession(id); } catch {}
  if ((v && v.started_at) || hadStarted) decide(v || flow.session);
  else neutralEnd('Your date couldn’t connect', 'It happens: networks can be patchy. Try again for someone new.');
}
function stopMedia() {
  if (!flow) return;
  clearInterval(flow.helloTimer); clearInterval(flow.beat); clearInterval(flow.clock); clearInterval(flow.markTimer); clearTimeout(flow.retry1); clearTimeout(flow.retry2); clearTimeout(flow.pullTimer); clearInterval(flow.camWatch); clearTimeout(flow.noShow); clearTimeout(flow.pollTimer);
  if (flow.channel) flow.channel.leave();
  if (flow.qch) flow.qch.leave();
  if (flow.pc) { try { flow.pc.close(); } catch {} }
  if (flow.stream) flow.stream.getTracks().forEach((t) => t.stop());
  if (flow.audioCtx) { try { flow.audioCtx.close(); } catch {} }
  flow.pc = null; flow.stream = null; flow.channel = null; flow.qch = null;
}
function stopFlow() {
  if (!flow) return;
  if (flow.queueing) { flow.queueing = false; api.speedLeaveQueue().catch(() => {}); }
  if (flow.session && !flow.ended) api.speedEnd(flow.session.id).catch(() => {});
  stopMedia();
  flow = null;
}

// ---- Report / block during the date ---------------------------------------------------------------------
function reportSheet(s) {
  const reasons = [['harassment', 'Harassment'], ['sexual', 'Sexual misconduct'], ['inappropriate', 'Inappropriate behaviour'], ['recording', 'Screenshotted or recorded me'], ['impersonation', 'Impersonation'], ['underage', 'Underage participant'], ['other', 'Other']];
  // Labels the database doesn't have its own category for go in front of the details.
  const label = (r) => (r === 'recording' ? 'Screenshotted or recorded without consent. ' : '');
  let reason = null;
  const details = h('textarea', { class: 'textarea', maxlength: '500', placeholder: 'What happened? (optional)' });
  const list = h('div', { class: 'menu-list' });
  const draw = () => list.replaceChildren(...reasons.map(([v, label]) => h('button', { class: `menu-item ${reason === v ? 'on' : ''}`, onclick: () => { reason = v; draw(); } }, label, reason === v ? icon('check', 'sm') : null)));
  draw();
  sheet((close) => [h('h2', {}, `Report ${s.other ? s.other.handle : 'this person'}`),
    h('p', { class: 'small muted' }, 'Reports are private and reviewed within 24 hours. Blocking ends the call and you’ll never be paired again.'),
    list, details,
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn btn-danger btn-block', onclick: async () => {
        try { await api.speedReport(s.id, reason === 'recording' ? 'other' : (reason || 'other'), label(reason) + details.value.trim(), true); close(); toast('Reported and blocked', 'shield'); finishCallBlocked(); }
        catch (e) { toast(api.friendly(e), 'x'); }
      } }, 'Report & block'),
      h('button', { class: 'btn btn-soft btn-block', onclick: async () => {
        if (!reason) return toast('Choose a reason', 'info');
        try { await api.speedReport(s.id, reason === 'recording' ? 'other' : reason, label(reason) + details.value.trim(), false); close(); toast('Thanks. We’ll review it.', 'flag'); }
        catch (e) { toast(api.friendly(e), 'x'); }
      } }, 'Report only'),
      h('button', { class: 'btn btn-soft btn-block', onclick: async () => {
        try { await api.speedReport(s.id, null, '', true); close(); toast('Blocked', 'shield'); finishCallBlocked(); }
        catch (e) { toast(api.friendly(e), 'x'); }
      } }, 'Block only'),
      h('button', { class: 'btn btn-soft btn-block', onclick: close }, 'Cancel'))], { label: 'Report or block' });
}
function finishCallBlocked() {
  if (!flow) return;
  flow.ended = true; stopMedia();
  neutralEnd('Call ended', 'You won’t be paired with them again.');
}

// ---- Like or Pass ---------------------------------------------------------------------------------------
function decide(v) {
  const other = (v && v.other) || (flow && flow.session && flow.session.other) || {};
  const id = (v && v.id) || flow.session.id;
  const send = async (like, btn) => {
    btn.disabled = true;
    try { await waitResult(id, await api.speedDecide(id, like)); }
    catch (e) { btn.disabled = false; toast(api.friendly(e), 'x'); }
  };
  const likeBtn = h('button', { class: 'btn sd-like', onclick: (e) => send(true, e.currentTarget) }, '❤️ Like');
  const passBtn = h('button', { class: 'btn btn-soft sd-pass', onclick: (e) => send(false, e.currentTarget) }, 'Pass');
  show(h('div', { class: 'sd-end' },
    h('span', { class: 'sd-end-av' }, avatar(other.handle, other.handle, 'xl')),
    h('h1', {}, 'Your speed date has ended.'),
    h('p', {}, `Would you like to get to know ${other.handle || 'this person'} better?`),
    h('p', { class: 'small muted' }, 'Your choice is private. Only two likes make a match.'),
    h('div', { class: 'sd-decide' }, passBtn, likeBtn)));
}
async function waitResult(id, v) {
  if (v && v.result) return showResult(v);
  show(h('div', { class: 'sd-end' }, h('div', { class: 'spinner' }), h('h1', {}, 'Thanks! Waiting for your date to decide…'),
    h('p', { class: 'small muted' }, 'This only takes a moment.'),
    h('button', { class: 'btn btn-soft', onclick: closeAll }, 'Close')));
  for (let i = 0; i < 70 && page; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try { const r = await api.speedSession(id); if (r && r.result) return showResult(r); } catch {}
  }
}
async function showResult(v) {
  if (v.result === 'match') {
    await loadDating({ force: true }).catch(() => {});
    show(h('div', { class: 'sd-end sd-match' },
      h('div', { class: 'sd-hearts', 'aria-hidden': 'true' }, '💖'),
      h('h1', {}, 'It’s a match!'),
      h('p', {}, 'You both want to keep the connection going.'),
      h('p', { class: 'small muted' }, 'You’re still anonymous. Your chat is waiting in Matches.'),
      h('button', { class: 'btn btn-primary btn-block', onclick: () => { const c = v.conversation_id; closeAll(); if (c) nav.openChat(c); else go('matches/matches'); } }, 'Start Chatting'),
      h('button', { class: 'btn btn-soft btn-block', onclick: () => { closeAll(); go('discover'); } }, 'Continue Discovering')));
  } else neutralEnd('Date complete.', 'Thanks for giving it a try. There’s someone else to meet.');
}
function neutralEnd(title, text) {
  stopMedia();
  flow = null;
  show(h('div', { class: 'sd-end' },
    h('div', { class: 'sd-hearts', 'aria-hidden': 'true' }, '🌱'),
    h('h1', {}, title), h('p', {}, text),
    h('button', { class: 'btn btn-primary btn-block', onclick: async () => { const q = await loadQuota(); if (coolingDown(q)) openSpeedDating(); else openCheck(); } }, 'Find Another Date'),
    h('button', { class: 'btn btn-soft btn-block', onclick: closeAll }, 'Back to Discover')));
}

// Leaving the page (closing the app tab) ends a live date or leaves the queue.
window.addEventListener('pagehide', () => { if (flow) stopFlow(); });
