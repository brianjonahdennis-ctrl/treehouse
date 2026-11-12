// Shared app state + a tiny change signal. Screens read `state` and re-render on `emit()`.
import * as api from './hy-api.js';
import { store } from './hy-ui.js';

export const state = {
  user: null,          // Supabase auth user
  profile: null,       // own dating profile (includes the private name: only ever shown to its owner)
  requests: [],        // incoming dating requests
  convos: [],          // my_conversations()
  pendingLikes: 0,
  myStatus: null,      // { body, updated_at } or null
  friendStatus: {},    // friend chat id -> { body, updated_at }
  openChat: null,      // id of the chat open on screen, if any
  ready: false,
  onboarding: false,   // true while the sign-up steps are still showing
  recovering: false,   // opened from a password-reset email
  likeTarget: null,    // handle from a dating card on someone's link page (/home?to=…)
};

export const GENDERS = [['female', 'Woman'], ['male', 'Man'], ['other', 'Non-binary / other']];
export const GENDER_LABEL = { female: 'Woman', male: 'Man', other: 'Non-binary' };
export const INTENTS = [['fun', 'Something fun 😄'], ['love', 'A relationship ❤️'], ['marriage', 'Marriage 💍']];
export const INTENT_LABEL = { fun: 'Fun 😄', love: 'Love ❤️', marriage: 'Marriage 💍' };
export const INTERESTS = ['Music', 'Afrobeats', 'Football', 'Movies', 'Fashion', 'Food', 'Travel', 'Gaming', 'Fitness', 'Art', 'Books', 'Tech', 'Faith', 'Photography', 'Dancing', 'Comedy', 'Business', 'Anime', 'Nature', 'Cooking'];
// Nigeria's 36 states and the FCT (must match dating_private.nigerian_states() in the database).
export const STATES = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta',
  'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
  'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'];
