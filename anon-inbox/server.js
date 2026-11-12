// treehouse — anonymous "ask me anything" inbox. Zero-dependency Node server.
// Senders: no accounts, no cookies, no IPs or user agents stored, timestamps rounded to the hour.
// Owner: installable, password-protected app at /app.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const webPush = require('./push.js');

const PORT = Number(process.env.PORT) || 4000;
// Anonymous dating (Supabase). The /date page needs the project URL and its publishable key
// (public by design; row-level security protects the data). DATING_ENABLED shows the
// "Date Anonymously" button on the public page.
const SUPABASE_URL = /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(process.env.SUPABASE_URL || '') ? process.env.SUPABASE_URL : '';
const SUPABASE_PUBLISHABLE_KEY = /^sb_publishable_[\w-]+$/.test(process.env.SUPABASE_PUBLISHABLE_KEY || '') ? process.env.SUPABASE_PUBLISHABLE_KEY : '';
const DATING_READY = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
const DATING_ENABLED = DATING_READY && process.env.DATING_ENABLED === '1';
// Admin key for reading dating reports (only its fingerprint is stored in the database).
// From the environment on Railway, or data/DATING_ADMIN_TOKEN locally.
let adminToken = null;   // loaded on first use (DATA_DIR is set further down)
function datingAdminToken() {
  if (adminToken !== null) return adminToken;
  adminToken = '';
  if (/^tha_[\w-]{30,}$/.test(process.env.DATING_ADMIN_TOKEN || '')) adminToken = process.env.DATING_ADMIN_TOKEN;
  else {
    try {
      const t = fs.readFileSync(path.join(DATA_DIR, 'DATING_ADMIN_TOKEN'), 'utf8').trim();
      if (/^tha_[\w-]{30,}$/.test(t)) adminToken = t;
    } catch {}
  }
  return adminToken;
}

// Call a public Supabase function and keep its error code (for user-facing messages).
// Supabase calls give up after a while, so a slow database can't leave pages waiting forever.
const RPC_TIMEOUT_MS = 10000;

// ---- Speed Dating video relay (Cloudflare TURN) ----------------------------------------------------
// Phones on mobile networks usually can't reach each other directly, so video goes through
// Cloudflare's relay. The key id and token are set in Railway (never sent to phones); the server
// hands out short-lived relay passwords, only to someone on a live date. SPEED_DEV=1 allows dates
// without the relay for local testing (same-network only).
const CF_TURN_KEY_ID = /^[a-f0-9]{32}$/.test(process.env.CF_TURN_KEY_ID || '') ? process.env.CF_TURN_KEY_ID : '';
const CF_TURN_KEY_TOKEN = /^[A-Za-z0-9_-]{20,200}$/.test(process.env.CF_TURN_KEY_TOKEN || '') ? process.env.CF_TURN_KEY_TOKEN : '';
const SPEED_RELAY = Boolean(CF_TURN_KEY_ID && CF_TURN_KEY_TOKEN);
const SPEED_ENABLED = SPEED_RELAY || process.env.SPEED_DEV === '1';
async function publicRpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  return { ok: res.ok, status: res.status, body };
}
const LINK_PATH = /^\/u\/([a-z0-9_]{3,20})\/?$/i;
const MEMBER_LINKS_ENABLED = false;   // members' anonymous links were retired in Nov 2026

async function datingRpc(fn, args, timeoutMs = RPC_TIMEOUT_MS) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn} ${res.status}`);
  return text ? JSON.parse(text) : null;
}

// ---- Push notifications (home-screen web app) --------------------------------------------------
// Keys from the environment on Railway (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY), or data/VAPID.json locally.
// The database queues private notifications and pings /api/push/wake; a slow poll is the backup.
let vapid;   // undefined = not loaded yet, null = not configured
function pushConfig() {
  if (vapid !== undefined) return vapid;
  vapid = null;
  let keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  if (!keys.publicKey || !keys.privateKey) {
    try { keys = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'VAPID.json'), 'utf8')); } catch { return vapid; }
  }
  try {
    const authHeader = webPush.vapidSigner({ ...keys, subject: 'mailto:hello@treehouse.ng' });
    vapid = { publicKey: keys.publicKey, authHeader };
  } catch (e) { console.error('Push notifications are off: invalid VAPID keys'); }
  return vapid;
}
const pushReady = () => Boolean(DATING_READY && pushConfig() && datingAdminToken());

let draining = false, drainAgain = false;
async function drainPush() {
  if (!pushReady()) return;
  if (draining) { drainAgain = true; return; }
  draining = true;
  try {
    for (let round = 0; round < 10; round++) {
      drainAgain = false;
      const rows = await datingRpc('admin_take_push', { p_key: datingAdminToken(), p_limit: 200 });
      if (!Array.isArray(rows) || !rows.length) { if (!drainAgain) break; continue; }
      const queue = rows.slice();
      const worker = async () => {
        for (let r; (r = queue.shift());) {
          try {
            const status = await webPush.sendPush(r, { kind: r.kind, url: r.url },
              { authHeader: vapid.authHeader, topic: `treehouse-${r.kind}` });
            if (status === 404 || status === 410) {
              await datingRpc('admin_drop_push_subscription', { p_key: datingAdminToken(), p_endpoint: r.endpoint }).catch(() => {});
            }
          } catch {}
        }
      };
      await Promise.all(Array.from({ length: Math.min(10, queue.length) }, worker));
      if (rows.length < 200 && !drainAgain) break;
    }
  } catch (e) {
    console.error('Push send failed:', e.message);
  } finally {
    draining = false;
  }
}
setInterval(() => { drainPush(); }, 60000).unref();

// ---- Chat photos: remove expired (30 days), unsent and never-sent files every hour -----------------
// The database lists them (owner key) and only allows deleting files that are due to go.
async function cleanChatPhotos() {
  if (!DATING_READY || !datingAdminToken()) return;
  try {
    for (let round = 0; round < 5; round++) {
      const names = await datingRpc('admin_expired_photos', { p_key: datingAdminToken(), p_limit: 500 }, 20000);
      if (!Array.isArray(names) || !names.length) break;
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/chat-photos`, {
        method: 'DELETE',
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: names }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) { console.log(`chat photo cleanup: ${res.status}`); break; }
      if (names.length < 500) break;
    }
  } catch (e) { console.log(`chat photo cleanup failed: ${e.message}`); }
}
setTimeout(cleanChatPhotos, 5 * 60 * 1000).unref();
setInterval(cleanChatPhotos, 60 * 60 * 1000).unref();

