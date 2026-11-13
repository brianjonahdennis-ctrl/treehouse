'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared app state (port of anon-inbox/public/hy-state.js). Screens read it with useAppState(),
// which re-renders them whenever something calls emit(). Same rules as the live app: the chat list
// refreshes at most every 30 s unless forced, and backs off while the server struggles.
import { useSyncExternalStore } from 'react';
import * as api from './api';
import { store } from './util';

export type Convo = any;
export const state = {
  user: null as any,
  bird: null as any,        // my Bird Kingdom level (my_bird / activity_ping)
  profile: null as any,
  requests: [] as any[],
  convos: [] as Convo[],
  pendingLikes: 0,
  myStatus: null as null | { body: string; updated_at: string },
  friendStatus: {} as Record<string, { body: string; updated_at: string }>,
  openChat: null as string | null,
  ready: false,
  booted: false,
  bootError: '' as string,
  onboarding: false,
  recovering: false,
  inRoom: null as boolean | null,
};

// ---- Change signal ------------------------------------------------------------------------------
let version = 0;
const subs = new Set<(what: string) => void>();
export const subscribe = (fn: (what: string) => void) => { subs.add(fn); return () => { subs.delete(fn); }; };
export const emit = (what = 'all') => { version++; subs.forEach((fn) => fn(what)); };
const subscribeAny = (cb: () => void) => subscribe(() => cb());
/** Re-render when the app state changes. Returns the (mutable) state object. */
export function useAppState() {
  useSyncExternalStore(subscribeAny, () => version, () => 0);
  return state;
}

// ---- Derived lists --------------------------------------------------------------------------------
export const statusOf = (c: Convo) => c.status || 'chat';
export const matchFriendAsks = () => state.convos.filter((c) => !c.blocked && c.friendAsk === 'theirs' && c.kind !== 'friend');
export const messageRequests = () => state.convos.filter((c) => !c.blocked && statusOf(c) === 'request');
export const unreadChats = () => state.convos.filter((c) => !c.blocked && statusOf(c) !== 'request').reduce((n, c) => n + (c.unread || 0), 0);
export const isMatch = (c: Convo) => c.matched === true && c.kind !== 'friend';
export const isFriend = (c: Convo) => c.kind === 'friend';
export const friendsList = () => state.convos
  .filter((c) => c.kind === 'friend' && !c.blocked && statusOf(c) === 'chat')
  .map((c) => Object.assign(c, { friend_status: state.friendStatus[c.conversation_id] || null }));
export const newMatches = () => state.convos.filter((c) => !c.blocked && statusOf(c) === 'chat' && !c.last_message && c.kind !== 'friend');
export const inboxBadge = () => state.requests.length + messageRequests().length + matchFriendAsks().length + unreadChats() + newMatches().length;

export function markChatRead(id: string) {
  const c = state.convos.find((x) => x.conversation_id === id);
  if (c && c.unread) { c.unread = 0; emit('badges'); }
  return api.markChatRead(id).catch(() => {});
}

let lastTouch = 0, lastLoad = 0, loading: Promise<void> | null = null;
export async function loadDating({ force = false } = {}) {
  if (loading) return loading;
  if (!force && (api.backingOff() || Date.now() - lastLoad < 30000)) return;
  lastLoad = Date.now();
  if (Date.now() - lastTouch > 240000) { lastTouch = Date.now(); api.touchLastSeen().catch(() => {}); }
  if (!state.profile) return;
  loading = loadDatingNow().finally(() => { loading = null; });
  return loading;
}
async function loadDatingNow() {
  try {
    const [{ convos, requests, pending, myStatus, friendStatuses }, asks] = await Promise.all([api.datingSummary(), api.myFriendAsks().catch(() => null)]);
    state.convos = convos; state.requests = requests; state.pendingLikes = pending || 0;
    if (asks) { const by = new Map(asks.map((a: any) => [a.conversation_id, a.who])); convos.forEach((c: Convo) => { c.friendAsk = by.get(c.conversation_id) || null; }); }
    if (myStatus !== undefined) state.myStatus = myStatus;
    if (friendStatuses) state.friendStatus = Object.fromEntries(friendStatuses.map((f: any) => [f.conversation_id, f]));
    applyRevealedNames();
    emit('dating');
  } catch {}
}

// Once both people have revealed, the chat shows their first name (cached on this device).
const NAMES_KEY = 'hy-revealed-names';
const bothRevealed = (c: Convo) => !!(c && c.i_revealed && c.they_revealed);
export const nameOf = (c: Convo): string => (bothRevealed(c) && c.other_name) || (c && c.other_handle) || '';
export function rememberRevealedName(id: string, name: string) {
  if (!id || !name) return;
  const cache = store.get<Record<string, string>>(NAMES_KEY, {})!; cache[id] = name; store.set(NAMES_KEY, cache);
  const c = state.convos.find((x) => x.conversation_id === id);
  if (c && c.other_name !== name) { c.other_name = name; emit('dating'); }
}
let fetchingNames = false;
function applyRevealedNames() {
  const cache = store.get<Record<string, string>>(NAMES_KEY, {})!;
  const missingIds: string[] = [];
  for (const c of state.convos) {
    if (!bothRevealed(c)) continue;
    if (cache[c.conversation_id]) c.other_name = cache[c.conversation_id];
    else missingIds.push(c.conversation_id);
  }
  if (!missingIds.length || fetchingNames) return;
  fetchingNames = true;
  Promise.all(missingIds.slice(0, 20).map((id) => api.revealedDetails(id).then((w: any) => { if (w && w.name) rememberRevealedName(id, w.name); }).catch(() => {})))
    .finally(() => { fetchingNames = false; });
}

