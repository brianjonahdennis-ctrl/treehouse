// treehouse app shell: start-up, routing (/home/...), navigation, notifications, live updates.
import * as api from './hy-api.js';
import { h, icon, logo, ago, emptyState, store, hero, heroBtn, toast } from './hy-ui.js';
import { state, subscribe, emit, nav, loadAll, loadDating, patchChat, closeChatLocal, notifications, notifSeenAt, markNotifsSeen,
  newNotifCount, unreadChats, messageRequests, matchFriendAsks, newMatches } from './hy-state.js';
import { renderRooms, openRoom, closeRoom } from './hy-rooms.js';
import * as push from './hy-push.js';
import { startAvatars } from './hy-avatar.js';
import * as install from './hy-install.js';
import { renderLanding, renderOnboarding, renderNewPassword, renderUnderage } from './hy-onboard.js';
import { renderHome } from './hy-home.js';
import { renderDiscover, renderMatches, openChat, closeChat, composeTo, deliverToOpenChat } from './hy-dating.js';
import { renderProfile } from './hy-profile.js';

// ---- Theme -------------------------------------------------------------------------------------
export function applyTheme(t = store.get('hy-theme', 'system')) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
applyTheme();

// ---- Routes ------------------------------------------------------------------------------------
const TABS = [
  { route: 'home', label: 'Home', icon: 'home' },
  { route: 'rooms', label: 'Chatrooms', icon: 'rooms' },
  { route: 'discover', label: 'Discover', icon: 'flame', center: true },
  { route: 'matches', label: 'Inbox', icon: 'mail', badge: () => state.requests.length + messageRequests().length + matchFriendAsks().length + unreadChats() + newMatches().length },
  { route: 'profile', label: 'Profile', icon: 'user' },
];
const TITLES = { rooms: 'Chatrooms', home: 'Home', discover: 'Discover', matches: 'Inbox', profile: 'Profile', notifications: 'Notifications' };
const MATCH_VIEWS = new Set(['requests', 'chats', 'likes', 'matches', 'friends']);

function parse() {
  const parts = location.pathname.replace(/^\/home\/?/, '').split('/').filter(Boolean);
  // Requests used to live under Discover
  if (parts[0] === 'discover' && parts[1] === 'requests') { history.replaceState(null, '', '/home/matches/likes'); return { tab: 'matches', sub: 'likes' }; }
  if (parts[0] === 'messages') { history.replaceState(null, '', '/home/matches'); return { tab: 'matches', sub: null }; }
  return { tab: parts[0] || 'home', sub: parts[1] || null };
}
const chatId = () => (route.tab === 'matches' && route.sub && !MATCH_VIEWS.has(route.sub) ? route.sub : null);
let route = parse();

nav.go = (path, { replace = false } = {}) => {
  if (path === 'discover/requests') path = 'matches/likes';
  const url = '/home' + (path && path !== 'home' ? `/${path}` : '');
  if (url !== location.pathname) history[replace ? 'replaceState' : 'pushState'](null, '', url);
  route = parse();
  render();
};
nav.openChat = (id) => {
  history.pushState(null, '', `/home/matches/${id}`);
  window.__hyChatPushed = true;
  route = parse();
  render();
};
window.addEventListener('popstate', () => { route = parse(); render(); });

// ---- Shell ------------------------------------------------------------------------------------
// Each screen draws its own purple header; the shell is just navigation (bottom bar on phones,
// sidebar on desktop) around the screen.
const root = document.getElementById('app');
let shellBuilt = false, mainEl, bellBadge, navEls = [];

function navItem(t, side) {
  const badge = h('span', { class: 'badge', 'data-n': '0' });
  const cls = side ? `side-item${t.center ? ' side-center' : ''}` : `nav-item${t.center ? ' nav-center' : ''}`;
  const el = h('a', {
    href: `/home${t.route === 'home' ? '' : '/' + t.route}`, class: cls,
    onclick: (e) => { e.preventDefault(); nav.go(t.route); },
  }, t.center && !side ? h('span', { class: 'nav-orb' }, icon(t.icon)) : icon(t.icon), h('span', {}, t.label), badge);
  navEls.push({ el, t, badge });
  return el;
}