// ---- Birthdays: ages come from date of birth; refresh them every hour so age rooms stay right -------
async function refreshAges() {
  if (!DATING_READY || !datingAdminToken()) return;
  try { await datingRpc('admin_refresh_ages', { p_key: datingAdminToken() }, 20000); }
  catch (e) { if (!/ 404$/.test(e.message)) console.log(`age refresh failed: ${e.message}`); }
}
setTimeout(refreshAges, 2 * 60 * 1000).unref();
setInterval(refreshAges, 60 * 60 * 1000).unref();
// Pings come with every queued batch; check at most about once a second however many arrive.
let lastWake = 0, wakeTimer = null;
function wakePush() {
  const wait = 1000 - (Date.now() - lastWake);
  if (wait <= 0) { lastWake = Date.now(); drainPush(); return; }
  if (!wakeTimer) wakeTimer = setTimeout(() => { wakeTimer = null; lastWake = Date.now(); drainPush(); }, wait);
}

// Dating cards for the public page, fetched server-side so that page keeps loading only its own
// files. Visitors who aren't signed in share a short cache; a signed-in dater's token is passed
// through so cards from people they blocked (or who blocked them) stay hidden.
const cardsCache = new Map();   // "offset:limit" -> { at, cards } for visitors who aren't signed in
const JWT_RE = /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/;

