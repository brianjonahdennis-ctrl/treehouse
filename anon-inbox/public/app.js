// treehouse owner app: inbox, messages as story images, stats, share link, settings.

const $ = (id) => document.getElementById(id);
const state = { messages: [], owner: { name: '', prompt: '' }, current: null, image: null, lastUnread: null };
// Your anonymous link is on its own address (treehouse.ng opens the treehouse app instead).
const LINK_ORIGIN = /(^|\.)treehouse\.ng$/.test(location.hostname) ? 'https://tell.brianjonahdennis.com' : location.origin;
const shareUrl = LINK_ORIGIN + '/';
const POLL_MS = 20000;

const PROMPT_IDEAS = [
  'send me anonymous messages!',
  'ask me anything',
  'tell me a secret',
  'confessions',
  'rate me 1-10',
  'never have I ever',
  'what do you really think of me?',
];

// ---- Helpers ---------------------------------------------------------------
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 2200);
}

function timeAgo(iso) {
  const hours = Math.floor((Date.now() - new Date(iso)) / 3.6e6);
  if (hours < 1) return 'Within the last hour';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') { showLogin(); throw new Error(data.error || 'Signed out'); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const ICON_MSG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z"/></svg>';
const ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

// ---- Views -----------------------------------------------------------------
function showLogin() {
  $('main').classList.add('hidden');
  $('login').classList.remove('hidden');
}

function showMain() {
  $('login').classList.add('hidden');
  $('main').classList.remove('hidden');
}

const TITLES = { inbox: 'Inbox', stats: 'Stats', safety: 'Dating reports', share: 'Get messages', settings: 'Settings' };
function setTab(tab) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  for (const t of Object.keys(TITLES)) $('view-' + t).classList.toggle('hidden', t !== tab);
  $('viewTitle').textContent = TITLES[tab];
  if (tab === 'stats') loadStats();
  if (tab === 'safety') loadReports();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

// ---- Inbox -----------------------------------------------------------------
function renderInbox() {
  const list = $('list');
  const unread = state.messages.filter((m) => !m.read).length;
  $('unreadPill').textContent = `${unread} new`;
  $('unreadPill').classList.toggle('hidden', !unread);
  $('tabBadge').classList.toggle('hidden', !unread);
  document.title = unread ? `(${unread}) treehouse` : 'treehouse';
  if ('setAppBadge' in navigator) (unread ? navigator.setAppBadge(unread) : navigator.clearAppBadge()).catch(() => {});

  list.replaceChildren();
  if (!state.messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = `<div class="bubble" style="margin:0 auto">${ICON_MSG}</div>
      <h2>No messages yet</h2>
      <div>Share your link and anonymous messages will show up here.</div>
      <button class="btn primary" id="goShare">Share my link</button>`;
    list.append(empty);
    $('goShare').onclick = () => setTab('share');
    return;
  }

  for (const m of state.messages) {
    const item = document.createElement('button');
    item.className = 'item' + (m.read ? '' : ' unread');
    item.innerHTML = `<div class="bubble">${m.read ? ICON_MSG : ICON_LOCK}</div>
      <div class="item-text">
        <div class="item-title"></div>
        <div class="item-sub"></div>
      </div>`;
    item.querySelector('.item-title').textContent = m.read ? m.text : 'New message!';
    const sub = item.querySelector('.item-sub');
    sub.textContent = timeAgo(m.createdAt);
    item.onclick = () => openMessage(m);
    list.append(item);
  }
}

async function loadInbox({ quiet } = {}) {
  const { messages, limit } = await api('/api/inbox');
  $('limitNote').textContent = `Only your newest ${limit} messages are kept. Older ones are deleted automatically.`;
  $('limitNote').classList.toggle('hidden', !messages.length);
  const unread = messages.filter((m) => !m.read).length;
  if (quiet && state.lastUnread !== null && unread > state.lastUnread) notifyNew(unread - state.lastUnread);
  state.lastUnread = unread;
  state.messages = messages;
  renderInbox();
}

function notifyNew(n) {
  toast(n === 1 ? 'You got a new message!' : `You got ${n} new messages!`);
  if (localStorageGet('notify') === '1' && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification('treehouse', { body: 'Someone sent you an anonymous message 👀', icon: 'icon-192.png' }); } catch {}
  }
}

