'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// The member app shell (port of anon-inbox/public/hy-app.js): start-up, sign-in gate, navigation
// (bottom bar on phones, sidebar on desktop), live updates, Terms of Use check.
import { loadRoomBan } from './RoomBan';
import { startActivity } from './Reputation';
import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as api from '@/lib/api';
import { state, emit, useAppState, loadAll, loadDating, patchChat, closeChatLocal, inboxBadge, newNotifCount, unreadChats, messageRequests } from '@/lib/state';
import { setRouter, go, openChat } from '@/lib/nav';
import * as push from '@/lib/push';
import * as inst from '@/lib/install';
import { store } from '@/lib/util';
import { Icon, Logo, EmptyState } from './ui';
import { OverlayHost, openSheet, toast } from './overlay';
import { Landing, NewPassword, Underage } from './Auth';
import Onboarding from './Onboarding';
import ForceUpdate from './ForceUpdate';
import { deliverToOpenChat } from './chatBus';
import { connectWaiting, rememberConnect } from '@/lib/kickrs';
import { loadAnnUnread } from '@/lib/announcements';

// Discover sits in the raised centre, Games next to it. Profile is your avatar at the top right of
// every screen (and the last item in the desktop sidebar).
const TABS: { route: string; label: string; icon: string; center?: boolean; badge?: boolean; sideOnly?: boolean }[] = [
  { route: 'home', label: 'Home', icon: 'home' },
  { route: 'rooms', label: 'Chatrooms', icon: 'rooms' },
  { route: 'discover', label: 'Discover', icon: 'flame', center: true },
  { route: 'games', label: 'Games', icon: 'gamepad' },
  { route: 'matches', label: 'Inbox', icon: 'mail', badge: true },
  { route: 'profile', label: 'Profile', icon: 'user', sideOnly: true },
];
const TITLES: Record<string, string> = { rooms: 'Chatrooms', home: 'Home', games: 'Games', discover: 'Discover', matches: 'Inbox', profile: 'Profile', notifications: 'Notifications', connect: 'Kickrs', admin: 'Admin' };

export function applyTheme(t: string = store.get('hy-theme', 'system') || 'system') {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

function LoadingScreen() {
  return (
    <div className="loading-screen" aria-busy="true" aria-label="Loading treehouse">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="logo-mark" src="/treehouse-mark.svg" alt="" width={72} height={72} />
      <span className="wordmark">treehouse<i className="dot" /></span>
    </div>
  );
}

export default function App({ children }: { children: ReactNode }) {
  const s = useAppState();
  const router = useRouter();
  const pathname = usePathname() || '/home';
  useEffect(() => { setRouter(router); }, [router]);
  useEffect(() => { boot(); }, []);

  let screen: ReactNode;
  if (!s.booted) screen = s.bootError
    ? <div className="loading-screen"><EmptyState emoji="😵‍💫" title="Can’t load treehouse" text={s.bootError}><button className="btn btn-dark" onClick={() => location.reload()}>Try again</button></EmptyState></div>
    : <LoadingScreen />;
  else if (s.user && s.recovering) screen = <NewPassword />;
  else if (!s.user) screen = <Landing />;
  else if (!s.profile || s.onboarding) screen = <Onboarding />;
  else if (s.profile.dob_underage_at) screen = <Underage />;
  else screen = <Shell pathname={pathname}>{children}</Shell>;

  return <div id="app">{screen}<OverlayHost /><ForceUpdate /></div>;
}

function Shell({ pathname, children }: { pathname: string; children: ReactNode }) {
  useAppState();
  const tab = pathname.replace(/^\/home\/?/, '').split('/')[0] || 'home';
  const lastTab = useRef<string | null>(null);
  const badge = inboxBadge();
  const bell = newNotifCount();

  useEffect(() => {
    document.body.classList.toggle('dark-screen', tab === 'discover');
    const unread = unreadChats() + state.requests.length + messageRequests().length;
    document.title = `${unread ? `(${unread}) ` : ''}${TITLES[tab] || 'Home'} · treehouse`;
    const n: any = navigator;
    if ('setAppBadge' in n) (unread ? n.setAppBadge(unread) : n.clearAppBadge()).catch(() => {});
    if (lastTab.current !== tab) { window.scrollTo(0, 0); lastTab.current = tab; }
  });
  useEffect(() => () => document.body.classList.remove('dark-screen'), []);
  useEffect(() => { if (tab !== 'connect' && connectWaiting()) go('connect/kickrs', { replace: true }); }, [tab]);

  const item = (t: typeof TABS[number], side: boolean) => {
    const n = t.badge ? badge : 0;
    const cls = side ? `side-item${t.center ? ` side-center side-${t.route}` : ''}` : `nav-item${t.center ? ` nav-center nav-${t.route}` : ''}`;
    return (
      <Link key={t.route} href={`/home${t.route === 'home' ? '' : '/' + t.route}`} className={cls} aria-current={tab === t.route ? 'page' : undefined}>
        {t.center && !side ? <span className="nav-orb"><Icon name={t.icon} /></span> : <Icon name={t.icon} />}
        <span>{t.label}</span>
        <span className="badge" data-n={String(n)}>{n ? (n > 99 ? '99+' : n) : ''}</span>
      </Link>
    );
  };
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <Logo />
        {TABS.map((t) => item(t, true))}
        <div className="side-foot">
          <Link className="side-item" href="/home/notifications"><Icon name="bell" /><span>Notifications</span><span className="badge" data-n={String(bell)}>{bell || ''}</span></Link>
          <p className="tiny" style={{ padding: '0 14px' }}>Anonymous users. Real connections. Identities stay hidden until both people agree.</p>
        </div>
      </nav>
      <div className="shell-body"><main className="main" id="main" tabIndex={-1}><div className="screen" key={tab}>{children}</div></main></div>
      <nav className="bottom-nav" aria-label="Main">{TABS.filter((t) => !t.sideOnly).map((t) => item(t, false))}</nav>
    </div>
  );
}

