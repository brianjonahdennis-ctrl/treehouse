'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// treehouse data layer: a straight port of anon-inbox/public/hy-api.js. Every Supabase call the
// member app makes lives here, with the same function names and the same database functions (RPCs),
// so the two apps behave identically against the one database. No database changes.
import { getClient } from './supabase';

export const SITE = typeof window !== 'undefined' ? window.location.origin : '';
export let sb: any = null;
// Both database features have existed since Nov 2026, so no start-up check is needed (it cost a slow
// round trip on every open).
export const features = { matching: true, states: true };

export function friendly(err: any): string {
  const m = (err && (err.message || err.error_description)) || String(err || '');
  if (/already registered|already been registered/i.test(m)) return 'That email already has an account. Sign in instead.';
  if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(m)) return 'Verify your email first: open the link we sent you.';
  if (/rate limit|too many|security purposes/i.test(m)) return 'Too many attempts. Please wait a minute and try again.';
  if (/password should be|at least 6/i.test(m)) return 'Use a password with at least 8 characters.';
  if (/failed to fetch|network/i.test(m)) return 'You seem to be offline. Check your connection and try again.';
  if (/timeout|timed out|canceling statement/i.test(m)) return 'treehouse is busy right now. Please try again in a moment.';
  return m || 'Something went wrong. Please try again.';
}
const missing = (error: any) => error && (error.code === 'PGRST202' || error.code === '42883' || error.code === '42703' || /could not find the function|does not exist/i.test(error.message || ''));
const missingFn = (e: any) => /could not find the function|PGRST202/i.test((e && (e.message || e.code)) || '');

// When the server is struggling, background checks back off: 30 s, then 1, 2, 4 minutes (max 5).
let backoffMs = 0, slowUntil = 0;
export const backingOff = () => Date.now() < slowUntil;
function noteFailure(err: any) {
  const m = String((err && (err.message || err.code || '')) || '');
  if (err && err.code && /^(PGRST|22|23|28|42|P0)/.test(String(err.code))) return;
  if (/not allowed|not found|sign in|full|already/i.test(m)) return;
  backoffMs = Math.min(backoffMs ? backoffMs * 2 : 30000, 300000);
  slowUntil = Date.now() + backoffMs;
}
async function rpc(fn: string, args?: Record<string, unknown>): Promise<any> {
  let res: any;
  try { res = await sb.rpc(fn, args); } catch (e) { noteFailure(e); throw e; }
  const { data, error } = res;
  if (error) { noteFailure(error); throw error; }
  backoffMs = 0; slowUntil = 0;
  return data;
}

export let googleReady: Promise<boolean> = Promise.resolve(false);
export async function init() {
  if (sb) return sb;
  sb = await getClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // Is "Continue with Google" switched on in Supabase?
  googleReady = url && key && process.env.NEXT_PUBLIC_TH_MOCK !== '1'
    ? fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } }).then((r) => r.json()).then((j) => !!(j && j.external && j.external.google)).catch(() => false)
    : Promise.resolve(false);
  listenForAppSignIn();
  return sb;
}