// ---- Message sheet ---------------------------------------------------------
const blobToDataUrl = (blob) => new Promise((resolve) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.readAsDataURL(blob);
});

// Opening a message renders it straight into the story image. It's shown as a plain <img>
// (data URL), so pressing and holding it brings up the phone's own "Save to Photos" menu.
async function openMessage(m) {
  state.current = m;
  $('sheetTime').textContent = timeAgo(m.createdAt);
  const img = $('msgImg');
  img.classList.add('hidden');
  img.removeAttribute('src');
  img.alt = `Message: ${m.text}`;
  $('msgLoading').classList.remove('hidden');
  $('sheet').classList.remove('hidden');
  drawStory({ prompt: m.prompt || state.owner.prompt, text: m.text }).then(async (blob) => {
    if (state.current !== m) return; // another message was opened meanwhile
    setImage(blob, `tell-hydra-${m.id.slice(0, 8)}.jpg`);
    img.src = await blobToDataUrl(blob);
    img.classList.remove('hidden');
    $('msgLoading').classList.add('hidden');
  });
  if (!m.read) {
    m.read = true;
    renderInbox();
    api(`/api/inbox/${m.id}`, { method: 'PATCH', body: JSON.stringify({ read: true }) })
      .then(() => { state.lastUnread = state.messages.filter((x) => !x.read).length; })
      .catch(() => {});
  }
}

function closeSheet() { $('sheet').classList.add('hidden'); state.current = null; }
$('closeSheet').onclick = closeSheet;
$('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });

$('deleteMsg').onclick = async () => {
  const m = state.current;
  if (!m || !confirm('Delete this message for good?')) return;
  await api(`/api/inbox/${m.id}`, { method: 'DELETE' });
  state.messages = state.messages.filter((x) => x.id !== m.id);
  closeSheet();
  renderInbox();
  toast('Deleted');
};

$('msgShare').onclick = () => shareImage();
$('msgSave').onclick = () => state.image && saveImage();

// Story image drawing lives in story.js (shared with members' inboxes).

function setImage(blob, filename) {
  if (state.image) URL.revokeObjectURL(state.image.url);
  state.image = { blob, filename, url: URL.createObjectURL(blob) };
}

function showImage(blob, filename) {
  setImage(blob, filename);
  $('storyImg').src = state.image.url;
  $('imgModal').classList.remove('hidden');
}

function saveImage() {
  const a = document.createElement('a');
  a.href = state.image.url;
  a.download = state.image.filename;
  a.click();
}

async function shareImage() {
  if (!state.image) return;
  const file = new File([state.image.blob], state.image.filename, { type: state.image.blob.type || 'image/jpeg' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); } catch {}
  } else {
    saveImage();
    toast('Image saved — post it from your photos');
  }
}
$('imgShare').onclick = shareImage;
$('imgSave').onclick = saveImage;
$('imgClose').onclick = () => $('imgModal').classList.add('hidden');

// ---- Share tab -------------------------------------------------------------
function renderOwner() {
  const { name, prompt } = state.owner;
  $('shareName').textContent = name;
  $('sharePrompt').textContent = prompt;
  $('setName').value = name;
  $('setPrompt').value = prompt;
}

$('link').textContent = shareUrl.replace(/^https?:\/\//, '');

$('copyLink').onclick = async () => {
  try { await navigator.clipboard.writeText(shareUrl); toast('Link copied!'); }
  catch { toast(shareUrl); }
};
$('shareLink').onclick = async () => {
  if (navigator.share) {
    try { await navigator.share({ title: state.owner.prompt, url: shareUrl }); } catch {}
  } else $('copyLink').click();
};
$('shareSticker').onclick = async () => {
  const blob = await drawStory({ prompt: state.owner.prompt, sticker: true });
  showImage(blob, 'tell-hydra-sticker.jpg');
};

// ---- Settings --------------------------------------------------------------
for (const idea of PROMPT_IDEAS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = idea;
  b.onclick = () => { $('setPrompt').value = idea; };
  $('promptIdeas').append(b);
}

$('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  state.owner = await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ name: $('setName').value, prompt: $('setPrompt').value }),
  });
  renderOwner();
  toast('Saved');
});

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

