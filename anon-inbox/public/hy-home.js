// Home: the hub. Who you are, the two ways in (Discover, Chatrooms), your connections at a glance,
// and what's happened recently. Pink = dating, blue = talking.
import * as api from './hy-api.js';
import { h, icon, avatar, avatarBg, initials, logo, hero, heroBtn, ago, store, sheet, toast, confirmSheet } from './hy-ui.js';
import { state, emit, go, nav, unreadChats, newMatches, messageRequests, statusOf, isMatch, stateLabel, INTENT_LABEL, GENERAL_ROOMS, UNI_ROOMS, nameOf, friendsList, loadDating } from './hy-state.js';
import { pushCard } from './hy-push.js';
import { installCard } from './hy-install.js';

// First word of the name given at sign-up (private to you; others see your nickname).
function firstName(n) { return String(n || '').trim().split(/\s+/)[0].slice(0, 24); }

function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
}
const shortName = (handle) => handle.split(' ').slice(0, 2).join(' ');
const roomTitle = (s) => (GENERAL_ROOMS[s] ? GENERAL_ROOMS[s].name : UNI_ROOMS[s] ? s : s === 'FCT' ? 'Abuja (FCT)' : `${stateLabel(s)}`);

let peopleCache = null, peopleAt = 0;
let myRoom = null, roomAt = 0;

// Android beta on Google Play: invite Android users to join the testers group, then install from Play.
// Only on Android, hidden once dismissed.
const BETA_GROUP = 'https://groups.google.com/g/treehouse-testers';
const BETA_OPTIN = 'https://play.google.com/apps/testing/com.brianjonahdennis.treehouse';
const BETA_LIVE = false;   // switch on once Google approves the closed test release
function betaCard() {
  if (!BETA_LIVE || !/Android/i.test(navigator.userAgent) || store.get('hy-beta-dismissed')) return null;
  const card = h('section', { class: 'beta-card' },
    h('div', { class: 'beta-top' },
      h('b', {}, '🚀 Help test treehouse on Google Play'),
      h('button', { class: 'plain-btn', 'aria-label': 'Dismiss', onclick: () => { store.set('hy-beta-dismissed', 1); card.remove(); } }, icon('x', 'sm'))),
    h('p', { class: 'small' }, 'Be one of the first to get treehouse from the Play Store. It takes a minute, using the Google account on this phone:'),
    h('ol', { class: 'small beta-steps' },
      h('li', {}, h('a', { href: BETA_GROUP, target: '_blank', rel: 'noopener' }, 'Join the testers group'), ' (tap “Join group”).'),
      h('li', {}, h('a', { href: BETA_OPTIN, target: '_blank', rel: 'noopener' }, 'Open the testing link'), ', tap “Become a tester”, then install.'),
      h('li', {}, 'Keep it installed for at least 14 days. Thank you! 💙')),
    h('p', { class: 'tiny muted' }, 'Your treehouse account and chats stay the same.'));
  return card;
}

