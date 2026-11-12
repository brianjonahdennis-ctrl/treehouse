// Chatrooms: one public room per Nigerian state, up to 200 people, one room at a time.
// Everyone appears under the anonymous name treehouse gave them. Layout follows the treehouse
// chatroom design: state list → room (logo bar, room pill with members dropdown, banner, reactions) → members page → profile card.

import * as api from './hy-api.js';
import { h, icon, toast, sheet, confirmSheet, emptyState, hash, initials, clock, dayLabel, store, shareOrCopy, logo, hero } from './hy-ui.js';
import { state, go, nav, stateLabel, statusOf, GENDER_LABEL, GENERAL_ROOMS, UNI_ROOMS, LANDMARKS, roomName, ageRoomBlock } from './hy-state.js';
import { fitChatToViewport, keepKeyboardOnSend, composeTo } from './hy-dating.js';
import { askBirthday } from './hy-onboard.js';

const CAPACITY = 200;
const capOf = (r) => r.capacity || (GENERAL_ROOMS[r.state] ? 500 : UNI_ROOMS[r.state] ? 300 : CAPACITY);
const NATIONAL = 'Nigeria';
const EMOJI = ['❤️', '👍', '🔥', '😂', '😮', '😢'];
const REPORT_REASONS = [['harassment', 'Harassment or bullying'], ['inappropriate', 'Sexual or inappropriate'], ['spam', 'Spam or scam'],
  ['underage', 'Seems under 18'], ['other', 'Something else']];
const NAME_COLORS = ['#ff5fa2', '#c084fc', '#38bdf8', '#34d399', '#fbbf24', '#fb7185', '#a78bfa', '#22d3ee', '#f97316', '#4ade80'];
const nameColor = (handle) => NAME_COLORS[hash(handle) % NAME_COLORS.length];
const roomPath = (s) => `rooms/${encodeURIComponent(s)}`;
const roomTitle = (s) => roomName(s);
const shortTitle = (s) => (GENERAL_ROOMS[s] ? GENERAL_ROOMS[s].name : UNI_ROOMS[s] ? s : s === 'FCT' ? 'Abuja (FCT)' : stateLabel(s));
const blocked = () => new Set(store.get('hy-room-blocked', []));
// Messages you've hidden or reported disappear from your view straight away (kept on this device).
const hiddenMsgs = () => new Set(store.get('hy-room-hidden', []));
function hideMsg(id) {
  const s = hiddenMsgs(); s.add(id); store.set('hy-room-hidden', [...s].slice(-500));
  dropRow(id);
}
function dropRow(id) {
  document.querySelectorAll(`.rmsg[data-id="${id}"]`).forEach((row) => row.remove());
  if (room && room.messages) room.messages.delete(id);
}
// Block someone: hidden on this device right away, and on the server so it follows your account.
async function blockHandle(handle, msgId) {
  const b = blocked(); b.add(handle); store.set('hy-room-blocked', [...b]);
  document.querySelectorAll('.rmsg').forEach((row) => { if (row.dataset.handle === handle) row.remove(); });
  if (msgId) api.blockRoomSender(msgId).catch(() => {});
  if (room && room.loadPeople) room.loadPeople();
  toast(`${handle} is blocked`, 'ban');
}
const SUPPORT_EMAIL = 'support@treehouse.ng';
// An existing chat (friend or otherwise) with this person, so we open it instead of a new request.
const friendChat = (handle) => state.convos.find((c) => c.other_handle === handle && !c.blocked) || null;

let rooms = null;
let loadingList = null;
let kick = null;          // { state, kicked_at } when you were kicked out of a room for inactivity
let rejoinFor = null;     // "Join again" was tapped for this room: skip the kicked screen once
let query = '';
const myRoom = () => (rooms || []).find((r) => r.mine);
const isOnline = (p) => p.online !== false;   // older servers don't send it: treat as online

// Avatar for an anonymous name: initials on a colour from the name.
function personAvatar(handle, cls = '') {
  return h('span', { class: `room-av ${cls}`.trim(), style: { '--c': nameColor(handle) }, 'data-av-handle': handle }, initials(handle));
}

// ---- Chatrooms list ---------------------------------------------------------------------------
async function refreshList(target) {
  // Opening the list counts as being around, so you stay "online" and keep your place in your room.
  api.roomHeartbeat().catch(() => {});
  loadingList = loadingList || api.roomList().finally(() => { loadingList = null; });
  const kickCheck = api.myRoomKick().catch(() => null);
  try { rooms = await loadingList; kick = await kickCheck; if (myRoom()) kick = null; state.inRoom = !!myRoom(); }
  catch (e) {
    if (target) target.replaceChildren(/could not find the function/i.test(e.message || '')
      ? emptyState('🚧', 'Chatrooms are opening soon', 'Check back in a little while.')
      : emptyState('📡', 'Couldn’t load chatrooms', api.friendly(e)));
    return;
  }
  if (target && target.isConnected) target.replaceChildren(roomRows());
  if (target && target.isConnected && target.onRooms) target.onRooms();
}
const onlineOf = (r) => (r.online ?? r.people);
// WhatsApp-style counter for your own room while you're outside it.
const unreadBadge = (r) => (r.mine && r.unread > 0
  ? h('span', { class: 'cr-unread', 'aria-label': `${r.unread} unread message${r.unread === 1 ? '' : 's'}` }, r.unread > 999 ? '999+' : String(r.unread))
  : null);

// Short code for each state's badge (LA, FCT, AK…), and a stable colour.
const stateCode = (s) => (s === NATIONAL ? 'NG' : s === 'FCT' ? 'FCT' : s.includes(' ') ? s.split(' ').map((w) => w[0]).join('').toUpperCase() : s.slice(0, 2).toUpperCase());
const recentRooms = () => store.get('hy-room-recent', []).filter((s) => (rooms || []).some((r) => r.state === s));
const rememberRoom = (s) => store.set('hy-room-recent', [s, ...store.get('hy-room-recent', []).filter((x) => x !== s)].slice(0, 6));
// Original university crests (our own design, not official logos): a shield in two colours with the
// university's short name. Each university always gets the same colours.
const UNI_PALETTES = [['#1e3a8a', '#f5b301'], ['#065f46', '#fcd34d'], ['#7f1d1d', '#fbbf24'], ['#4c1d95', '#f9a8d4'], ['#0e7490', '#fde68a'],
  ['#14532d', '#bef264'], ['#1d4ed8', '#e0f2fe'], ['#9a3412', '#fed7aa'], ['#0f172a', '#7dd3fc'], ['#831843', '#fde047'], ['#134e4a', '#99f6e4'], ['#3f3f46', '#fbbf24']];