function buildShell() {
  navEls = [];
  const sidebar = h('nav', { class: 'sidebar', 'aria-label': 'Main' }, logo(), TABS.map((t) => navItem(t, true)),
    h('div', { class: 'side-foot' },
      h('a', { class: 'side-item', href: '/home/notifications', onclick: (e) => { e.preventDefault(); nav.go('notifications'); } },
        icon('bell'), h('span', {}, 'Notifications'), bellBadge = h('span', { class: 'badge' })),
      h('p', { class: 'tiny', style: { padding: '0 14px' } }, 'Anonymous users. Real connections. Identities stay hidden until both people agree.')));
  mainEl = h('main', { class: 'main', id: 'main', tabindex: '-1' });
  const bottom = h('nav', { class: 'bottom-nav', 'aria-label': 'Main' }, TABS.map((t) => navItem(t, false)));
  root.replaceChildren(h('div', { class: 'shell' }, sidebar, h('div', { class: 'shell-body' }, mainEl), bottom));
  shellBuilt = true;
  refreshChrome();
}

function refreshChrome() {
  if (!shellBuilt) return;
  for (const { el, t, badge } of navEls) {
    if (route.tab === t.route) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    const n = t.badge ? t.badge() : 0;
    badge.textContent = n ? (n > 99 ? '99+' : n) : '';
    badge.dataset.n = String(n);
  }
  const nn = newNotifCount();
  if (bellBadge) { bellBadge.textContent = nn || ''; bellBadge.dataset.n = String(nn); }
  document.body.classList.toggle('dark-screen', route.tab === 'discover');
  const unread = unreadChats() + state.requests.length + messageRequests().length;
  document.title = `${unread ? `(${unread}) ` : ''}${TITLES[route.tab] || 'Home'} · treehouse`;
  // Home-screen icon badge (installed web app): match the in-app count, and clear it at zero.
  if ('setAppBadge' in navigator) (unread ? navigator.setAppBadge(unread) : navigator.clearAppBadge()).catch(() => {});
}

// ---- Render ------------------------------------------------------------------------------------
let lastTab = null;
function render() {
  if (state.user && state.recovering) { shellBuilt = false; closeChat(); closeRoom(); document.body.classList.remove('dark-screen'); return root.replaceChildren(renderNewPassword()); }
  if (!state.user) { shellBuilt = false; closeChat(); closeRoom(); document.body.classList.remove('dark-screen'); return root.replaceChildren(renderLanding()); }
  if (!state.profile || state.onboarding) { shellBuilt = false; closeChat(); closeRoom(); document.body.classList.remove('dark-screen'); return root.replaceChildren(renderOnboarding()); }
  // An under-18 date of birth stops here for good.
  if (state.profile.dob_underage_at) {
    shellBuilt = false; closeChat(); closeRoom(); document.body.classList.remove('dark-screen');
    return root.replaceChildren(renderUnderage());
  }
  if (!shellBuilt) buildShell();
  refreshChrome();
  document.querySelectorAll('.match-scrim').forEach((m) => { if (!chatId()) return; m.remove(); });
  const cid = chatId();
  if (cid) openChat(cid); else closeChat();
  const rid = route.tab === 'rooms' && route.sub ? decodeURIComponent(route.sub) : null;
  if (rid) openRoom(rid); else closeRoom();
  const screens = { rooms: renderRooms, home: renderHome, discover: renderDiscover, matches: renderMatches, profile: renderProfile, notifications: renderNotifications };
  const fn = screens[route.tab] || renderHome;
  const changedTab = lastTab !== route.tab;
  mainEl.replaceChildren(h('div', { class: changedTab ? 'screen' : '' }, fn(cid ? null : route.sub)));
  if (changedTab) { window.scrollTo(0, 0); lastTab = route.tab; }
}
export const rerender = render;
nav.rerender = () => render();
nav.applyTheme = applyTheme;
nav.bell = () => heroBtn('bell', 'Notifications', () => nav.go('notifications'), newNotifCount());