async function datingCards(authHeader, offset = 0, limit = 12) {
  const signedIn = JWT_RE.test(authHeader || '');
  const key = `${offset}:${limit}`;
  const hit = cardsCache.get(key);
  if (!signedIn && hit && Date.now() - hit.at < 20000) return hit.cards;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/discover_profiles`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
      ...(signedIn ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify({ p_limit: limit, p_offset: offset }),
  });
  if (signedIn && (res.status === 401 || res.status === 403)) return datingCards(null, offset, limit); // bad/expired token: public list
  if (!res.ok) throw new Error(`cards ${res.status}`);
  const rows = await res.json();
  // Keep exactly the safe card fields, whatever the database returns.
  const cards = rows.map(({ handle, gender, age, location, intent }) => ({ handle, gender, age, location, intent }));
  if (!signedIn) {
    cardsCache.set(key, { at: Date.now(), cards });
    if (cardsCache.size > 200) cardsCache.clear();
  }
  return cards;
}

// Google AdSense (optional). Ads stay off until ADSENSE_CLIENT is set, e.g. ca-pub-1234567890123456.
// ADSENSE_SLOT is an ad unit id; without it, AdSense Auto ads places the ad.
const ADSENSE_CLIENT = /^ca-pub-\d{10,20}$/.test(process.env.ADSENSE_CLIENT || '') ? process.env.ADSENSE_CLIENT : '';
const ADSENSE_SLOT = /^\d{6,20}$/.test(process.env.ADSENSE_SLOT || '') ? process.env.ADSENSE_SLOT : '';
// Longest message that still fits the inbox message box at its smallest text size.
const MAX_LEN = 250;
// Only the newest messages are kept; older ones are deleted as new ones arrive.
const MAX_MESSAGES = Number(process.env.MAX_MESSAGES) || 100;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
// Behind a hosting proxy every request comes from the proxy, so read the visitor's IP from its headers.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const DB_FILE = path.join(DATA_DIR, 'messages.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---- Config (password, name, prompt) --------------------------------------
let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

if (process.env.ADMIN_PASSWORD) {
  config.password = process.env.ADMIN_PASSWORD;
} else if (!config.password) {
  config.password = crypto.randomBytes(9).toString('base64url');
  console.log(`\nNo ADMIN_PASSWORD set. Generated one and saved it in data/config.json`);
}
config.name = config.name || process.env.OWNER_NAME || 'me';
config.prompt = config.prompt || 'send me anonymous messages!';
saveConfig();

const passwordHash = () => crypto.createHash('sha256').update(config.password).digest();

// ---- Storage --------------------------------------------------------------
let messages = [];
try { messages = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}
messages = messages.slice(0, MAX_MESSAGES);

function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(messages, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
}

// Round to the hour so the exact send time can't be used to guess the sender.
function roundedNow() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

// ---- Spam protection (memory only, never written to disk) -----------------
// IPs are hashed with a salt that changes on every restart, kept for 10 minutes max.
const rateSalt = crypto.randomBytes(16);
const rateBuckets = new Map();
const RATE_WINDOW = 10 * 60 * 1000;
const RATE_MAX = 5;

function clientIp(req) {
  const forwarded = TRUST_PROXY && (req.headers['fly-client-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim());
  return forwarded || req.socket.remoteAddress || '';
}

function rateLimited(req) {
  const ip = clientIp(req);
  const key = crypto.createHmac('sha256', rateSalt).update(ip).digest('hex');
  const now = Date.now();
  const hits = (rateBuckets.get(key) || []).filter((t) => now - t < RATE_WINDOW);
  if (hits.length >= RATE_MAX) return true;
  hits.push(now);
  rateBuckets.set(key, hits);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, hits] of rateBuckets) {
    if (hits.every((t) => now - t >= RATE_WINDOW)) rateBuckets.delete(k);
  }
}, RATE_WINDOW).unref();

// ---- Stats (daily totals only) ---------------------------------------------
// Only counts are stored: no IPs, cookies, user agents or anything tied to a person.
// Unique visitors use a salted hash that lives in memory for one day; the salt is random,
// changes daily and is never saved, so the hashes can't be linked to anyone afterwards.
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const TIMEZONE = process.env.TIMEZONE || 'Africa/Lagos';
const STATS_KEEP_DAYS = 400;
// Ad links: /go/<name> counts the tap, then redirects.
const AD_LINKS = { ella: 'https://chat.whatsapp.com/H536nHEIumo65bJeKTUSBe', troit: 'https://wa.me/message/INKG4DTXV2LQN1', kickrs: 'https://kickrs.vercel.app', whatsapp: 'https://wa.me/2347067667536' };

let stats = { since: null, days: {} };
try { stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); } catch {}

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', hourCycle: 'h23' });
const dayKey = (d = new Date()) => dayFmt.format(d);

function today() {
  const key = dayKey();
  if (!stats.since) stats.since = key;
  if (!stats.days[key]) {
    stats.days[key] = { views: 0, uniques: 0, messages: 0, adTaps: 0, adLinks: {}, sources: {}, devices: {}, hours: Array(24).fill(0) };
    const keys = Object.keys(stats.days).sort();
    while (keys.length > STATS_KEEP_DAYS) delete stats.days[keys.shift()];
  }
  return stats.days[key];
}

let statsTimer = null;
function saveStats() {
  clearTimeout(statsTimer);
  statsTimer = setTimeout(() => {
    const tmp = STATS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(stats), { mode: 0o600 });
    fs.renameSync(tmp, STATS_FILE);
  }, 2000);
}
process.on('SIGTERM', () => { clearTimeout(statsTimer); try { fs.writeFileSync(STATS_FILE, JSON.stringify(stats)); } catch {} process.exit(0); });

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|discord|skype|preview|embed|curl|wget|python|httpclient|headless|lighthouse|monitor/i;

function sourceOf(req) {
  const ua = req.headers['user-agent'] || '';
  // In-app browsers usually send no referrer, but say which app they are.
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook';
  if (/Snapchat/i.test(ua)) return 'Snapchat';
  if (/musical_ly|TikTok|Bytedance/i.test(ua)) return 'TikTok';
  if (/Twitter/i.test(ua)) return 'X (Twitter)';
  let host = '';
  try { host = new URL(req.headers.referer || '').hostname.replace(/^www\./, ''); } catch {}
  if (!host) return 'Direct / other apps';
  if (/instagram/.test(host)) return 'Instagram';
  if (/facebook|fb\.com|fb\.me/.test(host)) return 'Facebook';
  if (/whatsapp/.test(host)) return 'WhatsApp';
  if (/^t\.co$|twitter|x\.com/.test(host)) return 'X (Twitter)';
  if (/snapchat/.test(host)) return 'Snapchat';
  if (/tiktok/.test(host)) return 'TikTok';
  if (/google\./.test(host)) return 'Google';
  if (host === (req.headers.host || '').split(':')[0] || host === CANONICAL_HOST || OLD_HOSTS.has(host) || host === 'treehouse.ng') return null; // own pages
  return host;
}

function deviceOf(ua) {
  if (/iPad|Tablet/i.test(ua)) return 'Tablet';
  if (/Mobi|Android|iPhone/i.test(ua)) return 'Phone';
  return 'Computer';
}

let uniqueDay = '', uniqueSalt = null, uniqueSeen = new Set();
function countVisit(req) {
  const ua = req.headers['user-agent'] || '';
  if (!ua || BOT_UA.test(ua) || req.headers.purpose === 'prefetch' || isOwner(req)) return;
  const d = today();
  d.views += 1;
  const key = dayKey();
  if (key !== uniqueDay) { uniqueDay = key; uniqueSalt = crypto.randomBytes(16); uniqueSeen = new Set(); }
  const id = crypto.createHmac('sha256', uniqueSalt).update(clientIp(req) + '|' + ua).digest('base64').slice(0, 16);
  if (!uniqueSeen.has(id)) { uniqueSeen.add(id); d.uniques += 1; }
  const source = sourceOf(req);
  if (source) d.sources[source] = (d.sources[source] || 0) + 1;
  const device = deviceOf(ua);
  d.devices[device] = (d.devices[device] || 0) + 1;
  saveStats();
}

function countMessage() {
  const d = today();
  d.messages += 1;
  d.hours[Number(hourFmt.format(new Date()))] += 1;
  saveStats();
}

function statsReport(rangeDays) {
  const keys = [];
  for (let i = rangeDays - 1; i >= 0; i--) keys.push(dayKey(new Date(Date.now() - i * 864e5)));
  const blank = { views: 0, uniques: 0, messages: 0, adTaps: 0, adLinks: {}, sources: {}, devices: {}, hours: Array(24).fill(0) };
  const days = keys.map((k) => ({ date: k, ...blank, ...(stats.days[k] || {}) }));
  const sum = (f) => days.reduce((n, d) => n + (d[f] || 0), 0);
  const merge = (f) => {
    const out = {};
    for (const d of days) for (const [k, v] of Object.entries(d[f] || {})) out[k] = (out[k] || 0) + v;
    return Object.entries(out).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  };
  const hours = Array(24).fill(0);
  for (const d of days) (d.hours || []).forEach((n, h) => { hours[h] += n; });
  const allDays = Object.values(stats.days);
  return {
    range: rangeDays,
    timezone: TIMEZONE,
    since: stats.since,
    totals: { views: sum('views'), uniques: sum('uniques'), messages: sum('messages'), adTaps: sum('adTaps'), apkDownloads: sum('apkDownloads') },
    allTime: { views: allDays.reduce((n, d) => n + d.views, 0), messages: allDays.reduce((n, d) => n + d.messages, 0), apkDownloads: allDays.reduce((n, d) => n + (d.apkDownloads || 0), 0) },
    daily: days.map(({ date, views, uniques, messages, apkDownloads }) => ({ date, views, uniques, messages, apkDownloads: apkDownloads || 0 })),
    sources: merge('sources'),
    adLinks: merge('adLinks'),
    devices: merge('devices'),
    hours,
    inbox: {
      stored: messages.length,
      unread: messages.filter((m) => !m.read).length,
      avgLength: messages.length ? Math.round(messages.reduce((n, m) => n + m.text.length, 0) / messages.length) : 0,
    },
  };
}

// ---- Owner sessions -------------------------------------------------------
const sessions = new Map(); // token -> expiry
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

function getCookie(req, name) {
  const match = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

function isOwner(req) {
  const token = getCookie(req, 'owner');
  const expiry = token && sessions.get(token);
  if (!expiry) return false;
  if (expiry < Date.now()) { sessions.delete(token); return false; }
  return true;
}

// ---- HTTP helpers ---------------------------------------------------------
// The public page gets a looser policy when ads are on, so Google's ad code can load after a message is sent.
const ADS_CSP = [
  "default-src 'self'",
  "script-src 'self' https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.google.com https://*.googleadservices.com https://*.doubleclick.net https://*.gstatic.com https://*.adtrafficquality.google",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' https://img.treehouse.ng",
  "frame-src https://*.doubleclick.net https://*.googlesyndication.com https://*.google.com https://*.adtrafficquality.google",
  "connect-src 'self' https://*.google.com https://*.googlesyndication.com https://*.doubleclick.net https://*.adtrafficquality.google",
  "fenced-frame-src https://*.doubleclick.net https://*.googlesyndication.com",
  "frame-ancestors 'none'",
].join('; ');

// The dating page talks to Supabase (HTTPS API + realtime websocket).
// Map tiles for Nearby come from OpenStreetMap (images only).
const DATING_CSP = [
  "default-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  `img-src 'self' data: blob: https://img.treehouse.ng https://tile.openstreetmap.org ${SUPABASE_URL}`,
  "media-src 'self' https://img.treehouse.ng",
  `connect-src 'self' ${SUPABASE_URL} ${SUPABASE_URL.replace('https://', 'wss://')}`,
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' https://img.treehouse.ng; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

// ---- Sign-up email check ------------------------------------------------------------------------
// Emails to mistyped addresses bounce, and too many bounces get our email sending paused. Before an
// account is created the app asks here: is the domain a known typo (gmail.con → gmail.com), and can
// the domain receive email at all (it has mail servers)? If the lookup itself fails, we let it through.
const dnsP = require('node:dns').promises;
const EMAIL_TYPOS = {
  'gmail.con': 'gmail.com', 'gmail.come': 'gmail.com', 'gmail.comm': 'gmail.com', 'gmail.cpm': 'gmail.com', 'gmail.co': 'gmail.com',
  'gmail.cm': 'gmail.com', 'gmail.om': 'gmail.com', 'gmail.vom': 'gmail.com', 'gmail.xom': 'gmail.com', 'gmail.coom': 'gmail.com',
  'gmail.comh': 'gmail.com', 'gmail.como': 'gmail.com', 'gmail.comom': 'gmail.com', 'gmail.comp': 'gmail.com', 'gmail.coml': 'gmail.com',
  'gmai.com': 'gmail.com', 'gmial.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gnail.com': 'gmail.com',
  'gmal.com': 'gmail.com', 'gmali.com': 'gmail.com', 'gmil.com': 'gmail.com', 'gimail.com': 'gmail.com', 'gmail22.com': 'gmail.com',
  'yahoo.con': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.cm': 'yahoo.com', 'yahoo.co': 'yahoo.com',
  'hotmail.con': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'outlook.con': 'outlook.com',
  'outlok.com': 'outlook.com', 'icloud.con': 'icloud.com', 'iclod.com': 'icloud.com',
};
const mxCache = new Map();   // domain → { ok, at }
async function domainHasMail(domain) {
  const hit = mxCache.get(domain);
  if (hit && Date.now() - hit.at < 24 * 3600 * 1000) return hit.ok;
  let ok = true;
  try {
    const mx = await Promise.race([dnsP.resolveMx(domain), new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), 3000))]);
    ok = Array.isArray(mx) && mx.some((r) => r.exchange && r.exchange !== '.');
  } catch (e) {
    if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') {
      // No mail servers listed: a domain can still take mail on its own address, so check that too.
      try { await dnsP.resolve4(domain); ok = true; } catch { ok = false; }
    } else ok = true;   // DNS trouble on our side: don't block anyone
  }
  if (mxCache.size > 5000) mxCache.clear();
  mxCache.set(domain, { ok, at: Date.now() });
  return ok;
}
async function checkEmail(raw) {
  const email = String(raw).trim().toLowerCase();
  const m = email.match(/^[^\s@]+@([a-z0-9.-]+\.[a-z]{2,})$/);
  if (!m) return { ok: false, reason: 'invalid' };
  const domain = m[1];
  if (EMAIL_TYPOS[domain]) return { ok: false, reason: 'typo', suggestion: email.slice(0, email.lastIndexOf('@') + 1) + EMAIL_TYPOS[domain] };
  if (!(await domainHasMail(domain))) return { ok: false, reason: 'no_mail' };
  return { ok: true };
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': isJson ? 'application/json' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 16 * 1024) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webmanifest': 'application/manifest+json',
  '.apk': 'application/vnd.android.package-archive',
};