function uniBadge(code, cls = '') {
  const [bg, fg] = UNI_PALETTES[hash(code) % UNI_PALETTES.length];
  const label = code.replace(/[^A-Za-z]/g, '').toUpperCase();
  const size = label.length <= 2 ? 14 : label.length === 3 ? 12.5 : label.length === 4 ? 10.5 : label.length === 5 ? 8.6 : label.length === 6 ? 7.2 : label.length === 7 ? 6.3 : 5.6;
  const svg = `<svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
    <path d="M24 3 L42 9 V23 C42 34 34 41.5 24 45 C14 41.5 6 34 6 23 V9 Z" fill="${bg}"/>
    <path d="M24 6.5 L39 11.4 V23 C39 32.4 32.2 38.8 24 41.8 C15.8 38.8 9 32.4 9 23 V11.4 Z" fill="none" stroke="${fg}" stroke-width="1.4" opacity=".85"/>
    <path d="M17 15.5 L24 12.5 L31 15.5 L24 18.5 Z M20 17 V20.2 C22 21.6 26 21.6 28 20.2 V17" fill="${fg}"/>
    <text x="24" y="${30.5 + size * 0.36}" text-anchor="middle" font-family="Bricolage Grotesque, Plus Jakarta Sans, system-ui, sans-serif" font-weight="800" font-size="${size}" fill="#fff" letter-spacing="0">${label}</text>
  </svg>`;
  return h('span', { class: `st-badge crest ${cls}`.trim(), html: svg });
}

function stateBadge(st, cls = '') {
  if (UNI_ROOMS[st]) return uniBadge(st, cls);
  // States: a small photo of the state's best-known landmark (credits at /photo-credits).
  if (LANDMARKS[st]) return h('span', { class: `st-badge photo ${cls}`.trim(), role: 'img', 'aria-label': LANDMARKS[st].name, title: LANDMARKS[st].name,
    style: { backgroundImage: `url(/img/landmarks/${LANDMARKS[st].file})` } });
  if (GENERAL_ROOMS[st]) return h('span', { class: `st-badge emoji ${cls}`.trim(), style: { '--c': NAME_COLORS[hash(st) % NAME_COLORS.length] } }, GENERAL_ROOMS[st].emoji);
  return h('span', { class: `st-badge ${cls}`.trim(), style: { '--c': NAME_COLORS[hash(st) % NAME_COLORS.length] } }, stateCode(st));
}

function roomRows() {
  const home = state.profile && state.profile.state;
  const own = rooms.find((r) => !GENERAL_ROOMS[r.state] && !UNI_ROOMS[r.state]);
  const unis = rooms.filter((r) => UNI_ROOMS[r.state]);
  const open = rooms.filter((r) => GENERAL_ROOMS[r.state] && GENERAL_ROOMS[r.state].tag === 'Everyone');
  const ages = rooms.filter((r) => GENERAL_ROOMS[r.state] && GENERAL_ROOMS[r.state].ages);
  const just = rooms.filter((r) => GENERAL_ROOMS[r.state] && GENERAL_ROOMS[r.state].tag !== 'Everyone' && !GENERAL_ROOMS[r.state].ages);
  const myAge = state.profile && Number(state.profile.age);
  const section = (title, sub, list) => (list.length ? h('section', {}, h('div', { class: 'section-head' }, h('h2', {}, title), h('span', { class: 'small muted' }, sub)),
    h('div', { class: 'cr-list' }, list.map(row))) : null);
  return h('div', { class: 'cr-sections' },
    section('Your state', 'Only people in your state', own ? [own] : []),
    section('Universities', own ? `In ${shortTitle(own.state)}` : 'In your state', unis),
    !home ? h('p', { class: 'small muted center' }, 'Add your state to your dating card to unlock your state’s chatroom.') : null,
    section('Open to everyone', 'Across Nigeria', open),
    ageSection(),
    section('Just for you', just.length && GENERAL_ROOMS[just[0].state].tag, just),
    h('p', { class: 'tiny muted center' }, 'You can be in one chatroom at a time. Inactive for 10 minutes? You’re kicked out and can join again. Your state can change once every 30 days, your date of birth once every 365 days, and your gender once every 90 days.'));

  // Age rooms: blurred until you've added your date of birth, then open for your age only.
  function ageSection() {
    if (!ages.length) return null;
    if (state.profile && state.profile.birth_date) return section('Age groups', 'Join the one for your age', ages);
    return h('section', {}, h('div', { class: 'section-head' }, h('h2', {}, 'Age groups'), h('span', { class: 'small muted' }, 'Add your date of birth to join')),
      h('div', { class: 'age-lock' },
        h('div', { class: 'cr-list age-blur', 'aria-hidden': 'true', inert: '' }, ages.map(row)),
        h('div', { class: 'age-lock-card' },
          h('span', { class: 'age-lock-ico' }, '🎂'),
          h('b', {}, 'Rooms for your age group'),
          h('p', {}, 'Add your date of birth to join the age room for you. It’s private.'),
          h('button', { class: 'btn btn-primary btn-sm', onclick: () => askBirthday(() => nav.rerender()) }, 'Add date of birth'))));
  }

  function row(r) {
    const full = r.people >= capOf(r) && !r.mine;
    const g = GENERAL_ROOMS[r.state];
    // Age rooms you don't fit: still listed, with a lock; tapping says why instead of opening it.
    const blocked = !r.mine && state.profile && state.profile.birth_date && ageRoomBlock(r.state, myAge);
    return h('button', { class: `cr-row ${r.mine ? 'mine' : ''} ${blocked ? 'locked' : ''}`, disabled: full, 'aria-disabled': blocked ? 'true' : null,
      onclick: () => (blocked ? toast(blocked, 'lock') : enter(r.state)) },
      stateBadge(r.state),
      h('span', { class: 'grow' },
        h('b', {}, shortTitle(r.state),
          r.mine ? h('span', { class: 'cr-tag' }, 'You’re here') : g ? (g.ages ? (blocked ? null : h('span', { class: 'cr-tag soft' }, 'Your age')) : g.tag !== 'Everyone' ? h('span', { class: 'cr-tag soft' }, g.tag) : null) : UNI_ROOMS[r.state] ? null : h('span', { class: 'cr-tag soft' }, icon('pin', 'sm'), 'Your state')),
        g ? h('span', { class: 'cr-blurb' }, g.blurb) : UNI_ROOMS[r.state] ? h('span', { class: 'cr-blurb' }, UNI_ROOMS[r.state].name) : null,
        h('span', { class: 'cr-online' }, onlineOf(r) ? h('i') : h('i', { class: 'off' }),
          full ? `Full (${capOf(r)} people)` : `${onlineOf(r).toLocaleString()} online · ${r.people.toLocaleString()} member${r.people === 1 ? '' : 's'}`)),
      unreadBadge(r),
      h('span', { class: 'chev' }, icon(blocked ? 'lock' : 'chev', 'sm')));
  }
}