// Data changes refresh the chrome; the current screen decides whether it needs a full redraw.
subscribe((what) => {
  if (!state.user || !state.profile || state.onboarding) return;
  refreshChrome();
  const redraw = { all: true, dating: ['home', 'discover', 'matches', 'notifications'], notifs: ['notifications'], profile: ['home', 'discover', 'profile'], push: ['home', 'profile'] }[what];
  if (redraw === true || (redraw && redraw.includes(route.tab))) {
    // Don't redraw Discover while someone is mid-swipe; the deck updates itself.
    if (route.tab === 'discover' && what === 'dating') return;
    render();
  }
});

// ---- Notifications screen -----------------------------------------------------------------------
function renderNotifications() {
  const seen = notifSeenAt();
  const items = notifications();
  setTimeout(markNotifsSeen, 1500);
  const head = hero({ title: 'Notifications', sub: 'Messages, requests, matches and chats.' });
  if (!items.length) return h('div', { class: 'stack-lg' }, head, emptyState('🔔', 'All caught up', 'New chats, message requests, likes and matches will show up here.'));
  return h('div', { class: 'stack-lg' }, head,
    h('div', { class: 'card', style: { padding: '6px' } }, items.map((n) => h('button', {
      class: `notif ${new Date(n.at).getTime() > seen ? 'new' : ''}`,
      onclick: () => (n.chat ? nav.openChat(n.chat) : nav.go(n.to)),
    }, h('span', { class: 'n-icon' }, n.emoji), h('span', { class: 'grow' }, h('p', {}, n.text), h('span', { class: 'when' }, ago(n.at)))))),
    h('p', { class: 'tiny muted center' }, push.isOn() ? 'Push notifications are on for this device.' : 'Want these on your lock screen? Turn on push notifications in Profile.'));
}

// ---- Start-up ------------------------------------------------------------------------------------
let live = null, poll = null;
function startLive() {
  if (live || !state.profile) return;
  live = true;
  // Push notifications: find out if they're set up, and keep this device linked to this account.
  push.available().then((ok) => { if (ok) { emit('push'); push.sync(); } });
  // The server nudges this phone when something new arrives (message, like, accepted request, reveal),
  // so the chat list refreshes right away. The 10-minute check is only a safety net.
  // At most one refresh every 20 seconds, however many nudges arrive (busy chats send many).
  let nudgeTimer = null, lastNudgeLoad = 0;
  api.onInboxNudge(state.user.id, (n) => {
    // A new message in a chat this phone already has: update the list right here, no server call.
    // (The open chat shows it itself and marks it read, so it doesn't count as unread.)
    // They unmatched or blocked: close that chat here right away.
    if (n.k === 'closed' && n.c) {
      closeChatLocal(n.c);
      if (state.openChat === n.c) { closeChat(); nav.go('matches', { replace: true }); }
      return;
    }
    if (n.k === 'message' && n.c) {
      // Newer signals carry the whole message (m): show it in the open chat straight away.
      if (n.m) deliverToOpenChat(n.c, { conversation_id: n.c, created_at: n.at, reply_to: null, edited_at: null, deleted_at: null, ...n.m });
      const open = state.openChat === n.c && !document.hidden;
      if (patchChat(n.c, { body: n.b != null ? n.b : n.m ? String(n.m.body || '').slice(0, 200) : '', at: n.at, fromMe: false, countUnread: !open, theyreOnline: true })) return;
    }
    if (nudgeTimer) return;
    const wait = Math.max(1500, 20000 - (Date.now() - lastNudgeLoad));
    nudgeTimer = setTimeout(() => { nudgeTimer = null; lastNudgeLoad = Date.now(); if (!document.hidden) loadDating({ force: true }); }, wait);
  });
  poll = setInterval(() => { if (!document.hidden) loadDating(); }, 600000);
  // Chatrooms kick people who are inactive for 10 minutes (like 2go). While treehouse is open on
  // screen, ping every 3 minutes so you keep your seat; a null answer means you were kicked out.
  const roomBeat = async () => {
    if (document.hidden || state.inRoom === false || !api.roomHeartbeat) return;
    try {
      const st = await api.roomHeartbeat();
      if (st) { state.inRoom = true; return; }
      const wasIn = state.inRoom === true;
      state.inRoom = false;
      if (wasIn && !location.pathname.startsWith('/home/rooms')) toast('You were kicked out of your chatroom for inactivity', 'logout');
    } catch {}
  };
  setInterval(roomBeat, 180000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) roomBeat(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadDating(); });
}