// ---- Start-up --------------------------------------------------------------------------------------
let booting = false;
async function boot() {
  if (booting) return;
  booting = true;
  applyTheme();
  push.registerWorker();
  inst.watchInstall();
  inst.onChange(() => emit('push'));   // the browser's install offer can arrive any time
  watchServiceWorker();
  watchForUpdates();
  rememberConnect();
  try {
    await api.init();
    const hash = new URLSearchParams(location.hash.slice(1));
    let linkError = hash.get('error_description');
    state.recovering = hash.get('type') === 'recovery';
    // Email links (verify, reset password) arrive with a one-time code: confirm it to sign in.
    const query = new URLSearchParams(location.search);
    const tokenHash = query.get('token_hash');
    const linkType = query.get('type');
    if (tokenHash && linkType && ['email', 'signup', 'recovery', 'email_change'].includes(linkType)) {
      const err: any = await api.verifyEmailLink(tokenHash, linkType);
      if (err) linkError = /expired|invalid/i.test(err.message || '') ? 'This link has expired or was already used. Request a new one.' : (err.message || 'That link didn’t work.');
      else if (linkType === 'recovery') state.recovering = true;
    }
    const to = query.get('to');
    if (to && /^[A-Za-z]+ [A-Za-z]+ \d{3}$/.test(to)) store.set('hy-like-target', to);
    const sess = await api.session();
    if ((location.hash || location.search) && !query.get('signedout') && !query.get('empty')) history.replaceState(null, '', location.pathname);
    state.user = sess ? sess.user : null;
    if (linkError && !state.user) store.set('hy-auth-error', linkError);
    if (state.user && !state.recovering) await loadAll();
    state.booted = true;
    (window as any).__thBooted = true; // eslint-disable-line @typescript-eslint/no-explicit-any
    emit('all');
    if (state.user && !state.recovering) { startLive(); ensureTerms(); }
    api.sb.auth.onAuthStateChange((event: string) => {
      if (event === 'PASSWORD_RECOVERY') { state.recovering = true; emit('all'); }
      if (event === 'SIGNED_OUT') { state.user = null; state.profile = null; emit('all'); }
    });
  } catch (e) {
    (window as any).__thBooted = true; // eslint-disable-line @typescript-eslint/no-explicit-any
    state.bootError = api.friendly(e);
    emit('all');
  }
}

export async function afterSignIn() {
  const sess = await api.session();
  state.user = sess ? sess.user : null;
  if (!state.user) { emit('all'); return; }
  await loadAll();
  emit('all');
  startLive();
  ensureTerms();
}