// ---- Google in the Android app (1.6+): Google opens in Chrome and returns to the app ------------
const APP_RETURN = 'com.brianjonahdennis.treehouse://auth';
const cap = (): any => (typeof window !== 'undefined' ? (window as any).Capacitor : null);
const capPlugins = (): any => (cap() && cap().Plugins) || {};
export function appGoogle() {
  const c = cap(); const P = capPlugins();
  return !!(c && c.getPlatform && c.getPlatform() === 'android' && P.Browser && P.App);
}
export function isNativeApp() {
  if (typeof navigator === 'undefined') return false;
  const c = cap();
  return /TreehouseApp\//.test(navigator.userAgent || '') || !!(c && c.isNativePlatform && c.isNativePlatform());
}
async function finishAppSignIn(url?: string) {
  if (!url || !url.startsWith(APP_RETURN)) return;
  const P = capPlugins();
  try { if (P.Browser && P.Browser.close) await P.Browser.close(); } catch {}
  const part = url.includes('#') ? url.slice(url.indexOf('#') + 1) : url.slice(url.indexOf('?') + 1);
  const q = new URLSearchParams(part);
  if (q.get('access_token') && q.get('refresh_token')) {
    const { error } = await sb.auth.setSession({ access_token: q.get('access_token'), refresh_token: q.get('refresh_token') });
    if (!error) { location.replace('/home'); return; }
  }
  window.dispatchEvent(new CustomEvent('hy-google-failed', { detail: q.get('error_description') || 'Google sign-in didn’t finish. Please try again.' }));
}
let appListening = false;
function listenForAppSignIn() {
  if (appListening || !appGoogle()) return;
  appListening = true;
  const { App } = capPlugins();
  App.addListener('appUrlOpen', (e: any) => finishAppSignIn(e && e.url));
  App.getLaunchUrl().then((r: any) => finishAppSignIn(r && r.url)).catch(() => {});
}

export async function detectFeatures() { /* kept for callers; nothing to detect any more */ }

