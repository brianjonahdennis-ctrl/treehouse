'use client';
// Invite links: treehouse.ng/r/<code> leaves a th_ref cookie (app/r/[code]/route.ts). Once the new
// member has a profile, the database credits whoever invited them (only accounts under 3 days old).
import * as api from './api';

let tried = false;
export async function claimReferralOnce() {
  if (tried || typeof document === 'undefined') return;
  const m = document.cookie.match(/(?:^|;\s*)th_ref=([a-z0-9]{4,24})/);
  if (!m) return;
  tried = true;
  try { await api.claimReferral(m[1]); } catch { /* older database or not eligible */ }
  document.cookie = 'th_ref=; Max-Age=0; path=/; SameSite=Lax';
}

export const inviteUrl = (code: string) => `https://treehouse.ng/r/${code}`;