let live = false;
function startLive() {
  startActivity();
  if (live || !state.profile) return;
  live = true;
  // Push notifications: find out if they're set up, and keep this device linked to this account.
  push.available().then((ok) => { if (ok) { emit('push'); push.sync(); } });
  // The server nudges this device when something new arrives; at most one full refresh every 20 s.
  let nudgeTimer: ReturnType<typeof setTimeout> | null = null, lastNudgeLoad = 0;
  api.onInboxNudge(state.user.id, (n) => {
    if (n.k === 'closed' && n.c) {
      closeChatLocal(n.c);
      if (state.openChat === n.c) go('matches', { replace: true });
      return;
    }
    if (n.k === 'message' && n.c) {
      if (n.m) deliverToOpenChat(n.c, { conversation_id: n.c, created_at: n.at, reply_to: null, edited_at: null, deleted_at: null, ...n.m });
      const open = state.openChat === n.c && !document.hidden;
      if (patchChat(n.c, { body: n.b != null ? n.b : n.m ? String(n.m.body || '').slice(0, 200) : '', at: n.at, fromMe: false, countUnread: !open, theyreOnline: true })) return;
    }
    // A friend changed their status: fetch just the statuses, not the whole chat list.
    if (n.k === 'status') {
      api.friendStatuses().then((fs: any[]) => { state.friendStatus = Object.fromEntries(fs.map((f: any) => [f.conversation_id, f])); emit('status'); }).catch(() => {});
      return;
    }
    if (nudgeTimer) return;
    const wait = Math.max(1500, 45000 - (Date.now() - lastNudgeLoad));
    nudgeTimer = setTimeout(() => { nudgeTimer = null; lastNudgeLoad = Date.now(); if (!document.hidden) loadDating({ force: true }); }, wait);
  });
  setInterval(() => { if (!document.hidden) loadDating(); }, 600000);
  // Chatrooms kick people inactive for 10 minutes; while treehouse is on screen, keep the seat.
  const roomBeat = async () => {
    if (document.hidden || state.inRoom === false) return;
    try {
      const st = await api.roomHeartbeat();
      if (st) { state.inRoom = true; return; }
      const wasIn = state.inRoom === true;
      state.inRoom = false;
      if (wasIn && !location.pathname.startsWith('/home/rooms')) { if (await loadRoomBan()) toast('You’ve been banned from chatrooms. Open Chatrooms to see why.', 'logout'); else toast('You were kicked out of your chatroom for inactivity', 'logout'); }
    } catch {}
  };
  setInterval(roomBeat, 180000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { roomBeat(); loadDating({ minGap: 120000 }); } });
}

// Tapping a notification while treehouse is open: the background worker asks us to open that screen.
function watchServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'treehouse-open' || !state.user) return;
    const path = new URL(e.data.url, location.origin).pathname.replace(/^\/home\/?/, '');
    const chat = path.match(/^matches\/([0-9a-f-]{36})$/);
    if (chat) openChat(chat[1]); else go(path || 'home');
    if (path.startsWith('matches/announcements')) loadAnnUnread({ force: true });
  });
}

// New version? Reload by itself. Phones keep the page open for days; when treehouse comes back to the
// screen after a minute or more (or every 30 minutes), ask which version is live and reload if it's
// newer, unless someone is typing.
const MY_BUILD = process.env.NEXT_PUBLIC_BUILD || '';
function watchForUpdates() {
  if (!MY_BUILD || process.env.NODE_ENV !== 'production') return;
  let hiddenAt = 0, lastCheck = Date.now();
  const check = async (force = false) => {
    if (!force && Date.now() - hiddenAt < 60000 && Date.now() - lastCheck < 30 * 60000) return;
    lastCheck = Date.now();
    try {
      const r = await fetch('/home-build', { cache: 'no-store' });
      const { build } = await r.json();
      if (!build || build === MY_BUILD) return;
      const typing = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('textarea, input[type="text"], input:not([type])')].some((el) => el.value && el.value.trim());
      if (!typing) location.reload();
    } catch { /* offline: try next time */ }
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenAt = Date.now(); else check(); });
  setInterval(() => { if (!document.hidden) check(true); }, 30 * 60000);
}

// Everyone must agree to the Terms of Use; people who joined earlier are asked once.
let termsOpen = false;
async function ensureTerms() {
  const u = state.user;
  if (!u || termsOpen || state.recovering) return;
  if ((u.user_metadata && u.user_metadata.terms_accepted_at) || store.get('hy-terms-ok') === u.id) return;
  const g = store.get<number>('hy-google-terms');
  if (g && Date.now() - g < 2 * 3600 * 1000) {
    store.del('hy-google-terms');
    try { const user = await api.acceptTerms(); if (user) state.user = user; store.set('hy-terms-ok', u.id); return; } catch {}
  }
  termsOpen = true;
  let agreed = false;
  openSheet((close) => (
    <>
      <h2>Our Terms of Use</h2>
      <p className="muted">To keep treehouse safe, everyone agrees to the same rules. There’s zero tolerance for objectionable content or abusive users: harassment, sexual content, hate, scams and anything involving minors are removed, and so are the people who post them.</p>
      <p className="muted">You can report, block or hide anyone at any time, and we act on reports within 24 hours.</p>
      <p><a href="/terms" target="_blank" rel="noopener">Read the Terms of Use</a> · <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a></p>
      <div className="sheet-actions">
        <button className="btn btn-primary btn-block" onClick={async (e) => {
          e.currentTarget.disabled = true;
          try { const user = await api.acceptTerms(); if (user) state.user = user; } catch {}
          store.set('hy-terms-ok', u.id);
          agreed = true; close(); toast('Thanks for keeping treehouse safe', 'shield');
        }}>I agree</button>
        <button className="btn btn-soft btn-block" onClick={async () => { agreed = true; close(); await api.signOut(); location.reload(); }}>I don’t agree (sign out)</button>
      </div>
    </>
  ), { label: 'Terms of Use', onClose: () => { termsOpen = false; if (!agreed) setTimeout(ensureTerms, 0); } });
}
