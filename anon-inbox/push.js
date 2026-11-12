// Web Push for the treehouse home-screen app, with no dependencies.
// Implements VAPID (RFC 8292) and aes128gcm message encryption (RFC 8291) with node:crypto.
// Payloads are tiny and private: just the kind of notification and the page to open.

const crypto = require('node:crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');

// Make a new VAPID key pair (used once, when setting up).
function generateVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

function vapidSigner({ publicKey, privateKey, subject }) {
  const pub = unb64u(publicKey);
  const d = unb64u(privateKey);
  if (pub.length !== 65 || pub[0] !== 4 || d.length !== 32) throw new Error('Invalid VAPID keys');
  const key = crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: b64u(d), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: 'jwk',
  });
  const cache = new Map();   // audience -> { exp, header }
  return function authHeader(endpoint) {
    const aud = new URL(endpoint).origin;
    const now = Math.floor(Date.now() / 1000);
    const hit = cache.get(aud);
    if (hit && hit.exp - now > 3600) return hit.header;
    const exp = now + 12 * 3600;
    const unsigned = `${b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))}.${b64u(JSON.stringify({ aud, exp, sub: subject }))}`;
    const sig = crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
    const header = `vapid t=${unsigned}.${b64u(sig)}, k=${publicKey}`;
    cache.set(aud, { exp, header });
    return header;
  };
}

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// Encrypt a payload for one subscription (RFC 8291, single record).
function encrypt(payload, p256dh, auth) {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('Invalid subscription keys');
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = crypto.randomBytes(16);

  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}

// Send one notification. Resolves to the push service's status code (201 = sent; 404/410 = device gone).
async function sendPush(sub, data, { authHeader, topic, ttl = 86400, timeoutMs = 10000 }) {
  const endpoint = new URL(sub.endpoint);
  if (endpoint.protocol !== 'https:') throw new Error('Push endpoints must be HTTPS');
  const headers = {
    Authorization: authHeader(sub.endpoint),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl),
    Urgency: 'high',
  };
  if (topic) headers.Topic = topic;   // a newer notification of the same kind replaces an undelivered one
  const res = await fetch(sub.endpoint, {
    method: 'POST', headers, body: encrypt(JSON.stringify(data), sub.p256dh, sub.auth),
    signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
  });
  await res.arrayBuffer().catch(() => {});
  return res.status;
}

module.exports = { generateVapidKeys, vapidSigner, encrypt, sendPush };