$('notify').checked = localStorageGet('notify') === '1';
$('notify').onchange = async (e) => {
  if (e.target.checked && 'Notification' in window && Notification.permission !== 'granted') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { e.target.checked = false; toast('Notifications are blocked'); }
  }
  localStorageSet('notify', e.target.checked ? '1' : '0');
};

$('logout').onclick = async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  showLogin();
};

// ---- Login & startup -------------------------------------------------------
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginStatus').textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) });
    $('password').value = '';
    start();
  } catch (err) {
    $('loginStatus').textContent = err.message;
  }
});

async function start() {
  try {
    const [owner] = await Promise.all([fetch('/api/owner').then((r) => r.json()), loadInbox()]);
    state.owner = owner;
    renderOwner();
    showMain();
  } catch {}
}

setInterval(() => { if (!$('main').classList.contains('hidden')) loadInbox({ quiet: true }).catch(() => {}); }, POLL_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('main').classList.contains('hidden')) loadInbox({ quiet: true }).catch(() => {});
});

// Load the story-image fonts up front so the first message opens quickly.
['800 60px Inter', '700 60px Inter', '600 60px Inter', 'italic 900 60px Inter'].forEach((f) => document.fonts.load(f).catch(() => {}));

// Keep the installed app up to date: check for a new version whenever it comes back on screen,
// and reload once when a new version takes over.
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('/sw.js', { scope: '/app' }).then((reg) => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
}

start();

// ---- Stats -----------------------------------------------------------------
let statsRange = 7;
const fmt = (n) => n.toLocaleString();
const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '–');

document.querySelectorAll('.range button').forEach((b) => b.addEventListener('click', () => {
  statsRange = Number(b.dataset.range);
  document.querySelectorAll('.range button').forEach((x) => x.classList.toggle('on', x === b));
  loadStats();
}));