export const stateLabel = (s) => (s === 'FCT' ? 'FCT (Abuja)' : s || 'Anywhere in Nigeria');
// Rooms open across Nigeria (the server decides who may join each one).
// Can this profile join an age room? null = not an age room. Same rule and wording as the server.
export const ageRoomBlock = (room, age) => {
  const r = GENERAL_ROOMS[room]; if (!r || !r.ages || !age) return null;
  return age < r.ages[0] ? 'You are too young for this group.' : age > r.ages[1] ? 'You are too old for this group.' : null;
};
export const GENERAL_ROOMS = {
  'Nigeria': { name: 'Nigeria', emoji: '🇳🇬', tag: 'Everyone', blurb: 'The whole country in one room' },
  // Age rooms: everyone sees them; only people whose profile age fits can join (the server checks).
  'Ages 18-25': { name: 'Ages 18–25', emoji: '🎓', tag: 'Ages 18–25', blurb: 'Your age group, from all over Nigeria', ages: [18, 25] },
  'Ages 26-35': { name: 'Ages 26–35', emoji: '💼', tag: 'Ages 26–35', blurb: 'Your age group, from all over Nigeria', ages: [26, 35] },
  'Ages 36+': { name: 'Ages 36+', emoji: '🌟', tag: 'Ages 36+', blurb: 'Your age group, from all over Nigeria', ages: [36, 200] },
  'Lovers Lounge': { name: 'Lover’s Lounge', emoji: '💘', tag: 'Everyone', blurb: 'Love, dating and relationship talk' },
  'Football Banter': { name: 'Football Banter', emoji: '⚽', tag: 'Everyone', blurb: 'Matches, transfers and trash talk' },
  'Christian Room': { name: 'Christian Room', emoji: '✝️', tag: 'Everyone', blurb: 'Faith, fellowship and good vibes' },
  'Muslim Room': { name: 'Muslim Room', emoji: '☪️', tag: 'Everyone', blurb: 'Faith, fellowship and good vibes' },
  'Ladies Room': { name: 'Ladies’ Room', emoji: '💅', tag: 'Women only', blurb: 'Just the girls' },
  'Mens Room': { name: 'Men’s Room', emoji: '🧔🏾', tag: 'Men only', blurb: 'Just the guys' },
};
// State landmark photos for the state room badges (filled in from Wikimedia Commons; credits at /photo-credits).
export const LANDMARKS = {};
// University rooms: two per state (Abuja: one). Only people in that state can join.
export const UNI_ROOMS = {
  "MOUAU": { name: "Michael Okpara University of Agriculture, Umudike", state: "Abia" },
  "ABSU": { name: "Abia State University", state: "Abia" },
  "MAU": { name: "Modibbo Adama University, Yola", state: "Adamawa" },
  "ADSU": { name: "Adamawa State University, Mubi", state: "Adamawa" },
  "UNIUYO": { name: "University of Uyo", state: "Akwa Ibom" },
  "AKSU": { name: "Akwa Ibom State University", state: "Akwa Ibom" },
  "UNIZIK": { name: "Nnamdi Azikiwe University", state: "Anambra" },
  "COOU": { name: "Chukwuemeka Odumegwu Ojukwu University", state: "Anambra" },
  "ATBU": { name: "Abubakar Tafawa Balewa University", state: "Bauchi" },
  "BASUG": { name: "Bauchi State University, Gadau", state: "Bauchi" },
  "NDU": { name: "Niger Delta University", state: "Bayelsa" },
  "FUO": { name: "Federal University Otuoke", state: "Bayelsa" },
  "BSU": { name: "Benue State University", state: "Benue" },
  "JOSTUM": { name: "Joseph Sarwuan Tarka University, Makurdi", state: "Benue" },
  "UNIMAID": { name: "University of Maiduguri", state: "Borno" },
  "BOSU": { name: "Borno State University", state: "Borno" },
  "UNICAL": { name: "University of Calabar", state: "Cross River" },
  "UNICROSS": { name: "University of Cross River State", state: "Cross River" },
  "DELSU": { name: "Delta State University, Abraka", state: "Delta" },
  "FUPRE": { name: "Federal University of Petroleum Resources", state: "Delta" },
  "EBSU": { name: "Ebonyi State University", state: "Ebonyi" },
  "AE-FUNAI": { name: "Alex Ekwueme Federal University", state: "Ebonyi" },
  "UNIBEN": { name: "University of Benin", state: "Edo" },
  "AAU": { name: "Ambrose Alli University", state: "Edo" },
  "EKSU": { name: "Ekiti State University", state: "Ekiti" },
  "FUOYE": { name: "Federal University Oye-Ekiti", state: "Ekiti" },
  "UNN": { name: "University of Nigeria, Nsukka", state: "Enugu" },
  "ESUT": { name: "Enugu State University of Science and Technology", state: "Enugu" },
  "UniAbuja": { name: "University of Abuja", state: "FCT" },
  "GSU": { name: "Gombe State University", state: "Gombe" },
  "FUK": { name: "Federal University Kashere", state: "Gombe" },
  "IMSU": { name: "Imo State University", state: "Imo" },
  "FUTO": { name: "Federal University of Technology Owerri", state: "Imo" },
  "FUD": { name: "Federal University Dutse", state: "Jigawa" },
  "SLU": { name: "Sule Lamido University", state: "Jigawa" },
  "ABU": { name: "Ahmadu Bello University, Zaria", state: "Kaduna" },
  "KASU": { name: "Kaduna State University", state: "Kaduna" },
  "BUK": { name: "Bayero University Kano", state: "Kano" },
  "KUST": { name: "Aliko Dangote University of Science and Technology, Wudil", state: "Kano" },
  "UMYU": { name: "Umaru Musa Yar'adua University", state: "Katsina" },
  "FUDMA": { name: "Federal University Dutsin-Ma", state: "Katsina" },
  "KSUSTA": { name: "Kebbi State University of Science and Technology", state: "Kebbi" },
  "FUBK": { name: "Federal University Birnin Kebbi", state: "Kebbi" },
  "PAAU": { name: "Prince Abubakar Audu University, Anyigba", state: "Kogi" },
  "FULOKOJA": { name: "Federal University Lokoja", state: "Kogi" },
  "UNILORIN": { name: "University of Ilorin", state: "Kwara" },
  "KWASU": { name: "Kwara State University", state: "Kwara" },
  "UNILAG": { name: "University of Lagos", state: "Lagos" },
  "LASU": { name: "Lagos State University", state: "Lagos" },
  "NSUK": { name: "Nasarawa State University, Keffi", state: "Nasarawa" },
  "FULAFIA": { name: "Federal University of Lafia", state: "Nasarawa" },
  "FUT Minna": { name: "Federal University of Technology Minna", state: "Niger" },
  "IBBU": { name: "Ibrahim Badamasi Babangida University", state: "Niger" },
  "FUNAAB": { name: "Federal University of Agriculture Abeokuta", state: "Ogun" },
  "OOU": { name: "Olabisi Onabanjo University", state: "Ogun" },
  "FUTA": { name: "Federal University of Technology Akure", state: "Ondo" },
  "AAUA": { name: "Adekunle Ajasin University", state: "Ondo" },
  "OAU": { name: "Obafemi Awolowo University", state: "Osun" },
  "UNIOSUN": { name: "Osun State University", state: "Osun" },
  "UI": { name: "University of Ibadan", state: "Oyo" },
  "LAUTECH": { name: "Ladoke Akintola University of Technology", state: "Oyo" },
  "UNIJOS": { name: "University of Jos", state: "Plateau" },
  "PLASU": { name: "Plateau State University", state: "Plateau" },
  "UNIPORT": { name: "University of Port Harcourt", state: "Rivers" },
  "RSU": { name: "Rivers State University", state: "Rivers" },
  "UDUS": { name: "Usmanu Danfodiyo University", state: "Sokoto" },
  "SSU": { name: "Sokoto State University", state: "Sokoto" },
  "TSU": { name: "Taraba State University", state: "Taraba" },
  "FUW": { name: "Federal University Wukari", state: "Taraba" },
  "YSU": { name: "Yobe State University", state: "Yobe" },
  "FUGA": { name: "Federal University Gashua", state: "Yobe" },
  "FUGUS": { name: "Federal University Gusau", state: "Zamfara" },
  "ZAMSUT": { name: "Zamfara State University, Talata Mafara", state: "Zamfara" },
};
export const roomName = (s) => (GENERAL_ROOMS[s] ? GENERAL_ROOMS[s].name : UNI_ROOMS[s] ? s : s === 'FCT' ? 'Abuja (FCT)' : `${stateLabel(s)} State`);