export function renderRooms() {
  const listEl = h('div', {}, rooms ? roomRows() : h('div', { class: 'cr-list' }, Array.from({ length: 7 }, () => h('div', { class: 'skeleton', style: { height: '64px', borderRadius: '16px' } }))));
  refreshList(listEl);
  const redrawList = () => { if (rooms) listEl.replaceChildren(roomRows()); };
  // Keep counts fresh while the list is on screen.
  const tick = setInterval(() => { if (!listEl.isConnected) clearInterval(tick); else if (!document.hidden && !api.backingOff()) refreshList(listEl); }, 60000);
  const current = h('div');
  const drawCurrent = () => {
    const mine = myRoom();
    if (!mine && kick) {
      current.replaceChildren(h('div', { class: 'cr-kicked', role: 'status' },
        h('span', { class: 'cr-kicked-ico' }, '🚪'),
        h('span', { class: 'grow' }, h('b', {}, `You were kicked out of ${roomTitle(kick.state)} for inactivity`),
          h('span', {}, 'Rooms remove people who are inactive for 10 minutes.')),
        h('span', { class: 'cr-kicked-actions' },
          h('button', { class: 'btn btn-white btn-sm', onclick: () => { rejoinFor = kick.state; go(roomPath(kick.state)); } }, 'Join again'),
          h('button', { class: 'btn btn-glass btn-sm', onclick: () => { api.dismissRoomKick(); kick = null; drawCurrent(); } }, 'Dismiss'))));
      return;
    }
    current.replaceChildren(...(mine ? [h('button', { class: 'cr-current', onclick: () => go(roomPath(mine.state)) },
      stateBadge(mine.state, 'on-dark'),
      h('span', { class: 'grow' }, h('small', {}, 'Your chatroom'), h('b', {}, roomTitle(mine.state)),
        h('span', {}, mine.unread > 0 ? `${mine.unread > 999 ? '999+' : mine.unread} new message${mine.unread === 1 ? '' : 's'} · tap to catch up` : `${onlineOf(mine)} online · tap to keep chatting`)),
      unreadBadge(mine) || icon('chev', 'sm'))] : []));
  };
  drawCurrent();
  listEl.onRooms = drawCurrent;
  return h('div', { class: 'stack-lg cr-screen' },
    hero({ title: 'Chatrooms', sub: 'Your state’s room, plus rooms for all of Nigeria. One room at a time.', actions: [nav.bell ? nav.bell() : null].filter(Boolean) },
      current),
    h('div', { class: 'below-hero' }, listEl));
}

async function enter(target) {
  const mine = myRoom();
  if (mine && mine.state !== target) {
    const ok = await confirmSheet({ title: `Move to ${roomTitle(target)}?`, text: `You’ll leave ${roomTitle(mine.state)}. You can be in one chatroom at a time.`, yes: 'Move' });
    if (!ok) return;
  }
  go(roomPath(target));
}

// ---- Inside a room ----------------------------------------------------------------------------
let room = null;
// The room you closed without leaving, kept in memory (never saved on the phone) so opening it again
// shows the chat straight away while the server catches up in the background.
let kept = null;
const KEEP = ['id', 'handle', 'body', 'created_at', 'mine', 'reactions', 'my_reactions', 'reply_to', 'reply_handle', 'reply_body'];

export function closeRoom() {
  if (!room) return;
  kept = room.handle && !room.left && room.joined ? { state: room.state, joined: room.joined, at: Date.now(),
    msgs: [...room.messages.values()].slice(-60).map((m) => Object.fromEntries(KEEP.map((k) => [k, m[k]]))) } : null;
  if (room.handle && !room.left) api.roomMarkRead().catch(() => {});
  clearTimeout(room.readTimer);
  room.channel && room.channel.leave();
  clearInterval(room.timer);
  clearInterval(room.poll);
  room.unfit && room.unfit();
  document.removeEventListener('visibilitychange', room.onVisible);
  room.el.remove();
  room = null;
  document.body.style.overflow = '';
}