// Static files: kept in memory with an ETag, compressed once (brotli or gzip), and cacheable by the
// browser. "no-cache" means phones keep their copy and only re-download a file after it changes
// (a quick 304 otherwise), so updates still show up straight away.
const zlib = require('node:zlib');
const fileCache = new Map();
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.svg', '.webmanifest', '.json']);
function serveFile(res, file, extraHeaders = {}, req = null, transform = null) {
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) return send(res, 404, 'Not found');
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    const key = full + (transform ? '#t' : '');
    let entry = fileCache.get(key);
    if (!entry || entry.mtimeMs !== st.mtimeMs) {
      let data;
      try { data = fs.readFileSync(full); } catch { return send(res, 404, 'Not found'); }
      if (transform) data = Buffer.from(transform(data.toString('utf8')));
      entry = { mtimeMs: st.mtimeMs, data, etag: `"${crypto.createHash('sha1').update(data).digest('hex').slice(0, 20)}"` };
      fileCache.set(key, entry);
    }
    const ext = path.extname(full);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: entry.etag, Vary: 'Accept-Encoding', ...extraHeaders };
    if (req && req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, { ...SECURITY_HEADERS, ...headers });
      return res.end();
    }
    let body = entry.data;
    const accept = (req && req.headers['accept-encoding']) || '';
    if (req && COMPRESSIBLE.has(ext) && body.length > 1024) {
      if (/\bbr\b/.test(accept)) {
        entry.br = entry.br || zlib.brotliCompressSync(entry.data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } });
        body = entry.br; headers['Content-Encoding'] = 'br';
      } else if (/\bgzip\b/.test(accept)) {
        entry.gz = entry.gz || zlib.gzipSync(entry.data, { level: 9 });
        body = entry.gz; headers['Content-Encoding'] = 'gzip';
      }
    }
    send(res, 200, body, headers);
  });
}

