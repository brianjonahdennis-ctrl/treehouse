'use client';
// Shared birthday helper (kept separate so components don't import each other in a loop).
import { state } from '@/lib/state';

/** My own birthday today (Lagos time), from my own date of birth. Only I see this. */
export function isMyBirthday() {
  const dob = state.profile && state.profile.birth_date;
  if (!dob) return false;
  const today = new Date(Date.now() + 3600000).toISOString().slice(5, 10);   // Lagos is UTC+1
  const md = String(dob).slice(5, 10);
  if (md === today) return true;
  const y = new Date().getUTCFullYear();
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return md === '02-29' && today === '02-28' && !leap;
}