export async function openRoom(target) {
  if (room && room.state === target) return;
  closeRoom();
  const el = h('section', { class: 'chat room', 'aria-label': `${roomTitle(target)} chatroom` });
  room = { state: target, el, messages: new Map() };
  const mine = room;
  document.body.append(el);
  document.body.style.overflow = 'hidden';
  el.append(h('div', { class: 'chat-head' }, h('div', { class: 'spinner' })));

  // Coming back to a room you're still in (closed without leaving): one trip to the server instead of
  // three. No kick check (you're still a member), and the messages load at the same time as the join.
  // Only while you'd still be a member: closed rooms stop sending "I'm here", and after 10 minutes
  // you're out (and must not see older messages when you come back).
  const cached = kept && kept.state === target && Date.now() - kept.at < 8 * 60000 ? kept : null;
  kept = null;
  const still = !!cached || !!(myRoom() && myRoom().state === target);
  const early = still ? api.roomHistory().catch(() => null) : null;
  // Kicked out of this room for inactivity: say so, and only join again when they choose to.
  if (!still && rejoinFor !== target) {
    const k = await api.myRoomKick().catch(() => null);
    if (room !== mine) return;
    if (k && k.state === target) {
      kick = k;
      el.replaceChildren(h('div', { class: 'empty room-kicked', style: { margin: 'auto' } }, h('div', { class: 'empty-art' }, h('span', {}, '🚪')),
        h('h3', {}, 'You were kicked out of this room for inactivity'),
        h('p', {}, `You were inactive in ${roomTitle(target)} for more than 10 minutes. Join again to keep chatting.`),
        h('div', { class: 'row center-row' },
          h('button', { class: 'btn btn-primary', onclick: () => { rejoinFor = target; closeRoom(); openRoom(target); } }, 'Join again'),
          h('button', { class: 'btn btn-soft', onclick: () => go('rooms', { replace: true }) }, 'Back to chatrooms'))));
      return;
    }
  }
  rejoinFor = null;
  let joined;
  if (cached) {
    // Show the room at once from what was on screen; the join (which also says "I'm here") runs alongside.
    const top = cached.msgs.reduce((a, m) => Math.max(a, Number(m.id) || 0), 0);
    joined = { ...cached.joined, rejoined: true, last_read_id: top };
    api.joinRoom(target).then((j) => {
      if (room !== mine || !j) return;
      // You'd been dropped after all: start the room fresh, without the old messages.
      if (!j.rejoined) { room.left = true; rejoinFor = target; closeRoom(); kept = null; openRoom(target); return; }
      room.joined = j;
      if (room.setCount) room.setCount(j.people);
    }).catch((e) => {
      if (room !== mine) return;
      toast(api.friendly(e), 'x');
      go('rooms', { replace: true });
    });
  } else try { joined = await api.joinRoom(target); }
  catch (e) {
    if (room !== mine) return;
    el.replaceChildren(h('div', { class: 'empty', style: { margin: 'auto' } }, h('div', { class: 'empty-art' }, h('span', {}, '🚪')),
      h('h3', {}, `Can’t join ${roomTitle(target)}`), h('p', {}, api.friendly(e)),
      /date of birth/i.test(api.friendly(e))
        ? h('button', { class: 'btn btn-primary', onclick: () => askBirthday(() => { closeRoom(); openRoom(target); }) }, 'Add date of birth')
        : null,
      h('button', { class: `btn ${/date of birth/i.test(api.friendly(e)) ? 'btn-soft' : 'btn-primary'}`, onclick: () => go('rooms', { replace: true }) }, 'Back to chatrooms')));
    return;
  }
  if (room !== mine) return;
  room.handle = joined.handle;
  room.joined = joined;
  kick = null;
  state.inRoom = true;
  rememberRoom(target);
  rooms = (rooms || []).map((r) => ({ ...r, mine: r.state === target, unread: 0, people: r.state === target ? joined.people : r.people }));
  // Everything on screen counts as read (a few seconds after it arrives, batched).
  const markRead = (soon = 4000) => {
    if (room !== mine || document.hidden) return;
    clearTimeout(room.readTimer);
    room.readTimer = setTimeout(() => { if (room === mine && !document.hidden) api.roomMarkRead().catch(() => {}); }, soon);
  };

  // Header: treehouse bar, then the room pill that opens the members dropdown.
  const countEl = h('span', {}, `${joined.people.toLocaleString()} ${joined.people === 1 ? 'member' : 'members'}`);
  room.setCount = (n) => { countEl.textContent = `${n.toLocaleString()} ${n === 1 ? 'member' : 'members'}`; };
  const pill = h('button', { class: 'room-pill', 'aria-expanded': 'false', 'aria-label': 'Show members', onclick: () => toggleDrop() },
    h('span', { class: 'cr-group' }, icon('rooms')),
    h('span', { class: 'grow' }, h('b', { class: 'ellipsis' }, roomTitle(target)), h('span', { class: 'rp-count' }, h('i'), countEl)),
    h('span', { class: 'rp-chev' }, icon('chev', 'sm')));
  const head = h('div', { class: 'room-head2' },
    h('div', { class: 'room-topbar' },
      h('button', { class: 'plain-btn', 'aria-label': 'Back', onclick: () => go('rooms') }, icon('back')),
      logo(),
      h('span', { class: 'grow' }),
      nav.bell ? nav.bell() : null,
      h('button', { class: 'plain-btn', 'aria-label': 'Room options', onclick: roomMenu }, icon('more'))),
    pill);

  // Welcome banner (dismissible, remembered per room)
  const bannerKey = `hy-room-banner-${target}`;
  const banner = store.get(bannerKey, false) ? null : h('div', { class: 'room-banner' },
    h('span', { class: 'rb-pin' }, icon('pushpin', 'sm')),
    h('p', {}, GENERAL_ROOMS[target] || UNI_ROOMS[target] ? `Welcome to ${roomTitle(target)}! You’re ` : `Welcome to ${roomTitle(target)} chatroom! You’re `, h('b', { style: { color: nameColor(joined.handle) } }, joined.handle),
      '. Be respectful, keep it fun and meet new people 💙'),
    h('button', { class: 'plain-btn', 'aria-label': 'Dismiss', onclick: (e) => { store.set(bannerKey, true); e.currentTarget.parentElement.remove(); } }, icon('x', 'sm')));

  // Messages, with the members dropdown floating over them when open.
  const body = h('div', { class: 'chat-body room-body', role: 'log', 'aria-live': 'polite' });
  const dropList = h('div', { class: 'md-list' });
  const dropSub = h('p', {});
  const dropSearch = h('input', { class: 'input', type: 'search', placeholder: 'Search members…', 'aria-label': 'Search members', oninput: () => drawDrop() });
  const drop = h('div', { class: 'members-drop', hidden: true, role: 'dialog', 'aria-label': 'Room members' },
    h('div', { class: 'md-head' }, h('span', { class: 'md-icon' }, icon('rooms')),
      h('div', { class: 'grow' }, h('b', {}, `${shortTitle(target)} Members`), dropSub),
      h('button', { class: 'plain-btn', 'aria-label': 'Close', onclick: () => toggleDrop(false) }, icon('x'))),
    h('label', { class: 'md-search' }, icon('search', 'sm'), dropSearch),
    dropList,
    h('button', { class: 'md-all', onclick: () => { toggleDrop(false); membersPage(); } }, 'View All Members', icon('chev', 'sm')));
  // "50 new messages ↓": counts messages that arrive while you're scrolled up or away from the app.
  let unseen = 0;
  const newPill = h('button', { class: 'new-pill', hidden: true, onclick: () => { scroll(); clearUnseen(); } });
  const showUnseen = () => {
    newPill.hidden = !unseen;
    newPill.replaceChildren(`${unseen > 99 ? '99+' : unseen} new message${unseen === 1 ? '' : 's'}`, icon('chev', 'sm'));
  };
  const clearUnseen = () => { unseen = 0; showUnseen(); };
  const middle = h('div', { class: 'room-middle' }, body, drop, newPill);
  function toggleDrop(open = drop.hidden) {
    drop.hidden = !open;
    pill.setAttribute('aria-expanded', String(open));
    pill.classList.toggle('open', open);
    if (open) { drawDrop(); loadPeople(); }
  }
  function drawDrop() {
    const q = dropSearch.value.trim().toLowerCase();
    const list = (room.people || []).filter((p) => !blocked().has(p.handle) && (!q || p.handle.toLowerCase().includes(q)));
    dropList.replaceChildren(...(list.length ? list.slice(0, 8).map((p) => memberRow(p, drawDrop)) : [h('p', { class: 'small muted center', style: { padding: '14px' } }, q ? 'No one by that name.' : 'Loading…')]));
  }
  room.drawDrop = drawDrop;

  // Composer
  let replyTo = null;
  const replyBar = h('div', { class: 'reply-bar', hidden: true });
  const input = h('textarea', { class: 'input', rows: '1', maxlength: '500', placeholder: 'Type a message…', 'aria-label': 'Message' });
  const sendBtn = h('button', { class: 'send', 'aria-label': 'Send' }, icon('send', 'sm'));
  keepKeyboardOnSend(sendBtn, input);
  const composer = h('form', { class: 'composer room-composer', onsubmit: (e) => { e.preventDefault(); send(); } },
    input, sendBtn);
  el.replaceChildren(head, ...(banner ? [banner] : []), middle, replyBar, composer);
  body.addEventListener('click', () => { if (!drop.hidden) toggleDrop(false); });

  let lastDay = null, nearBottom = true, catchingUp = false;
  const scroll = () => { body.scrollTop = body.scrollHeight; };
  body.addEventListener('scroll', () => { nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 120; if (nearBottom && !document.hidden) clearUnseen(); });
  room.unfit = fitChatToViewport(el, () => { if (nearBottom) requestAnimationFrame(scroll); });

  function reactionRow(m) {
    const row = h('div', { class: 'rx-row' });
    m.redraw = () => {
      const counts = m.reactions || {};
      const mineSet = new Set(m.my_reactions || []);
      const chips = EMOJI.filter((e) => counts[e]).map((e) => h('button', { class: `rx ${mineSet.has(e) ? 'on' : ''}`, onclick: () => react(m, e) }, e, h('span', {}, String(counts[e]))));
      // Like the design: the + only shows next to existing reactions. Tap a message to add the first one.
      row.hidden = !chips.length;
      row.replaceChildren(...chips, h('button', { class: 'rx add', 'aria-label': 'Add reaction', onclick: (ev) => pickReaction(m, ev.currentTarget) }, icon('plus', 'sm')));
    };
    m.redraw();
    return row;
  }

  // ---- Replies (like WhatsApp): swipe a message right, or tap it → Reply ----------------------------
  const quoteName = (handle) => (handle === room.handle ? 'You' : handle);
  function quoteBlock(m) {
    const gone = !m.reply_handle;
    return h('button', { class: `rmsg-quote ${gone ? 'gone' : ''}`, style: { '--c': gone ? 'var(--muted)' : nameColor(m.reply_handle) },
      onclick: (e) => { e.stopPropagation(); jumpTo(m.reply_to); } },
      h('b', {}, gone ? 'Message' : quoteName(m.reply_handle)),
      h('span', {}, gone ? 'This message is no longer available' : m.reply_body));
  }
  function jumpTo(id) {
    const target = body.querySelector(`.rmsg[data-id="${id}"]`);
    if (!target) return toast('That message was sent before you joined', 'reply');
    target.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
  }
  function setReply(m) {
    if (room !== mine) return;
    replyTo = m;
    replyBar.style.setProperty('--c', nameColor(m.handle));
    replyBar.replaceChildren(
      h('div', { class: 'grow' }, h('b', {}, `Replying to ${quoteName(m.handle)}`), h('span', {}, m.body.length > 140 ? `${m.body.slice(0, 140)}…` : m.body)),
      h('button', { type: 'button', class: 'plain-btn', 'aria-label': 'Cancel reply', onclick: () => clearReply() }, icon('x', 'sm')));
    replyBar.hidden = false;
    input.focus();
  }
  function clearReply() { replyTo = null; replyBar.hidden = true; replyBar.replaceChildren(); }
  room.reply = setReply;
  // Drag a message to the right; past ~60px it becomes a reply (with a tick of haptics on phones).
  function swipeToReply(row, m) {
    let x0 = 0, y0 = 0, dx = 0, active = false, decided = false, horizontal = false;
    row.addEventListener('touchstart', (e) => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; dx = 0; active = true; decided = false; horizontal = false; }, { passive: true });
    row.addEventListener('touchmove', (e) => {
      if (!active) return;
      const t = e.touches[0];
      const ddx = t.clientX - x0, ddy = t.clientY - y0;
      if (!decided && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) { decided = true; horizontal = Math.abs(ddx) > Math.abs(ddy) * 1.3 && ddx > 0; }
      if (!horizontal) return;
      dx = Math.max(0, Math.min(90, ddx));
      row.style.transform = `translateX(${dx}px)`;
      row.classList.toggle('swipe-ready', dx > 60);
    }, { passive: true });
    const end = () => {
      if (!active) return;
      active = false;
      if (horizontal && dx > 60) { setReply(m); if (navigator.vibrate) navigator.vibrate(12); }
      row.classList.add('swipe-back'); row.style.transform = '';
      row.classList.remove('swipe-ready');
      setTimeout(() => row.classList.remove('swipe-back'), 220);
    };
    row.addEventListener('touchend', end);
    row.addEventListener('touchcancel', end);
  }

  const add = (m) => {
    if (room !== mine || room.messages.has(m.id)) return;
    if (blocked().has(m.handle) || hiddenMsgs().has(m.id)) return;
    m.mine = m.mine ?? m.handle === room.handle;
    m.reactions = m.reactions || {};
    m.my_reactions = m.my_reactions || [];
    room.messages.set(m.id, m);
    const day = dayLabel(m.created_at);
    if (day !== lastDay) { body.append(h('div', { class: 'day-sep' }, day)); lastDay = day; }
    const openCard = () => profileCard(m.handle);
    const row = h('div', { class: `rmsg ${m.mine ? 'me' : ''}`, 'data-handle': m.handle, 'data-id': String(m.id) },
      h('button', { class: 'rmsg-swipe', 'aria-label': `Reply to ${m.mine ? 'your message' : m.handle}`, onclick: (e) => { e.stopPropagation(); setReply(m); } }, icon('reply', 'sm')),
      h('button', { class: 'rmsg-av', onclick: openCard, 'aria-label': `${m.handle}’s profile` }, personAvatar(m.handle)),
      h('div', { class: 'rmsg-main' },
        h('div', { class: 'rmsg-top' },
          h('button', { class: 'rmsg-name', style: { color: nameColor(m.handle) }, onclick: openCard }, m.mine ? 'You' : m.handle),
          h('time', { datetime: m.created_at }, clock(m.created_at))),
        m.reply_to ? quoteBlock(m) : null,
        h('p', { class: 'rmsg-text', onclick: () => messageMenu(m) }, m.body),
        reactionRow(m)));
    swipeToReply(row, m);
    body.append(row);
    if (!document.hidden) markRead();
    if (m.mine) { scroll(); clearUnseen(); }
    else if (catchingUp || document.hidden || !nearBottom) { unseen += 1; showUnseen(); }
    else scroll();
  };

  // Live updates first, then history, so nothing sent in between is missed.
  // "… joined" lines: a small centred notice, never stored, gone when you leave.
  const notice = (text, cls = '') => {
    const empty = cls === 'me' ? null : body.querySelector('.empty'); if (empty) empty.remove();
    body.append(h('div', { class: `room-notice ${cls}` }, text));
    if (nearBottom) scroll();
  };
  room.channel = api.joinRoomChannel(target, (m) => add(m), (p) => {
    const m = room && room.messages.get(p.id);
    if (m) { m.reactions = p.reactions || {}; m.redraw(); }
  }, (p) => {
    if (room !== mine || !p || p.handle === room.handle || blocked().has(p.handle)) return;
    notice([h('b', { style: { color: nameColor(p.handle) } }, p.handle), ' joined the chat 👋']);
    loadPeople();
  }, (status) => {
    // Live connection state. While it's down, check for new messages every few seconds instead.
    if (room !== mine) return;
    room.live = status === 'SUBSCRIBED';
    if (room.live) pull();
  }, (p) => { if (room === mine && p && p.id) dropRow(p.id); }, (p) => {
    // Someone left: they tapped Leave, moved to another room, or were kicked out for inactivity.
    if (room !== mine || !p || p.handle === room.handle || blocked().has(p.handle)) return;
    notice([h('b', { style: { color: nameColor(p.handle) } }, p.handle), p.why === 'inactive' ? ' was kicked out for inactivity 🚪' : ' left the room']);
    loadPeople();
  });
  // Safety net: even with the live connection up, quietly check every 20 seconds; while it's down,
  // every 3 seconds. Messages are de-duplicated, so nothing ever shows twice.
  let lastPull = 0;
  async function pull() {
    if (room !== mine || document.hidden) return;
    lastPull = Date.now();
    try { const fresh = await api.roomHistorySince(lastId()); if (room === mine) fresh.forEach(add); } catch {}
  }
  // The newest message already on screen: the background check only asks for what came after it.
  function lastId() { let max = 0; if (room) for (const k of room.messages.keys()) { const n = Number(k); if (n > max) max = n; } return max; }
  room.poll = setInterval(() => {
    const gap = api.backingOff() ? 180000 : room && room.live ? 120000 : 30000;
    if (Date.now() - lastPull >= gap) pull();
  }, 1000);
  try {
    const history = cached ? cached.msgs : (early && (await early)) || await api.roomHistory();
    if (room !== mine) return;
    // Opened from memory: when the fresh copy arrives, add anything new and refresh the reactions.
    if (cached) early.then((fresh) => {
      if (room !== mine || !fresh) return;
      fresh.forEach((m) => {
        const old = room.messages.get(m.id);
        if (!old) return add(m);
        if (JSON.stringify(old.reactions) !== JSON.stringify(m.reactions || {}) || String(old.my_reactions) !== String(m.my_reactions || [])) {
          old.reactions = m.reactions || {}; old.my_reactions = m.my_reactions || []; old.redraw && old.redraw();
        }
      });
    });
    // Coming back to a room you're still in: no "you joined" line, pick up at the last message you
    // saw, and count the ones after it as new.
    const back = !!joined.rejoined;
    const readTo = Number(joined.last_read_id || 0);
    if (!history.length && !back) body.append(h('div', { class: 'empty', style: { padding: '30px 10px' } }, h('div', { class: 'empty-art' }, h('span', {}, '👋')),
      h('h3', {}, 'Say hi!'), h('p', {}, 'You’ll see messages sent from now on. Earlier messages aren’t shown, and the chat clears when you leave.')));
    let firstUnread = null;
    history.forEach((m) => {
      const isNew = back && m.id > readTo && !m.mine && !blocked().has(m.handle);
      catchingUp = isNew;
      add(m);
      if (isNew && !firstUnread) firstUnread = body.lastElementChild;
    });
    catchingUp = false;
    if (!back) {
      notice(['You joined ', h('b', {}, roomTitle(target)), ' as ', h('b', { style: { color: nameColor(joined.handle) } }, joined.handle)], 'me');
      scroll();
    } else if (firstUnread) {
      // A divider like WhatsApp's, then show from there; the pill keeps the count until they reach the bottom.
      body.insertBefore(h('div', { class: 'room-notice unread-sep' }, `${unseen} unread message${unseen === 1 ? '' : 's'}`), firstUnread);
      requestAnimationFrame(() => { firstUnread.previousElementSibling.scrollIntoView({ block: 'start' }); nearBottom = false; showUnseen(); });
    } else scroll();
    markRead(0);
  } catch (e) { toast(api.friendly(e), 'x'); }

  async function loadPeople() {
    try {
      const people = await api.roomPeople();
      if (room !== mine) return;
      room.people = people;
      const onNow = people.filter(isOnline).length;
      countEl.textContent = `${people.length.toLocaleString()} ${people.length === 1 ? 'member' : 'members'} · ${onNow} online`;
      dropSub.replaceChildren(`${people.length} members · `, h('i', { class: 'dot-on' }), `${people.filter(isOnline).length} online`);
      if (!drop.hidden) drawDrop();
      if (room.onPeople) room.onPeople();
    } catch {}
  }
  loadPeople();

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    try {
      const quoted = replyTo;
      const m = await api.sendRoomMessage(text, quoted ? quoted.id : null);
      input.value = ''; autosize(); clearReply();
      const empty = body.querySelector('.empty'); if (empty) empty.remove();
      if (m) add({ ...m, mine: true, reply_handle: m.reply_handle ?? (quoted && quoted.handle), reply_body: m.reply_body ?? (quoted && quoted.body.slice(0, 140)) });
    } catch (e) {
      if (/join a room/i.test(e.message || '')) { dropped(); sendBtn.disabled = false; return; }
      toast(api.friendly(e), 'x');
    }
    sendBtn.disabled = false;
    input.focus();
  }
  const autosize = () => { input.style.height = 'auto'; input.style.height = `${Math.min(120, input.scrollHeight)}px`; };
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); send(); } });

  // Keep your seat while the room is open.
  async function beat() {
    if (room !== mine || document.hidden) return;   // only an app that's on screen keeps your seat
    try {
      const s = await api.roomHeartbeat();
      if (!s) { dropped(); return; }
      if (!document.hidden) loadPeople();
    } catch {}
  }
  // Inactive for 10 minutes: you've been kicked out of the room (like 2go). Show it right here.
  function dropped() {
    if (room !== mine) return;
    room.left = true;
    state.inRoom = false;
    kick = { state: target, kicked_at: new Date().toISOString() };
    rooms = (rooms || []).map((r) => ({ ...r, mine: false }));
    toast('You were kicked out of this room for inactivity', 'logout');
    go('rooms', { replace: true });
  }
  // Coming back to the app: messages sent while it was in the background may have been missed by
  // the live connection, so fetch anything new. They count towards "N new messages".
  async function catchUp() {
    if (room !== mine) return;
    await beat();
    if (room !== mine) return;
    try {
      const fresh = await api.roomHistorySince(lastId());
      if (room !== mine) return;
      const firstNew = fresh.find((m) => !room.messages.has(m.id) && !m.mine);
      catchingUp = !!firstNew;
      fresh.forEach(add);
      catchingUp = false;
    } catch {}
    markRead(0);
    if (unseen && nearBottom) {
      // Show where the new ones start, and keep the counter until they scroll down.
      const firstEl = [...body.querySelectorAll('.rmsg')].slice(-unseen)[0];
      if (firstEl) firstEl.scrollIntoView({ block: 'start' });
    }
  }
  room.timer = setInterval(beat, 120000);
  room.onVisible = () => { if (!document.hidden) catchUp(); };
  document.addEventListener('visibilitychange', room.onVisible);
  room.loadPeople = loadPeople;
}