async function loadStats() {
  const body = $('statsBody');
  try {
    renderStats(await api(`/api/stats?days=${statsRange}`));
  } catch (err) {
    body.innerHTML = '<div class="empty">Couldn’t load stats.</div>';
  }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function tile(label, value, note) {
  const t = el('div', 'tile');
  t.append(el('div', 'tile-label', label), el('div', 'tile-value', value));
  if (note) t.append(el('div', 'tile-note', note));
  return t;
}

function card(title, sub) {
  const c = el('section', 'chart-card');
  c.append(el('h3', '', title));
  if (sub) c.append(el('p', 'muted small chart-sub', sub));
  return c;
}

// Column chart: one series, thin bars with rounded tops anchored to the baseline, tap/hover tooltip.
function columns(values, labels, tipFor, axisLabels) {
  const W = 320, H = 130, top = 14, bottom = 20, n = values.length;
  const max = Math.max(1, ...values);
  const slot = W / n, gap = n > 40 ? 1 : 2, bw = Math.max(1, Math.min(slot - gap, 18));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'cols');
  svg.setAttribute('role', 'img');
  const mk = (t, a) => { const e = document.createElementNS(ns, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const base = H - bottom;
  svg.append(mk('line', { x1: 0, x2: W, y1: top, y2: top, class: 'grid' }));
  svg.append(mk('line', { x1: 0, x2: W, y1: base, y2: base, class: 'axis' }));
  const maxLabel = mk('text', { x: 0, y: top - 4, class: 'axis-text' });
  maxLabel.textContent = fmt(max);
  svg.append(maxLabel);
  values.forEach((v, i) => {
    const x = i * slot + (slot - bw) / 2;
    if (v > 0) {
      const h = Math.max(3, ((base - top) * v) / max);
      const r = Math.min(4, bw / 2, h);
      const y = base - h;
      svg.append(mk('path', { class: 'bar', d: `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${base} Z` }));
    }
    const hit = mk('rect', { x: i * slot, y: 0, width: slot, height: H, class: 'hit' });
    hit.dataset.tip = tipFor(i);
    svg.append(hit);
  });
  for (const [i, text] of axisLabels) {
    const t = mk('text', { x: Math.min(W - 2, Math.max(2, i * slot + slot / 2)), y: H - 5, class: 'axis-text', 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' });
    t.textContent = text;
    svg.append(t);
  }
  const wrap = el('div', 'cols-wrap');
  const tip = el('div', 'tip hidden');
  wrap.append(svg, tip);
  const show = (e) => {
    const target = e.target.closest('.hit');
    if (!target) return;
    svg.querySelectorAll('.hit.on').forEach((h) => h.classList.remove('on'));
    target.classList.add('on');
    tip.textContent = target.dataset.tip;
    tip.classList.remove('hidden');
    const box = wrap.getBoundingClientRect(), r = target.getBoundingClientRect();
    tip.style.left = Math.min(box.width - tip.offsetWidth, Math.max(0, r.left - box.left + r.width / 2 - tip.offsetWidth / 2)) + 'px';
  };
  svg.addEventListener('pointerover', show);
  svg.addEventListener('pointerdown', show);
  wrap.addEventListener('pointerleave', () => { tip.classList.add('hidden'); svg.querySelectorAll('.hit.on').forEach((h) => h.classList.remove('on')); });
  return wrap;
}

// Ranked list with inline bars (sources, devices).
function barList(rows, total) {
  const list = el('div', 'barlist');
  if (!rows.length) { list.append(el('p', 'muted small', 'Nothing yet in this period.')); return list; }
  const max = rows[0].count;
  for (const r of rows.slice(0, 8)) {
    const row = el('div', 'barrow');
    const head = el('div', 'barrow-head');
    head.append(el('span', '', r.name), el('span', 'barrow-val', `${fmt(r.count)} · ${pct(r.count, total)}`));
    const track = el('div', 'track');
    const fill = el('i');
    fill.style.width = Math.max(2, (r.count / max) * 100) + '%';
    track.append(fill);
    row.append(head, track);
    list.append(row);
  }
  return list;
}

const shortDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const hourName = (h) => (h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`);

function renderStats(s) {
  const body = $('statsBody');
  body.replaceChildren();
  const t = s.totals;

  const tiles = el('div', 'tiles');
  tiles.append(
    tile('Visits', fmt(t.views), 'times your link was opened'),
    tile('Unique visitors', fmt(t.uniques), 'different people (per day)'),
    tile('Messages', fmt(t.messages), `${fmt(s.allTime.messages)} all time`),
    tile('Send rate', pct(t.messages, t.uniques), 'messages per unique visitor'),
    tile('Per day', (t.messages / s.range).toFixed(1), 'messages on average'),
    tile('Ad taps', fmt(t.adTaps), 'taps on your ad box'),
  );
  body.append(tiles);

  const n = s.daily.length;
  const ticks = [[0, shortDate(s.daily[0].date)], [n - 1, shortDate(s.daily[n - 1].date)]];
  if (n > 7) ticks.splice(1, 0, [Math.floor(n / 2), shortDate(s.daily[Math.floor(n / 2)].date)]);

  const v = card('Visits per day');
  v.append(columns(s.daily.map((d) => d.views), null,
    (i) => `${shortDate(s.daily[i].date)}: ${fmt(s.daily[i].views)} visits · ${fmt(s.daily[i].uniques)} unique`, ticks));
  body.append(v);

  const m = card('Messages per day');
  m.append(columns(s.daily.map((d) => d.messages), null,
    (i) => `${shortDate(s.daily[i].date)}: ${fmt(s.daily[i].messages)} message${s.daily[i].messages === 1 ? '' : 's'}`, ticks));
  body.append(m);

  const src = card('Where visitors come from', 'Based on the app or site the link was opened from');
  src.append(barList(s.sources, t.views));
  body.append(src);

  const ads = card('Ad taps by link', 'Kickrs is the ad playing now; WhatsApp is the "Advertise here" link');
  const AD_NAMES = { ella: 'Ella Thrift Hairs (WhatsApp group)', troit: 'Troit Mobile Mart (WhatsApp)', kickrs: 'Kickrs (kickrs.vercel.app)', whatsapp: 'WhatsApp: advertise here' };
  ads.append(barList((s.adLinks || []).map((r) => ({ name: AD_NAMES[r.name] || r.name, count: r.count })), t.adTaps));
  body.append(ads);

  const dev = card('Devices');
  dev.append(barList(s.devices, t.views));
  body.append(dev);

  const busiest = s.hours.indexOf(Math.max(...s.hours));
  const hr = card('When messages arrive', t.messages ? `Busiest: ${hourName(busiest)}–${hourName((busiest + 1) % 24)} (${s.timezone.split('/')[1] || s.timezone} time)` : 'No messages yet in this period');
  hr.append(columns(s.hours, null, (h) => `${hourName(h)}–${hourName((h + 1) % 24)}: ${fmt(s.hours[h])} message${s.hours[h] === 1 ? '' : 's'}`,
    [[0, '12am'], [6, '6am'], [12, '12pm'], [18, '6pm'], [23, '11pm']]));
  body.append(hr);

  const inbox = card('Inbox right now');
  const it = el('div', 'tiles');
  it.append(
    tile('Stored', `${fmt(s.inbox.stored)}`, 'of your newest 100'),
    tile('Unread', fmt(s.inbox.unread)),
    tile('Read', fmt(s.inbox.stored - s.inbox.unread), 'opened by you'),
    tile('Avg. length', `${fmt(s.inbox.avgLength)}`, 'characters'),
  );
  inbox.append(it);
  body.append(inbox);

  if (s.since) body.append(el('p', 'muted small', `Counting since ${shortDate(s.since)}.`));
  const dBody = $('datingBody');
  dBody.replaceChildren();
  const downloads = [...appDownloads(s, ticks), ...playTesters(s, ticks)];
  if (s.dating) renderDatingStats(s.dating, dBody, downloads);
  else dBody.append(el('div', 'empty', 'Dating stats aren’t available right now.'), ...downloads);
}

// Google Play test: people who used the app installed from Google Play, per day (needs app 1.5+),
// plus which kinds of treehouse people use. Counts only.
const PLATFORM_NAMES = { 'android-play': 'Android app from Google Play', 'android-apk': 'Android app from the APK',
  'android-app': 'Android app, older version (1.4 or earlier)', 'ios-app': 'iPhone app', web: 'Browser' };
function playTesters(s, ticks) {
  const p = s.platforms;
  if (!p) return [el('div', 'empty', 'Google Play test stats aren’t available yet.')];
  const daily = p.playDaily || [];
  const inRange = (p.people || {})['android-play'] || 0;
  const tiles = el('div', 'tiles');
  tiles.append(
    tile('Play testers active', fmt(inRange), 'used the Google Play app in this period'),
    tile('Play testers all time', fmt(p.playAllTime || 0), p.playFirstDay ? `since ${shortDate(p.playFirstDay)}` : 'needs app 1.5 from Google Play'),
  );
  const chart = card('Google Play testers active per day', 'People who opened the app installed from Google Play (app 1.5 or later)');
  if (daily.length) chart.append(columns(daily.map((d) => d.people), null,
    (i) => `${shortDate(daily[i].date)}: ${fmt(daily[i].people)} Play tester${daily[i].people === 1 ? '' : 's'}`, ticks));
  const kinds = card('How people use treehouse', 'Different people per kind, in this period. Older apps can’t say where they were installed from.');
  const rows = Object.entries(p.people || {}).map(([k, n]) => ({ name: PLATFORM_NAMES[k] || k, count: n })).sort((a, b) => b.count - a.count);
  kinds.append(barList(rows, rows.reduce((a, r) => a + r.count, 0)));
  return [tiles, chart, kinds];
}

// Android test app downloads (from the treehouse.ng landing page), shown with the dating stats.
function appDownloads(s, ticks) {
  const t = s.totals;
  const tiles = el('div', 'tiles');
  tiles.append(
    tile('Android downloads', fmt(t.apkDownloads || 0), 'test app, in this period'),
    tile('All-time downloads', fmt((s.allTime && s.allTime.apkDownloads) || 0), 'from treehouse.ng'),
  );
  const apk = card('Android app downloads per day', 'Test APK downloaded from the treehouse.ng landing page');
  apk.append(columns(s.daily.map((d) => d.apkDownloads || 0), null,
    (i) => `${shortDate(s.daily[i].date)}: ${fmt(s.daily[i].apkDownloads || 0)} download${s.daily[i].apkDownloads === 1 ? '' : 's'}`, ticks));
  return [tiles, apk];
}

// ---- Dating reports (moderation) -------------------------------------------------
let reportStatus = 'open';
const REASONS = { harassment: 'Harassment or threats', inappropriate: 'Sexual or inappropriate', spam: 'Spam or scam',
  fake: 'Fake profile', underage: 'Seems under 18', other: 'Something else' };

document.querySelectorAll('[data-rstatus]').forEach((b) => b.addEventListener('click', () => {
  reportStatus = b.dataset.rstatus;
  document.querySelectorAll('[data-rstatus]').forEach((x) => x.classList.toggle('on', x === b));
  loadReports();
}));

function setReportBadge(open) {
  $('safetyBadge').classList.toggle('hidden', !open);
}

async function loadReports() {
  const body = $('reportsBody');
  try {
    if (reportKind === 'links') {
      const data = await api(`/api/link-reports?status=${reportStatus}`);
      renderLinkReports(data);
    } else {
      const data = await api(`/api/dating-reports?status=${reportStatus}`);
      renderReports(data);
    }
    refreshReportBadge();
  } catch {
    body.innerHTML = '<div class="empty">Couldn’t load reports.</div>';
  }
}

function renderReports({ reports, available }) {
  const body = $('reportsBody');
  body.replaceChildren();
  if (!available) { body.append(el('div', 'empty', 'Dating reports aren’t set up on this server.')); return; }
  if (!reports.length) {
    body.append(el('div', 'empty', reportStatus === 'open' ? 'No open reports. 🎉' : 'No reports yet.'));
    return;
  }
  for (const r of reports) {
    const card = el('section', 'chart-card report');
    const head = el('div', 'report-head');
    head.append(el('span', `rstatus ${r.status}`, r.status), el('span', 'muted small', timeAgo(r.created_at)));
    card.append(head);
    card.append(el('h3', '', REASONS[r.reason] || r.reason));
    const who = el('p', 'report-who');
    who.append(el('b', '', r.reporter_handle), document.createTextNode(' reported '), el('b', '', r.reported_handle));
    card.append(who);
    if (r.reports_against > 1) card.append(el('p', 'report-warn', `${r.reports_against} reports against ${r.reported_handle} in total`));
    if (r.reported_suspended) card.append(el('p', 'report-warn', `${r.reported_handle} is suspended`));
    if (r.details) card.append(el('p', 'report-details', `“${r.details}”`));

    const chat = document.createElement('details');
    chat.className = 'report-chat';
    chat.append(el('summary', '', `Show chat (${r.recent_messages.length} recent messages)`));
    for (const m of r.recent_messages) {
      const line = el('div', `rmsg ${m.from}`);
      line.append(el('span', 'rmsg-who', m.from === 'reported' ? r.reported_handle : r.reporter_handle), el('span', 'rmsg-body', m.body));
      chat.append(line);
    }
    card.append(chat);

    const actions = el('div', 'btn-row');
    const act = (label, cls, payload) => {
      const b = el('button', `btn small ${cls}`, label);
      b.onclick = async () => {
        if (payload.suspend === true && !confirm(`Suspend ${r.reported_handle}? Their card disappears and they can't message anyone.`)) return;
        b.disabled = true;
        try { await api(`/api/dating-reports/${r.id}`, { method: 'POST', body: JSON.stringify(payload) }); toast('Updated'); }
        catch { toast('Couldn’t update'); }
        loadReports();
      };
      actions.append(b);
    };
    if (r.status === 'open') act('Mark reviewed', '', { status: 'reviewed' });
    else act('Reopen', '', { status: 'open' });
    if (r.reported_suspended) act(`Restore ${r.reported_handle}`, '', { suspend: false });
    else act(`Suspend ${r.reported_handle}`, 'danger', { suspend: true });
    card.append(actions);
    body.append(card);
  }
}

// Show the red dot on the Reports tab when there are open reports.
setTimeout(() => { if (!$('main').classList.contains('hidden')) refreshReportBadge(); }, 1500);

// ---- Dating stats (counts only, from the dating database) ---------------------------
const D_INTENT = { fun: 'Fun 😄', love: 'Love ❤️', marriage: 'Marriage 💍' };
const D_GENDER = { male: 'Male', female: 'Female', other: 'Other / prefer not to say' };

function renderDatingStats(d, body, downloads = []) {
  const t = d.totals, r = d.inRange;

  const tiles = el('div', 'tiles');
  tiles.append(
    tile('Accounts', fmt(t.accounts), `${fmt(r.accounts)} new · ${pct(t.verified, t.accounts)} verified`),
    tile('Dating profiles', fmt(t.active), `active · ${fmt(t.paused)} paused${t.suspended ? ` · ${fmt(t.suspended)} suspended` : ''}`),
    tile('Chats started', fmt(r.conversations), `${fmt(t.conversations)} all time`),
    tile('Dating messages', fmt(r.messages), `${fmt(t.messages)} all time`),
    tile('People chatting', fmt(r.chattingPeople), `${pct(t.chattingPeople, t.profiles)} of profiles have sent a message`),
    tile('Mutual reveals', fmt(r.mutualReveals), `${fmt(t.mutualReveals)} all time`),
    tile('Open reports', fmt(t.reportsOpen), `${fmt(t.reports)} total · ${fmt(t.blocks)} block${t.blocks === 1 ? '' : 's'}`),
    tile('New profiles', fmt(r.profiles), 'created in this period'),
  );
  if (d.deletions) tiles.append(tile('Deleted accounts', fmt(d.deletions.inRange),
    `${fmt(d.deletions.withProfile)} had a dating profile · ${fmt(d.deletions.total)} all time`));
  body.append(tiles);
  // Speed Dating: video dates, connections and matches.
  if (d.speed && d.speed.inRange) {
    const sp = d.speed, r2 = sp.inRange;
    const head = card('Speed Dating', `${fmt(sp.now.waiting)} waiting · ${fmt(sp.now.onDates)} on dates right now`);
    const st = el('div', 'tiles');
    st.append(
      tile('Speed dates', fmt(r2.connected), `${pct(r2.connected, r2.pairings)} of ${fmt(r2.pairings)} pairings connected`),
      tile('Speed matches', fmt(r2.matches), `${pct(r2.matches, r2.connected)} of dates · ${fmt(sp.totals.matches)} all time`),
      tile('Speed daters', fmt(r2.daters), `${fmt(sp.totals.daters)} all time`),
      tile('Average date', r2.avgMinutes == null ? '–' : `${r2.avgMinutes} min`, `${fmt(r2.fullFive)} went the full time`),
      tile('Speed reports', fmt(r2.reports), `${fmt(r2.blocked)} date${r2.blocked === 1 ? '' : 's'} ended by a block`));
    head.append(st);
    if (sp.daily && sp.daily.length) {
      const sn = sp.daily.length;
      const sticks = [[0, shortDate(sp.daily[0].date)], [sn - 1, shortDate(sp.daily[sn - 1].date)]];
      head.append(el('div', 'tile-note', 'Speed dates per day'),
        columns(sp.daily.map((x) => x.dates), null, (i) => `${shortDate(sp.daily[i].date)}: ${fmt(sp.daily[i].dates)} dates · ${fmt(sp.daily[i].matches)} matches`, sticks));
    }
    body.append(head);
  }
  if (d.deletions && d.deletions.daily) {
    const del = card('Deleted accounts per day', 'People who deleted their own account. Counted since 12 Nov 2026.');
    const dn = d.deletions.daily.length;
    const dticks = [[0, shortDate(d.deletions.daily[0].date)], [dn - 1, shortDate(d.deletions.daily[dn - 1].date)]];
    del.append(columns(d.deletions.daily.map((x) => x.deleted), null,
      (i) => `${shortDate(d.deletions.daily[i].date)}: ${fmt(d.deletions.daily[i].deleted)} deleted`, dticks));
    body.append(del);
  }

  const n = d.daily.length;
  const ticks = [[0, shortDate(d.daily[0].date)], [n - 1, shortDate(d.daily[n - 1].date)]];
  if (n > 7) ticks.splice(1, 0, [Math.floor(n / 2), shortDate(d.daily[Math.floor(n / 2)].date)]);

  const acc = card('New accounts per day');
  acc.append(columns(d.daily.map((x) => x.accounts), null,
    (i) => `${shortDate(d.daily[i].date)}: ${fmt(d.daily[i].accounts)} accounts · ${fmt(d.daily[i].profiles)} profiles`, ticks));
  body.append(acc);

  const msgs = card('Dating messages per day');
  msgs.append(columns(d.daily.map((x) => x.messages), null,
    (i) => `${shortDate(d.daily[i].date)}: ${fmt(d.daily[i].messages)} messages · ${fmt(d.daily[i].conversations)} new chats`, ticks));
  body.append(msgs);
  body.append(...downloads);

  const total = (rows) => rows.reduce((a, x) => a + x.count, 0);
  const lists = [
    ['What people are looking for', d.intent.map((x) => ({ name: D_INTENT[x.name] || x.name, count: x.count }))],
    ['Gender', d.gender.map((x) => ({ name: D_GENDER[x.name] || x.name, count: x.count }))],
    ['Age', d.ages],
    ['Top locations', d.locations],
  ];
  for (const [title, rows] of lists) {
    const c = card(title, title === 'Top locations' ? 'As people typed them; spellings may vary' : '');
    c.append(barList(rows, total(rows)));
    body.append(c);
  }
}

// Messages | Dating switch at the top of Stats.
let statsView = 'messages';
document.querySelectorAll('[data-sview]').forEach((b) => b.addEventListener('click', () => {
  statsView = b.dataset.sview;
  document.querySelectorAll('[data-sview]').forEach((x) => {
    x.classList.toggle('on', x === b);
    x.setAttribute('aria-selected', String(x === b));
  });
  $('statsBody').classList.toggle('hidden', statsView !== 'messages');
  $('datingBody').classList.toggle('hidden', statsView !== 'dating');
  window.scrollTo(0, 0);
}));

// ---- Link reports (messages members received and reported) -------------------------
let reportKind = 'dating';
const LINK_REASONS = { harassment: 'Bullying or harassment', threat: 'Threats or violence', hate: 'Hate speech',
  sexual: 'Sexual content', self_harm: 'Self-harm or suicide', spam: 'Spam', other: 'Something else' };

document.querySelectorAll('[data-rkind]').forEach((b) => b.addEventListener('click', () => {
  reportKind = b.dataset.rkind;
  document.querySelectorAll('[data-rkind]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
  loadReports();
}));

async function refreshReportBadge() {
  try {
    const [d, l] = await Promise.all([api('/api/dating-reports?status=open'), api('/api/link-reports?status=open')]);
    setReportBadge((d.open || 0) + (l.open || 0));
  } catch {}
}

function renderLinkReports({ reports, available }) {
  const body = $('reportsBody');
  body.replaceChildren();
  if (!available) { body.append(el('div', 'empty', 'Link reports aren’t set up on this server.')); return; }
  if (!reports.length) { body.append(el('div', 'empty', reportStatus === 'open' ? 'No open link reports. 🎉' : 'No link reports yet.')); return; }
  for (const r of reports) {
    const card = el('section', 'chart-card report');
    const head = el('div', 'report-head');
    head.append(el('span', `rstatus ${r.status}`, r.status), el('span', 'muted small', timeAgo(r.created_at)));
    card.append(head, el('h3', '', LINK_REASONS[r.reason] || r.reason));
    const who = el('p', 'report-who');
    who.append(document.createTextNode('Reported by '), el('b', '', `@${r.username}`), document.createTextNode(` (prompt: “${r.prompt}”)`));
    card.append(who);
    if (r.reports_for_link > 1) card.append(el('p', 'report-warn', `${r.reports_for_link} reports from @${r.username} in total`));
    if (r.link_suspended) card.append(el('p', 'report-warn', `@${r.username} is suspended`));
    if (r.reason === 'self_harm') card.append(el('p', 'report-warn', 'Self-harm report: consider reaching out to this member with support resources.'));
    const msg = el('div', 'rmsg reported');
    msg.append(el('span', 'rmsg-who', 'Anonymous message'), el('span', 'rmsg-body', r.body));
    card.append(msg);
    const actions = el('div', 'btn-row');
    const act = (label, cls, payload) => {
      const b = el('button', `btn small ${cls}`, label);
      b.onclick = async () => {
        if (payload.suspend === true && !confirm(`Suspend @${r.username}'s link? It stops showing and stops taking messages.`)) return;
        b.disabled = true;
        try { await api(`/api/link-reports/${r.id}`, { method: 'POST', body: JSON.stringify(payload) }); toast('Updated'); }
        catch { toast('Couldn’t update'); }
        loadReports();
      };
      actions.append(b);
    };
    if (r.status === 'open') act('Mark reviewed', '', { status: 'reviewed' });
    else act('Reopen', '', { status: 'open' });
    if (r.link_suspended) act(`Restore @${r.username}`, '', { suspend: false });
    else act(`Suspend @${r.username}`, 'danger', { suspend: true });
    card.append(actions);
    body.append(card);
  }
}
