// treehouse data layer. Same Supabase project, accounts and rules as /date and
// /date: row-level security decides what each person can read; anonymous cards never include names.
//
// Features that need the 20261108000000_dating_matching migration (likes, requests, matches,
// bio/interests/preferences, reactions) are detected at start-up: until it's applied, the app shows
// those parts as "coming soon" instead of failing.

const API = (window.TH_CONFIG && window.TH_CONFIG.apiBase) || '';
export const SITE = (window.TH_CONFIG && window.TH_CONFIG.siteUrl) || location.origin;
export let sb = null;
export const features = { matching: false, states: false };


export function friendly(err) {
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
const missing = (error) => error && (error.code === 'PGRST202' || error.code === '42883' || error.code === '42703' || /could not find the function|does not exist/i.test(error.message || ''));
// When the server is struggling (errors or timeouts), background checks back off so phones don't
// pile on: 30 s, then 1, 2, 4 minutes (max 5). Any success clears it.
let backoffMs = 0, slowUntil = 0;
export const backingOff = () => Date.now() < slowUntil;
function noteFailure(err) {
  const m = (err && (err.message || err.code || '')) + '';
  if (err && err.code && /^(PGRST|22|23|28|42|P0)/.test(String(err.code))) return;   // normal "no" answers
  if (/not allowed|not found|sign in|full|already/i.test(m)) return;
  backoffMs = Math.min(backoffMs ? backoffMs * 2 : 30000, 300000);
  slowUntil = Date.now() + backoffMs;
}
async function rpc(fn, args) {
  let res;
  try { res = await sb.rpc(fn, args); } catch (e) { noteFailure(e); throw e; }
  const { data, error } = res;
  if (error) { noteFailure(error); throw error; }
  backoffMs = 0; slowUntil = 0;
  return data;
}

export async function init() {
  let config;
  // The page carries the (public) config, so the app doesn't need an extra request before starting.
  const meta = document.querySelector('meta[name="th-dating"]');
  if (meta && !API) { try { config = JSON.parse(meta.content); } catch {} }
  if (!config || !config.ready) { try { config = await (await fetch(API + '/api/dating-config')).json(); } catch {} }
  if (!config || !config.ready || !window.supabase) throw new Error('treehouse isn’t available right now. Please try again later.');
  sb = window.supabase.createClient(config.url, config.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  });
  // Is "Continue with Google" switched on in Supabase? (Until it is, sign-up stays email-only.)
  googleReady = fetch(`${config.url}/auth/v1/settings`, { headers: { apikey: config.key } })
    .then((r) => r.json()).then((j) => !!(j && j.external && j.external.google)).catch(() => false);
  listenForAppSignIn();
  return sb;
}

// ---- Google in the Android app (1.6+) ------------------------------------------------------------
// Google refuses to sign people in inside an app's own web view, so the app opens Google in Chrome.
// Google then sends them back to the app at APP_RETURN with the sign-in tucked into the link.
// (iPhone waits: Apple requires "Sign in with Apple" next to Google, and older apps lack the plugins.)
const APP_RETURN = 'com.brianjonahdennis.treehouse://auth';
const capPlugins = () => (window.Capacitor && window.Capacitor.Plugins) || {};
export function appGoogle() {
  const cap = window.Capacitor; const P = capPlugins();
  return !!(cap && cap.getPlatform && cap.getPlatform() === 'android' && P.Browser && P.App);
}
async function finishAppSignIn(url) {
  if (!url || !url.startsWith(APP_RETURN)) return;
  const P = capPlugins();
  try { P.Browser && P.Browser.close && await P.Browser.close(); } catch {}
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
  App.addListener('appUrlOpen', (e) => finishAppSignIn(e && e.url));
  // The phone closed treehouse while Google was open: the link starts the app again.
  App.getLaunchUrl().then((r) => finishAppSignIn(r && r.url)).catch(() => {});
}
export let googleReady = Promise.resolve(false);

// Which new features does the database support yet? (cheap calls that fail fast when missing)
export async function detectFeatures() {
  const [m, st] = await Promise.all([
    sb.rpc('my_pending_likes'),
    sb.from('dating_profiles').select('state').limit(1),
  ]);
  // Matching and states are live everywhere now. Only a missing function turns them off; a
  // signed-out "not allowed" error must not (that dropped people's state and bio at sign-up).
  features.matching = !missing(m.error);
  features.states = !missing(st.error);
}