async function react(m, emoji) {
  try {
    const r = await api.toggleRoomReaction(m.id, emoji);
    if (!r) return;
    m.reactions = r.reactions || {};
    const set = new Set(m.my_reactions); if (r.mine) set.add(emoji); else set.delete(emoji);
    m.my_reactions = [...set];
    m.redraw();
  } catch (e) { toast(api.friendly(e), 'x'); }
}
function pickReaction(m, anchor) {
  document.querySelectorAll('.rx-picker').forEach((p) => p.remove());
  const picker = h('div', { class: 'rx-picker', role: 'menu' }, EMOJI.map((e) => h('button', { onclick: () => { picker.remove(); react(m, e); } }, e)));
  anchor.parentElement.append(picker);
  setTimeout(() => document.addEventListener('click', function off(ev) {
    if (!picker.contains(ev.target)) { picker.remove(); document.removeEventListener('click', off); }
  }), 0);
}

function invite() {
  if (!room) return;
  shareOrCopy({ title: `${roomTitle(room.state)} chatroom on treehouse`, text: `Come chat with people in ${roomTitle(room.state)} on treehouse 💬`,
    url: `${location.origin}/home/rooms/${encodeURIComponent(room.state)}` });
}

// "Message" sends a message request (as in Discover). It needs a dating card on both sides.
function messageButton(p) {
  if (p.me) return null;
  if (!state.profile) return h('span', { class: 'req-note' }, 'Room chat only');
  if (friendChat(p.handle)) return h('button', { class: 'req-btn', onclick: (e) => { e.stopPropagation(); nav.openChat(friendChat(p.handle).conversation_id); } }, icon('chat', 'sm'), 'Chat');
  return h('button', { class: 'req-btn', onclick: (e) => {
    e.stopPropagation();
    composeTo({ handle: p.handle, age: p.age, gender: p.gender }, { friend: true });
  } }, icon('userplus', 'sm'), 'Add friend');
}