// ---- Account --------------------------------------------------------------------------------
export const session = async () => (await sb.auth.getSession()).data.session;
export async function signInWithGoogle(redirect: string) {
  if (appGoogle()) {
    const { data, error } = await sb.auth.signInWithOAuth({ provider: 'google',
      options: { redirectTo: APP_RETURN, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } } });
    if (error) throw error;
    await capPlugins().Browser.open({ url: data.url, toolbarColor: '#05051f' });
    return;
  }
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirect, queryParams: { prompt: 'select_account' } } });
  if (error) throw error;
}
export async function signUp(email: string, password: string, redirect: string) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect, data: { terms_accepted_at: new Date().toISOString() } } });
  if (error) throw error;
  return data;
}
export async function acceptTerms() {
  const { data, error } = await sb.auth.updateUser({ data: { terms_accepted_at: new Date().toISOString() } });
  if (error) throw error;
  return data && data.user;
}
export async function signIn(email: string, password: string) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}
// Catch mistyped email addresses before sign-up (handled by the existing server's /api/email-check).
export async function emailCheck(email: string): Promise<{ ok: boolean; reason?: string; suggestion?: string }> {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`/api/email-check?email=${encodeURIComponent(email)}`, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok ? await r.json() : { ok: true };
  } catch { return { ok: true }; }
}
export async function resendVerify(email: string, redirect: string) {
  const { error } = await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirect } });
  if (error) throw error;
}
export async function resetPassword(email: string) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${SITE}/home` });
  if (error) throw error;
}
export async function setPassword(password: string) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
}
export const signOut = () => sb.auth.signOut();
export async function verifyEmailLink(tokenHash: string, type: string) {
  const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type });
  return error || null;
}
export const deleteAccount = () => rpc('delete_my_account');

export async function myProfile() {
  const cols = 'handle, name, gender, age, location, intent, is_active, suspended'
    + (features.matching ? ', bio, interests, interested_in, min_age, max_age' : '')
    + (features.states ? ', state, pref_state, state_changed_at, gender_changed_at, age_changed_at, birth_date, dob_underage_at, birthday_public' : '');
  const { data, error } = await sb.from('dating_profiles').select(cols).maybeSingle();
  if (error) throw error;
  return data;
}
export const createProfile = (p: any) => rpc('create_my_profile', {
  p_name: p.name, p_gender: p.gender, p_age: Number(p.age), p_location: p.location || '', p_intent: p.intent,
});
export async function updateProfile(handle: string, fields: Record<string, unknown>) {
  const { error } = await sb.from('dating_profiles').update(fields).eq('handle', handle);
  if (error) throw error;
}

export async function discover(limit = 20, exclude: string[] = []) {
  if (features.matching) return (await rpc('discover_cards', exclude.length ? { p_limit: limit, p_exclude: exclude.slice(-300) } : { p_limit: limit })) || [];
  return (await rpc('discover_profiles', { p_limit: limit, p_offset: 0 })) || [];
}
export const likeProfile = async (handle: string, like: boolean) => ((await rpc('like_profile', { p_handle: handle, p_like: like })) || [])[0] || { matched: false };
export const incomingRequests = async () => (features.matching ? (await rpc('incoming_requests')) || [] : []);
export const pendingLikes = async () => (features.matching ? rpc('my_pending_likes') : 0);
export const conversations = async () => (await rpc('my_conversations')) || [];
export function onInboxNudge(uid: string, cb: (n: any) => void) {
  const ch = sb.channel(`user:${uid}`, { config: { private: true } }).on('broadcast', { event: 'inbox' }, (e: any) => cb((e && e.payload) || {})).subscribe();
  return { leave() { sb.removeChannel(ch); } };
}
export const friendStatuses = async () => (await rpc('friend_statuses')) || [];
export async function datingSummary(): Promise<any> {
  try {
    const d = await rpc('dating_summary');
    return { convos: d.convos || [], requests: d.requests || [], pending: d.pending || 0, myStatus: d.my_status || null, friendStatuses: d.friend_statuses || [] };
  } catch (e) {
    if (!/could not find the function|PGRST202/i.test(String((e as any)?.message || (e as any)?.code || ''))) throw e;
    const [convos, requests, pending] = await Promise.all([conversations(), incomingRequests(), pendingLikes()]);
    return { convos, requests, pending };
  }
}

const MSG_COLS = 'id, sender_id, body, created_at, reply_to, edited_at, deleted_at, photo, photo_w, photo_h';
export async function messages(conversationId: string) {
  const { data, error } = await sb.from('dating_messages').select(MSG_COLS)
    .eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(80);
  if (error) throw error;
  return (data || []).reverse();
}
export async function sendMessage(conversationId: string, body: string, replyTo: string | null = null) {
  const row: any = { conversation_id: conversationId, body };
  if (replyTo) row.reply_to = replyTo;
  const { data, error } = await sb.from('dating_messages').insert(row).select(MSG_COLS).single();
  if (error) throw error;
  return data;
}

// ---- Photos in chats (unlock rule lives in the database) -----------------------------------------
export const photosUnlocked = (conversationId: string) => rpc('photos_unlocked', { p_conversation: conversationId }).then(Boolean);
const photoUrls = new Map<string, { url: string; until: number }>();
export async function sendPhoto(conversationId: string, blob: Blob, w: number, h: number, replyTo: string | null = null) {
  const path = `${conversationId}/${crypto.randomUUID()}.jpg`;
  const up = await sb.storage.from('chat-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '86400' });
  if (up.error) throw up.error;
  const row: any = { conversation_id: conversationId, body: '📷 Photo', photo: path, photo_w: w, photo_h: h };
  if (replyTo) row.reply_to = replyTo;
  const { data, error } = await sb.from('dating_messages').insert(row).select(MSG_COLS).single();
  if (error) { sb.storage.from('chat-photos').remove([path]).catch(() => {}); throw error; }
  photoUrls.set(path, { url: URL.createObjectURL(blob), until: Infinity });
  return data;
}
export async function photoUrl(path: string) {
  const hit = photoUrls.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data, error } = await sb.storage.from('chat-photos').createSignedUrl(path, 3600);
  if (error || !data) throw error || new Error('Photo unavailable');
  photoUrls.set(path, { url: data.signedUrl, until: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl as string;
}

// ---- Push notifications ------------------------------------------------------------------------------
export async function savePushSubscription(sub: PushSubscription) {
  const j: any = sub.toJSON();
  await rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
}
export async function deletePushSubscription(endpoint: string) { await rpc('delete_push_subscription', { p_endpoint: endpoint }); }

let platformPromise: Promise<string> | null = null;
export function appPlatform() {
  if (platformPromise) return platformPromise;
  platformPromise = (async () => {
    const ua = navigator.userAgent || '';
    const c = cap();
    if (!isNativeApp()) return 'web';
    if (!/Android/i.test(ua)) return 'ios-app';
    try {
      const src = c && c.Plugins && c.Plugins.InstallSource ? await c.Plugins.InstallSource.get() : null;
      if (!src) return 'android-app';
      return src.play ? 'android-play' : 'android-apk';
    } catch { return 'android-app'; }
  })();
  return platformPromise;
}
export async function touchLastSeen() {
  const platform = await appPlatform().catch(() => null);
  const { error } = await sb.rpc('touch_last_seen', platform ? { p_platform: platform } : {});
  if (error && platform && /p_platform|could not find the function|PGRST202/i.test(error.message || error.code || '')) await sb.rpc('touch_last_seen');
}
export async function markChatRead(conversationId: string) {
  const { error } = await sb.rpc('mark_conversation_read', { p_conversation: conversationId });
  if (error) throw error;
}
export async function reveal(conversationId: string, on: boolean) {
  const q = on
    ? sb.from('dating_reveals').insert({ conversation_id: conversationId })
    : sb.from('dating_reveals').delete().eq('conversation_id', conversationId).eq('user_id', (await session()).user.id);
  const { error } = await q;
  if (error && !/duplicate/i.test(error.message)) throw error;
}
export const revealedDetails = async (conversationId: string) => ((await rpc('revealed_details', { p_conversation: conversationId })) || [])[0] || null;
export const stateCounts = async () => {
  const rows = (await rpc('dating_state_counts')) || [];
  return Object.fromEntries(rows.map((r: any) => [r.state, r.people]));
};
export const startChat = (handle: string) => rpc('start_conversation', { p_handle: handle });
export const startFriend = (handle: string) => rpc('start_friend_request', { p_handle: handle });
export const askFriend = (conversationId: string, on = true) => rpc('ask_friend', { p_conversation: conversationId, p_on: on });

let asksMissing = false;
export async function myFriendAsks() {
  if (asksMissing) return [];
  try { return (await rpc('my_friend_asks')) || []; }
  catch (e) { if (missingFn(e)) { asksMissing = true; return []; } throw e; }
}
export async function friendAskState(conversationId: string) {
  try { return await rpc('friend_ask_state', { p_conversation: conversationId }); }
  catch (e) { if (missingFn(e)) return null; throw e; }
}
export const setStatus = async (body: string) => ((await rpc('set_my_status', { p_body: body })) || [])[0] || null;
export const clearStatus = () => rpc('clear_my_status');
export const declineRequest = (conversationId: string) => rpc('decline_message_request', { p_conversation: conversationId });
export const acceptRequest = (conversationId: string) => rpc('accept_message_request', { p_conversation: conversationId });
export const cancelRequest = (conversationId: string) => rpc('cancel_request', { p_conversation: conversationId });
export const blockPartner = (conversationId: string) => rpc('block_conversation_partner', { p_conversation: conversationId });
export const unblockPartner = (conversationId: string) => rpc('unblock_conversation_partner', { p_conversation: conversationId });
export const unmatch = (conversationId: string) => rpc('unmatch_conversation', { p_conversation: conversationId });
export const chatPartnerProfile = async (conversationId: string) => ((await rpc('chat_partner_profile', { p_conversation: conversationId })) || [])[0] || null;
export const deleteConversation = (conversationId: string) => rpc('delete_conversation', { p_conversation: conversationId });
export const editMessage = (id: string, body: string) => rpc('edit_dating_message', { p_message: id, p_body: body });
export const unsendMessage = (id: string) => rpc('unsend_dating_message', { p_message: id });
export const hideMessage = (id: string) => rpc('hide_dating_message', { p_message: id });
export async function messageById(id: string) {
  const { data } = await sb.from('dating_messages').select('id, sender_id, body, created_at, deleted_at').eq('id', id).maybeSingle();
  return data || null;
}
export const chatStatus = async (conversationId: string) => ((await rpc('chat_status', { p_conversation: conversationId })) || [])[0] || null;
export const nearbySettings = async () => ((await rpc('nearby_settings')) || [])[0] || { enabled: false };
// Nearby: the phone's position is sent once (turning Nearby on or refreshing your area) and is
// reduced to a protected point by the database; raw GPS is never returned.
export const nearbySetLocation = (lat: number, lng: number) => rpc('nearby_set_location', { p_lat: lat, p_lng: lng });
export const nearbyUpdate = (args: Record<string, unknown>) => rpc('nearby_update_settings', args);
export const nearbyPeople = async ({ radius, minAge, maxAge, genders, interests, sort }: { radius: number; minAge?: number | null; maxAge?: number | null; genders?: string[]; interests?: string[]; sort?: string }) => (await rpc('nearby_people', {
  p_radius_km: radius, p_min_age: minAge || null, p_max_age: maxAge || null,
  p_genders: genders && genders.length ? genders : null, p_interests: interests && interests.length ? interests : null,
  p_sort: sort || 'distance', p_limit: 150,
})) || [];
export const blockProfile = (handle: string) => rpc('block_profile', { p_handle: handle });
export const reportProfile = (handle: string, reason: string, details?: string) => rpc('report_profile', { p_handle: handle, p_reason: reason, p_details: details || '' });
export const reportPartner = (conversationId: string, reason: string, details?: string) =>
  rpc('report_conversation_partner', { p_conversation: conversationId, p_reason: reason, p_details: details || '' });

// ---- Live updates for one open chat -----------------------------------------------------------------
export function joinChat(conversationId: string, me: string, { onMessage, onUpdate, onTyping, onPresence, onRead }: {
  onMessage: (m: any) => void; onUpdate?: (m: any) => void; onTyping: () => void; onPresence?: (here: boolean) => void; onRead?: () => void;
}) {
  let fallback: any = null;
  const live = sb.channel(`chat:${conversationId}`, { config: { private: true } })
    .on('broadcast', { event: 'message' }, ({ payload }: any) => onMessage(payload))
    .on('broadcast', { event: 'update' }, ({ payload }: any) => { if (onUpdate) onUpdate(payload); })
    .subscribe((status: string) => {
      if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !fallback) {
        fallback = sb.channel(`hy-chat-db-${conversationId}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dating_messages', filter: `conversation_id=eq.${conversationId}` }, (p: any) => onMessage(p.new))
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dating_messages', filter: `conversation_id=eq.${conversationId}` }, (p: any) => { if (onUpdate) onUpdate(p.new); })
          .subscribe();
      }
    });
  const ch = sb.channel(`hy-chat-${conversationId}`, { config: { broadcast: { self: false }, presence: { key: me } } })
    .on('broadcast', { event: 'typing' }, (p: any) => { if (p.payload && p.payload.from !== me) onTyping(); })
    .on('broadcast', { event: 'read' }, (p: any) => { if (onRead && p.payload && p.payload.from !== me) onRead(); })
    .on('presence', { event: 'sync' }, () => { if (onPresence) onPresence(Object.keys(ch.presenceState()).some((k) => k !== me)); })
    .subscribe((status: string) => { if (status === 'SUBSCRIBED') { ch.track({ here: true }); read(); } });
  const read = () => ch.send({ type: 'broadcast', event: 'read', payload: { from: me } });
  let last = 0;
  return {
    read,
    typing() { const now = Date.now(); if (now - last > 2500) { last = now; ch.send({ type: 'broadcast', event: 'typing', payload: { from: me } }); } },
    leave() { sb.removeChannel(ch); sb.removeChannel(live); if (fallback) sb.removeChannel(fallback); },
  };
}

