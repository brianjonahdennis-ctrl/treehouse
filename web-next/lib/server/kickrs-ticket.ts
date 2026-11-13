// Server only. Signs the one-minute Kickrs pass (Ed25519, Node's own crypto, no packages).
// Kickrs checks it with the matching public key (TREEHOUSE_PUBLIC_KEY on the Kickrs server).
import { createHash, createPrivateKey, randomUUID, sign, type KeyObject } from 'node:crypto';

export interface KickrsPlayer { kickrsId: string; handle: string; avatarUrl: string | null }

const NONCE = /^[A-Za-z0-9_-]{16,64}$/;
let key: KeyObject | null = null;

function signingKey(): KeyObject {
  if (key) return key;
  const raw = process.env.KICKRS_SIGNING_KEY;
  if (!raw) throw new Error('KICKRS_SIGNING_KEY is not set');
  key = createPrivateKey({ key: Buffer.from(raw.trim(), 'base64'), format: 'der', type: 'pkcs8' });
  return key;
}

export const isNonce = (v: unknown): v is string => typeof v === 'string' && NONCE.test(v);

export function kickrsTicket(player: KickrsPlayer, nonce: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const claims = { iss: 'treehouse', aud: 'kickrs', sub: player.kickrsId, handle: player.handle, avatar: player.avatarUrl, adult: true, nonce, iat, exp: iat + 60, jti: randomUUID() };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `kt1.${body}.${sign(null, Buffer.from(`kt1.${body}`), signingKey()).toString('base64url')}`;
}

// Preview only (NEXT_PUBLIC_TH_MOCK=1 and KICKRS_MOCK_TICKETS=1): a stable fake member per browser tab.
export function mockPlayer(tab: string): KickrsPlayer {
  const h = createHash('sha256').update(tab).digest('hex');
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  const names = ['Lucky Dolphin', 'Gentle Tiger', 'Noble Owl', 'Swift Hawk', 'Calm River'];
  return { kickrsId: id, handle: `${names[parseInt(h.slice(0, 2), 16) % names.length]} ${100 + (parseInt(h.slice(2, 5), 16) % 900)}`, avatarUrl: null };
}