function memberRow(p, redraw) {
  return h('div', { class: 'md-row', role: 'button', tabindex: '0', onclick: () => profileCard(p.handle) },
    h('span', { class: 'op-av' }, personAvatar(p.handle), isOnline(p) ? h('i') : null),
    h('span', { class: 'grow' }, h('b', { style: { color: nameColor(p.handle) } }, p.me ? `${p.handle} (you)` : p.handle),
      h('span', { class: 'md-place' }, `${p.place || ''}${p.place ? ' • ' : ''}${isOnline(p) ? 'Online' : 'Away'}`)),
    messageButton(p));
}

// Full members screen: search, and All / Online / Open to dating.
function membersPage() {
  if (!room) return;
  const r = room;
  let filter = 'all';
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search members…', 'aria-label': 'Search members', oninput: () => draw() });
  const tabs = h('div', { class: 'cr-pills' });
  const list = h('div', { class: 'mp-list' });
  const sub = h('p', {});
  const page = h('section', { class: 'members-page', 'aria-label': 'Room members' },
    h('div', { class: 'mp-head' },
      h('button', { class: 'plain-btn', 'aria-label': 'Back', onclick: () => close() }, icon('back')),
      h('div', { class: 'grow' }, h('h2', {}, `${shortTitle(r.state)} Members`), sub)),
    h('label', { class: 'md-search' }, icon('search', 'sm'), search),
    tabs, list);
  function draw() {
    const people = (r.people || []).filter((p) => !blocked().has(p.handle));
    const open = people.filter((p) => p.dating && !p.me);
    const onNow = people.filter(isOnline);
    sub.replaceChildren(`${people.length} members · `, h('i', { class: 'dot-on' }), `${onNow.length} online`);
    const tab = (id, label) => h('button', { class: `cr-pill ${filter === id ? 'on' : ''}`, onclick: () => { filter = id; draw(); } }, label);
    tabs.replaceChildren(tab('all', `All (${people.length})`), tab('online', `Online (${onNow.length})`), tab('dating', `Open to dating (${open.length})`));
    const q = search.value.trim().toLowerCase();
    const shown = (filter === 'dating' ? open : filter === 'online' ? onNow : people).filter((p) => !q || p.handle.toLowerCase().includes(q));
    list.replaceChildren(...(shown.length ? shown.map((p) => memberRow(p, draw))
      : [emptyState(filter === 'dating' ? '💘' : '🔎', filter === 'dating' ? 'No one open to dating here yet' : 'No one by that name', filter === 'dating' ? 'People with a dating card can get message requests.' : 'Try another name.')]));
  }
  function close() { page.remove(); r.onPeople = null; if (r.drawDrop) r.drawDrop(); }
  r.onPeople = draw;
  r.el.append(page);
  draw();
  if (r.loadPeople) r.loadPeople();
}