// ---- Chatrooms ---------------------------------------------------------------------------------------
export const roomList = async () => (await rpc('room_list')) || [];
export const joinRoom = async (state: string) => ((await rpc('join_room', { p_state: state })) || [])[0] || null;
export const roomHeartbeat = () => rpc('room_heartbeat');
export const leaveRoom = () => rpc('leave_room');
export async function myRoomKick() {
  try { return ((await rpc('my_room_kick')) || [])[0] || null; }
  catch (e) { if (missingFn(e)) return null; throw e; }
}
export const dismissRoomKick = () => rpc('dismiss_room_kick').catch(() => {});
export const roomMarkRead = () => rpc('room_mark_read');
export const roomHistory = async () => (await rpc('room_history', { p_limit: 200 })) || [];
let sinceMissing = false;
export async function roomHistorySince(afterId: string | null) {
  if (sinceMissing || !afterId) return roomHistory();
  try { return (await rpc('room_history_since', { p_after: afterId, p_limit: 100 })) || []; }
  catch (e: any) { if (/room_history_since|PGRST202|42883/i.test(`${e.message} ${e.code || ''}`)) { sinceMissing = true; return roomHistory(); } throw e; }
}
export const roomPeople = async () => (await rpc('room_people')) || [];
export const sendRoomMessage = async (body: string, replyTo: string | null = null) => ((await rpc('send_room_message', replyTo ? { p_body: body, p_reply_to: replyTo } : { p_body: body })) || [])[0] || null;
export const reportRoomMessage = (id: string, reason: string) => rpc('report_room_message', { p_message: id, p_reason: reason });
export const deleteRoomMessage = (id: string) => rpc('delete_room_message', { p_message: id });
export const blockRoomSender = (id: string) => rpc('block_room_sender', { p_message: id });
export function joinRoomChannel(state: string, h: { onMessage: (m: any) => void; onRemove?: (m: any) => void; onReaction?: (m: any) => void; onJoin?: (m: any) => void; onLeave?: (m: any) => void; onStatus?: (s: string) => void }) {
  const ch = sb.channel(`room:${state}`, { config: { private: true } })
    .on('broadcast', { event: 'message' }, ({ payload }: any) => h.onMessage(payload))
    .on('broadcast', { event: 'remove' }, ({ payload }: any) => h.onRemove && h.onRemove(payload))
    .on('broadcast', { event: 'reaction' }, ({ payload }: any) => h.onReaction && h.onReaction(payload))
    .on('broadcast', { event: 'join' }, ({ payload }: any) => h.onJoin && h.onJoin(payload))
    .on('broadcast', { event: 'leave' }, ({ payload }: any) => h.onLeave && h.onLeave(payload))
    .subscribe((status: string) => h.onStatus && h.onStatus(status));
  return { leave() { sb.removeChannel(ch); } };
}
export const toggleRoomReaction = async (id: string, emoji: string) => ((await rpc('toggle_room_reaction', { p_message: id, p_emoji: emoji })) || [])[0] || null;
export const roomProfile = async (handle: string) => ((await rpc('room_profile', { p_handle: handle })) || [])[0] || null;