// The app page carries its public Supabase settings, so it can start without an extra request.
const homeConfigMeta = () => `<meta name="th-dating" content="${JSON.stringify({ ready: DATING_READY, enabled: DATING_ENABLED, url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY })
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}">`;
// Which version of the member app this server has: a fingerprint of its files. The app compares it
// when it comes back to the screen and reloads itself when a newer version is live (phones, iPhones
// especially, keep an app's page open for days without reloading it).
const APP_BUILD = (() => {
  const h = crypto.createHash('sha1');
  for (const f of fs.readdirSync(PUBLIC_DIR).filter((n) => /^(hy[\w-]*\.(js|css)|home\.html)$/.test(n)).sort()) h.update(f).update(fs.readFileSync(path.join(PUBLIC_DIR, f)));
  h.update(fs.readFileSync(__filename));   // a server change (e.g. to how files are linked) is a new release too
  return h.digest('hex').slice(0, 12);
})();
// Every member-app file is linked with ?v=<APP_BUILD>, so each release has brand-new addresses and no
// phone or web view can keep using an old copy (iPhones did, even after closing the app).
const withBuild = (src) => src.replace(/(["'])(\.?\/)(hy[\w-]*\.(?:js|css))(?:\?v=[\w]*)?\1/g, `$1$2$3?v=${APP_BUILD}$1`);
const injectHomeConfig = (html) => withBuild(html).replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  ${homeConfigMeta()}\n  <meta name="th-build" content="${APP_BUILD}">`);

// Video needs byte ranges: iPhones won't play a video whose server ignores Range requests.
function serveVideo(req, res, file) {
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) return send(res, 404, 'Not found');
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    const headers = { ...SECURITY_HEADERS, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=3600' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (!m || (m[1] === '' && m[2] === '')) {
      res.writeHead(200, { ...headers, 'Content-Length': st.size });
      return fs.createReadStream(full).pipe(res);
    }
    let start = m[1] === '' ? Math.max(0, st.size - Number(m[2])) : Number(m[1]);
    let end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
    if (start > end || start >= st.size) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${st.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(full, { start, end }).pipe(res);
  });
}

const cleanText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ---- Routes ---------------------------------------------------------------
// ---- Domain move (tell.brianjonahdennis.com → treehouse.ng) ------------------------------------
// Off until CANONICAL_HOST is set on Railway. Then visits to an old address are forwarded to the new
// one, keeping the path. APIs, background workers and ad links are left alone on the old address, so
// installed apps, older app builds, notification devices and the database's notification ping all keep
// working. Start with a temporary redirect (302); set DOMAIN_REDIRECT=301 once everything is confirmed.
const CANONICAL_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(process.env.CANONICAL_HOST || '') ? process.env.CANONICAL_HOST : '';
const OLD_HOSTS = new Set(['tell.brianjonahdennis.com', 'www.treehouse.ng']);
const REDIRECT_CODE = process.env.DOMAIN_REDIRECT === '301' ? 301 : 302;
// The owner's anonymous link lives on its own address, away from treehouse: people who search for
// treehouse land on the app, not on "send me anonymous messages". treehouse.ng/ opens the app instead.
const ANDROID_APK = 'treehouse-1.5.apk';
const LINK_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(process.env.ANON_LINK_HOST || '') ? process.env.ANON_LINK_HOST : 'tell.brianjonahdennis.com';
const TREEHOUSE_HOSTS = new Set(['treehouse.ng', 'www.treehouse.ng', CANONICAL_HOST].filter(Boolean));
const hostOf = (req) => (req.headers.host || '').split(':')[0].toLowerCase();
function domainRedirect(req, url) {
  if (!CANONICAL_HOST || (req.method !== 'GET' && req.method !== 'HEAD')) return null;
  const host = hostOf(req);
  if (host === CANONICAL_HOST || !OLD_HOSTS.has(host)) return null;
  const p = url.pathname;
  if (p.startsWith('/api/') || p.startsWith('/go/') || p === '/sw.js' || p === '/home-sw.js') return null;
  // The anonymous link address keeps its own page, the owner's inbox and the files they use.
  if (host === LINK_HOST && (p === '/' || p === '/app' || p === '/app/' || /^\/[\w./-]+\.\w+$/.test(p))) return null;
  return `https://${CANONICAL_HOST}${p}${url.search}`;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const moved = domainRedirect(req, url);
  if (moved) return send(res, REDIRECT_CODE, '', { Location: moved, 'Cache-Control': REDIRECT_CODE === 301 ? 'public, max-age=86400' : 'no-store' });

  if (req.method === 'GET') {
    if (p === '/') {
      if (TREEHOUSE_HOSTS.has(hostOf(req))) return serveFile(res, 'landing.html', {}, req);
      countVisit(req);
      return serveFile(res, 'index.html', ADSENSE_CLIENT ? { 'Content-Security-Policy': ADS_CSP } : {});
    }
    // Members' anonymous links are retired: treehouse is for anonymous dating now. Only the owner's
    // own link (the home page, /) still takes anonymous messages. Old member links go to treehouse.
    if (LINK_PATH.test(p)) return send(res, 302, '', { Location: '/home' });
    if (/^\/api\/u\/[a-z0-9_]{3,20}(\/messages)?$/i.test(p)) return send(res, 410, { error: 'Anonymous links have closed. Join treehouse to meet people anonymously.' });
    const linkInfo = MEMBER_LINKS_ENABLED && p.match(/^\/api\/u\/([a-z0-9_]{3,20})$/i);
    if (linkInfo) {
      if (!DATING_READY) return send(res, 404, { error: 'Not found.' });
      const r = await publicRpc('public_link', { p_username: linkInfo[1] });
      const row = r.ok && Array.isArray(r.body) ? r.body[0] : null;
      if (!row) return send(res, 404, { error: 'This link doesn\u2019t exist.' });
      const ads = ADSENSE_CLIENT ? { client: ADSENSE_CLIENT, slot: ADSENSE_SLOT } : null;
      return send(res, 200, { name: row.display_name, username: row.username, prompt: row.prompt, maxLength: 250, ads });
    }
    // Links in the ad box: count the tap, then send them on.
    const go = p.match(/^\/go\/(\w+)$/);
    if (go && AD_LINKS[go[1]]) {
      if (!BOT_UA.test(req.headers['user-agent'] || '')) {
        const d = today();
        d.adTaps += 1;
        d.adLinks = d.adLinks || {};
        d.adLinks[go[1]] = (d.adLinks[go[1]] || 0) + 1;
        saveStats();
      }
      return send(res, 302, '', { Location: AD_LINKS[go[1]] });
    }
    if (p === '/api/push/key') {
      const c = pushReady() ? pushConfig() : null;
      return c ? send(res, 200, { key: c.publicKey }) : send(res, 404, { error: 'Notifications aren’t set up.' });
    }
    if (p === '/ads.txt') {
      if (!ADSENSE_CLIENT) return send(res, 404, 'Not found');
      return send(res, 200, `google.com, ${ADSENSE_CLIENT.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n`);
    }
    if (p === '/app' || p === '/app/') return serveFile(res, 'app.html');
    // Android test build (until the Play Store listing is live). Counted, then downloaded.
    if (p === '/download/android' || p === '/download/android/') {
      if (!BOT_UA.test(req.headers['user-agent'] || '')) { const d = today(); d.apkDownloads = (d.apkDownloads || 0) + 1; saveStats(); }
      return serveFile(res, `downloads/${ANDROID_APK}`, { 'Content-Disposition': `attachment; filename="${ANDROID_APK}"`, 'Cache-Control': 'no-store' });
    }
    if (p === '/api/dating-cards') {
      if (!DATING_ENABLED) return send(res, 200, { cards: [] });
      // Pages of 12 (or up to 48); ask for one extra to know whether there are more.
      const offset = Math.min(Math.max(parseInt(url.searchParams.get('offset'), 10) || 0, 0), 100000);
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 12, 1), 48);
      try {
        const rows = await datingCards(req.headers.authorization, offset, limit + 1);
        return send(res, 200, { cards: rows.slice(0, limit), more: rows.length > limit });
      } catch { return send(res, 200, { cards: [], more: false }); }
    }
    if (p === '/api/email-check') {
      return send(res, 200, await checkEmail(url.searchParams.get('email') || ''));
    }
    if (p === '/api/dating-config') {
      return send(res, 200, { ready: DATING_READY, enabled: DATING_ENABLED, url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY });
    }
    if (p === '/inbox') return send(res, 302, '', { Location: '/app' });
    // Legal pages (also linked from the app and the Play Store listing)
    if (p === '/privacy' || p === '/privacy-policy') return serveFile(res, 'privacy.html');
    if (p === '/delete-account') return serveFile(res, 'delete-account.html');
    if (p === '/terms' || p === '/terms-of-use') return serveFile(res, 'terms.html');
    if (p === '/photo-credits') return serveFile(res, 'photo-credits.html');
    if (p === '/child-safety' || p === '/child-safety-standards') return serveFile(res, 'child-safety.html');
    // Google Search Console ownership file (keep it: Google re-checks it)
    if (/^\/google[0-9a-f]{16}\.html$/.test(p)) return serveFile(res, p.slice(1));
    // The classic member pages now forward to the new app. Browsers keep the #fragment of email
    // links (confirmations, password resets) across a redirect, so those still land signed in.
    // The old pages stay in public/ (link.html, date.html) in case they're ever needed again.
    if (p === '/link' || p === '/link/') return send(res, 302, '', { Location: '/home' });
    if (p === '/date' || p === '/date/') {
      const view = url.searchParams.get('view');
      const to = url.searchParams.get('to');
      const target = view === 'browse' ? '/home/discover' : view === 'chats' ? '/home/matches'
        : to && /^[A-Za-z]+ [A-Za-z]+ \d{3}$/.test(to) ? `/home?to=${encodeURIComponent(to)}` : '/home/discover';
      return send(res, 302, '', { Location: target });
    }
    // The member app: one page, the screens are routed in the browser (/home/messages etc.)
    if (p === '/home' || p.startsWith('/home/')) {
      if (!DATING_READY) return send(res, 404, 'Not found');
      return serveFile(res, 'home.html', { 'Content-Security-Policy': DATING_CSP }, req, injectHomeConfig);
    }
    if (p === '/sw.js') return serveFile(res, 'sw.js', { 'Service-Worker-Allowed': '/app' });
    if (p === '/api/owner') {
      const ads = ADSENSE_CLIENT ? { client: ADSENSE_CLIENT, slot: ADSENSE_SLOT } : null;
      return send(res, 200, { name: config.name, prompt: config.prompt, maxLength: MAX_LEN, ads });
    }
    // Member-app modules: their imports point at this release's addresses. A request carrying this
    // release's ?v= can be kept for a year (the address changes with every release).
    if (/^\/hy[\w-]*\.(js|css)$/.test(p)) {
      const current = url.searchParams.get('v') === APP_BUILD;
      return serveFile(res, p.slice(1), current ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : {}, req, p.endsWith('.js') ? withBuild : null);
    }
    if (/^\/[\w.-]+\.(css|js|svg|png|jpg|webmanifest)$/.test(p)) return serveFile(res, p.slice(1), {}, req);
    // Painted avatar portraits (they never change once published, so phones can keep them for a month).
    // Avatar paintings now live on Cloudflare (img.treehouse.ng). Older app copies still ask us: send them there.
    if (/^\/avatars\/(lib\/(f-[123]-[a-z]{2,8}|m-[123]-[a-z]{2,8}-[nb])-[ngs]-[hd]|[fm]\d{2})-(96|256|640)\.webp$/.test(p)) {
      res.writeHead(301, { Location: `https://img.treehouse.ng${p}`, 'Cache-Control': 'public, max-age=2592000' });
      return res.end();
    }
    // The Nearby map library (Leaflet), served from treehouse itself.
    if (/^\/vendor\/leaflet\/[\w.-]+\.(css|js)$/.test(p)) return serveFile(res, p.slice(1), {}, req);
    // Video ads live on Cloudflare (img.treehouse.ng/ads/) to keep our own server light.
    if (/^\/[\w.-]+\.mp4$/.test(p)) {
      if (fs.existsSync(path.join(PUBLIC_DIR, p.slice(1)))) return serveVideo(req, res, p.slice(1));
      res.writeHead(301, { Location: `https://img.treehouse.ng/ads${p}`, 'Cache-Control': 'public, max-age=86400' });
      return res.end();
    }
  }

  // Send an anonymous message to a member's link (stored in Supabase; nothing about the sender is kept)
  if (req.method === 'POST' && /^\/api\/u\/[a-z0-9_]{3,20}\/messages$/i.test(p)) return send(res, 410, { error: 'Anonymous links have closed. Join treehouse to meet people anonymously.' });
  const linkSend = MEMBER_LINKS_ENABLED && p.match(/^\/api\/u\/([a-z0-9_]{3,20})\/messages$/i);
  if (req.method === 'POST' && linkSend) {
    if (!DATING_READY) return send(res, 404, { error: 'Not found.' });
    let body;
    try { body = await readJson(req); } catch { return send(res, 400, { error: 'Invalid request.' }); }
    if (body.website) return send(res, 200, { ok: true }); // honeypot
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return send(res, 400, { error: 'Write something first.' });
    if (text.length > 250) return send(res, 400, { error: 'Messages can be up to 250 characters. Send the rest as another message.' });
    if (rateLimited(req)) return send(res, 429, { error: 'Too many messages. Try again in a few minutes.' });
    const r = await publicRpc('send_link_message', { p_username: linkSend[1], p_body: text });
    if (r.ok) return send(res, 201, { ok: true });
    const code = r.body && r.body.code;
    if (code === 'P0002') return send(res, 404, { error: 'This link isn\u2019t taking messages right now.' });
    if (code === 'P0001') return send(res, 429, { error: 'This inbox is getting a lot of messages. Try again in a few minutes.' });
    if (code === '22023') return send(res, 400, { error: 'Messages can be 1 to 250 characters.' });
    return send(res, 502, { error: 'Couldn\u2019t send right now. Please try again.' });
  }

  // The database pings this when notifications are queued. It carries nothing: the server
  // fetches the queue itself with its admin key, so a stray ping only causes an empty check.
  // Speed Dating: is it switched on (relay configured)?
  if (req.method === 'GET' && p === '/api/speed-config') {
    return send(res, 200, { enabled: DATING_READY && SPEED_ENABLED, relay: SPEED_RELAY }, { 'Cache-Control': 'no-store' });
  }
  // Speed Dating: relay passwords for the video call. Only for the signed-in person's live date.
  if (req.method === 'POST' && p === '/api/speed-ice') {
    if (!DATING_READY || !SPEED_ENABLED) return send(res, 503, { error: 'Speed Dating isn’t available right now.' });
    const token = (/^Bearer ([\w.-]{20,4000})$/.exec(req.headers.authorization || '') || [])[1];
    if (!token) return send(res, 401, { error: 'Sign in first.' });
    try {
      // The database checks the sign-in and that this person is on a date that hasn't ended.
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/speed_session`, {
        method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}', signal: AbortSignal.timeout(8000) });
      const date = r.ok ? await r.json() : null;
      if (!date || date.status === 'ended') return send(res, 403, { error: 'No live date.' });
      const stun = [{ urls: ['stun:stun.cloudflare.com:3478'] }];
      if (!SPEED_RELAY) return send(res, 200, { iceServers: stun, relay: false }, { 'Cache-Control': 'no-store' });
      const c = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${CF_TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: 'POST', headers: { Authorization: `Bearer ${CF_TURN_KEY_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 1800 }), signal: AbortSignal.timeout(8000) });
      if (!c.ok) { console.log(`speed relay: ${c.status}`); return send(res, 200, { iceServers: stun, relay: false }, { 'Cache-Control': 'no-store' }); }
      const j = await c.json();
      return send(res, 200, { iceServers: j.iceServers || stun, relay: true }, { 'Cache-Control': 'no-store' });
    } catch (e) { console.log(`speed ice failed: ${e.message}`); return send(res, 502, { error: 'Try again in a moment.' }); }
  }

  if (req.method === 'POST' && p === '/api/push/wake') {
    req.resume();
    wakePush();
    return send(res, 202, { ok: true });
  }

  // Send an anonymous message
  if (req.method === 'POST' && p === '/api/messages') {
    let body;
    try { body = await readJson(req); } catch { return send(res, 400, { error: 'Invalid request.' }); }
    if (body.website) return send(res, 200, { ok: true }); // honeypot: bots fill hidden fields
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return send(res, 400, { error: 'Write something first.' });
    if (text.length > MAX_LEN) return send(res, 400, { error: `Messages can be up to ${MAX_LEN} characters. Send the rest as another message.` });
    if (rateLimited(req)) return send(res, 429, { error: 'Too many messages. Try again in a few minutes.' });
    messages.unshift({ id: crypto.randomUUID(), text, prompt: config.prompt, createdAt: roundedNow(), read: false });
    countMessage();
    if (messages.length > MAX_MESSAGES) messages.length = MAX_MESSAGES;
    save();
    return send(res, 201, { ok: true });
  }

  // Owner login / logout
  if (req.method === 'POST' && p === '/api/login') {
    let body;
    try { body = await readJson(req); } catch { return send(res, 400, { error: 'Invalid request.' }); }
    const given = crypto.createHash('sha256').update(String(body.password || '')).digest();
    if (!crypto.timingSafeEqual(given, passwordHash())) {
      await new Promise((r) => setTimeout(r, 800)); // slow down guessing
      return send(res, 401, { error: 'Wrong password.' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL);
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return send(res, 200, { ok: true }, {
      'Set-Cookie': `owner=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}`,
    });
  }
  if (req.method === 'POST' && p === '/api/logout') {
    sessions.delete(getCookie(req, 'owner'));
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'owner=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  // The member app's current version (see APP_BUILD). Never cached.
  if (req.method === 'GET' && p === '/api/app-build') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ build: APP_BUILD }));
  }

  // Owner stats
  if (req.method === 'GET' && p === '/api/stats') {
    if (!isOwner(req)) return send(res, 401, { error: 'Not signed in.' });
    const range = [7, 30, 90].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 7;
    const report = statsReport(range);
    // Dating totals (counts only) from Supabase, when dating is set up.
    if (DATING_READY && datingAdminToken()) {
      try { report.dating = await datingRpc('admin_dating_stats', { p_key: datingAdminToken(), p_days: range }, 6000); }
      catch { report.dating = null; }
      // Which apps people use (Google Play test, APK, iPhone, browser): counts only.
      try { report.platforms = await datingRpc('admin_platform_stats', { p_key: datingAdminToken(), p_days: range }, 6000); }
      catch { report.platforms = null; }
      // Deleted accounts (counts only; counted from 12 Nov 2026).
      try { if (report.dating) report.dating.deletions = await datingRpc('admin_deletion_stats', { p_key: datingAdminToken(), p_days: range }, 6000); }
      catch { /* older database: no deletion counts yet */ }
      // Speed Dating (counts only).
      try { if (report.dating) report.dating.speed = await datingRpc('admin_speed_stats', { p_key: datingAdminToken(), p_days: range }, 6000); }
      catch { /* older database: no Speed Dating stats yet */ }
    }
    return send(res, 200, report);
  }

  // Owner: personal-link reports (moderation)
  if (p.startsWith('/api/link-reports')) {
    if (!isOwner(req)) return send(res, 401, { error: 'Not signed in.' });
    if (!DATING_READY || !datingAdminToken()) return send(res, 200, { reports: [], available: false });
    try {
      if (req.method === 'GET' && p === '/api/link-reports') {
        const status = ['open', 'reviewed', 'actioned', 'all'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'open';
        const reports = await datingRpc('admin_link_reports', { p_key: datingAdminToken(), p_status: status });
        const open = status === 'open' ? reports.length
          : (await datingRpc('admin_link_reports', { p_key: datingAdminToken(), p_status: 'open' })).length;
        return send(res, 200, { reports, open, available: true });
      }
      const m = p.match(/^\/api\/link-reports\/(\d+)$/);
      if (req.method === 'POST' && m) {
        const body = await readJson(req);
        const id = Number(m[1]);
        if (['open', 'reviewed', 'actioned'].includes(body.status)) {
          await datingRpc('admin_set_link_report_status', { p_key: datingAdminToken(), p_id: id, p_status: body.status });
        } else if (typeof body.suspend === 'boolean') {
          await datingRpc('admin_suspend_link', { p_key: datingAdminToken(), p_report: id, p_suspend: body.suspend });
        } else return send(res, 400, { error: 'Invalid request.' });
        return send(res, 200, { ok: true });
      }
    } catch { return send(res, 502, { error: 'Couldn\u2019t reach the database.' }); }
    return send(res, 404, { error: 'Not found.' });
  }

  // Owner: dating reports (moderation)
  if (p.startsWith('/api/dating-reports')) {
    if (!isOwner(req)) return send(res, 401, { error: 'Not signed in.' });
    if (!DATING_READY || !datingAdminToken()) return send(res, 200, { reports: [], available: false });
    try {
      if (req.method === 'GET' && p === '/api/dating-reports') {
        const status = ['open', 'reviewed', 'actioned', 'all'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'open';
        const reports = await datingRpc('admin_dating_reports', { p_key: datingAdminToken(), p_status: status });
        const open = status === 'open' ? reports.length
          : (await datingRpc('admin_dating_reports', { p_key: datingAdminToken(), p_status: 'open' })).length;
        return send(res, 200, { reports, open, available: true });
      }
      const m = p.match(/^\/api\/dating-reports\/(\d+)$/);
      if (req.method === 'POST' && m) {
        const body = await readJson(req);
        const id = Number(m[1]);
        if (['open', 'reviewed', 'actioned'].includes(body.status)) {
          await datingRpc('admin_set_report_status', { p_key: datingAdminToken(), p_id: id, p_status: body.status });
        } else if (typeof body.suspend === 'boolean') {
          await datingRpc('admin_suspend_reported', { p_key: datingAdminToken(), p_report: id, p_suspend: body.suspend });
        } else return send(res, 400, { error: 'Invalid request.' });
        return send(res, 200, { ok: true });
      }
    } catch { return send(res, 502, { error: 'Couldn\u2019t reach the dating database.' }); }
    return send(res, 404, { error: 'Not found.' });
  }

  // Owner settings
  if (req.method === 'PUT' && p === '/api/settings') {
    if (!isOwner(req)) return send(res, 401, { error: 'Not signed in.' });
    let body;
    try { body = await readJson(req); } catch { return send(res, 400, { error: 'Invalid request.' }); }
    const name = cleanText(body.name, 40);
    const prompt = cleanText(body.prompt, 120);
    if (name) config.name = name;
    if (prompt) config.prompt = prompt;
    saveConfig();
    return send(res, 200, { name: config.name, prompt: config.prompt });
  }

  // Owner-only inbox API
  if (p.startsWith('/api/inbox')) {
    if (!isOwner(req)) return send(res, 401, { error: 'Not signed in.' });
    if (req.method === 'GET' && p === '/api/inbox') return send(res, 200, { messages, limit: MAX_MESSAGES });

    const id = p.split('/')[3];
    const msg = messages.find((m) => m.id === id);
    if (!msg) return send(res, 404, { error: 'Message not found.' });

    if (req.method === 'PATCH') {
      let body;
      try { body = await readJson(req); } catch { return send(res, 400, { error: 'Invalid request.' }); }
      if ('read' in body) msg.read = Boolean(body.read);
      save();
      return send(res, 200, { message: msg });
    }
    if (req.method === 'DELETE') {
      messages = messages.filter((m) => m.id !== id);
      save();
      return send(res, 200, { ok: true });
    }
  }

  send(res, 404, 'Not found');
}

// Note: there is deliberately no request logging.
http.createServer((req, res) => {
  handle(req, res).catch(() => send(res, 500, { error: 'Something went wrong.' }));
}).listen(PORT, () => {
  console.log(`treehouse running`);
  console.log(`  Share this:  http://localhost:${PORT}/`);
  console.log(`  Your app:    http://localhost:${PORT}/app`);
});