// Profile card for someone in the room.
async function profileCard(handle) {
  let p = null;
  try { p = await api.roomProfile(handle); } catch (e) { return toast(api.friendly(e), 'x'); }
  if (!p) return toast('They’ve left the room', 'x');
  const lastMsg = room && [...room.messages.values()].reverse().find((m) => m.handle === handle);
  const canMessage = !!state.profile && !p.me;
  const existing = canMessage ? friendChat(p.handle) : null;
  sheet((close) => [
    h('div', { class: 'pc' },
      h('div', { class: 'pc-av' }, personAvatar(p.handle, 'xl'), p.online ? h('i') : null),
      h('h2', {}, p.handle),
      h('p', { class: 'pc-sub' }, [p.place && p.place !== p.room ? p.place : roomTitle(p.room), p.age ? `${p.age} years` : null].filter(Boolean).join(' · ')),
      h('span', { class: `pc-status ${p.online ? 'on' : ''}` }, p.online ? 'Online' : 'Away'),
      p.me ? null : h('div', { class: 'pc-actions' },
        existing
          ? h('button', { class: 'btn btn-primary', onclick: () => { close(); nav.openChat(existing.conversation_id); } }, icon('chat', 'sm'), statusOf(existing) === 'sent' ? 'Request sent · open' : 'Open chat')
          : h('button', { class: `btn ${canMessage ? 'btn-coral' : 'btn-soft'}`, disabled: !canMessage, onclick: () => { close(); composeTo({ handle: p.handle, age: p.age, gender: p.gender }, { friend: true }); } }, icon('userplus', 'sm'), 'Add friend')),
      p.me || canMessage ? null : h('p', { class: 'tiny muted' }, 'Set up your profile to add friends.')),
    h('div', { class: 'pc-about' },
      h('h3', {}, 'About'),
      h('p', { class: 'muted' }, p.bio || (p.me ? 'Add a bio to your dating card so people know your vibe.' : 'No bio yet.')),
      h('div', { class: 'pc-facts' },
        h('span', {}, icon('pin', 'sm'), roomTitle(p.room)),
        p.age ? h('span', {}, icon('cake', 'sm'), `${p.age} years${p.gender ? ` · ${GENDER_LABEL[p.gender]}` : ''}`) : null,
        h('span', {}, icon('heart', 'sm'), p.dating ? 'Open to dating on treehouse' : 'Here to chat and meet people')),
      (p.interests || []).length ? h('div', { class: 'chips' }, p.interests.map((i) => h('span', { class: 'chip static' }, i))) : null),
    p.me ? null : h('div', { class: 'settings-group pc-safety' },
      h('button', { class: 'settings-row', onclick: async () => {
        close();
        if (!(await confirmSheet({ title: `Block ${p.handle}?`, text: 'You won’t see their messages in chatrooms, and they can’t message you. They won’t be told.', yes: 'Block', danger: true }))) return;
        await blockHandle(p.handle, lastMsg && lastMsg.id);
      } }, icon('ban'), h('span', { class: 'grow' }, 'Block user'), h('span', { class: 'chev' }, icon('chev', 'sm'))),
      h('button', { class: 'settings-row danger', onclick: () => { close(); if (lastMsg) messageMenu(lastMsg, true); else toast('Nothing to report yet: they haven’t sent a message here.', 'flag'); } },
        icon('flag'), h('span', { class: 'grow' }, 'Report user'), h('span', { class: 'chev' }, icon('chev', 'sm')))),
  ], { label: `${p.handle}’s profile` });
}

