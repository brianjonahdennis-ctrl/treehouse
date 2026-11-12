// Small helpers shared by screens (ported from anon-inbox/public/hy-ui.js).

// Saved-on-this-device settings, same keys as the live app (hy-theme, hy-notif-seen, ...), so moving
// between the two apps keeps them.
export const store = {
  get<T = unknown>(k: string, d: T | null = null): T | null {
    try { const v = localStorage.getItem(k); return v == null ? d : (JSON.parse(v) as T); } catch { return d; }
  },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k: string) { try { localStorage.removeItem(k); } catch {} },
};

export function ago(iso: string | number | Date) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export function dayLabel(iso: string) {
  const d = new Date(iso), today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// Anonymous people get a colour from their handle, so the same person always looks the same.
const PALETTES = [
  ['#ff3d9a', '#a855f7'], ['#a855f7', '#38bdf8'], ['#f97316', '#ec4899'], ['#14b8a6', '#6366f1'],
  ['#f43f5e', '#f59e0b'], ['#8b5cf6', '#ec4899'], ['#0ea5e9', '#22c55e'], ['#6366f1', '#14b8a6'],
];
export function hash(s: string) { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) | 0; return Math.abs(x); }
export function avatarBg(seed: string) { const [a, b] = PALETTES[hash(seed) % PALETTES.length]; return `linear-gradient(135deg, ${a}, ${b})`; }
export function initials(name: string) {
  const words = String(name || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).filter((w) => !/^\d+$/.test(w));
  return ((words[0] || '?')[0] + (words[1] ? words[1][0] : '')).toUpperCase();
}

// ---- Date of birth (Nigeria time, like the database) ---------------------------------------------
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function lagosToday(): [number, number, number] {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((x) => x.type === t)!.value);
  return [get('year'), get('month'), get('day')];
}
export function yearsOld(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const [ty, tm, td] = lagosToday();
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}
export const formatDob = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
export const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
