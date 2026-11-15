'use client';
// Invite links: treehouse.ng/r/<code> leaves a th_ref cookie (app/r/[code]/route.ts). Once the new
// member has a profile, the database credits whoever invited them (only accounts under 3 days old).
import * as api from './api';

let tried = false;
export async function claimReferralOnce() {
  if (tried || typeof document === 'undefined') return;
  const m = document.cookie.match(/(?:^|;\s*)th_ref=([a-z0-9]{3,24})/);
  if (!m) return;
  tried = true;
  const via = /(?:^|;\s*)th_via=qr/.test(document.cookie) ? 'qr' : 'link';
  try { await api.claimReferral(m[1], via); } catch { /* older database or not eligible */ }
  for (const k of ['th_ref', 'th_via']) {
    document.cookie = `${k}=; Max-Age=0; path=/; SameSite=Lax`;
    if (location.hostname.endsWith('treehouse.ng')) document.cookie = `${k}=; Max-Age=0; path=/; domain=treehouse.ng; SameSite=Lax`;
  }
}

export const inviteUrl = (code: string) => `https://treehouse.ng/r/${code}`;
