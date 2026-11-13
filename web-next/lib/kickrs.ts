'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Games on treehouse are made by Kickrs (kickrs.app). This is the browser side of that connection:
// the games list, the one-minute sign-in pass for the Kickrs frame, and the messages between this page
// and the frame. Kickrs never gets a treehouse sign-in token: it gets a pass signed by our server with
// the member's Kickrs id, nickname, avatar and "18+" only (see KICKRS.md).
import * as api from './api';
import { MOCK } from './supabase';

export const KICKRS_ORIGIN = (process.env.NEXT_PUBLIC_KICKRS_ORIGIN || 'https://kickrs.app').replace(/\/$/, '');
export const KICKRS_API = (process.env.NEXT_PUBLIC_KICKRS_API || 'https://play.kickrs.app').replace(/\/$/, '');
const RETURN_URLS = [`${KICKRS_ORIGIN}/treehouse`, ...(process.env.NEXT_PUBLIC_KICKRS_RETURN_URLS || '').split(',').map((u) => u.trim()).filter(Boolean)];
const NONCE = /^[A-Za-z0-9_-]{16,64}$/;

export interface KickrsGame { id: string; name: string; tagline: string; status: 'live' | 'soon'; players: string; path: string | null; join?: string | null; playing: number | null }

export type KickrsEvent =
  | { type: 'kickrs:ready'; v: 1; nonce: string }
  | { type: 'kickrs:signed-in'; name: string }
  | { type: 'kickrs:match-start'; matchId: string; mode: string; opponent: string }
  | { type: 'kickrs:match-end'; matchId: string; mode: string; won: boolean | null; score: [number, number]; opponent: string }
  | { type: 'kickrs:match-left'; matchId: string }
  | { type: 'kickrs:add-friend'; treehouseId: string; name: string }
  | { type: 'kickrs:friend-status'; treehouseId: string; handle: string }
  | { type: 'kickrs:invite'; code: string; url: string };

export type FriendStatus = 'none' | 'friends' | 'pending' | 'chat';

type Reply =
  | { type: 'treehouse:ticket'; ticket: string }
  | { type: 'treehouse:ticket-error'; message: string }
  | { type: 'treehouse:friend-result'; treehouseId: string; ok: boolean; message: string }
  | { type: 'treehouse:friend-status'; treehouseId: string; status: FriendStatus };