export function renderHome() {
  const { profile } = state;
  const live = state.convos.filter((c) => !c.blocked);
  const unread = unreadChats();
  const requests = messageRequests();
  const matches = live.filter((c) => statusOf(c) === 'chat' && isMatch(c));
  const likes = state.requests.length;

  const roomCard = h('div', { class: 'hm-room-slot' });
  const activity = h('div', { class: 'hm-activity' });
  const people = h('div', { class: 'h-scroll' }, Array.from({ length: 4 }, () => h('div', { class: 'skeleton person-sk' })));
  loadPeople(people);

  const drawRoom = () => {
    roomCard.replaceChildren(featureCard({
      kind: 'talk', iconName: 'rooms', title: 'Chatrooms',
      text: myRoom ? `You’re in ${roomTitle(myRoom.state)} · ${myRoom.online ?? myRoom.people} online` : 'Join your state community, meet people and start conversations.',
      badge: myRoom && myRoom.unread ? `${myRoom.unread > 99 ? '99+' : myRoom.unread} new` : null,
      onclick: () => go(myRoom ? `rooms/${encodeURIComponent(myRoom.state)}` : 'rooms'),
    }));
    activity.replaceChildren(...activityItems(live, requests));
  };
  drawRoom();
  loadRoom(drawRoom);

  return h('div', { class: 'stack-lg home' },
    hero({ cls: 'home-hero', top: logo(), actions: [nav.bell(), heroBtn('gear', 'Settings', () => go('profile'))] },
      h('div', { class: 'hm-me' },
        h('button', { class: 'hm-av', 'aria-label': 'Your profile', onclick: () => go('profile') }, avatar(profile.handle, profile.handle, 'xl')),
        h('div', { class: 'grow' },
          h('p', { class: 'hm-greet' }, firstName(profile.name) ? `${greeting()}, ${firstName(profile.name)} 👋` : `${greeting()} 👋`),
          h('h1', {}, shortName(profile.handle)),
          statusPill()))),

    friendsStrip(),

    h('div', { class: 'hm-features' },
      featureCard({ kind: 'date', iconName: 'flame', title: 'Discover', text: 'Meet new people and find meaningful connections.',
        badge: likes ? `${likes} like${likes === 1 ? '' : 's'}` : null, onclick: () => go('discover') }),
      roomCard),

    h('section', {},
      h('div', { class: 'section-head' }, h('h2', {}, 'Your connections')),
      h('div', { class: 'hm-stats' },
        stat('heart', 'date', likes, 'Likes', () => go('matches/likes')),
        stat('sparkles', 'date', matches.length, 'Matches', () => go('matches/matches')),
        friendsStat(),
        stat('send', 'talk', requests.length, 'Requests', () => go('matches/requests')))),

    betaCard(),
    installCard(() => emit('push')) || pushCard(() => emit('push')),

    h('section', {},
      h('div', { class: 'section-head' }, h('h2', {}, 'Recent activity'), h('button', { class: 'link-btn', onclick: () => go('matches') }, 'Inbox')),
      activity),

    h('section', {},
      h('div', { class: 'section-head' }, h('h2', {}, 'People to discover'), h('button', { class: 'link-btn', onclick: () => go('discover') }, 'See all')),
      people));
}

// ---- Personal status (one at a time, seen by your friends) ----------------------------------------
const SUGGESTED = ['Available to chat 👋', 'Busy at work 💼', 'Feeling happy 😊', 'Chilling with music 🎧', 'Looking for new friends 🤝', 'Out with friends 🍹', 'Studying 📚', 'Travelling ✈️'];
function statusPill() {
  const st = state.myStatus;
  return h('button', { class: `hm-status ${st ? '' : 'empty'}`, 'aria-label': st ? 'Edit your status' : 'Set your status', onclick: () => statusEditor() },
    h('i', { class: 'hm-status-dot' }),
    h('span', { class: 'ellipsis grow', key: st ? st.updated_at : 'none' }, st ? st.body : 'What’s your status?'),
    icon('edit', 'sm'));
}
export function statusEditor() {
  const cur = state.myStatus;
  const input = h('input', { class: 'input', maxlength: '80', placeholder: 'What are you up to?', value: cur ? cur.body : '', 'aria-label': 'Your status' });
  const count = h('small', { class: 'muted' }, `${input.value.length} / 80`);
  input.addEventListener('input', () => { count.textContent = `${input.value.length} / 80`; });
  const err = h('p', { class: 'error', role: 'alert' });
  sheet((close) => {
    const save = h('button', { class: 'btn btn-primary btn-block', onclick: async () => {
      const body = input.value.trim();
      if (!body) return (err.textContent = 'Write something first, or pick a suggestion.');
      save.disabled = true;
      try { const r = await api.setStatus(body); state.myStatus = r || { body, updated_at: new Date().toISOString() }; close(); emit('dating'); toast('Status updated', 'check'); }
      catch (e) { err.textContent = api.friendly(e); save.disabled = false; }
    } }, cur ? 'Update status' : 'Post status');
    return [h('h2', {}, 'Your status'),
      h('p', { class: 'small muted' }, 'Your friends see it on their Home. One status at a time: a new one replaces the old.'),
      h('label', { class: 'field' }, input, count),
      h('div', { class: 'chips status-suggest' }, SUGGESTED.map((t) => h('button', { type: 'button', class: 'chip', onclick: () => { input.value = t; count.textContent = `${t.length} / 80`; input.focus(); } }, t))),
      err,
      h('div', { class: 'sheet-actions' }, save,
        cur ? h('button', { class: 'btn btn-soft btn-block danger-text', onclick: async () => {
          close();
          try { await api.clearStatus(); state.myStatus = null; emit('dating'); toast('Status removed', 'trash'); } catch (e) { toast(api.friendly(e), 'x'); }
        } }, 'Delete status') : null)];
  }, { label: 'Your status' });
  setTimeout(() => input.focus(), 50);
}

