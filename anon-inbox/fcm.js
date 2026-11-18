// Push notifications for the treehouse Android app, through Firebase Cloud Messaging (HTTP v1), with
// no dependencies. The app saves its device token as a push "endpoint" of the form "fcm:<token>".
// Notifications stay private, like the web ones: they say what happened, never who or what was said.
//
// The key is a Firebase service account (Firebase console → Project settings → Service accounts →
// Generate new private key): FIREBASE_SERVICE_ACCOUNT on Railway (the whole JSON, or base64 of it),
// or data/firebase-service-account.json locally. Never commit or print it.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TEXT = {
  message: ['💌 New anonymous message', 'Someone sent you an anonymous message. Open treehouse to read it.'],
  chat: ['💬 New message', 'You have a new message. Open treehouse to read it.'],
  request: ['📩 New message request', 'Someone wants to chat. Open treehouse to see it.'],
  like: ['💘 Someone liked you', 'Open treehouse to see who’s interested.'],
  match: ['✨ It’s a match!', 'You have a new match. Open treehouse to say hi.'],
  friend: ['👋 New friend request', 'Someone wants to be your friend. Open treehouse to accept.'],
  announcement: ['Treehouse Update 🎉', 'We have something new for you. Open Treehouse to see what’s new.'],
  call: ['📞 Incoming call', 'Someone is calling you on treehouse. Open it now to answer.'],
  missed_call: ['📞 Missed call', 'You missed a call on treehouse. Open it to call back.'],
};

const b64u = (x) => Buffer.from(x).toString('base64url');

let account;   // undefined = not loaded yet, null = not configured
function loadAccount(dataDir) {
  if (account !== undefined) return account;
  account = null;
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (raw && !raw.trim().startsWith('{')) { try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch { raw = ''; } }
  if (!raw) { try { raw = fs.readFileSync(path.join(dataDir, 'firebase-service-account.json'), 'utf8'); } catch { return account; } }
  try {
    const j = JSON.parse(raw);
    if (!j.project_id || !j.client_email || !j.private_key) throw new Error('missing fields');
    account = { projectId: j.project_id, email: j.client_email, key: crypto.createPrivateKey(j.private_key) };
  } catch { console.error('Android push is off: FIREBASE_SERVICE_ACCOUNT is not a valid service account'); }
  return account;
}

let token = null;   // { value, exp }
async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (token && token.exp - now > 300) return token.value;
  const unsigned = `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64u(JSON.stringify({
    iss: account.email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }))}`;
  const jwt = `${unsigned}.${b64u(crypto.sign('sha256', Buffer.from(unsigned), account.key))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Firebase sign-in failed (${res.status})`);
  const j = await res.json();
  token = { value: j.access_token, exp: now + (j.expires_in || 3600) };
  return token.value;
}

const ready = (dataDir) => Boolean(loadAccount(dataDir));
const isFcm = (endpoint) => typeof endpoint === 'string' && endpoint.startsWith('fcm:');

// Send one notification. Returns 'ok', 'gone' (the token no longer works: forget it) or 'failed'.
async function send(endpoint, { kind, url }) {
  if (!account || !isFcm(endpoint)) return 'failed';
  const [title, body] = TEXT[kind] || ['treehouse', 'You have something new. Open treehouse to see it.'];
  const call = kind === 'call';
  const message = {
    token: endpoint.slice(4),
    notification: { title, body },
    data: { kind: String(kind || ''), url: typeof url === 'string' && url.startsWith('/home') ? url : '/home' },
    android: {
      priority: 'high',
      ttl: call ? '60s' : '86400s',
      notification: {
        channel_id: call ? 'calls' : 'treehouse',
        tag: `treehouse-${kind || 'update'}`,   // newer notifications of the same kind replace older ones
        icon: 'ic_stat_treehouse',
        color: '#ff4f9a',
        default_sound: true,
        notification_priority: call ? 'PRIORITY_MAX' : 'PRIORITY_HIGH',
      },
    },
  };
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(10000),
  });
  if (res.ok) return 'ok';
  const text = await res.text().catch(() => '');
  if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(text)) return 'gone';
  if (res.status === 400 && /INVALID_ARGUMENT/.test(text) && /token/i.test(text)) return 'gone';
  if (res.status === 401) token = null;
  return 'failed';
}

module.exports = { ready, isFcm, send, TEXT };