function roomMenu() {
  if (!room) return;
  sheet((close) => [h('h2', {}, roomTitle(room.state)),
    h('p', { class: 'small muted' }, 'Chatrooms are public to the people in them. Don’t share your phone number, address or other personal details.'),
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn btn-soft btn-block', onclick: () => { close(); membersPage(); } }, icon('rooms', 'sm'), 'See members'),
      h('button', { class: 'btn btn-soft btn-block', onclick: () => { close(); invite(); } }, icon('share', 'sm'), 'Invite people'),
      h('button', { class: 'btn btn-danger btn-block', onclick: async () => {
        close();
        room.left = true;
        try { await api.leaveRoom(); } catch {}
        state.inRoom = false;
        rooms = (rooms || []).map((r) => ({ ...r, mine: false }));
        toast('You left the chatroom', 'logout');
        go('rooms', { replace: true });
      } }, icon('logout', 'sm'), 'Leave chatroom'),
      h('button', { class: 'btn btn-soft btn-block', onclick: close }, 'Close'))], { label: 'Chatroom options' });
}

function messageMenu(m, reportOnly = false) {
  sheet((close) => [h('h2', {}, reportOnly ? `Report ${m.handle}` : m.handle),
    h('p', { class: 'muted' }, `“${m.body.length > 140 ? `${m.body.slice(0, 140)}…` : m.body}”`),
    reportOnly ? null : h('div', { class: 'rx-quick' }, EMOJI.map((e) => h('button', { onclick: () => { close(); react(m, e); } }, e))),
    reportOnly || !room || !room.reply ? null : h('button', { class: 'btn btn-primary btn-block', style: { marginBottom: '10px' }, onclick: () => { close(); room.reply(m); } }, icon('reply', 'sm'), 'Reply'),
    m.mine && !reportOnly ? h('button', { class: 'btn btn-soft btn-block danger-text', style: { marginBottom: '10px' }, onclick: async () => {
      close();
      if (!(await confirmSheet({ title: 'Delete this message?', text: 'It’s removed from the chatroom for everyone.', yes: 'Delete', danger: true }))) return;
      try { await api.deleteRoomMessage(m.id); dropRow(m.id); toast('Message deleted', 'trash'); }
      catch (e) { toast(api.friendly(e), 'x'); }
    } }, icon('trash', 'sm'), 'Delete message') : null,
    m.mine || reportOnly ? null : h('div', { class: 'stack', style: { gap: '8px', marginBottom: '12px' } },
      h('button', { class: 'btn btn-soft btn-block', onclick: () => { close(); hideMsg(m.id); toast('Message hidden', 'eye'); } }, 'Hide this message'),
      h('button', { class: 'btn btn-soft btn-block', onclick: async () => {
        close();
        if (!(await confirmSheet({ title: `Block ${m.handle}?`, text: 'You won’t see their messages in chatrooms, and they can’t message you. They won’t be told.', yes: 'Block', danger: true }))) return;
        await blockHandle(m.handle, m.id);
      } }, `Block ${m.handle}`)),
    m.mine ? null : h('p', { class: 'small muted' }, 'Report this if it’s abusive, sexual, spam, or from someone who seems under 18. It’s hidden for you straight away, and we review reports within 24 hours.'),
    m.mine ? null : h('div', { class: 'stack', style: { gap: '8px' } }, REPORT_REASONS.map(([value, label]) => h('button', { class: 'btn btn-soft btn-block', onclick: async () => {
      close();
      try { await api.reportRoomMessage(m.id, value); hideMsg(m.id); toast('Thanks. It’s hidden and we’ll review it.', 'flag'); }
      catch (e) { toast(api.friendly(e), 'x'); }
    } }, label))),
    m.mine ? null : h('p', { class: 'tiny muted center', style: { marginTop: '10px' } }, 'Something urgent? Email ', h('a', { href: `mailto:${SUPPORT_EMAIL}` }, SUPPORT_EMAIL)),
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn btn-soft btn-block', onclick: close }, m.mine ? 'Close' : 'Cancel'))], { label: 'Message' });
}