export function patchChat(id: string, { body, at, fromMe, countUnread = false, theyreOnline = false }: { body: string; at?: string; fromMe: boolean; countUnread?: boolean; theyreOnline?: boolean }) {
  const c = state.convos.find((x) => x.conversation_id === id);
  if (!c || c.blocked) return false;
  if (c.last_at && at && new Date(at) < new Date(c.last_at)) return true;
  c.last_message = body; c.last_from_me = !!fromMe; c.last_at = at || new Date().toISOString();
  if (countUnread) c.unread = Math.min(99, (c.unread || 0) + 1);
  if (theyreOnline) { c.other_online = true; c.other_active_hours = 0; }
  state.convos.sort((a, b) => +new Date(b.last_at) - +new Date(a.last_at));
  emit('dating');
  return true;
}
export function closeChatLocal(id: string) {
  const c = state.convos.find((x) => x.conversation_id === id);
  if (!c || c.blocked) return () => {};
  const before = { blocked: c.blocked, unread: c.unread };
  c.blocked = true; c.unread = 0;
  emit('dating');
  return () => { Object.assign(c, before); emit('dating'); };
}

export async function loadAll() {
  state.profile = await api.myProfile();
  state.ready = true;
  loadDating({ force: true });
  emit('all');
}

// ---- Notifications (derived from data that already exists) -----------------------------------
const SEEN_KEY = 'hy-notif-seen';
export const notifSeenAt = () => store.get<number>(SEEN_KEY, 0)!;
export const markNotifsSeen = () => { store.set(SEEN_KEY, Date.now()); emit('notifs'); };
export type Notif = { kind: string; emoji: string; text: string; at: string; to?: string; chat?: string };
export function notifications(): Notif[] {
  const out: Notif[] = [];
  for (const r of state.requests) out.push({ kind: 'request', emoji: '💘', text: `${r.handle} liked you`, at: r.requested_at, to: 'matches/likes' });
  for (const c of state.convos) {
    if (c.blocked) continue;
    if (statusOf(c) === 'request') { out.push({ kind: 'mrequest', emoji: c.kind === 'friend' ? '👋' : '📩', text: `${c.other_handle} sent you a ${c.kind === 'friend' ? 'friend' : 'message'} request`, at: c.last_at, chat: c.conversation_id }); continue; }
    if (statusOf(c) === 'sent') continue;
    if (c.started_by_me && !c.matched && c.accepted_at) out.push({ kind: 'accepted', emoji: '✅', text: `${nameOf(c)} accepted your ${c.kind === 'friend' ? 'friend' : 'message'} request`, at: c.accepted_at, chat: c.conversation_id });
    if (!c.last_message && c.matched) out.push({ kind: 'match', emoji: '✨', text: `It's a match with ${c.other_handle}! Say hi.`, at: c.last_at, chat: c.conversation_id });
    else if (c.unread) out.push({ kind: 'chat', emoji: '💬', text: `${nameOf(c)} sent you ${c.unread === 1 ? 'a message' : `${c.unread} messages`}`, at: c.last_at, chat: c.conversation_id });
    if (c.they_revealed && !c.i_revealed) out.push({ kind: 'reveal', emoji: '🎭', text: `${c.other_handle} wants to reveal identities`, at: c.last_at, chat: c.conversation_id });
    if (c.they_revealed && c.i_revealed) out.push({ kind: 'revealed', emoji: '🔓', text: `You and ${nameOf(c)} both revealed`, at: c.last_at, chat: c.conversation_id });
  }
  for (const c of state.convos) {
    const st = state.friendStatus[c.conversation_id];
    if (!st || c.blocked || c.kind !== 'friend') continue;
    out.push({ kind: 'status', emoji: '💬', text: `${nameOf(c)} updated their status: “${st.body}”`, at: st.updated_at, chat: c.conversation_id });
  }
  if (state.bird && state.bird.leveled_at && state.bird.level > 1) out.push({ kind: 'level', emoji: '🪶', text: `You reached Level ${state.bird.level} in the Bird Kingdom`, at: state.bird.leveled_at, to: 'profile' });
  if (state.profile && state.profile.suspended) out.push({ kind: 'account', emoji: '⚠️', text: 'Your dating profile is suspended after reports.', at: new Date().toISOString(), to: 'profile' });
  return out.sort((a, b) => +new Date(b.at) - +new Date(a.at));
}
export const newNotifCount = () => notifications().filter((n) => new Date(n.at).getTime() > notifSeenAt()).length;