const subs = new Set();
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const emit = (what) => subs.forEach((fn) => fn(what));

// Navigation is set up by the app shell; screens call go('matches') etc.
export const nav = { go: () => {}, openChat: () => {} };
export const go = (...a) => nav.go(...a);

export const isAdultDater = () => !!state.profile;
// Chat status from my_conversations(): 'chat' (accepted), 'request' (someone messaged me first and
// I haven't replied), 'sent' (I messaged first, waiting for a reply).
export const statusOf = (c) => c.status || 'chat';
// Match chats where the other person asked to be friends (you can accept or decline).
export const matchFriendAsks = () => state.convos.filter((c) => !c.blocked && c.friendAsk === 'theirs' && c.kind !== 'friend');
export const messageRequests = () => state.convos.filter((c) => !c.blocked && statusOf(c) === 'request');
export const unreadChats = () => state.convos.filter((c) => !c.blocked && statusOf(c) !== 'request').reduce((n, c) => n + (c.unread || 0), 0);
// A match = you both liked each other (from the database's `matched` flag). Accepted message
// requests are chats too, but they aren't matches.
export const isMatch = (c) => c.matched === true && c.kind !== 'friend';
// Friends: people added from chatrooms. Their chats live in Friends, not Matches.
export const isFriend = (c) => c.kind === 'friend';
// Accepted friends (not pending requests, not dating matches), each with their status if they have one.
export const friendsList = () => state.convos
  .filter((c) => c.kind === 'friend' && !c.blocked && statusOf(c) === 'chat')
  .map((c) => Object.assign(c, { friend_status: state.friendStatus[c.conversation_id] || null }));
export const newMatches = () => state.convos.filter((c) => !c.blocked && statusOf(c) === 'chat' && !c.last_message && c.kind !== 'friend');

// Clear a chat's unread count straight away (the badge updates without redrawing the open chat),
// then save it; if saving fails, the next refresh brings the count back and it's retried on open.
export function markChatRead(id) {
  const c = state.convos.find((x) => x.conversation_id === id);
  if (c && c.unread) { c.unread = 0; emit('badges'); }
  return api.markChatRead(id).catch(() => {});
}
let lastTouch = 0, lastLoad = 0, loading = null;
export async function loadDating({ force = false } = {}) {
  // Runs on open, when the app comes back to the screen, and with the background poll. Light on the
  // server: one at a time, not more than once every 30 s unless forced, and paused while it struggles.
  if (loading) return loading;
  if (!force && (api.backingOff() || Date.now() - lastLoad < 30000)) return;
  lastLoad = Date.now();
  // Tell the database this person is active, at most every 4 minutes (also keeps their chatroom seat).
  if (Date.now() - lastTouch > 240000) { lastTouch = Date.now(); api.touchLastSeen().catch(() => {}); }
  if (!state.profile) return;
  loading = loadDatingNow().finally(() => { loading = null; });
  return loading;
}
async function loadDatingNow() {
  try {
    const [{ convos, requests, pending, myStatus, friendStatuses }, asks] = await Promise.all([api.datingSummary(), api.myFriendAsks().catch(() => null)]);
    state.convos = convos; state.requests = requests; state.pendingLikes = pending || 0;
    // Friend requests inside match chats: tag each chat 'mine' (you asked) or 'theirs' (they asked).
    if (asks) { const by = new Map(asks.map((a) => [a.conversation_id, a.who])); convos.forEach((c) => { c.friendAsk = by.get(c.conversation_id) || null; }); }
    if (myStatus !== undefined) state.myStatus = myStatus;
    if (friendStatuses) state.friendStatus = Object.fromEntries(friendStatuses.map((f) => [f.conversation_id, f]));
    applyRevealedNames();
    emit('dating');
  } catch {}
}