let gamesCache: { at: number; games: KickrsGame[] } | null = null;
export async function kickrsGames(): Promise<KickrsGame[]> {
  if (gamesCache && Date.now() - gamesCache.at < 15000) return gamesCache.games;
  const res = await fetch(`${KICKRS_API}/games`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Games are not available right now. Try again in a moment.');
  const games = ((await res.json()) as { games: KickrsGame[] }).games || [];
  gamesCache = { at: Date.now(), games };
  return games;
}
export const gameUrl = (g: KickrsGame) => (g.path ? `${KICKRS_ORIGIN}${g.path}` : null);
export const joinUrl = (g: KickrsGame, code: string) => `${KICKRS_ORIGIN}${g.join || '/f/'}${code}?embed=treehouse`;

function mockToken() {
  const tab = sessionStorage.getItem('mock-tab') || 'T0';
  return `mock.${tab}`;
}

export async function kickrsTicket(nonce: string): Promise<string> {
  const token = MOCK ? mockToken() : (await api.session())?.access_token;
  if (!token) throw new Error('Sign in to treehouse first.');
  const res = await fetch('/api/kickrs/ticket', {
    method: 'POST', cache: 'no-store',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ nonce }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ticket) throw new Error(data.message || 'treehouse couldn’t sign you in to Kickrs.');
  return data.ticket;
}

// Listen to one Kickrs frame. Only messages from Kickrs, from that frame, are handled.
export function connectKickrs(frame: HTMLIFrameElement, handlers: { addFriend: (id: string, name: string) => Promise<string>; friendStatus: (handle: string) => FriendStatus; onEvent?: (e: KickrsEvent) => void }) {
  const reply = (m: Reply) => frame.contentWindow?.postMessage(m, KICKRS_ORIGIN);
  const onMessage = async (event: MessageEvent) => {
    if (event.origin !== KICKRS_ORIGIN || event.source !== frame.contentWindow) return;
    const data = event.data as KickrsEvent;
    if (!data || typeof data !== 'object' || typeof (data as any).type !== 'string' || !data.type.startsWith('kickrs:')) return;
    handlers.onEvent?.(data);
    if (data.type === 'kickrs:ready' && NONCE.test(String(data.nonce))) {
      try { reply({ type: 'treehouse:ticket', ticket: await kickrsTicket(data.nonce) }); }
      catch (e: any) { reply({ type: 'treehouse:ticket-error', message: e?.message || 'treehouse couldn’t sign you in.' }); }
    }
    if (data.type === 'kickrs:friend-status' && typeof data.treehouseId === 'string' && typeof data.handle === 'string') {
      reply({ type: 'treehouse:friend-status', treehouseId: data.treehouseId, status: handlers.friendStatus(data.handle) });
    }
    if (data.type === 'kickrs:add-friend' && typeof data.treehouseId === 'string') {
      try { reply({ type: 'treehouse:friend-result', treehouseId: data.treehouseId, ok: true, message: await handlers.addFriend(data.treehouseId, String(data.name || '')) }); }
      catch (e: any) { reply({ type: 'treehouse:friend-result', treehouseId: data.treehouseId, ok: false, message: api.friendly(e) }); }
    }
  };
  const handler = (e: MessageEvent) => { void onMessage(e); };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

// "Continue with treehouse" on kickrs.app sends people to /home/connect/kickrs?nonce=…&return=….
// The details are kept on the device while they sign in (Google always comes back to /home).
const CONNECT_KEY = 'th-kickrs-connect';
export function rememberConnect() {
  if (typeof window === 'undefined' || location.pathname !== '/home/connect/kickrs') return;
  const q = new URLSearchParams(location.search);
  const nonce = q.get('nonce'), back = q.get('return');
  if (nonce && back) try { sessionStorage.setItem(CONNECT_KEY, JSON.stringify({ nonce, back, at: Date.now() })); } catch {}
}
function readConnect() {
  try {
    const raw = sessionStorage.getItem(CONNECT_KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (!v || Date.now() - v.at > 30 * 60000 || !NONCE.test(v.nonce) || !RETURN_URLS.includes(v.back)) return null;
    return v as { nonce: string; back: string; at: number; seen?: boolean };
  } catch { return null; }
}
// For the connect page: the saved details (marked as seen, so the app stops sending people back to it).
export function pendingConnect(): { nonce: string; back: string } | null {
  const v = readConnect();
  if (!v) return null;
  if (!v.seen) try { sessionStorage.setItem(CONNECT_KEY, JSON.stringify({ ...v, seen: true })); } catch {}
  return { nonce: v.nonce, back: v.back };
}
// For the app shell: someone came from kickrs.app, signed in, and hasn't reached the connect page yet.
export const connectWaiting = () => { const v = readConnect(); return Boolean(v && !v.seen); };
export function clearConnect() { try { sessionStorage.removeItem(CONNECT_KEY); } catch {} }

// Penalty challenges in a chat: the message carries a treehouse link that opens the game and joins.
// Kickrs keeps a challenge open for 10 minutes while the person who sent it waits.
export const CHALLENGE_MS = 10 * 60 * 1000;
const CHALLENGE_LINK = /\/home\/games\/([a-z0-9-]{2,30})\?join=([A-Z0-9]{4,10})\b/;
export const isInviteCode = (v: unknown): v is string => typeof v === 'string' && /^[A-Z0-9]{4,10}$/.test(v);
export const CHALLENGES: Record<string, { art: string; title: string; line: string; menu: string; what: string }> = {
  penalties: { art: '⚽', title: 'Penalty shootout', line: '⚽ Penalty shootout! I challenge you on Kickrs.', menu: 'Penalty challenge', what: 'Play' },
  trivia: { art: '🧠', title: 'Trivia duel', line: '🧠 Trivia duel! Think you know more than me? Play me on Kickrs.', menu: 'Trivia challenge', what: 'Quiz' },
  crosswords: { art: '🔠', title: 'Crossword race', line: '🔠 Crossword race! Same puzzle, first to fill the grid wins. Play me on Kickrs.', menu: 'Crossword race', what: 'Race' },
};
export const challengeOf = (gameId: string) => CHALLENGES[gameId] || CHALLENGES.penalties;
export const challengeText = (gameId: string, code: string) =>
  `${challengeOf(gameId).line} Tap to play: ${location.origin}/home/games/${gameId}?join=${code}`;
export function parseChallenge(body: string): { game: string; code: string } | null {
  const m = CHALLENGE_LINK.exec(body || '');
  return m ? { game: m[1], code: m[2] } : null;
}