// ---- Friends -------------------------------------------------------------------------------------
function openFriend(f) { nav.openChat(f.conversation_id); }
function friendsStat() {
  const fr = friendsList();
  const on = fr.filter((f) => f.other_online).length;
  return h('button', { class: `hm-stat talk ${fr.length ? 'has' : ''}`, onclick: () => go('matches/friends') },
    h('span', { class: 'hs-icon' }, icon('rooms'), on ? h('i', { class: 'hs-on' }) : null),
    h('b', {}, fr.length ? `${on}/${fr.length}` : '0'),
    h('span', {}, 'Friends'));
}
function friendsStrip() {
  const fr = friendsList();
  const online = fr.filter((f) => f.other_online);
  const head = h('div', { class: 'section-head' }, h('h2', {}, online.length ? `Friends online (${online.length})` : 'Friends'),
    h('button', { class: 'link-btn', onclick: () => go('matches/friends') }, fr.length ? 'See all' : 'Find friends'));
  if (!fr.length) {
    return h('section', { class: 'below-hero hm-friends' }, head,
      h('div', { class: 'card hm-empty small' }, h('p', {}, 'No friends yet. Meet people in a chatroom, tap their name and choose Add friend.'),
        h('button', { class: 'btn btn-primary btn-sm', onclick: () => go('rooms') }, icon('rooms', 'sm'), 'Open chatrooms')));
  }
  const shown = online.length ? online : fr.slice().sort((a, b) => (a.other_active_hours ?? 1e9) - (b.other_active_hours ?? 1e9));
  return h('section', { class: 'below-hero hm-friends' }, head,
    online.length ? null : h('p', { class: 'small muted' }, 'None of your friends are online right now.'),
    h('div', { class: 'friend-strip' }, shown.slice(0, 12).map((f) => h('button', { class: `fs-item ${f.other_online ? 'on' : ''}`, onclick: () => openFriend(f), title: f.friend_status ? f.friend_status.body : '' },
      h('span', { class: 'fs-av' }, avatar(f.other_handle, nameOf(f), 'lg'), f.other_online ? h('i') : null),
      h('span', { class: 'fs-name ellipsis' }, shortName(nameOf(f)))))));
}

function featureCard({ kind, iconName, title, text, badge, onclick }) {
  return h('button', { class: `hm-feature ${kind}`, onclick },
    h('span', { class: 'hf-top' },
      h('span', { class: 'hf-icon' }, icon(iconName, kind === 'date' ? 'fill' : '')),
      badge ? h('span', { class: 'hf-badge' }, badge) : null),
    h('b', {}, title),
    h('span', { class: 'hf-text' }, text),
    h('span', { class: 'hf-go' }, kind === 'date' ? 'Start discovering' : 'Open chatrooms', icon('chev', 'sm')));
}

function stat(iconName, kind, n, label, onclick) {
  return h('button', { class: `hm-stat ${kind} ${n ? 'has' : ''}`, onclick },
    h('span', { class: 'hs-icon' }, icon(iconName, kind === 'date' && iconName === 'heart' ? 'fill' : '')),
    h('b', {}, n > 999 ? '999+' : String(n)),
    h('span', {}, label));
}