nav.afterSignIn = () => afterSignIn();
export async function afterSignIn() {
  const s = await api.session();
  state.user = s ? s.user : null;
  if (!state.user) return render();
  await api.detectFeatures();   // signed in now: re-check what this account can use
  await loadAll();
  render();
  startLive();
  ensureTerms();
  offerLikeTarget();
}

// Everyone must agree to the Terms of Use (zero tolerance for objectionable content). New accounts
// agree at sign-up; anyone who joined earlier is asked once, and can't skip it.
let termsOpen = false;
async function ensureTerms() {
  const u = state.user;
  if (!u || termsOpen || state.recovering) return;
  if ((u.user_metadata && u.user_metadata.terms_accepted_at) || store.get('hy-terms-ok') === u.id) return;
  // Ticked "18+" and "I agree" just before continuing with Google on this phone: save that agreement.
  const g = store.get('hy-google-terms');
  if (g && Date.now() - g < 2 * 3600 * 1000) {
    store.del('hy-google-terms');
    try { const user = await api.acceptTerms(); if (user) state.user = user; store.set('hy-terms-ok', u.id); return; } catch { /* ask below */ }
  }
  termsOpen = true;
  const { sheet, toast: say } = await import('./hy-ui.js');
  let agreed = false;
  sheet((close) => [h('h2', {}, 'Our Terms of Use'),
    h('p', { class: 'muted' }, 'To keep treehouse safe, everyone agrees to the same rules. There’s zero tolerance for objectionable content or abusive users: harassment, sexual content, hate, scams and anything involving minors are removed, and so are the people who post them.'),
    h('p', { class: 'muted' }, 'You can report, block or hide anyone at any time, and we act on reports within 24 hours.'),
    h('p', {}, h('a', { href: '/terms', target: '_blank', rel: 'noopener' }, 'Read the Terms of Use'), ' · ', h('a', { href: '/privacy', target: '_blank', rel: 'noopener' }, 'Privacy policy')),
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn btn-primary btn-block', onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { const user = await api.acceptTerms(); if (user) state.user = user; }
        catch { /* saved on this device below, asked again on another device */ }
        store.set('hy-terms-ok', u.id);
        agreed = true; close(); say('Thanks for keeping treehouse safe', 'shield');
      } }, 'I agree'),
      h('button', { class: 'btn btn-soft btn-block', onclick: async () => { agreed = true; close(); await api.signOut(); location.reload(); } }, 'I don’t agree (sign out)'))],
    { label: 'Terms of Use', onClose: () => { termsOpen = false; if (!agreed) setTimeout(ensureTerms, 0); } });
}

// "Like this person?" for someone who tapped a dating card on a link page before signing in.
nav.offerLike = () => offerLikeTarget();
async function offerLikeTarget() {
  const handle = store.get('hy-like-target');
  if (!handle || !state.profile || state.onboarding || state.recovering) return;
  if (!state.profile) { nav.go('discover'); return; }   // they'll set up dating first; the target waits
  store.del('hy-like-target');
  if (!api.features.matching || handle === state.profile.handle) return;
  const { sheet, toast: say } = await import('./hy-ui.js');
  sheet((close) => [h('h2', {}, handle),
    h('p', { class: 'muted' }, 'Send a like, or message them: a message arrives as a request and moves to your chats when they reply.'),
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn btn-coral btn-block', onclick: async () => {
        close();
        try {
          const r = await api.likeProfile(handle, true);
          await loadDating({ force: true });
          if (r.matched && r.conversation_id) nav.openChat(r.conversation_id); else say('Like sent 💘', 'heart');
        } catch (e) { say(api.friendly(e), 'x'); }
      } }, icon('heart', 'sm'), 'Send a like'),
      h('button', { class: 'btn btn-primary btn-block', onclick: () => { close(); composeTo({ handle }); } }, icon('send', 'sm'), 'Send a message'),
      h('button', { class: 'btn btn-soft btn-block', onclick: close }, 'Not now'))], { label: handle });
}

