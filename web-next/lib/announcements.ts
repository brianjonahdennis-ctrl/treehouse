'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Announcements: categories, safe links, the unread count, and the small "Markdown-lite" format the
// composer writes. The format is turned into React elements (never HTML), so content can't run code.
import * as api from './api';
import { state, emit } from './state';

export type Ann = {
  id: string; title: string; preview: string; category: string; cover_url: string | null; cta_label: string | null; cta_url: string | null;
  published_at: string; delivered_at?: string; read_at: string | null; archived_at: string | null; body?: string;
  revises?: string | null; revised_by?: string | null; expired?: boolean;
};

export const CATS: Record<string, { label: string; icon: string; tone: string }> = {
  product_update: { label: 'Product Update', icon: 'shield', tone: 'blue' },
  feature_launch: { label: 'Feature Launch', icon: 'rocket', tone: 'pink' },
  event: { label: 'Events', icon: 'calendar', tone: 'violet' },
  community: { label: 'Community', icon: 'rooms', tone: 'teal' },
  maintenance: { label: 'Maintenance', icon: 'wrench', tone: 'amber' },
  important: { label: 'Important', icon: 'alert', tone: 'red' },
};
export const CAT_IDS = Object.keys(CATS);

// Pages a button may open (must match dating_private.ann_routes() in the database).
export const ROUTES: [string, string][] = [
  ['/home', 'Home'], ['/home/discover', 'Discover'], ['/home/discover/nearby', 'Nearby'], ['/home/rooms', 'Chatrooms'],
  ['/home/matches', 'Inbox'], ['/home/matches/friends', 'Friends'], ['/home/matches/requests', 'Requests'], ['/home/matches/likes', 'Likes you'],
  ['/home/matches/announcements', 'Announcements'], ['/home/games', 'Games'], ['/home/profile', 'Profile'], ['/home/notifications', 'Notifications'],
];
export const CTA_PRESETS = ['Explore Nearby', 'Discover Events', 'Play Now', 'Update Profile', 'Learn More', 'Open Treehouse'];

const HTTPS = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{2,5})?(\/[^\s<>"'\\]*)?$/i;
/** A link is safe if it's an approved treehouse page or a plain https:// address. Anything else: null. */
export function safeLink(url: string | null | undefined): { internal: boolean; href: string } | null {
  if (!url) return null;
  const u = url.trim();
  if (ROUTES.some(([r]) => r === u) || /^\/home\/games\/[a-z0-9-]{1,40}$/.test(u) || /^\/home\/matches\/announcements\/[0-9a-f-]{36}$/.test(u)) return { internal: true, href: u };
  if (HTTPS.test(u) && u.length <= 500) return { internal: false, href: u };
  return null;
}
// Images must be uploaded (Supabase storage) or on img.treehouse.ng: the site's security policy blocks others.
const IMG_HOSTS = [process.env.NEXT_PUBLIC_SUPABASE_URL || '', 'https://img.treehouse.ng'].filter(Boolean).map((h) => h.replace(/\/$/, '') + '/');
export const safeImage = (url: string | null | undefined) => {
  const u = (url || '').trim();
  return u && /^https:\/\/[^\s<>"']+$/i.test(u) && IMG_HOSTS.some((h) => u.startsWith(h)) ? u : null;
};

// ---- Unread count: loaded with the Inbox (no polling) ----------------------------------------------------
let lastUnread = 0;
export async function loadAnnUnread({ force = false } = {}) {
  if (!force && Date.now() - lastUnread < 30000) return;
  lastUnread = Date.now();
  try { const n = await api.announcementsUnread(); if (n !== state.annUnread) { state.annUnread = n; emit('badges'); } } catch { /* keep what we had */ }
}
export function setAnnUnread(n: number) { state.annUnread = Math.max(0, n); emit('badges'); }

// ---- Markdown-lite --------------------------------------------------------------------------------------
// # Heading / ## Subheading · paragraphs (blank line between) · "- " bullets · "1. " numbered ·
// ![alt](https://image) on its own line · [[Button label](link)] on its own line · **bold** and
// [text](link) inside text.
export type Block =
  | { t: 'h'; level: 2 | 3; text: string }
  | { t: 'p'; text: string }
  | { t: 'ul' | 'ol'; items: string[] }
  | { t: 'img'; src: string; alt: string }
  | { t: 'btn'; label: string; href: string };
export function parseBody(src: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let list: { t: 'ul' | 'ol'; items: string[] } | null = null;
  const flush = () => {
    if (para.length) { out.push({ t: 'p', text: para.join(' ') }); para = []; }
    if (list) { out.push(list); list = null; }
  };
  for (const raw of String(src || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    let m: RegExpMatchArray | null;
    if (!line) { flush(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.+)$/))) { flush(); out.push({ t: 'h', level: m[1].length === 1 ? 2 : 3, text: m[2] }); continue; }
    if ((m = line.match(/^!\[([^\]]{0,120})\]\((\S+)\)$/))) { flush(); const s = safeImage(m[2]); if (s) out.push({ t: 'img', src: s, alt: m[1] }); continue; }
    if ((m = line.match(/^\[\[([^\]]{1,40})\]\((\S+)\)\]$/))) { flush(); const l = safeLink(m[2]); if (l) out.push({ t: 'btn', label: m[1], href: l.href }); continue; }
    if ((m = line.match(/^[-*•]\s+(.+)$/)) || (m = line.match(/^\d+[.)]\s+(.+)$/))) {
      const kind = /^\d/.test(line) ? 'ol' : 'ul';
      if (para.length) { out.push({ t: 'p', text: para.join(' ') }); para = []; }
      if (!list || list.t !== kind) { if (list) out.push(list); list = { t: kind, items: [] }; }
      list.items.push(m[1]);
      continue;
    }
    if (list) { out.push(list); list = null; }
    para.push(line);
  }
  flush();
  return out;
}
/** Inline pieces of a line: plain text, **bold**, and [text](safe link). */
export type Inline = { t: 'text' | 'b'; v: string } | { t: 'a'; v: string; href: string; internal: boolean };
export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let i = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > i) out.push({ t: 'text', v: s.slice(i, m.index) });
    if (m[1]) out.push({ t: 'b', v: m[1] });
    else { const l = safeLink(m[3]); out.push(l ? { t: 'a', v: m[2], href: l.href, internal: l.internal } : { t: 'text', v: m[2] }); }
    i = m.index + m[0].length;
  }
  if (i < s.length) out.push({ t: 'text', v: s.slice(i) });
  return out;
}

// Dates in Lagos time: "13 November 2026 · 10:00 AM".
export function annDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return '';
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' });
  return withTime ? `${day} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos' })}` : day;
}
export function annShortDate(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  const lag = (x: Date) => x.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos' });
  if (lag(d) === lag(now)) return 'Today';
  if (lag(d) === lag(new Date(now.getTime() - 864e5))) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
}
// datetime-local value (typed as Lagos time, UTC+1 all year) ↔ ISO.
export const lagosInputToIso = (v: string) => (v ? new Date(`${v}:00+01:00`).toISOString() : null);
export function isoToLagosInput(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 3600000);
  return d.toISOString().slice(0, 16);
}
export const fmtN = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('en-NG'));