// ---- Account --------------------------------------------------------------------------------
export const session = async () => (await sb.auth.getSession()).data.session;
// Sign up / sign in with Google: leaves for Google's page and comes back signed in (no email to confirm).
export async function signInWithGoogle(redirect) {
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
export async function signUp(email, password, redirect) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect, data: { terms_accepted_at: new Date().toISOString() } } });
  if (error) throw error;
  return data;
}
// Agreement to the Terms of Use, saved on the account (people who joined before the Terms existed
// are asked once).
export async function acceptTerms() {
  const { data, error } = await sb.auth.updateUser({ data: { terms_accepted_at: new Date().toISOString() } });
  if (error) throw error;
  return data && data.user;
}
export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}
// Before sign-up: catch mistyped or non-existent email addresses (they bounce, and too many bounces
// get treehouse's email sending paused). If the check can't run, sign-up carries on as normal.
export async function emailCheck(email) {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`${API}/api/email-check?email=${encodeURIComponent(email)}`, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok ? await r.json() : { ok: true };
  } catch { return { ok: true }; }
}
export async function resendVerify(email, redirect) {
  const { error } = await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirect } });
  if (error) throw error;
}
export async function resetPassword(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${SITE}/home` });
  if (error) throw error;
}
export async function setPassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
}
export const signOut = () => sb.auth.signOut();
// Confirm the one-time code from an email link. Returns an error, or null when signed in.
export async function verifyEmailLink(tokenHash, type) {
  const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type });
  return error || null;
}
export const deleteAccount = () => rpc('delete_my_account');

export async function myProfile() {
  const cols = 'handle, name, gender, age, location, intent, is_active, suspended'
    + (features.matching ? ', bio, interests, interested_in, min_age, max_age' : '')
    + (features.states ? ', state, pref_state, state_changed_at, gender_changed_at, age_changed_at, birth_date, dob_underage_at' : '');
  const { data, error } = await sb.from('dating_profiles').select(cols).maybeSingle();
  if (error) throw error;
  return data;
}
export const createProfile = (p) => rpc('create_my_profile', {
  p_name: p.name, p_gender: p.gender, p_age: Number(p.age), p_location: p.location || '', p_intent: p.intent,
});
export async function updateProfile(handle, fields) {
  const { error } = await sb.from('dating_profiles').update(fields).eq('handle', handle);
  if (error) throw error;
}

export async function discover(limit = 20, exclude = []) {
  // exclude: people the phone already has, so the next batch continues where the last one ended.
  if (features.matching) return (await rpc('discover_cards', exclude.length ? { p_limit: limit, p_exclude: exclude.slice(-300) } : { p_limit: limit })) || [];
  return (await rpc('discover_profiles', { p_limit: limit, p_offset: 0 })) || [];
}
export const likeProfile = async (handle, like) => ((await rpc('like_profile', { p_handle: handle, p_like: like })) || [])[0] || { matched: false };
export const incomingRequests = async () => (features.matching ? (await rpc('incoming_requests')) || [] : []);
export const pendingLikes = async () => (features.matching ? rpc('my_pending_likes') : 0);
export const conversations = async () => (await rpc('my_conversations')) || [];
// "Something new" nudges on your own private channel (no names or text): refresh the chat list.
export function onInboxNudge(uid, cb) {
  const ch = sb.channel(`user:${uid}`, { config: { private: true } }).on('broadcast', { event: 'inbox' }, (e) => cb((e && e.payload) || {})).subscribe();
  return { leave() { sb.removeChannel(ch); } };
}
// Chats, incoming likes and the pending-likes count in one call (falls back to three calls).
export async function datingSummary() {
  try {
    const d = await rpc('dating_summary');
    return { convos: d.convos || [], requests: d.requests || [], pending: d.pending || 0, myStatus: d.my_status || null, friendStatuses: d.friend_statuses || [] };
  } catch (e) {
    if (!/could not find the function|PGRST202/i.test((e && (e.message || e.code)) || '')) throw e;
    const [convos, requests, pending] = await Promise.all([conversations(), incomingRequests(), pendingLikes()]);
    return { convos, requests, pending };
  }
}

const MSG_COLS = 'id, sender_id, body, created_at, reply_to, edited_at, deleted_at, photo, photo_w, photo_h';
export async function messages(conversationId) {
  const { data, error } = await sb.from('dating_messages').select(MSG_COLS)
    .eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(80);
  if (error) throw error;
  return (data || []).reverse();
}
export async function sendMessage(conversationId, body, replyTo = null) {
  const row = { conversation_id: conversationId, body };
  if (replyTo) row.reply_to = replyTo;
  const { data, error } = await sb.from('dating_messages').insert(row).select(MSG_COLS).single();
  if (error) throw error;
  return data;
}

// ---- Photos in chats ------------------------------------------------------------------------------
// Unlocked after 50 messages (at least 10 from each person) in an accepted chat; the database checks.
export const photosUnlocked = (conversationId) => rpc('photos_unlocked', { p_conversation: conversationId }).then(Boolean);
// Upload one prepared JPEG (already shrunk on the phone, no location data), then send it as a message.
export async function sendPhoto(conversationId, blob, w, h, replyTo = null) {
  const path = `${conversationId}/${crypto.randomUUID()}.jpg`;
  const up = await sb.storage.from('chat-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '86400' });
  if (up.error) throw up.error;
  const row = { conversation_id: conversationId, body: '📷 Photo', photo: path, photo_w: w, photo_h: h };
  if (replyTo) row.reply_to = replyTo;
  const { data, error } = await sb.from('dating_messages').insert(row).select(MSG_COLS).single();
  if (error) { sb.storage.from('chat-photos').remove([path]).catch(() => {}); throw error; }
  photoUrls.set(path, { url: URL.createObjectURL(blob), until: Infinity });
  return data;
}
// Short-lived private link to a photo (only the two people in the chat get one).
const photoUrls = new Map();
export async function photoUrl(path) {
  const hit = photoUrls.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data, error } = await sb.storage.from('chat-photos').createSignedUrl(path, 3600);
  if (error || !data) throw error || new Error('Photo unavailable');
  photoUrls.set(path, { url: data.signedUrl, until: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}
// Push notifications: save or forget this device for the signed-in account.
export async function savePushSubscription(sub) {
  const j = sub.toJSON();
  await rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
}
export async function deletePushSubscription(endpoint) { await rpc('delete_push_subscription', { p_endpoint: endpoint }); }
// "Last active" heartbeat for dating profiles (the database keeps at most one write a minute).
// Which kind of treehouse this is: the Android app from Google Play or from the APK, an older Android
// app that can't tell, the iPhone app, or a browser. Counted per day for the owner's Play test stats.
let platformPromise = null;
export function appPlatform() {
  if (platformPromise) return platformPromise;
  platformPromise = (async () => {
    const ua = navigator.userAgent || '';
    const cap = window.Capacitor;
    const nativeApp = /TreehouseApp\//.test(ua) || !!(cap && cap.isNativePlatform && cap.isNativePlatform());
    if (!nativeApp) return 'web';
    if (!/Android/i.test(ua)) return 'ios-app';
    try {
      const src = cap && cap.Plugins && cap.Plugins.InstallSource ? await cap.Plugins.InstallSource.get() : null;
      if (!src) return 'android-app';
      return src.play ? 'android-play' : 'android-apk';
    } catch { return 'android-app'; }   // app 1.4 or earlier: no install-source plugin
  })();
  return platformPromise;
}
export async function touchLastSeen() {
  const platform = await appPlatform().catch(() => null);
  const { error } = await sb.rpc('touch_last_seen', platform ? { p_platform: platform } : {});
  // Server not updated yet: fall back to the plain ping.
  if (error && platform && /p_platform|could not find the function|PGRST202/i.test(error.message || error.code || '')) await sb.rpc('touch_last_seen');
}
// Supabase queries only run when awaited, so this must be awaited (it used to never be sent).
export async function markChatRead(conversationId) {
  const { error } = await sb.rpc('mark_conversation_read', { p_conversation: conversationId });
  if (error) throw error;
}
export async function reveal(conversationId, on) {
  const q = on
    ? sb.from('dating_reveals').insert({ conversation_id: conversationId })
    : sb.from('dating_reveals').delete().eq('conversation_id', conversationId).eq('user_id', (await session()).user.id);
  const { error } = await q;
  if (error && !/duplicate/i.test(error.message)) throw error;
}
export const revealedDetails = async (conversationId) => ((await rpc('revealed_details', { p_conversation: conversationId })) || [])[0] || null;
export const stateCounts = async () => {
  const rows = (await rpc('dating_state_counts')) || [];
  return Object.fromEntries(rows.map((r) => [r.state, r.people]));
};
export const startChat = (handle) => rpc('start_conversation', { p_handle: handle });
export const startFriend = (handle) => rpc('start_friend_request', { p_handle: handle });
// Matches → friends: ask (or take back) in a match chat; both asking makes it a friend chat.
export const askFriend = (conversationId, on = true) => rpc('ask_friend', { p_conversation: conversationId, p_on: on });
// Pending match friend requests: [{ conversation_id, who: 'mine' | 'theirs' }] ([] on older databases).
let asksMissing = false;
// ---- Speed Dating (three-minute video dates; rules live in the database) ----------------------------
export const speedConfig = () => fetch(API + '/api/speed-config', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ enabled: false }));
export const speedJoin = () => rpc('speed_join');
export const speedPoll = () => rpc('speed_poll');
export const speedLeaveQueue = () => rpc('speed_leave_queue');
export const speedWaiting = () => rpc('speed_waiting');
// Dates used in the last 24 hours, the daily limit, and (when used up) when the next date opens.
export const speedQuota = () => rpc('speed_quota');
export const speedSession = (id = null) => rpc('speed_session', { p_session: id });
export const speedReady = (id) => rpc('speed_ready', { p_session: id });
export const speedHeartbeat = (id) => rpc('speed_heartbeat', { p_session: id });
export const speedSignal = (id, data) => rpc('speed_signal', { p_session: id, p_data: data });
// The other person's call-setup messages from the mailbox (after message number `after`).
export const speedPull = (id, after = 0) => rpc('speed_pull', { p_session: id, p_after: after });
export const speedEnd = (id) => rpc('speed_end', { p_session: id });
export const speedDecide = (id, like) => rpc('speed_decide', { p_session: id, p_like: like });
export const speedReport = (id, reason, details = '', block = false) => rpc('speed_report', { p_session: id, p_reason: reason, p_details: details, p_block: block });
// Relay passwords for the video call (from our server, only while on a live date).
export async function speedIce() {
  const s = await session();
  const r = await fetch(API + '/api/speed-ice', { method: 'POST', headers: { Authorization: `Bearer ${s && s.access_token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Couldn’t start the video call.');
  return j;
}
// The date's private live channel (call setup + "ended"), and your own queue channel ("paired").
export function speedChannel(id, { onSignal, onEnded, onStatus }) {
  const ch = sb.channel(`speed:${id}`, { config: { private: true } })
    .on('broadcast', { event: 'signal' }, (e) => onSignal && onSignal((e && e.payload) || {}))
    .on('broadcast', { event: 'ended' }, () => onEnded && onEnded())
    .subscribe((st) => onStatus && onStatus(st));
  return { leave: () => { try { sb.removeChannel(ch); } catch {} } };
}
export function speedQueueChannel(uid, onPaired) {
  const ch = sb.channel(`speedq:${uid}`, { config: { private: true } })
    .on('broadcast', { event: 'paired' }, (e) => onPaired((e && e.payload) || {})).subscribe();
  return { leave: () => { try { sb.removeChannel(ch); } catch {} } };
}

export async function myFriendAsks() {
  if (asksMissing) return [];
  try { return (await rpc('my_friend_asks')) || []; }
  catch (e) { if (/could not find the function|PGRST202/i.test((e && (e.message || e.code)) || '')) { asksMissing = true; return []; } throw e; }
}
export async function friendAskState(conversationId) {
  try { return await rpc('friend_ask_state', { p_conversation: conversationId }); }
  catch (e) { if (/could not find the function|PGRST202/i.test((e && (e.message || e.code)) || '')) return null; throw e; }
}
// Personal status: one per person, seen by accepted friends.
export const setStatus = async (body) => ((await rpc('set_my_status', { p_body: body })) || [])[0] || null;
export const clearStatus = () => rpc('clear_my_status');
export const declineRequest = (conversationId) => rpc('decline_message_request', { p_conversation: conversationId });
export const acceptRequest = (conversationId) => rpc('accept_message_request', { p_conversation: conversationId });
// Take back a friend/message request you sent, before they accept it (it disappears for both).
export const cancelRequest = (conversationId) => rpc('cancel_request', { p_conversation: conversationId });
export const blockPartner = (conversationId) => rpc('block_conversation_partner', { p_conversation: conversationId });
export const unblockPartner = (conversationId) => rpc('unblock_conversation_partner', { p_conversation: conversationId });
export const unmatch = (conversationId) => rpc('unmatch_conversation', { p_conversation: conversationId });
export const chatPartnerProfile = async (conversationId) => ((await rpc('chat_partner_profile', { p_conversation: conversationId })) || [])[0] || null;
export const deleteConversation = (conversationId) => rpc('delete_conversation', { p_conversation: conversationId });
export const editMessage = (id, body) => rpc('edit_dating_message', { p_message: id, p_body: body });
export const unsendMessage = (id) => rpc('unsend_dating_message', { p_message: id });
export const hideMessage = (id) => rpc('hide_dating_message', { p_message: id });
export async function messageById(id) {
  const { data } = await sb.from('dating_messages').select('id, sender_id, body, created_at, deleted_at').eq('id', id).maybeSingle();
  return data || null;
}
// ---- Nearby (protected locations; raw GPS is sent once and never returned) ----------------------
export const chatStatus = async (conversationId) => ((await rpc('chat_status', { p_conversation: conversationId })) || [])[0] || null;
export const nearbySettings = async () => ((await rpc('nearby_settings')) || [])[0] || { enabled: false };
export const nearbySetLocation = (lat, lng) => rpc('nearby_set_location', { p_lat: lat, p_lng: lng });
export const nearbyUpdate = (args) => rpc('nearby_update_settings', args);
export const nearbyPeople = async ({ radius, minAge, maxAge, genders, interests, sort }) => (await rpc('nearby_people', {
  p_radius_km: radius, p_min_age: minAge || null, p_max_age: maxAge || null,
  p_genders: genders && genders.length ? genders : null, p_interests: interests && interests.length ? interests : null,
  p_sort: sort || 'distance', p_limit: 150,
})) || [];
export const blockProfile = (handle) => rpc('block_profile', { p_handle: handle });
export const reportProfile = (handle, reason, details) => rpc('report_profile', { p_handle: handle, p_reason: reason, p_details: details || '' });
export const reportPartner = (conversationId, reason, details) =>
  rpc('report_conversation_partner', { p_conversation: conversationId, p_reason: reason, p_details: details || '' });

// ---- Live updates ---------------------------------------------------------------------------
// One open chat: its new messages, "typing…" pings, and presence (is the other person in this chat
// right now?) over the chat's own channel. The channel name is the chat's random id; presence only
// carries "this account is here", nothing else.
export function joinChat(conversationId, me, { onMessage, onUpdate, onTyping, onPresence, onRead }) {
  // "read" pings let the other person's open chat flip to Seen straight away (the database keeps the real read time).
  const read = () => ch.send({ type: 'broadcast', event: 'read', payload: { from: me } });
  // New messages, edits and unsends arrive on the chat's private channel (only its two people can
  // listen). If that channel isn't available, fall back to the older table-change feed.
  let fallback = null;
  const live = sb.channel(`chat:${conversationId}`, { config: { private: true } })
    .on('broadcast', { event: 'message' }, ({ payload }) => onMessage(payload))
    .on('broadcast', { event: 'update' }, ({ payload }) => { if (onUpdate) onUpdate(payload); })
    .subscribe((status) => {
      if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !fallback) {
        fallback = sb.channel(`hy-chat-db-${conversationId}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dating_messages', filter: `conversation_id=eq.${conversationId}` }, (p) => onMessage(p.new))
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dating_messages', filter: `conversation_id=eq.${conversationId}` }, (p) => { if (onUpdate) onUpdate(p.new); })
          .subscribe();
      }
    });
  // Typing, "read" pings and presence stay on the chat's own lightweight channel.
  const ch = sb.channel(`hy-chat-${conversationId}`, { config: { broadcast: { self: false }, presence: { key: me } } })
    .on('broadcast', { event: 'typing' }, (p) => { if (p.payload && p.payload.from !== me) onTyping(); })
    .on('broadcast', { event: 'read' }, (p) => { if (onRead && p.payload && p.payload.from !== me) onRead(); })
    .on('presence', { event: 'sync' }, () => { if (onPresence) onPresence(Object.keys(ch.presenceState()).some((k) => k !== me)); })
    .subscribe((status) => { if (status === 'SUBSCRIBED') { ch.track({ here: true }); read(); } });
  let last = 0;
  return {
    read,
    typing() { const now = Date.now(); if (now - last > 2500) { last = now; ch.send({ type: 'broadcast', event: 'typing', payload: { from: me } }); } },
    leave() { sb.removeChannel(ch); sb.removeChannel(live); if (fallback) sb.removeChannel(fallback); },
  };
}

// ---- State chat rooms -----------------------------------------------------------------------------
export const roomList = async () => (await rpc('room_list')) || [];
export const joinRoom = async (state) => ((await rpc('join_room', { p_state: state })) || [])[0] || null;
export const roomHeartbeat = () => rpc('room_heartbeat');
export const leaveRoom = () => rpc('leave_room');
// Kicked out of a room for being inactive for 10 minutes? (null if not, or on older servers)
export async function myRoomKick() {
  try { return ((await rpc('my_room_kick')) || [])[0] || null; }
  catch (e) { if (/could not find the function|PGRST202/i.test((e && (e.message || e.code)) || '')) return null; throw e; }
}
export const dismissRoomKick = () => rpc('dismiss_room_kick').catch(() => {});
export const roomMarkRead = () => rpc('room_mark_read');
export const roomHistory = async () => (await rpc('room_history', { p_limit: 200 })) || [];
// Only messages newer than the last one on screen (the background check). Falls back to the full
// history if the database doesn't have the newer function yet.
let sinceMissing = false;
export async function roomHistorySince(afterId) {
  if (sinceMissing || !afterId) return roomHistory();
  try { return (await rpc('room_history_since', { p_after: afterId, p_limit: 100 })) || []; }
  catch (e) { if (/room_history_since|PGRST202|42883/i.test(`${e.message} ${e.code || ''}`)) { sinceMissing = true; return roomHistory(); } throw e; }
}
export const roomPeople = async () => (await rpc('room_people')) || [];
export const sendRoomMessage = async (body, replyTo = null) => ((await rpc('send_room_message', replyTo ? { p_body: body, p_reply_to: replyTo } : { p_body: body })) || [])[0] || null;
export const reportRoomMessage = (id, reason) => rpc('report_room_message', { p_message: id, p_reason: reason });
export const deleteRoomMessage = (id) => rpc('delete_room_message', { p_message: id });
export const blockRoomSender = (id) => rpc('block_room_sender', { p_message: id });
// Live messages for one room, on its private channel (only members can listen).
export function joinRoomChannel(state, onMessage, onReaction = () => {}, onJoin = () => {}, onStatus = () => {}, onRemove = () => {}, onLeave = () => {}) {
  const ch = sb.channel(`room:${state}`, { config: { private: true } })
    .on('broadcast', { event: 'message' }, ({ payload }) => onMessage(payload))
    .on('broadcast', { event: 'remove' }, ({ payload }) => onRemove(payload))
    .on('broadcast', { event: 'reaction' }, ({ payload }) => onReaction(payload))
    .on('broadcast', { event: 'join' }, ({ payload }) => onJoin(payload))
    .on('broadcast', { event: 'leave' }, ({ payload }) => onLeave(payload))
    .subscribe((status) => onStatus(status));
  return { leave() { sb.removeChannel(ch); } };
}
export const toggleRoomReaction = async (id, emoji) => ((await rpc('toggle_room_reaction', { p_message: id, p_emoji: emoji })) || [])[0] || null;
export const roomProfile = async (handle) => ((await rpc('room_profile', { p_handle: handle })) || [])[0] || null;
// ---- Custom avatars ---------------------------------------------------------------------------------
export const getAvatars = async (handles) => (await rpc('get_avatars', { p_handles: handles })) || [];
export const setMyAvatar = (config) => rpc('set_my_avatar', { p_config: config });