// Tapping a notification while treehouse is open: the background worker asks us to open that screen.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'treehouse-open' || !state.user) return;
    const path = new URL(e.data.url, location.origin).pathname.replace(/^\/home\/?/, '');
    const chat = path.match(/^matches\/([0-9a-f-]{36})$/);
    if (chat) nav.openChat(chat[1]); else nav.go(path || 'home');
  });
}

// The browser's own "Install app" offer can arrive any time; show or hide the Home card when it does.
install.onChange(() => emit('push'));

// ---- New version? Reload by itself --------------------------------------------------------------
// Phones (iPhones especially) keep treehouse's page open for days, so updates wouldn't show until
// the app was fully closed. When the app comes back to the screen after a minute or more, ask the
// server which version is live; if it's newer, reload, unless someone is typing (then wait).
const myBuild = (document.querySelector('meta[name="th-build"]') || {}).content || null;
let hiddenAt = 0, lastBuildCheck = Date.now();
async function checkForUpdate(force = false) {
  if (!myBuild) return;
  if (!force && (Date.now() - hiddenAt < 60000 && Date.now() - lastBuildCheck < 30 * 60000)) return;
  lastBuildCheck = Date.now();
  try {
    const r = await fetch('/api/app-build', { cache: 'no-store' });
    const { build } = await r.json();
    if (!build || build === myBuild) return;
    const typing = [...document.querySelectorAll('textarea, input[type="text"], input:not([type])')].some((el) => el.value && el.value.trim());
    if (typing) return;
    location.reload();
  } catch { /* offline: try next time */ }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenAt = Date.now(); else checkForUpdate(); });
// Also check now and then while it's open (every 30 minutes).
setInterval(() => { if (!document.hidden) checkForUpdate(true); }, 30 * 60000);

(async function boot() {
  push.registerWorker();
  try {
    await api.init();
    startAvatars();
    await api.detectFeatures();
    const hash = new URLSearchParams(location.hash.slice(1));
    let linkError = hash.get('error_description');
    state.recovering = hash.get('type') === 'recovery';
    // Email links (verify, reset password) come straight here with a one-time code, so emails only
    // ever link to treehouse's own address. Confirm the code to sign the person in.
    const query = new URLSearchParams(location.search);
    const tokenHash = query.get('token_hash');
    const linkType = query.get('type');
    if (tokenHash && ['email', 'signup', 'recovery', 'email_change'].includes(linkType)) {
      const err = await api.verifyEmailLink(tokenHash, linkType);
      if (err) linkError = /expired|invalid/i.test(err.message || '') ? 'This link has expired or was already used. Request a new one.' : (err.message || 'That link didn’t work.');
      else {
        if (linkType === 'recovery') state.recovering = true;
        // Now signed in: re-check features (the first check ran signed out and finds none).
        await api.detectFeatures();
      }
    }
    // A dating card on someone's link page sends people here with ?to=<handle>
    const to = new URLSearchParams(location.search).get('to');
    if (to && /^[A-Za-z]+ [A-Za-z]+ \d{3}$/.test(to)) store.set('hy-like-target', to);
    const s = await api.session();
    if (location.hash || location.search) history.replaceState(null, '', location.pathname);
    state.user = s ? s.user : null;
    if (linkError && !state.user) store.set('hy-auth-error', linkError);
    if (state.user && !state.recovering) await loadAll();
    render();
    if (state.user && !state.recovering) { startLive(); ensureTerms(); offerLikeTarget(); }
    api.sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') { state.recovering = true; render(); }
      if (event === 'SIGNED_OUT') { state.user = null; state.profile = null; render(); }
    });
  } catch (e) {
    root.replaceChildren(h('div', { class: 'loading-screen' }, emptyState('😵‍💫', 'Can’t load treehouse', api.friendly(e),
      h('button', { class: 'btn btn-dark', onclick: () => location.reload() }, 'Try again'))));
  }
})();

export { emit };