// Matches, requests, chats and your chatroom, newest first.
function activityItems(live, requests) {
  const items = [];
  for (const c of requests) items.push({ at: c.last_at, el: actRow(c.other_handle, 'talk', 'send', `${c.other_handle}`, 'sent you a message request', c.last_at, () => nav.openChat(c.conversation_id), 'Review') });
  for (const c of live) {
    const st = statusOf(c);
    if (st === 'chat' && !c.last_message) items.push({ at: c.last_at, el: actRow(c.other_handle, 'date', 'sparkles', c.other_handle, isMatch(c) ? 'You matched! Say hi 👋' : 'Request accepted. Say hi 👋', c.last_at, () => nav.openChat(c.conversation_id), 'Say hi') });
    else if (st === 'chat' || st === 'sent') items.push({ at: c.last_at, el: actRow(c.other_handle, 'talk', 'chat', nameOf(c), `${c.last_from_me ? 'You: ' : ''}${c.last_message || ''}`, c.last_at, () => nav.openChat(c.conversation_id), c.unread ? String(c.unread) : st === 'sent' ? 'Pending' : null, !!c.unread) });
  }
  for (const f of friendsList()) {
    if (f.friend_status) items.push({ at: f.friend_status.updated_at, el: actRow(f.other_handle, 'talk', 'chat', `${nameOf(f)} posted a status`, `“${f.friend_status.body}”`, f.friend_status.updated_at, () => openFriend(f), null) });
    if (f.accepted_at && !f.last_message) items.push({ at: f.accepted_at, el: actRow(f.other_handle, 'talk', 'userplus', nameOf(f), 'You’re now friends 🎉', f.accepted_at, () => nav.openChat(f.conversation_id), 'Say hi') });
  }
  if (myRoom && myRoom.unread) items.push({ at: new Date().toISOString(), el: h('button', { class: 'act-row', onclick: () => go(`rooms/${encodeURIComponent(myRoom.state)}`) },
    h('span', { class: 'act-av room' }, icon('rooms')),
    h('span', { class: 'grow' }, h('b', {}, `${roomTitle(myRoom.state)} chatroom`), h('span', { class: 'act-sub ellipsis' }, `${myRoom.unread} new message${myRoom.unread === 1 ? '' : 's'} since you left`)),
    h('span', { class: 'act-pill talk strong' }, String(myRoom.unread > 99 ? '99+' : myRoom.unread))) });
  items.sort((a, b) => new Date(b.at) - new Date(a.at));
  if (!items.length) {
    return [h('div', { class: 'card hm-empty' },
      h('p', {}, 'Nothing here yet. Like someone in Discover, or say hi in your state’s chatroom: your matches, requests and chats will show up here.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-coral btn-sm', onclick: () => go('discover') }, icon('flame', 'sm'), 'Discover'),
        h('button', { class: 'btn btn-primary btn-sm', onclick: () => go('rooms') }, icon('rooms', 'sm'), 'Chatrooms')))];
  }
  return [h('div', { class: 'card act-list' }, items.slice(0, 6).map((i) => i.el))];
}

function actRow(handle, kind, iconName, title, sub, at, onclick, pill, strong = false) {
  return h('button', { class: 'act-row', onclick },
    h('span', { class: 'act-av' }, avatar(handle, handle), h('span', { class: `act-kind ${kind}` }, icon(iconName, 'sm'))),
    h('span', { class: 'grow' },
      h('span', { class: 'row-between' }, h('b', { class: 'ellipsis' }, title), h('span', { class: 'when' }, ago(at))),
      h('span', { class: `act-sub ellipsis ${strong ? 'strong' : ''}` }, sub)),
    pill ? h('span', { class: `act-pill ${kind} ${strong ? 'strong' : ''}` }, pill) : null);
}

async function loadRoom(draw) {
  if (Date.now() - roomAt < 20000) return;
  roomAt = Date.now();
  try { myRoom = (await api.roomList()).find((r) => r.mine) || null; state.inRoom = !!myRoom; draw(); } catch {}
}

async function loadPeople(el) {
  try {
    // "People to discover" is remembered on this phone for 3 hours (across app opens).
    if (!peopleCache) {
      const saved = store.get('hy-people', null);
      if (saved && saved.me === state.profile.handle && Date.now() - saved.at < 3 * 3600 * 1000) { peopleCache = saved.list; peopleAt = saved.at; }
    }
    if (!peopleCache || Date.now() - peopleAt > 3 * 3600 * 1000) {
      peopleCache = await api.discover(8); peopleAt = Date.now();
      store.set('hy-people', { me: state.profile.handle, at: peopleAt, list: peopleCache });
    }
    if (!peopleCache.length) {
      el.replaceWith(h('p', { class: 'small muted' }, 'No new people right now. Check back soon, or widen who you see in Profile.'));
      return;
    }
    el.replaceChildren(...peopleCache.map((p) => h('button', { class: 'person-tile', style: { '--av': avatarBg(p.handle) }, onclick: () => go('discover') },
      h('span', { class: 'pt-art' }, h('span', { class: 'pt-initials', 'data-av-handle': p.handle }, initials(p.handle)), p.online ? h('i', { class: 'pt-on', 'aria-label': 'Online' }) : null),
      h('span', { class: 'pt-info' },
        h('b', {}, `${shortName(p.handle)}, ${p.age}`),
        h('span', {}, [p.location, INTENT_LABEL[p.intent]].filter(Boolean).join(' · '))))));
  } catch {
    el.replaceWith(h('p', { class: 'small muted' }, 'Couldn’t load people right now.'));
  }
}