// Once you've both revealed, the chat shows their first name instead of the anonymous nickname.
// First names are fetched once per chat and remembered on this device.
const NAMES_KEY = 'hy-revealed-names';
const bothRevealed = (c) => !!(c && c.i_revealed && c.they_revealed);
export const nameOf = (c) => (bothRevealed(c) && c.other_name) || (c && c.other_handle) || '';
export function rememberRevealedName(id, name) {
  if (!id || !name) return;
  const cache = store.get(NAMES_KEY, {}); cache[id] = name; store.set(NAMES_KEY, cache);
  const c = state.convos.find((x) => x.conversation_id === id);
  if (c && c.other_name !== name) { c.other_name = name; emit('dating'); }
}
let fetchingNames = false;
function applyRevealedNames() {
  const cache = store.get(NAMES_KEY, {});
  const missing = [];
  for (const c of state.convos) {
    if (!bothRevealed(c)) continue;
    if (cache[c.conversation_id]) c.other_name = cache[c.conversation_id];
    else missing.push(c.conversation_id);
  }
  if (!missing.length || fetchingNames) return;
  fetchingNames = true;
  Promise.all(missing.slice(0, 20).map((id) => api.revealedDetails(id).then((w) => { if (w && w.name) rememberRevealedName(id, w.name); }).catch(() => {})))
    .finally(() => { fetchingNames = false; });
}

// Update one chat in the list on this phone, without asking the server for the whole list
// (a new message arrived, or you sent one). Returns false if this phone doesn't know that chat yet.
export function patchChat(id, { body, at, fromMe, countUnread = false, theyreOnline = false }) {
  const c = state.convos.find((x) => x.conversation_id === id);
  if (!c || c.blocked) return false;
  if (c.last_at && at && new Date(at) < new Date(c.last_at)) return true;   // older than what we show
  c.last_message = body; c.last_from_me = !!fromMe; c.last_at = at || new Date().toISOString();
  if (countUnread) c.unread = Math.min(99, (c.unread || 0) + 1);
  if (theyreOnline) { c.other_online = true; c.other_active_hours = 0; }
  state.convos.sort((a, b) => new Date(b.last_at) - new Date(a.last_at));
  emit('dating');
  return true;
}

// Unmatch / block: close the chat in the list right away (moves to "Chat closed"), before the
// server confirms. Returns an undo for when the server call fails.
export function closeChatLocal(id) {
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
  // Show the app straight away; chats, likes and requests fill in as soon as they arrive.
  loadDating({ force: true });
  emit('all');
}

// ---- Notifications (derived from data that already exists) -----------------------------------
const SEEN_KEY = 'hy-notif-seen';
export const notifSeenAt = () => store.get(SEEN_KEY, 0);
export const markNotifsSeen = () => { store.set(SEEN_KEY, Date.now()); emit('notifs'); };

export function notifications() {
  const out = [];
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
  // Friends' new or changed statuses (one entry per friend, for their latest status).
  for (const c of state.convos) {
    const st = state.friendStatus[c.conversation_id];
    if (!st || c.blocked || c.kind !== 'friend') continue;
    out.push({ kind: 'status', emoji: '💬', text: `${nameOf(c)} updated their status: “${st.body}”`, at: st.updated_at, chat: c.conversation_id });
  }
  if (state.profile && state.profile.suspended) out.push({ kind: 'account', emoji: '⚠️', text: 'Your dating profile is suspended after reports.', at: new Date().toISOString(), to: 'profile' });
  return out.sort((a, b) => new Date(b.at) - new Date(a.at));
}
export const newNotifCount = () => notifications().filter((n) => new Date(n.at).getTime() > notifSeenAt()).length;