// ---- Custom avatars ----------------------------------------------------------------------------------
export const getAvatars = async (handles: string[]) => (await rpc('get_avatars', { p_handles: handles })) || [];
export const setMyAvatar = (config: unknown) => rpc('set_my_avatar', { p_config: config });

// ---- Games (Kickrs) ------------------------------------------------------------------------------
// kickrs_status(): { ready, blocker: 'profile' | 'suspended' | null, connected }
export const kickrsStatus = async (): Promise<{ ready: boolean; blocker: string | null; connected: boolean }> => (await rpc('kickrs_status')) || { ready: false, blocker: 'profile', connected: false };
export const kickrsConnect = async () => ((await rpc('kickrs_connect')) || [])[0] || null;
export const kickrsDisconnect = () => rpc('kickrs_disconnect');
export const kickrsFriendRequest = (kickrsId: string) => rpc('kickrs_friend_request', { p_kickrs_id: kickrsId });

// ---- Speed Dating (three-minute video dates; rules live in the database) ----------------------------
// Config and relay passwords come from the existing server (/api/*, passed through by next.config.ts).
export const speedConfig = () => fetch('/api/speed-config', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ enabled: false }));
export const speedJoin = () => rpc('speed_join');
export const speedPoll = () => rpc('speed_poll');
export const speedLeaveQueue = () => rpc('speed_leave_queue');
export const speedWaiting = () => rpc('speed_waiting');
// Dates used in the last 24 hours, the daily limit, and (when used up) when the next date opens.
export const speedQuota = () => rpc('speed_quota');
export const speedSession = (id: string | null = null) => rpc('speed_session', { p_session: id });
export const speedReady = (id: string) => rpc('speed_ready', { p_session: id });
export const speedHeartbeat = (id: string) => rpc('speed_heartbeat', { p_session: id });
export const speedSignal = (id: string, data: unknown) => rpc('speed_signal', { p_session: id, p_data: data });
// The other person's call-setup messages from the mailbox (after message number `after`).
export const speedPull = (id: string, after = 0) => rpc('speed_pull', { p_session: id, p_after: after });
export const speedEnd = (id: string) => rpc('speed_end', { p_session: id });
export const speedDecide = (id: string, like: boolean) => rpc('speed_decide', { p_session: id, p_like: like });
export const speedReport = (id: string, reason: string | null, details = '', block = false) => rpc('speed_report', { p_session: id, p_reason: reason, p_details: details, p_block: block });
// Relay passwords for the video call (from our server, only while on a live date).
export async function speedIce() {
  const { data } = await sb.auth.getSession();
  const r = await fetch('/api/speed-ice', { method: 'POST', headers: { Authorization: `Bearer ${data.session && data.session.access_token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Couldn’t start the video call.');
  return j;
}
// The date's private live channel (call setup + "ended"), and your own queue channel ("paired").
export function speedChannel(id: string, { onSignal, onEnded, onStatus }: { onSignal?: (m: any) => void; onEnded?: () => void; onStatus?: (s: string) => void }) {
  const ch = sb.channel(`speed:${id}`, { config: { private: true } })
    .on('broadcast', { event: 'signal' }, (e: any) => onSignal && onSignal((e && e.payload) || {}))
    .on('broadcast', { event: 'ended' }, () => onEnded && onEnded())
    .subscribe((st: string) => onStatus && onStatus(st));
  return { leave: () => { try { sb.removeChannel(ch); } catch {} } };
}
export function speedQueueChannel(uid: string, onPaired: (p: any) => void) {
  const ch = sb.channel(`speedq:${uid}`, { config: { private: true } })
    .on('broadcast', { event: 'paired' }, (e: any) => onPaired((e && e.payload) || {})).subscribe();
  return { leave: () => { try { sb.removeChannel(ch); } catch {} } };
}

// ---- Bird Kingdom (active hours) and Community Star Ratings (see REPUTATION.md) ----------------------
export const myBird = () => rpc('my_bird');
export const activityPing = () => rpc('activity_ping');
export const birdLaunchSeen = () => rpc('bird_launch_seen');
export const myReputation = () => rpc('my_reputation');
export const ratingStatusConvo = (id: string) => rpc('rating_status_convo', { p_conversation: id });
export const ratingStatusRoom = (handle: string) => rpc('rating_status_room', { p_handle: handle });
export const rateConvo = (id: string, stars: number) => rpc('rate_convo', { p_conversation: id, p_stars: stars });
export const rateRoomMember = (handle: string, stars: number) => rpc('rate_room_member', { p_handle: handle, p_stars: stars });
export const badgesForConvos = async (ids: string[]) => (await rpc('badges_for_convos', { p_ids: ids })) || [];
export const badgesForRoom = async (handles: string[]) => (await rpc('badges_for_room', { p_handles: handles })) || [];
export const myRoomBan = () => rpc('my_room_ban');
export const roomBirthdays = async () => (await rpc('room_birthdays')) || [];
export const badgesForHandles = async (handles: string[]) => (await rpc('badges_for_handles', { p_handles: handles })) || [];

// ---- Announcements (official messages from treehouse; see ANNOUNCEMENTS.md) ----------------------------
export const myAnnouncements = async (filter = 'all', before: string | null = null, limit = 20) => (await rpc('my_announcements', { p_filter: filter, p_before: before, p_limit: limit })) || [];
export const announcementsUnread = async (): Promise<number> => (await rpc('my_announcements_unread')) || 0;
export const openAnnouncement = (id: string) => rpc('open_announcement', { p_id: id });
export const markAnnouncement = (id: string, action: 'read' | 'unread' | 'archive' | 'unarchive' | 'click') => rpc('mark_announcement', { p_id: id, p_action: action });
export const markAllAnnouncementsRead = () => rpc('mark_all_announcements_read');
export const announcementPrefs = async () => (await rpc('my_announcement_prefs')) || { push_updates: true };
export const setAnnouncementPush = (on: boolean) => rpc('set_announcement_push', { p_on: on });
// Staff (the database checks the role on every call).
export const annMe = async (): Promise<null | { role: string; can_publish: boolean }> => (await rpc('ann_me')) || null;
export const annOverview = () => rpc('ann_overview');
export const annList = async (a: { status?: string; category?: string | null; query?: string | null; from?: string | null; to?: string | null; offset?: number; limit?: number }) =>
  (await rpc('ann_list', { p_status: a.status || 'all', p_category: a.category || null, p_query: a.query || null, p_from: a.from || null, p_to: a.to || null, p_offset: a.offset || 0, p_limit: a.limit || 20 })) || [];
export const annGet = (id: string) => rpc('ann_get', { p_id: id });
export const annEstimate = (audience: unknown): Promise<number> => rpc('ann_estimate', { p_audience: audience });
export const annSave = (id: string | null, fields: Record<string, unknown>): Promise<string> => rpc('ann_save', { p_id: id, p_fields: fields });
export const annPublish = (id: string, when: string | null = null) => rpc('ann_publish', { p_id: id, p_when: when });
export const annCancel = (id: string) => rpc('ann_cancel', { p_id: id });
export const annArchive = (id: string, on = true) => rpc('ann_archive', { p_id: id, p_on: on });
export const annCorrection = (id: string): Promise<string> => rpc('ann_correction', { p_id: id });
export const annDeleteDraft = (id: string) => rpc('ann_delete_draft', { p_id: id });
export const annAnalytics = (id: string) => rpc('ann_analytics', { p_id: id });
export const annAudit = async (id: string | null = null, limit = 50) => (await rpc('ann_audit_log', { p_id: id, p_limit: limit })) || [];
export const annStaff = async () => (await rpc('ann_staff')) || [];
export const annSetStaff = (handle: string, role: string | null, canPublish = false) => rpc('ann_set_staff', { p_handle: handle, p_role: role, p_can_publish: canPublish });
/** Upload a cover or inline image (JPEG/PNG/WebP, max 2 MB). Returns its public https address. */
export async function annUploadImage(file: File): Promise<string> {
  const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>)[file.type];
  if (!ext) throw new Error('Use a JPEG, PNG or WebP image.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Images must be 2 MB or smaller.');
  const d = new Date();
  const path = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from('announcement-images').upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return sb.storage.from('announcement-images').getPublicUrl(path).data.publicUrl;
}
