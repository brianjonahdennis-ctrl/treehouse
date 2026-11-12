// Dating: Discover (dark swipe deck), the match moment, Connections (matches / requests / chats)
// and chat. People are anonymous cards (handle, age, gender, area, intent, bio, interests). A name
// is only shown after both people choose to reveal, via revealed_details().
import * as api from './hy-api.js';
import { h, icon, avatar, avatarBg, initials, hash, ago, clock, dayLabel, toast, sheet, confirmSheet, emptyState, hero, heroBtn, copyText, logo } from './hy-ui.js';
import { state, emit, nav, go, loadDating, patchChat, closeChatLocal, nameOf, rememberRevealedName, markChatRead, statusOf, messageRequests, matchFriendAsks, isMatch, isFriend, friendsList, subscribe, STATES, stateLabel, GENDER_LABEL, INTENT_LABEL } from './hy-state.js';
import { startDatingSetup } from './hy-onboard.js';
import { editPrefs } from './hy-profile.js';
import { renderNearby } from './hy-nearby.js';
import * as photos from './hy-photos.js';
import { speedBanner } from './hy-speed.js';

// Preferences changed (e.g. the location filter): start the deck again.
subscribe((what) => { if (what === 'profile') { deck = []; deckLoaded = false; lastPassed = null; } });

const REPORT_REASONS = [['harassment', 'Harassment'], ['inappropriate', 'Sexual or inappropriate'], ['spam', 'Spam or scam'],
  ['fake', 'Fake profile'], ['underage', 'Seems under 18'], ['other', 'Something else']];
const meta = (p) => [p.age, GENDER_LABEL[p.gender || p.other_gender], p.location || p.other_location].filter(Boolean).join(' · ');
// "Online" (green dot) or how long ago someone was last active, from the coarse values the database shares.
const activeText = (online, hours) => online ? 'Online'
  : hours == null ? null
  : hours < 1 ? 'Active less than an hour ago'
  : hours < 48 ? `Active ${hours} hour${hours === 1 ? '' : 's'} ago`
  : `Active ${Math.floor(hours / 24)} days ago`;
const onlineDot = () => h('i', { class: 'online-dot-inline', role: 'img', 'aria-label': 'Online' });
const shortName = (handle) => handle.split(' ').slice(0, 2).join(' ');

// ---- Discover ------------------------------------------------------------------------------------
let deck = [];            // cards waiting, top first
let deckLoaded = false, deckLoading = false;
let lastPassed = null;    // for rewind
const decided = new Set();

export function renderDiscover(sub) {
  const nearby = sub === 'nearby';
  const tab = (id, ico, label, to) => h('button', { role: 'tab', 'aria-selected': String(id === (nearby ? 'nearby' : 'discover')), onclick: () => go(to) }, icon(ico, 'sm'), label);
  const tabs = state.profile ? h('div', { class: 'disc-tabs', role: 'tablist', 'aria-label': 'Discover sections' },
    tab('nearby', 'pin', 'Nearby', 'discover/nearby'), tab('discover', 'flame', 'Discover', 'discover'), tab('matches', 'heart', 'Matches', 'matches/matches')) : null;
  const head = hero({ cls: 'disc-hero', title: 'Discover', sub: nearby ? 'Meet people around you, safely and anonymously.' : 'Anonymous profiles. Like, pass, or send a message request.',
    actions: state.profile && api.features.matching && !nearby ? [heroBtn('sliders', 'Filters', () => editPrefs())] : [] }, tabs);
  if (nearby && state.profile && !state.profile.suspended) return h('div', { class: 'stack' }, head, renderNearby());
  if (!state.profile) return h('div', { class: 'stack-lg' }, head, datingIntro());
  if (state.profile.suspended) return h('div', { class: 'stack' }, head, h('div', { class: 'notice warn' }, '⚠️ Your dating profile is suspended after reports, so you can’t use Discover.'));
  return h('div', { class: 'stack' }, head,
    api.features.states ? locationBar() : null,
    api.features.matching ? null : h('div', { class: 'notice' }, icon('sparkles', 'sm'),
      h('span', {}, h('b', {}, 'Likes and matching are switching on. '), 'For now, message anyone you like the look of: you both stay anonymous.')),
    !state.profile.is_active ? h('div', { class: 'notice' }, icon('pause', 'sm'), h('span', {}, 'Your dating profile is paused, so others can’t see you. Turn it on in Profile.')) : null,
    speedBanner(),
    renderDeck());
}

// ---- Location filter --------------------------------------------------------------------------------
function locationBar() {
  const p = state.profile;
  return h('div', { class: 'stack', style: { gap: '10px' } },
    !p.state ? h('div', { class: 'notice' }, icon('pin', 'sm'), h('span', { class: 'grow' }, h('b', {}, 'Add your state. '), 'People nearby can find you, and you can filter by location.'),
      h('button', { class: 'btn btn-white btn-sm', onclick: () => pickState('mine') }, 'Choose')) : null,
    h('div', { class: 'loc-row', role: 'group', 'aria-label': 'Discovery filters' },
      h('button', { class: 'loc-chip', onclick: () => pickState('filter') }, icon('pin', 'sm'), h('span', {}, stateLabel(p.pref_state)), icon('chev', 'sm')),
      api.features.matching ? h('button', { class: 'loc-chip', onclick: () => editPrefs() }, h('span', {}, `Ages ${p.min_age}–${p.max_age >= 99 ? '99+' : p.max_age}`)) : null,
      api.features.matching ? h('button', { class: 'loc-chip', onclick: () => editPrefs() }, h('span', {}, whoLabel(p))) : null,
      p.pref_state && p.state && p.pref_state !== p.state ? h('button', { class: 'link-btn small loc-back', onclick: () => saveFilter(p.state) }, `Back to ${stateLabel(p.state)}`) : null));
}
function whoLabel(p) {
  const who = p.interested_in || [];
  if (!who.length || who.length >= 3) return 'Everyone';
  return who.map((g) => ({ female: 'Women', male: 'Men', other: 'Non-binary' }[g])).join(' & ');
}

async function saveFilter(st) {
  const p = state.profile;
  const prev = p.pref_state;
  p.pref_state = st || null;
  try { await api.updateProfile(p.handle, { pref_state: p.pref_state }); emit('profile'); toast(`Showing ${stateLabel(p.pref_state)}`, 'pin'); }
  catch (e) { p.pref_state = prev; toast(api.friendly(e), 'x'); }
}

// mode 'filter' = who to show in Discover; 'mine' = the state on your own card.
async function pickState(mode) {
  const p = state.profile;
  const current = mode === 'filter' ? p.pref_state : p.state;
  const list = h('div', { class: 'state-list' });
  let counts = {};
  const draw = (q = '') => {
    const ql = q.trim().toLowerCase();
    const rows = STATES.filter((st) => !ql || stateLabel(st).toLowerCase().includes(ql));
    list.replaceChildren(
      mode === 'filter' && !ql ? option('', 'Anywhere in Nigeria', null) : null,
      mode === 'filter' && p.state && !ql ? option(p.state, `${stateLabel(p.state)} · your state`, counts[p.state]) : null,
      ...rows.filter((st) => !(mode === 'filter' && st === p.state && !ql)).map((st) => option(st, stateLabel(st), counts[st])));
  };
  const option = (value, label, n) => h('button', { class: `state-opt ${(current || '') === value ? 'on' : ''}`, onclick: async () => {
    close();
    if (mode === 'filter') return saveFilter(value);
    try {
      const fields = { state: value, location: value };
      if (!p.pref_state) fields.pref_state = value;
      await api.updateProfile(p.handle, fields);
      Object.assign(p, fields); emit('profile'); toast(`Your state: ${stateLabel(value)}`, 'pin');
    } catch (e) { toast(api.friendly(e), 'x'); }
  } }, h('span', { class: 'grow' }, label), n ? h('span', { class: 'tiny muted' }, `${n} ${n === 1 ? 'person' : 'people'}`) : null, (current || '') === value ? icon('check', 'sm') : null);
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search states…', 'aria-label': 'Search states' });
  search.addEventListener('input', () => draw(search.value));
  const { close } = sheet(() => [
    h('h2', {}, mode === 'filter' ? 'Show people in' : 'Your state'),
    h('p', { class: 'small muted' }, mode === 'filter' ? 'Discover only shows people in the state you pick.' : 'Shown on your card. Only your state, never your exact location.'),
    search, list], { label: mode === 'filter' ? 'Location filter' : 'Your state' });
  draw();
  try { counts = await api.stateCounts(); draw(search.value); } catch {}
}

function datingIntro() {
  return h('div', { class: 'stack-lg' },
    h('div', { class: 'cta-card', style: { textAlign: 'center', justifyItems: 'center', padding: '30px 22px' } },
      h('div', { class: 'empty-art' }, h('span', {}, '🎭')),
      h('h2', { style: { fontSize: '24px' } }, 'Anonymous dating'),
      h('p', {}, 'See someone’s vibe before their face or name. Like them; if they like you back, it’s a match. You both choose when to reveal who you are.'),
      h('button', { class: 'btn btn-coral', onclick: () => startDatingSetup() }, 'Create my dating card (18+)')),
    h('div', { class: 'list' },
      how('💘', 'Like or pass', 'A like sends an anonymous request.'),
      how('✨', 'Match', 'When you both like each other, a chat opens.'),
      how('🎭', 'Reveal together', 'Names show only when you both tap reveal.'),
      how('🛡️', 'Stay safe', 'Block, unmatch or report anyone, any time.')));
}
function how(emoji, title, text) {
  return h('div', { class: 'row', style: { padding: '14px 16px', borderRadius: '18px', background: 'rgba(255,255,255,.07)', color: '#fff' } },
    h('span', { style: { fontSize: '24px' } }, emoji), h('div', {}, h('b', {}, title), h('p', { class: 'small dark-note' }, text)));
}

function renderDeck() {
  const wrap = h('div', {});
  const draw = () => {
    if (!deckLoaded) { wrap.replaceChildren(h('div', { class: 'deck' }, h('div', { class: 'swipe-card', style: { '--av': 'linear-gradient(160deg,#2a1866,#170a38)' } }, h('div', { class: 'card-info' }, h('div', { class: 'spinner' }))))); return; }
    if (!deck.length) {
      wrap.replaceChildren(emptyState('🌙', 'You’ve seen everyone for now', api.features.matching
        ? (state.profile && state.profile.pref_state ? `No new people in ${stateLabel(state.profile.pref_state)} right now. Try another state or anywhere in Nigeria.` : 'New people join all the time. Check your requests in Matches, or widen who you see.')
        : 'New people join all the time. Check back soon.',
      lastPassed ? h('button', { class: 'btn btn-glass', onclick: () => rewind(draw) }, icon('rewind', 'sm'), 'Go back') : null,
      api.features.states && state.profile && state.profile.pref_state ? h('button', { class: 'btn btn-glass', onclick: () => saveFilter(null) }, icon('pin', 'sm'), 'Anywhere in Nigeria') : null,
      h('button', { class: 'btn btn-white', onclick: () => { deckLoaded = false; emptyAt = 0; decided.clear(); fill(true).then(draw); } }, 'Refresh')));
      return;
    }
    const box = h('div', { class: 'deck' });
    deck.slice(0, 3).reverse().forEach((p, i, arr) => {
      const depth = arr.length - 1 - i;
      const card = swipeCard(p, depth);
      if (depth === 0) attachSwipe(card, p, draw);
      box.append(card);
    });
    const top = deck[0];
    const topCard = () => box.querySelector('.swipe-card:last-of-type');
    box.append(api.features.matching
      ? h('div', { class: 'deck-actions' },
        h('button', { class: 'round-btn sm', title: 'Undo pass', 'aria-label': 'Go back to the last person you passed', disabled: !lastPassed, onclick: () => rewind(draw) }, icon('rewind')),
        h('button', { class: 'round-btn pass', title: 'Pass', 'aria-label': 'Pass', onclick: () => fling(topCard(), top, false, draw) }, icon('x')),
        h('button', { class: 'round-btn big', title: 'Like', 'aria-label': 'Like', onclick: (e) => { burst(e.currentTarget); fling(topCard(), top, true, draw); } }, icon('heart')),
        h('button', { class: 'round-btn talk', title: 'Send a message request', 'aria-label': `Send ${top.handle} a message request`, onclick: () => composeTo(top) }, icon('send')))
      : h('div', { class: 'deck-actions' },
        h('button', { class: 'round-btn', 'aria-label': 'Next', onclick: () => fling(topCard(), top, null, draw) }, icon('x')),
        h('button', { class: 'btn btn-coral', onclick: () => composeTo(top) }, icon('chat', 'sm'), 'Message anonymously')));
    wrap.replaceChildren(...[box,
      h('div', { class: 'deck-legend', 'aria-hidden': 'true' }, h('span', {}, 'Undo'), h('span', {}, 'Pass'), h('span', { class: 'date' }, 'Like'), h('span', { class: 'talk' }, 'Request')),
      matchMedia('(pointer: fine)').matches ? h('p', { class: 'tiny dark-note center', style: { marginTop: '6px' } }, 'Keyboard: ← pass, → like.') : null].filter(Boolean));
  };
  currentDraw = draw;
  if (!deckLoaded && !deckLoading) fill().then(() => currentDraw && currentDraw());
  draw();
  keyHandler = (e) => {
    if (!wrap.isConnected || !deck.length || document.querySelector('.scrim, .chat, .match-scrim')) return;
    const card = wrap.querySelector('.swipe-card:last-of-type');
    if (e.key === 'ArrowRight' && api.features.matching) fling(card, deck[0], true, draw);
    if (e.key === 'ArrowLeft') fling(card, deck[0], api.features.matching ? false : null, draw);
  };
  return wrap;
}
let keyHandler = null;
let currentDraw = null;   // the deck on screen now (the screen can be redrawn while cards load)
document.addEventListener('keydown', (e) => { if (keyHandler && !/input|textarea/i.test(e.target.tagName)) keyHandler(e); });

let emptyAt = 0;   // when the last batch came back empty: don't keep asking for a while
async function fill(force = false) {
  if (deckLoading) return;
  if (!force && emptyAt && Date.now() - emptyAt < 10 * 60 * 1000) { deckLoaded = true; return; }
  deckLoading = true;
  try {
    // Bigger, less frequent batches that continue after the people already shown.
    const more = await api.discover(40, [...decided, ...deck.map((p) => p.handle)]);
    emptyAt = more.length ? 0 : Date.now();
    const have = new Set(deck.map((p) => p.handle));
    deck.push(...more.filter((p) => !have.has(p.handle) && !decided.has(p.handle)));
  } catch (e) { if (force) toast(api.friendly(e), 'x'); }
  deckLoaded = true; deckLoading = false;
}

// No photos yet: each card gets artwork made from the person's handle (same colours every time).
function cardArt(p) {
  const n = hash(p.handle);
  const blob = (i, color) => h('span', { class: 'blob', style: {
    width: `${180 + ((n >> i) % 120)}px`, height: `${180 + ((n >> (i + 2)) % 120)}px`,
    left: `${((n >> (i * 3)) % 70) - 10}%`, top: `${((n >> (i * 2 + 1)) % 50) - 5}%`, background: color,
  } });
  return h('div', { class: 'swipe-art' },
    blob(1, 'rgba(255,255,255,.35)'), blob(4, 'rgba(255,95,162,.55)'), blob(7, 'rgba(56,189,248,.45)'),
    h('span', { class: 'big-initials', 'data-av-handle': p.handle }, initials(p.handle)));
}

function swipeCard(p, depth) {
  const likesYou = state.requests.some((r) => r.handle === p.handle);
  const ints = p.interests || [];
  return h('article', { class: `swipe-card ${depth === 1 ? 'behind' : depth === 2 ? 'behind-2' : ''}`, style: { '--av': avatarBg(p.handle) }, 'aria-label': `${p.handle}, ${meta(p)}` },
    cardArt(p),
    h('span', { class: 'stamp like' }, 'LIKE'), h('span', { class: 'stamp nope' }, 'NOPE'),
    h('div', { class: 'card-badge' }, '🎭 Anonymous until you both reveal',
      h('button', { 'aria-label': 'How anonymous dating works', onclick: (e) => { e.stopPropagation(); anonInfo(); } }, 'i')),
    likesYou ? h('span', { class: 'liked-you' }, '💘 Likes you') : null,
    h('div', { class: 'card-info' },
      h('button', { class: 'card-more', 'aria-label': `View ${p.handle}’s profile`, onclick: (e) => { e.stopPropagation(); cardProfile(p); } }, icon('info')),
      h('h2', {}, `${shortName(p.handle)}, ${p.age}`, p.online ? onlineDot() : null),
      activeText(p.online, p.active_hours) ? h('span', { class: `active-line ${p.online ? 'on' : ''}` }, activeText(p.online, p.active_hours)) : null,
      h('span', { class: 'where' }, icon('pin', 'sm'), [p.location, GENDER_LABEL[p.gender]].filter(Boolean).join(' · ')),
      p.bio ? h('p', { class: 'bio' }, p.bio) : null,
      h('div', { class: 'chips' },
        h('span', { class: 'chip static intent' }, INTENT_LABEL[p.intent]),
        ints.slice(0, 2).map((i) => h('span', { class: 'chip static' }, i)),
        ints.length > 2 ? h('span', { class: 'chip static' }, `+${ints.length - 2}`) : null)));
}

function anonInfo() {
  sheet((close) => [h('h2', {}, '🎭 Anonymous until you both reveal'),
    h('p', { class: 'muted' }, 'You see a nickname, age, area, what they’re looking for and their bio. Their name stays hidden, and so does yours.'),
    h('div', { class: 'stack', style: { marginTop: '12px' } },
      h('p', {}, '💘 Like them: if they like you back, it’s a match and a chat opens.'),
      h('p', {}, '📩 Or message them: it arrives as a message request and becomes a chat when they reply.'),
      h('p', {}, '🔓 Names are shown only after you both tap “Reveal”.'),
      h('p', {}, '🛡️ You can unmatch, block or report from any chat.')),
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn btn-primary btn-block', onclick: close }, 'Got it'))], { label: 'How it works' });
}

function attachSwipe(card, p, draw) {
  let x0 = 0, y0 = 0, dx = 0, dy = 0, dragging = false;
  const like = card.querySelector('.stamp.like'), nope = card.querySelector('.stamp.nope');
  card.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    dragging = true; x0 = e.clientX; y0 = e.clientY; dx = dy = 0;
    card.setPointerCapture(e.pointerId); card.classList.remove('animating');
  });
  card.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dx = e.clientX - x0; dy = e.clientY - y0;
    card.style.transform = `translate(${dx}px, ${dy * 0.4}px) rotate(${dx / 18}deg)`;
    if (api.features.matching) { like.style.opacity = Math.max(0, Math.min(1, dx / 90)); nope.style.opacity = Math.max(0, Math.min(1, -dx / 90)); }
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    if (Math.abs(dx) > 110) fling(card, p, api.features.matching ? dx > 0 : null, draw);
    else { card.classList.add('animating'); card.style.transform = ''; like.style.opacity = nope.style.opacity = 0; }
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

// like: true = like, false = pass, null = just next (before matching is switched on)
async function fling(card, p, like, draw) {
  if (!card || !p || card.dataset.gone) return;
  card.dataset.gone = '1';
  const dir = like === true ? 1 : -1;
  card.classList.add('animating');
  card.style.transform = `translate(${dir * 140}%, -30px) rotate(${dir * 24}deg)`;
  card.style.opacity = '0';
  const stamp = card.querySelector(like ? '.stamp.like' : '.stamp.nope');
  if (stamp && like !== null) stamp.style.opacity = 1;
  decided.add(p.handle);
  deck = deck.filter((x) => x.handle !== p.handle);
  lastPassed = like === false ? p : null;
  setTimeout(draw, 260);
  if (deck.length < 3) fill().then(() => { if (deck.length >= 1 && currentDraw) currentDraw(); });
  if (like === null) return;
  try {
    const r = await api.likeProfile(p.handle, like);
    state.requests = state.requests.filter((x) => x.handle !== p.handle);
    if (r.matched && r.conversation_id) { await loadDating({ force: true }); matchMoment(p, r.conversation_id); }
    else if (like) state.pendingLikes += 1;
    emit('dating');
  } catch (e) { toast(api.friendly(e), 'x'); }
}

// Rewind brings back the last person you passed. Liking them now simply replaces the pass.
function rewind(draw) {
  if (!lastPassed) return;
  const p = lastPassed;
  lastPassed = null;
  decided.delete(p.handle);
  deck.unshift(p);
  draw();
}

// The full anonymous profile behind a card, with the same choices as the deck.
function cardProfile(p) {
  const ints = p.interests || [];
  const active = activeText(p.online, p.active_hours);
  const likesYou = state.requests.some((r) => r.handle === p.handle);
  sheet((close) => [
    h('div', { class: 'pc' },
      h('div', { class: 'pc-av' }, avatar(p.handle, p.handle, 'xl'), p.online ? h('i') : null),
      h('h2', {}, p.handle),
      h('p', { class: 'pc-sub' }, [`${p.age}`, GENDER_LABEL[p.gender], p.location].filter(Boolean).join(' · ')),
      active ? h('span', { class: `pc-status ${p.online ? 'on' : ''}` }, active) : null,
      likesYou ? h('span', { class: 'pc-likes' }, '💘 Likes you') : null),
    h('div', { class: 'pc-about' },
      h('h3', {}, 'About'),
      h('p', { class: 'muted' }, p.bio || 'No bio yet.'),
      h('div', { class: 'pc-facts' },
        h('span', {}, icon('heart', 'sm'), `Looking for: ${INTENT_LABEL[p.intent] || 'Not set'}`),
        p.location ? h('span', {}, icon('pin', 'sm'), p.location) : null),
      ints.length ? h('div', { class: 'chips' }, ints.map((i) => h('span', { class: 'chip static' }, i))) : null,
      h('p', { class: 'tiny muted', style: { marginTop: '8px' } }, '🎭 Names stay hidden until you both choose to reveal.')),
    api.features.matching ? h('div', { class: 'sheet-actions two' },
      h('button', { class: 'btn btn-coral', onclick: () => { close(); const card = document.querySelector('.deck .swipe-card:last-of-type'); if (deck[0] && deck[0].handle === p.handle) fling(card, p, true, currentDraw); else likeOnly(p); } }, icon('heart', 'sm'), 'Like'),
      h('button', { class: 'btn btn-primary', onclick: () => { close(); composeTo(p); } }, icon('send', 'sm'), 'Message request')) : null,
  ], { label: `${p.handle}’s profile` });
}
async function likeOnly(p) {
  try {
    const r = await api.likeProfile(p.handle, true);
    if (r.matched && r.conversation_id) { await loadDating({ force: true }); matchMoment(p, r.conversation_id); } else toast('Like sent 💘', 'heart');
  } catch (e) { toast(api.friendly(e), 'x'); }
}
// A little heart burst on the like button.
function burst(btn) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < 6; i++) {
    const hrt = h('i', { class: 'heart-burst', style: { '--dx': `${Math.cos((i / 6) * Math.PI * 2) * 46}px`, '--dy': `${Math.sin((i / 6) * Math.PI * 2) * 46 - 20}px` } }, '♥');
    btn.append(hrt);
    setTimeout(() => hrt.remove(), 700);
  }
}

// Message anyone. If they haven't liked you, it arrives as a message request: it moves to their
// chats when they reply. You can send up to 3 messages until then.
export function composeTo(p, { friend = false } = {}) {
  const text = h('textarea', { class: 'textarea', maxlength: '1000', placeholder: friend ? 'Say hi and why you’d like to be friends…' : 'Say something that gets a reply…' });
  const err = h('p', { class: 'error', role: 'alert' });
  const likedMe = !friend && state.requests.some((r) => r.handle === p.handle);
  const send = h('button', { class: 'btn btn-primary btn-block' }, icon(friend ? 'userplus' : 'send', 'sm'), friend ? 'Send friend request' : likedMe ? 'Send message' : 'Send message request');
  sheet((close) => {
    send.onclick = async () => {
      const body = text.value.trim();
      if (!body) return (err.textContent = 'Write a message first.');
      send.disabled = true;
      try {
        const conv = friend ? await api.startFriend(p.handle) : await api.startChat(p.handle);
        await api.sendMessage(conv, body);
        await loadDating({ force: true });
        close();
        const c = state.convos.find((x) => x.conversation_id === conv);
        if (c && statusOf(c) === 'chat') nav.openChat(conv);
        else toast(friend ? 'Friend request sent 👋' : 'Message request sent 📩', friend ? 'userplus' : 'send');
        decided.add(p.handle);
        deck = deck.filter((x) => x.handle !== p.handle);
        emit('dating');
        if (location.pathname.startsWith('/home/discover')) nav.rerender();
      } catch (e) { err.textContent = api.friendly(e); send.disabled = false; }
    };
    return [
      h('div', { class: 'row' }, avatar(p.handle, p.handle, 'lg'), h('div', { class: 'grow' }, h('h2', {}, friend ? `Add ${shortName(p.handle)} as a friend` : likedMe ? `Message ${shortName(p.handle)}` : 'Message request'), h('p', { class: 'small muted' }, [p.handle, meta(p)].filter(Boolean).join(' · ')))),
      h('p', { class: 'small muted', style: { margin: '10px 0' } }, friend
        ? 'They’ll get a friend request with your message. If they accept, you’re friends: chat any time, and you can both reveal your first names. You stay anonymous until then.'
        : likedMe
        ? '💘 They already liked you, so this opens a chat straight away.'
        : 'They’ll see it in their Requests and can accept or decline. If they accept, you can chat. You stay anonymous either way.'),
      text, err, h('div', { class: 'sheet-actions' }, send)];
  }, { label: `Message ${p.handle}` });
}

// ---- The match moment ------------------------------------------------------------------------------
export function matchMoment(p, conversationId) {
  const colors = ['#ff3f9b', '#12b9f5', '#b8b2ff', '#ffffff', '#ff6fb4'];
  const confetti = Array.from({ length: 40 }, (_, i) => h('i', { class: 'confetti', style: {
    left: `${Math.random() * 100}%`, background: colors[i % colors.length],
    animationDuration: `${2.2 + Math.random() * 2}s`, animationDelay: `${Math.random() * .6}s`,
  } }));
  const scrim = h('div', { class: 'match-scrim', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'It’s a match' }, confetti,
    h('div', { class: 'match-box' },
      h('div', { class: 'match-avatars' },
        avatar(state.profile.handle, state.profile.handle), h('span', { class: 'match-heart' }, icon('heart')), avatar(p.handle, p.handle)),
      h('p', { class: 'match-kicker' }, 'Mutual like'),
      h('h1', {}, 'It’s a match!'),
      h('p', {}, `You and ${p.handle} like each other. You’re both still anonymous: say hi and see where it goes.`),
      h('div', { class: 'match-actions' },
        h('button', { class: 'btn btn-coral btn-block', onclick: () => { scrim.remove(); nav.openChat(conversationId); } }, icon('chat', 'sm'), 'Send a message'),
        h('button', { class: 'btn btn-glass btn-block', onclick: () => scrim.remove() }, 'Keep discovering'))));
  document.body.append(scrim);
  if (navigator.vibrate) navigator.vibrate([30, 40, 60]);
}

// ---- Connections: matches / chats / likes / message requests ---------------------------------------
export function renderMatches(sub) {
  if (!state.profile) return h('div', { class: 'stack-lg' }, hero({ title: 'Inbox', sub: 'Private chats with people on treehouse.' }), lightIntro());
  const view = sub === 'requests' ? 'requests' : sub === 'friends' ? 'friends' : (sub === 'matches' || sub === 'likes') ? 'matches' : 'chats';
  const live = state.convos.filter((c) => !c.blocked);
  const requests = messageRequests();
  // Chats: only conversations you can actually talk in (requests, sent or received, live under Requests).
  const chats = state.convos.filter((c) => c.blocked ? !!c.last_message : statusOf(c) === 'chat' && !!c.last_message);
  const fresh = live.filter((c) => statusOf(c) === 'chat' && !c.last_message && !isFriend(c));
  const friends = friendsList();
  const friendsOn = friends.filter((f) => f.other_online).length;
  const unread = chats.reduce((n, c) => n + (c.unread ? 1 : 0), 0);

  const card = (id, label, ico, kind, badge, extra) => h('button', { class: `ib-tab t-${kind}`, role: 'tab', 'aria-selected': String(view === id),
    onclick: () => { if (view !== id) go(id === 'chats' ? 'matches' : `matches/${id}`); } },
    h('span', { class: 'ib-tab-ico' }, icon(ico, id === 'matches' && view === id ? 'fill' : '')),
    h('span', { class: 'ib-tab-label' }, label),
    extra || null,
    badge ? h('span', { class: `badge ${kind === 'match' ? 'date' : 'talk'}` }, badge > 99 ? '99+' : badge) : null);
  const head = hero({ top: logo(), cls: 'inbox-hero', title: 'Inbox', sub: 'Messages, friends, requests and matches.',
    actions: [nav.bell(), heroBtn('gear', 'Settings', () => go('profile'))] },
    h('div', { class: 'ib-tabs', role: 'tablist', 'aria-label': 'Inbox sections' },
      card('chats', 'Chats', 'chat', 'chat', unread),
      card('requests', 'Requests', 'send', 'req', requests.length + matchFriendAsks().length),
      card('friends', 'Friends', 'rooms', 'friend', 0,
        h('span', { class: 'ib-tab-count', 'aria-label': `${friendsOn} of ${friends.length} friends online` }, friendsOn ? h('i', { class: 'ib-tab-on' }) : null, `${friendsOn} / ${friends.length}`)),
      card('matches', 'Matches', 'heart', 'match', fresh.length + state.requests.length)));

  let body;
  if (view === 'requests') body = renderRequestsTab(requests);
  else if (view === 'matches') body = renderMatchesTab(fresh, sub === 'likes');
  else if (view === 'friends') body = renderFriendsTab();
  else body = renderChatsTab(chats, live);
  return h('div', { class: 'stack-lg inbox' }, head, h('div', { class: 'below-hero ib-body', key: view }, body),
    h('p', { class: 'tiny muted center' }, '🎭 Everyone stays anonymous until you both choose to reveal.'));
}

const searchBox = (placeholder, value, oninput) => h('label', { class: 'ib-search' }, icon('search', 'sm'),
  h('input', { type: 'search', placeholder, value, 'aria-label': placeholder, oninput: (e) => oninput(e.target.value) }));

// ---- Chats: quick view of who's online, then your private conversations -------------------------
let chatQuery = '';
function renderChatsTab(chats, live) {
  const onlineNow = live.filter((c) => statusOf(c) === 'chat' && c.other_online)
    .sort((a, b) => (isFriend(b) ? 1 : 0) - (isFriend(a) ? 1 : 0) || recent(b) - recent(a));
  const me = state.myStatus;
  const quick = h('section', {},
    h('div', { class: 'section-head' }, h('h2', {}, 'Quick view')),
    h('div', { class: 'friend-strip ib-quick' },
      h('button', { class: 'fs-item ib-add', onclick: () => import('./hy-home.js').then((m) => m.statusEditor()), title: me ? me.body : 'Add your status' },
        h('span', { class: 'ib-add-av' }, icon(me ? 'edit' : 'plus')),
        h('span', { class: 'fs-name ellipsis' }, me ? 'My status' : 'Add status')),
      onlineNow.slice(0, 15).map((c) => h('button', { class: 'fs-item on', onclick: () => nav.openChat(c.conversation_id), title: c.friend_status ? c.friend_status.body : '' },
        h('span', { class: `fs-av ${isMatch(c) ? 'match' : ''}` }, avatar(c.other_handle, nameOf(c), 'lg'), h('i')),
        h('span', { class: 'fs-name ellipsis' }, shortName(nameOf(c)))))),
    onlineNow.length ? null : h('p', { class: 'tiny muted' }, 'Nobody you chat with is online right now.'));
  if (!chats.length) {
    return h('div', { class: 'stack-lg' }, quick,
      emptyState('💬', 'No conversations yet', 'Start connecting with people: match in Discover, add friends in Chatrooms, or accept a request.',
        h('div', { class: 'row center-row' },
          h('button', { class: 'btn btn-coral btn-sm', onclick: () => go('discover') }, icon('flame', 'sm'), 'Discover'),
          h('button', { class: 'btn btn-primary btn-sm', onclick: () => go('rooms') }, icon('rooms', 'sm'), 'Chatrooms'))));
  }
  const listEl = h('div');
  const draw = () => {
    const q = chatQuery.trim().toLowerCase();
    const list = chats.filter((c) => !q || nameOf(c).toLowerCase().includes(q) || c.other_handle.toLowerCase().includes(q) || (c.last_message || '').toLowerCase().includes(q));
    listEl.replaceChildren(list.length ? chatList(list) : h('div', { class: 'card ib-empty' }, h('p', {}, 'No chats match your search.')));
  };
  draw();
  return h('div', { class: 'stack-lg' }, quick,
    h('section', { class: 'stack' },
      h('div', { class: 'section-head' }, h('h2', {}, 'Recent chats'), h('span', { class: 'small muted' }, `${chats.length} chat${chats.length === 1 ? '' : 's'}`)),
      chats.length > 3 ? searchBox('Search conversations', chatQuery, (v) => { chatQuery = v; draw(); }) : null,
      listEl));
}

// ---- Requests: friend requests and message requests, kept apart ----------------------------------
let reqChoice = null;   // the request type you picked; until then, whichever has something waiting
function renderRequestsTab(requests) {
  const sent = state.convos.filter((c) => !c.blocked && statusOf(c) === 'sent');
  // Friend requests made inside match chats count as friend requests too.
  const askIn = matchFriendAsks();
  const askOut = state.convos.filter((c) => !c.blocked && c.friendAsk === 'mine' && !isFriend(c));
  const inFriend = [...requests.filter(isFriend), ...askIn], inMsg = requests.filter((c) => !isFriend(c));
  const sentFriend = [...sent.filter(isFriend), ...askOut], sentMsg = sent.filter((c) => !isFriend(c));
  let reqView = reqChoice || (inFriend.length || (!inMsg.length && sentFriend.length) ? 'friend' : 'message');
  const wrap = h('div', { class: 'stack-lg' });
  const draw = () => {
    const friend = reqView === 'friend';
    const incoming = friend ? inFriend : inMsg, out = friend ? sentFriend : sentMsg;
    const seg = (id, label, ico, n) => h('button', { class: `ib-subtab t-${id}`, role: 'tab', 'aria-selected': String(reqView === id), onclick: () => { reqView = reqChoice = id; draw(); } },
      icon(ico, 'sm'), label, n ? h('span', { class: 'badge talk' }, n) : null);
    wrap.replaceChildren(...[
      h('div', { class: 'ib-subtabs', role: 'tablist', 'aria-label': 'Request type' },
        seg('friend', 'Friends', 'userplus', inFriend.length), seg('message', 'Messages', 'mail', inMsg.length)),
      h('div', { class: 'ib-note' }, h('span', {}, friend ? '👋' : '✉️'), h('span', {}, friend
        ? 'Accepting a friend request makes you friends: you see each other’s status and can chat. Opening a request doesn’t accept it.'
        : 'Accepting a message request lets you chat, but doesn’t make you friends. They can’t see that you’ve opened it.')),
      h('section', { class: 'stack' },
        h('div', { class: 'section-head' }, h('h2', {}, friend ? 'Friend requests' : 'Message requests'), incoming.length ? h('span', { class: 'small muted' }, `${incoming.length} waiting`) : null),
        incoming.length ? h('div', { class: 'list' }, incoming.map((c) => (c.friendAsk === 'theirs' ? matchAskCard(c) : requestCard(c))))
          : h('div', { class: 'card ib-empty' }, h('p', {}, 'You’re all caught up. New requests will appear here.'),
            friend ? h('button', { class: 'btn btn-primary btn-sm', onclick: () => go('rooms') }, icon('rooms', 'sm'), 'Meet people in Chatrooms') : null)),
      out.length ? h('section', { class: 'stack' }, h('div', { class: 'section-head' }, h('h2', {}, 'You sent'), h('span', { class: 'small muted' }, `${out.length} pending`)),
        h('div', { class: 'card ib-list' }, out.map((c) => h('div', { class: 'sent-row' }, convoRow(c),
          c.friendAsk === 'mine' ? h('span', { class: 'pill friend sent-pending' }, 'Pending') : null,
          h('button', { class: 'btn btn-ghost btn-sm sent-cancel', 'aria-label': `Cancel your request to ${c.other_handle}`,
            onclick: () => (c.friendAsk === 'mine' ? cancelMatchAsk(c) : cancelSent(c)) }, 'Cancel'))))) : null].filter(Boolean));
  };
  draw();
  return wrap;
}

// Take back a request you sent (friend or message), before they accept it.
async function cancelSent(c) {
  const friend = isFriend(c);
  if (!(await confirmSheet({ title: `Cancel your ${friend ? 'friend' : 'message'} request?`, yes: 'Cancel request', danger: true,
    text: `It disappears for ${c.other_handle} too, with anything you sent with it.` }))) return false;
  try {
    await api.cancelRequest(c.conversation_id);
    if (chat && chat.convo && chat.convo.conversation_id === c.conversation_id) go('matches', { replace: true });
    await loadDating({ force: true });
    toast('Request cancelled', 'x');
    return true;
  } catch (e) { toast(api.friendly(e), 'x'); return false; }
}

// A match who asked to be friends (sent from your match chat): accept or decline right here.
function matchAskCard(c) {
  const busy = (btn, fn) => async () => { btn.disabled = true; try { await fn(); } finally { btn.disabled = false; } };
  const accept = h('button', { class: 'btn btn-primary btn-sm' }, icon('check', 'sm'), 'Accept');
  const decline = h('button', { class: 'btn btn-ghost btn-sm' }, 'Decline');
  accept.onclick = busy(accept, () => askFriend(c, true));
  decline.onclick = busy(decline, async () => {
    try { await api.askFriend(c.conversation_id, false); await loadDating({ force: true }); toast('Friend request declined', 'x'); }
    catch (e) { toast(api.friendly(e), 'x'); }
  });
  return h('article', { class: 'req-card' },
    h('button', { class: 'req-top', onclick: () => nav.openChat(c.conversation_id), 'aria-label': `Open your chat with ${nameOf(c)}` },
      h('span', { class: 'ib-av' }, avatar(c.other_handle, nameOf(c), 'lg'), c.other_online ? h('i', { class: 'on' }) : null),
      h('span', { class: 'grow' },
        h('span', { class: 'row-between' }, h('b', { class: 'ellipsis' }, nameOf(c), h('span', { class: 'pill friend' }, '👋 Friend')), h('span', { class: 'when' }, ago(c.last_at))),
        h('span', { class: 'req-meta' }, 'Your match wants to be friends'))),
    h('div', { class: 'req-actions' }, accept, decline));
}

async function cancelMatchAsk(c) {
  if (!(await confirmSheet({ title: 'Cancel your friend request?', yes: 'Cancel request', danger: true,
    text: `${nameOf(c)} won’t see it any more. Your chat stays as it is.` }))) return;
  try { await api.askFriend(c.conversation_id, false); await loadDating({ force: true }); toast('Friend request cancelled', 'x'); }
  catch (e) { toast(api.friendly(e), 'x'); }
}

function requestCard(c) {
  const busy = (btn, fn) => async () => { btn.disabled = true; try { await fn(); } finally { btn.disabled = false; } };
  const accept = h('button', { class: 'btn btn-primary btn-sm' }, icon('check', 'sm'), 'Accept');
  const decline = h('button', { class: 'btn btn-ghost btn-sm' }, 'Decline');
  accept.onclick = busy(accept, () => acceptRequest(c));
  decline.onclick = busy(decline, () => declineRequest(c, false));
  return h('article', { class: `req-card ${c.unread ? 'unread' : ''}` },
    h('button', { class: 'req-top', onclick: () => nav.openChat(c.conversation_id), 'aria-label': `Open request from ${c.other_handle}` },
      h('span', { class: 'ib-av' }, avatar(c.other_handle, c.other_handle, 'lg'), c.other_online ? h('i', { class: 'on' }) : null),
      h('span', { class: 'grow' },
        h('span', { class: 'row-between' }, h('b', { class: 'ellipsis' }, c.other_handle, h('span', { class: `pill ${isFriend(c) ? 'friend' : 'msg'}` }, isFriend(c) ? '👋 Friend' : '✉️ Message')), h('span', { class: 'when' }, ago(c.last_at))),
        h('span', { class: 'req-meta' }, meta({ age: c.other_age, gender: c.other_gender, location: c.other_location }), c.other_intent ? ` · ${INTENT_LABEL[c.other_intent]}` : ''))),
    c.last_message ? h('p', { class: 'req-msg' }, c.last_message) : null,
    h('div', { class: 'req-actions' }, accept, decline,
      h('button', { class: 'btn btn-ghost btn-sm btn-icon', 'aria-label': 'More options', onclick: () => requestMenu(c) }, icon('more'))));
}

function requestMenu(c) {
  sheet((close) => [
    h('h2', {}, c.other_handle),
    h('div', { class: 'menu-list', style: { marginTop: '10px' } },
      h('button', { class: 'menu-item', onclick: () => { close(); partnerProfile(c); } }, icon('user'), 'View profile'),
      h('button', { class: 'menu-item', onclick: () => { close(); nav.openChat(c.conversation_id); } }, icon('chat'), 'Open request'),
      h('button', { class: 'menu-item danger', onclick: async () => {
        close();
        if (!(await confirmSheet({ title: `Block ${c.other_handle}?`, text: 'They can’t message you or see you in Discover. They aren’t told.', yes: 'Block', danger: true }))) return;
        try { await api.blockPartner(c.conversation_id); toast('Blocked', 'shield'); await loadDating({ force: true }); } catch (e) { toast(api.friendly(e), 'x'); }
      } }, icon('shield'), 'Block'),
      h('button', { class: 'menu-item danger', onclick: () => { close(); reportSheet(c); } }, icon('flag'), 'Report')),
  ], { label: 'Request options' });
}

async function acceptRequest(c) {
  try {
    await api.acceptRequest(c.conversation_id);
    await loadDating({ force: true });
    toast(isFriend(c) ? `You and ${shortName(c.other_handle)} are friends now 👋` : `You can chat with ${shortName(c.other_handle)} now`, 'check');
    if (chat && chat.id === c.conversation_id) { chat.convo = state.convos.find((x) => x.conversation_id === c.conversation_id) || chat.convo; closeChat(); nav.openChat(c.conversation_id); }
  } catch (e) { toast(api.friendly(e), 'x'); }
}

// ---- Friends: people you added from chatrooms ------------------------------------------------------
let friendFilter = 'all', friendQuery = '';
function renderFriendsTab() {
  const all = friendsList();
  const online = all.filter((f) => f.other_online);
  const listEl = h('div');
  const draw = () => {
    const q = friendQuery.trim().toLowerCase();
    let list = (friendFilter === 'online' ? online : all).filter((f) => !q || nameOf(f).toLowerCase().includes(q) || f.other_handle.toLowerCase().includes(q));
    list = list.slice().sort((a, b) => (b.other_online ? 1 : 0) - (a.other_online ? 1 : 0) || (a.other_active_hours ?? 1e9) - (b.other_active_hours ?? 1e9));
    listEl.replaceChildren(list.length ? h('div', { class: 'card ib-list friend-list' }, list.map(friendRow))
      : h('div', { class: 'card ib-empty' }, h('p', {}, q ? 'No friend by that name.' : 'None of your friends are online right now.')));
  };
  if (!all.length) {
    return h('div', { class: 'stack-lg' },
      emptyState('👋', 'No friends yet', 'Meet people in your chatrooms and send friend requests: tap someone’s name, then Add friend.',
        h('button', { class: 'btn btn-primary', onclick: () => go('rooms') }, icon('rooms', 'sm'), 'Go to Chatrooms')),
      friendActivity(all));
  }
  const chip = (id, label) => h('button', { class: `chip ${friendFilter === id ? 'on' : ''}`, onclick: (e) => { friendFilter = id; e.currentTarget.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === e.currentTarget)); draw(); } }, label);
  draw();
  return h('div', { class: 'stack-lg' },
    h('div', { class: 'card friends-sum' },
      h('div', { class: 'fsum' }, h('b', {}, String(all.length)), h('span', {}, all.length === 1 ? 'Friend' : 'Friends')),
      h('div', { class: 'fsum on' }, h('b', {}, h('i'), String(online.length)), h('span', {}, 'Online')),
      h('div', { class: 'chips' }, chip('all', 'All'), chip('online', 'Online'))),
    searchBox('Search friends', friendQuery, (v) => { friendQuery = v; draw(); }),
    listEl,
    friendActivity(all));
}

// Recent things your friends did: status posts and friendships accepted.
function friendActivity(all) {
  const items = [];
  for (const f of all) {
    if (f.friend_status) items.push({ at: f.friend_status.updated_at, f, kind: 'status' });
    if (f.accepted_at) items.push({ at: f.accepted_at, f, kind: 'friends' });
  }
  if (!items.length) return null;
  items.sort((a, b) => new Date(b.at) - new Date(a.at));
  return h('section', { class: 'stack' }, h('div', { class: 'section-head' }, h('h2', {}, 'Friend activity')),
    h('div', { class: 'card ib-list' }, items.slice(0, 6).map(({ f, kind, at }) => h('button', { class: 'ib-row fa-row', onclick: () => kind === 'status' ? partnerProfile(f) : nav.openChat(f.conversation_id) },
      h('span', { class: `fa-ico ${kind}` }, icon(kind === 'status' ? 'chat' : 'userplus')),
      h('span', { class: 'grow' },
        h('span', { class: 'row-between' }, h('b', {}, h('span', { class: 'ellipsis' }, kind === 'status' ? `${nameOf(f)} updated their status` : `You and ${nameOf(f)} are now friends`)), h('span', { class: 'when' }, ago(at))),
        h('span', { class: 'preview' }, h('span', { class: 'ellipsis' }, kind === 'status' ? `“${f.friend_status.body}”` : f.last_message ? 'Tap to open your chat' : 'Say hi 👋')))))));
}

function friendRow(f) {
  const st = f.friend_status;
  const sub = st ? `“${st.body}”` : f.other_online ? 'Online now' : activeText(false, f.other_active_hours) || 'Offline';
  return h('div', { class: 'friend-row' },
    h('button', { class: 'fr-main', onclick: () => partnerProfile(f), 'aria-label': `${nameOf(f)}’s profile` },
      h('span', { class: 'ib-av' }, avatar(f.other_handle, nameOf(f), 'lg'), f.other_online ? h('i', { class: 'on' }) : null),
      h('span', { class: 'grow' }, h('b', { class: 'ellipsis' }, nameOf(f)),
        h('span', { class: `fr-sub ellipsis ${st ? 'status' : ''}` }, sub),
        st && !f.other_online ? h('span', { class: 'fr-away' }, activeText(false, f.other_active_hours)) : null)),
    h('button', { class: 'btn btn-soft btn-sm fr-msg', onclick: () => nav.openChat(f.conversation_id), 'aria-label': `Message ${nameOf(f)}` }, icon('chat', 'sm'), h('span', { class: 'fr-msg-t' }, 'Message')));
}

// ---- Matches: new matches, likes you, all matches ---------------------------------------------------
function renderMatchesTab(fresh, focusLikes) {
  const matches = state.convos.filter((c) => !c.blocked && statusOf(c) === 'chat' && isMatch(c));

  const likes = renderLikes();
  const el = h('div', { class: 'stack-lg' },
    fresh.length ? h('section', {}, h('div', { class: 'section-head' }, h('h2', {}, 'New connections'), h('span', { class: 'small muted' }, 'Say hi first')),
      h('div', { class: 'story-row' }, fresh.map((c) => h('button', { class: 'story new', onclick: () => nav.openChat(c.conversation_id) },
        h('span', { class: 'story-av' }, avatar(c.other_handle, c.other_handle, 'lg'), h('span', { class: 'heart-dot' }, icon(isMatch(c) ? 'heart' : 'check', 'fill'))),
        h('span', {}, shortName(c.other_handle)))))) : null,
    h('section', { id: 'likes-you' }, h('div', { class: 'section-head' }, h('h2', {}, 'Likes you'), state.requests.length ? h('span', { class: 'pill date' }, state.requests.length) : null), likes),
    h('section', {}, h('div', { class: 'section-head' }, h('h2', {}, 'Your matches'), h('span', { class: 'small muted' }, 'You both liked each other')),
      matches.length ? h('div', { class: 'card ib-list' }, matches.map((c) => convoRow(c)))
        : h('div', { class: 'card ib-empty' }, h('p', {}, 'No matches yet. Keep discovering people: when you both like each other, you’ll match.'),
          h('button', { class: 'btn btn-coral btn-sm', onclick: () => go('discover') }, icon('flame', 'sm'), 'Go to Discover'))));
  if (focusLikes) setTimeout(() => { const t = el.querySelector('#likes-you'); if (t) t.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 60);
  return el;
}

function lightIntro() {
  return h('div', { class: 'card center stack' }, h('div', { class: 'empty-art', style: { justifySelf: 'center' } }, h('span', {}, '🎭')),
    h('h2', {}, 'Anonymous dating'), h('p', { class: 'muted' }, 'Create your dating card (18+) to start matching. Names stay hidden until you both reveal.'),
    h('button', { class: 'btn btn-coral', onclick: () => startDatingSetup() }, 'Create my dating card'));
}

// Chats: people online now at the top (newest message first), then everyone else by who was active
// most recently, showing when they were last active. Closed chats go last. Sorted on the phone from
// data the chat list already has, so it costs the server nothing.
const recent = (c) => new Date(c.last_at).getTime() || 0;
function chatOrder(a, b) {
  const rank = (c) => (c.blocked ? 2 : c.other_online ? 0 : 1);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (rank(a) === 1) {
    const ha = a.other_active_hours ?? Infinity, hb = b.other_active_hours ?? Infinity;
    if (ha !== hb) return ha - hb;
  }
  return recent(b) - recent(a);
}
function chatList(list) {
  if (!list.length) return emptyState('💬', 'No chats yet', 'Match with someone in Discover, or accept a message request, and your chats show up here.',
    h('button', { class: 'btn btn-coral', onclick: () => go('discover') }, icon('flame', 'sm'), 'Start discovering'));
  const sorted = [...list].sort(chatOrder);
  const online = sorted.filter((c) => !c.blocked && c.other_online);
  const rest = sorted.filter((c) => c.blocked || !c.other_online);
  const label = (text, n) => h('div', { class: 'ib-group' }, h('span', {}, text), n != null ? h('span', { class: 'ib-group-n' }, String(n)) : null);
  return h('div', { class: 'card ib-list' },
    online.length ? label('Online now', online.length) : null,
    online.map((c) => convoRow(c)),
    online.length && rest.length ? label('Other chats') : null,
    rest.map((c) => convoRow(c, { lastActive: true })));
}

function convoRow(c, { lastActive = false } = {}) {
  const st = statusOf(c);
  const away = lastActive && !c.blocked && !c.other_online ? activeText(false, c.other_active_hours) : null;
  const preview = c.blocked ? 'Chat closed' : `${c.last_from_me ? 'You: ' : ''}${c.last_message || (isMatch(c) ? 'You matched. Say hi 👋' : isFriend(c) ? 'You’re friends. Say hi 👋' : 'Say hi 👋')}`;
  const seen = !c.blocked && c.last_from_me && c.other_read_at && new Date(c.other_read_at) >= new Date(c.last_at);
  const delivered = !seen && !c.blocked && c.last_from_me && c.other_delivered_at && new Date(c.other_delivered_at) >= new Date(c.last_at);
  return h('button', { class: `ib-row ${c.unread ? 'unread' : ''} ${c.blocked ? 'closed' : ''}`, onclick: () => nav.openChat(c.conversation_id) },
    h('span', { class: 'ib-av' }, avatar(c.other_handle, nameOf(c), 'lg'), c.other_online && !c.blocked ? h('i', { class: 'on' }) : null),
    h('span', { class: 'grow' },
      h('span', { class: 'row-between' },
        h('b', {}, h('span', { class: 'ellipsis' }, nameOf(c)), isMatch(c) ? h('span', { class: 'ib-match', title: 'Match' }, icon('heart', 'fill')) : isFriend(c) ? h('span', { class: 'ib-friend', title: 'Friend' }, '👋') : null),
        h('span', { class: 'when' }, ago(c.last_at))),
      h('span', { class: 'row-between' },
        h('span', { class: 'preview' }, c.last_from_me && !c.blocked && !seen ? h('span', { class: `tick ${delivered ? 'delivered' : ''}`, 'aria-label': delivered ? 'Delivered' : 'Sent' }, icon(delivered ? 'delivered' : 'sent', 'sm')) : null, h('span', { class: 'ellipsis' }, preview)),
        c.unread ? h('span', { class: 'badge talk' }, c.unread) : st === 'sent' ? h('span', { class: 'pill' }, 'Pending')
          : seen ? h('span', { class: 'list-seen', 'aria-label': 'Seen' }, avatar(c.other_handle, c.other_handle, 'xs'))
          : null),
      away ? h('span', { class: 'ib-away' }, away) : null));
}

function renderLikes() {
  if (!api.features.matching) return emptyState('💘', 'Likes are switching on', 'Soon, people who like you will show up here.');
  if (!state.requests.length) return h('div', { class: 'card ib-empty' }, h('p', {}, 'No likes yet. When someone likes you, their anonymous card shows up here. Like them back to match.'));
  return h('div', { class: 'list' }, state.requests.map((r) => h('article', { class: 'like-card' },
    h('div', { class: 'row' }, avatar(r.handle, r.handle, 'lg'),
      h('div', { class: 'grow' }, h('h3', { class: 'ellipsis' }, r.handle), h('p', { class: 'small muted' }, meta(r)), h('p', { class: 'tiny muted' }, `Liked you ${ago(r.requested_at)} ago`)),
      h('span', { class: 'pill date' }, INTENT_LABEL[r.intent])),
    r.bio ? h('p', { class: 'like-bio' }, r.bio) : null,
    r.interests && r.interests.length ? h('div', { class: 'chips' }, r.interests.slice(0, 4).map((i) => h('span', { class: 'chip static' }, i))) : null,
    h('div', { class: 'request-actions' },
      h('button', { class: 'btn btn-ghost btn-sm', onclick: (e) => answer(r, false, e.currentTarget) }, 'Pass'),
      h('button', { class: 'btn btn-coral btn-sm', onclick: (e) => answer(r, true, e.currentTarget) }, icon('heart', 'sm'), 'Like back')))));
}

async function answer(r, accept, btn) {
  btn.disabled = true;
  try {
    const res = await api.likeProfile(r.handle, accept);
    state.requests = state.requests.filter((x) => x.handle !== r.handle);
    decided.add(r.handle);
    deck = deck.filter((x) => x.handle !== r.handle);
    if (accept && res.conversation_id) { await loadDating({ force: true }); matchMoment(r, res.conversation_id); }
    else toast('Passed', 'x');
    emit('dating');
    nav.rerender();
  } catch (e) { btn.disabled = false; toast(api.friendly(e), 'x'); }
}

// ---- Chat ------------------------------------------------------------------------------------------
let chat = null;   // { id, el, channel, convo }

// Phones with an on-screen keyboard (iPhone especially) shrink the visible area and scroll the page
// up instead of resizing it, which pushed the chat header and messages off the top. Keep the chat
// exactly the size of the visible area, above the keyboard, and keep the latest message in view.
// Chat screens (private chats and chatrooms) sit on top of the app. While one is open:
//  * the app behind it is hidden and switched off, so nothing shows through around the keyboard and
//    the phone doesn't offer to jump between other text boxes;
//  * the chat is sized to the space above the keyboard, and the message list stays anchored to the
//    bottom (like WhatsApp): opening or closing the keyboard never hides your latest messages.
// Send buttons keep the keyboard open (like WhatsApp). On phones, tapping a button normally takes
// focus from the message box first: the keyboard closes, the screen jumps and the tap can miss, so
// the message isn't sent. Here the tap is handled on touch-up and focus stays in the box.
export function keepKeyboardOnSend(btn, input) {
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('touchend', (e) => {
    const t = e.changedTouches && e.changedTouches[0];
    const r = btn.getBoundingClientRect();
    if (t && (t.clientX < r.left - 12 || t.clientX > r.right + 12 || t.clientY < r.top - 12 || t.clientY > r.bottom + 12)) return;   // finger slid off
    e.preventDefault();
    if (btn.disabled) return;
    if (btn.form && btn.form.requestSubmit) btn.form.requestSubmit(btn); else btn.click();
    if (document.activeElement !== input) input.focus({ preventScroll: true });
  });
}

export function fitChatToViewport(el, onResize) {
  const shell = document.querySelector('.shell');
  if (shell) shell.setAttribute('inert', '');
  document.body.classList.add('chat-open');
  // Native app: hide the iOS bar above the keyboard (‹ › Done) when the app supports it.
  try { const kb = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard; if (kb && kb.setAccessoryBarVisible) kb.setAccessoryBarVisible({ isVisible: false }); } catch {}
  const scroller = () => el.querySelector('.chat-body');
  let fromBottom = 0, resizing = false;
  const remember = () => { const b = scroller(); if (b && !resizing) fromBottom = b.scrollHeight - b.scrollTop - b.clientHeight; };
  el.addEventListener('scroll', remember, true);
  const vv = window.visualViewport;
  const fit = (initial = false) => {
    resizing = true;
    if (vv) {
      const keyboard = window.innerHeight - vv.height > 120;
      // Size the chat to what's actually on screen. (On some Android phones the page behind can be
      // laid out wider than the screen; the chat must still fit the phone, Send button included.)
      el.style.height = `${vv.height}px`;
      const left = parseFloat(getComputedStyle(el).left) || 0;   // desktop: chat sits beside the sidebar
      el.style.width = `${Math.max(0, vv.width - left)}px`;
      el.style.bottom = 'auto';
      el.style.right = 'auto';
      el.style.transform = `translate(${vv.offsetLeft}px, ${vv.offsetTop}px)`;
      el.classList.toggle('kb-open', keyboard);
    }
    if (initial) { resizing = false; return; }   // first layout: the screen decides where to start
    // Keep the same distance from the newest message as before the keyboard moved.
    const b = scroller();
    if (b) b.scrollTop = b.scrollHeight - b.clientHeight - (fromBottom < 120 ? 0 : fromBottom);
    requestAnimationFrame(() => {
      const b2 = scroller();
      if (b2) b2.scrollTop = b2.scrollHeight - b2.clientHeight - (fromBottom < 120 ? 0 : fromBottom);
      resizing = false;
      onResize();
    });
  };
  // iOS also scrolls the whole page when the keyboard opens; put it back.
  const unscroll = () => { if (window.scrollY) window.scrollTo(0, 0); fit(); };
  const onVv = () => fit();
  if (vv) { vv.addEventListener('resize', onVv); vv.addEventListener('scroll', unscroll); }
  fit(true);
  return () => {
    if (vv) { vv.removeEventListener('resize', onVv); vv.removeEventListener('scroll', unscroll); }
    el.removeEventListener('scroll', remember, true);
    // Only bring the app back when no other chat screen is still open.
    if (!document.querySelector('.chat:not([data-closing])') || document.querySelectorAll('.chat').length <= 1) {
      document.body.classList.remove('chat-open');
      const sh = document.querySelector('.shell');
      if (sh) sh.removeAttribute('inert');
    }
  };
}

// A message arrived on your inbox channel: if its chat is open here, show it there.
export function deliverToOpenChat(conversationId, m) {
  if (!chat || chat.id !== conversationId || !chat.incoming) return false;
  chat.incoming(m);
  return true;
}

export function closeChat() {
  if (!chat) return;
  if (chat.unfit) chat.unfit();
  clearInterval(chat.poll);
  chat.channel && chat.channel.leave();
  chat.el.remove();
  // Bring the chat list up to date from what this chat showed (no server call needed).
  const last = chat.lastMsg;
  const closedId = chat.id;   // update once the screen behind has come back, so it redraws
  if (last && !last.deleted_at) setTimeout(() => patchChat(closedId, { body: last.body, at: last.created_at, fromMe: last.sender_id === state.user.id }), 0);
  state.openChat = null;
  chat = null;
  document.body.style.overflow = '';
}

export async function openChat(id) {
  if (chat && chat.id === id) return;
  closeChat();
  let convo = state.convos.find((c) => c.conversation_id === id);
  const el = h('section', { class: 'chat', 'aria-label': 'Chat' });
  chat = { id, el, channel: null, convo };
  state.openChat = id;
  document.body.append(el);
  document.body.style.overflow = 'hidden';
  el.append(h('div', { class: 'chat-head' }, h('div', { class: 'spinner' })));
  if (!convo) { await loadDating({ force: true }); convo = state.convos.find((c) => c.conversation_id === id); }
  if (!chat || chat.id !== id) return;
  if (!convo) { el.replaceChildren(h('div', { class: 'empty', style: { margin: 'auto' } }, h('div', { class: 'empty-art' }, h('span', {}, '🤷')), h('h3', {}, 'Chat not found'), h('p', {}, 'It may have been closed.'), h('button', { class: 'btn btn-primary', onclick: back }, 'Back to matches'))); return; }
  chat.convo = convo;
  const me = state.user.id;
  const metaText = meta({ age: convo.other_age, gender: convo.other_gender, location: convo.other_location });

  const body = h('div', { class: 'chat-body', role: 'log', 'aria-live': 'polite' });
  const typing = h('div', { class: 'typing', hidden: true, 'aria-label': 'Typing' }, h('i'), h('i'), h('i'));
  const status = h('span', { class: 'status' });
  const nameDot = h('span', { class: 'name-dot-slot' });
  // Online if they're in this chat right now (live presence) or the app was open in the last 5 minutes.
  let present = false;
  const showStatus = () => {
    if (!chat || chat.id !== id) return;
    const online = !convo.blocked && (present || convo.other_online);
    nameDot.replaceChildren(...(online ? [onlineDot()] : []));
    const base = metaText;
    const active = convo.blocked ? null : activeText(false, convo.other_active_hours);
    status.replaceChildren(...(online ? [h('i'), 'Online'] : [document.createTextNode(active ? `${active} · ${base}` : base)]));
  };
  const revealSlot = h('div');
  const headReveal = h('span', { class: 'head-reveal' });
  const headFriend = h('span', { class: 'head-reveal head-friend' });
  const head = h('div', { class: 'chat-head' },
    h('button', { class: 'plain-btn', 'aria-label': 'Back', onclick: back }, icon('back')),
    // Tap their picture or nickname to see their dating card.
    h('button', { class: 'chat-who', 'aria-label': `View ${convo.other_handle}’s profile`, onclick: () => partnerProfile(chat.convo || convo) },
      avatar(convo.other_handle, nameOf(convo)),
      h('span', { class: 'grow' }, h('b', { class: 'ellipsis name-dot', 'data-chat-name': convo.conversation_id }, nameOf(convo), nameDot), status)),
    headFriend,
    headReveal,
    h('button', { class: 'plain-btn', 'aria-label': 'Chat options', onclick: () => chatMenu(convo) }, icon('more')));
  const input = h('textarea', { class: 'input', rows: '1', maxlength: '1000', placeholder: 'Type a message…', 'aria-label': 'Message' });
  const sendBtn = h('button', { class: 'send', 'aria-label': 'Send' }, icon('send', 'sm'));
  keepKeyboardOnSend(sendBtn, input);
  // Photos: greyed out until the two of you have chatted enough (the database decides).
  let photoOk = false, photoCheck = null, sinceCheck = 0;
  const plusBtn = h('button', { type: 'button', class: 'ph-btn plus locked', 'aria-label': 'Send a photo', onclick: () => photoTap('choose') }, icon('plus'));
  const galleryBtn = h('button', { type: 'button', class: 'ph-btn gallery locked', 'aria-label': 'Send photos from your gallery', onclick: () => photoTap('library') }, icon('image'));
  const paintPhotoBtns = () => [plusBtn, galleryBtn].forEach((b) => { b.classList.toggle('locked', !photoOk); b.setAttribute('aria-disabled', String(!photoOk)); });
  const checkPhotos = () => {
    if (photoCheck) return photoCheck;
    photoCheck = (statusOf(chat.convo) === 'chat' ? api.photosUnlocked(id) : Promise.resolve(false))
      .then((v) => { photoOk = v; sinceCheck = 0; paintPhotoBtns(); return v; })
      .catch(() => photoOk)
      .finally(() => { photoCheck = null; });
    return photoCheck;
  };
  async function photoTap(how) {
    if (!photoOk) {
      // Maybe it just unlocked: ask once more before saying no. (Then they tap again to pick.)
      if (await checkPhotos()) return toast('Photos unlocked 🎉 Tap again to send one', 'image');
      return photos.lockedSheet(statusOf(chat.convo) === 'chat' ? 'chat' : 'request');
    }
    const source = how === 'library' ? 'library' : await photos.chooseSource();
    if (!source) return;
    const files = await photos.pickPhotos(source);
    if (!files.length) return;
    const ready = await photos.reviewPhotos(files);
    for (const p of ready) await sendOnePhoto(p);
  }
  const composer = convo.blocked ? h('div', { class: 'chat-closed' }, 'This chat is closed. Neither of you can send messages.')
    : statusOf(convo) === 'request' ? h('div', { class: 'accept-bar' },
      h('p', {}, h('b', {}, isFriend(convo) ? `${shortName(convo.other_handle)} wants to be friends.` : `${shortName(convo.other_handle)} wants to chat with you.`), ' Accept to reply. If you decline, they aren’t told.'),
      h('div', { class: 'accept-actions' },
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => declineRequest(convo) }, 'Decline'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
          if (!(await confirmSheet({ title: `Block ${convo.other_handle}?`, text: 'They can’t message you or see you in Discover. They aren’t told.', yes: 'Block', danger: true }))) return;
          const undo = closeChatLocal(convo.conversation_id);
        closeAndBack(); toast('Blocked', 'shield');
        api.blockPartner(convo.conversation_id).catch((e) => { undo(); toast(api.friendly(e), 'x'); });
        } }, icon('shield', 'sm'), 'Block'),
        h('button', { class: 'btn btn-primary btn-sm grow', onclick: () => acceptRequest(convo) }, icon('check', 'sm'), 'Accept')))
    : h('form', { class: 'composer', onsubmit: (e) => { e.preventDefault(); send(); } }, plusBtn, input, galleryBtn, sendBtn);
  let replyTo = null, editing = null;
  const actionBar = h('div', { class: 'reply-bar', hidden: true });
  el.replaceChildren(head, body, revealSlot, composer);
  if (composer.tagName === 'FORM') composer.before(actionBar);
  chat.revealSlot = revealSlot;
  chat.headReveal = headReveal;
  chat.headFriend = headFriend;
  chat.status = status;
  chat.showStatus = showStatus;
  showStatus();

  const shown = new Set();
  const msgs = new Map();          // id → message, for replies and edits
  let lastDay = null, typingTimer = null;
  const EDIT_WINDOW = 15 * 60 * 1000;
  const who = (senderId) => (senderId === me ? 'You' : (convo.other_name && convo.i_revealed && convo.they_revealed ? convo.other_name : shortName(convo.other_handle)));
  const preview = (m) => (m.deleted_at ? 'This message was deleted' : m.body.length > 120 ? `${m.body.slice(0, 120)}…` : m.body);
  function quote(m) {
    const q = msgs.get(m.reply_to);
    const el = h('button', { class: `bubble-quote ${q && q.sender_id === me ? 'mine' : ''}`, onclick: (e) => { e.stopPropagation(); jumpTo(m.reply_to); } },
      h('b', {}, q ? who(q.sender_id) : 'Message'), h('span', {}, q ? preview(q) : 'Earlier message'));
    if (!q) api.messageById(m.reply_to).then((x) => {   // older than what's loaded: fetch it once
      if (!x || !el.isConnected) return;
      el.replaceChildren(h('b', {}, who(x.sender_id)), h('span', {}, preview(x)));
      if (x.sender_id === me) el.classList.add('mine');
    }).catch(() => {});
    return el;
  }
  function jumpTo(mid) {
    const row = body.querySelector(`.msg-row[data-id="${mid}"]`);
    if (!row) return toast('That message is further back in the chat', 'reply');
    row.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
  }
  function buildRow(m) {
    const mine = m.sender_id === me;
    const gone = !!m.deleted_at;
    const row = h('div', { class: `msg-row ${mine ? 'me' : 'them'} ${gone ? 'gone' : ''}`, 'data-at': String(new Date(m.created_at).getTime()), 'data-id': String(m.id) },
      h('button', { class: 'msg-swipe', 'aria-label': 'Reply', tabindex: '-1', onclick: (e) => { e.stopPropagation(); setReply(m); } }, icon('reply', 'sm')),
      m.photo && !gone
        ? h('div', { class: 'bubble photo-bubble', onclick: (e) => photoClick(e, m) },
          m.reply_to ? quote(m) : null, photos.photoBox(m, mine))
        : h('div', { class: 'bubble', onclick: () => messageActions(m) },
          m.reply_to && !gone ? quote(m) : null,
          gone ? h('span', { class: 'gone-text' }, icon('ban', 'sm'), mine ? 'You unsent a message' : 'This message was deleted') : m.body),
      h('time', { datetime: m.created_at }, m.edited_at && !gone ? `Edited · ${clock(m.created_at)}` : clock(m.created_at)));
    if (!gone) swipeToReply(row, m);
    return row;
  }
  // First tap on their photo un-blurs it; after that a tap opens it full screen.
  function photoClick(e, m) {
    const box = e.currentTarget.querySelector('.ph');
    if (!box || box.classList.contains('ph-gone')) return messageActions(m);
    if (box.classList.contains('blur')) {
      photos.markSeen(m.id);
      box.classList.remove('blur');
      const veil = box.querySelector('.ph-veil'); if (veil) veil.remove();
      return;
    }
    photos.openViewer(m, { onMore: () => messageActions(m) });
  }
  const add = (m) => {
    if (shown.has(m.id)) return;
    if (!m.photo && !photoOk && ++sinceCheck >= 6 && statusOf(chat.convo) === 'chat') checkPhotos();
    shown.add(m.id);
    msgs.set(m.id, m);
    if (chat && (!chat.lastMsg || new Date(m.created_at) >= new Date(chat.lastMsg.created_at))) chat.lastMsg = m;
    const day = dayLabel(m.created_at);
    if (day !== lastDay) { body.insertBefore(h('div', { class: 'day-sep' }, day), typing); lastDay = day; }
    body.insertBefore(buildRow(m), typing);
    receipt();
  };
  // An edit or unsend arrived (from you on another device, or from them): redraw that message.
  const update = (m) => {
    const old = msgs.get(m.id);
    if (!old) return;
    Object.assign(old, m);
    const row = body.querySelector(`.msg-row[data-id="${m.id}"]`);
    if (row) row.replaceWith(buildRow(old));
    body.querySelectorAll('.bubble-quote').forEach(() => {});
    receipt();
  };

  // ---- Reply / edit bar above the message box --------------------------------------------------------
  function showBar(title, text, cls) {
    actionBar.className = `reply-bar ${cls}`;
    actionBar.replaceChildren(
      h('div', { class: 'grow' }, h('b', {}, title), h('span', {}, text)),
      h('button', { type: 'button', class: 'plain-btn', 'aria-label': 'Cancel', onclick: () => clearBar() }, icon('x', 'sm')));
    actionBar.hidden = false;
  }
  function setReply(m) {
    if (convo.blocked || statusOf(chat.convo) === 'request' || m.deleted_at) return;
    editing = null; replyTo = m;
    showBar(`Replying to ${who(m.sender_id) === 'You' ? 'yourself' : who(m.sender_id)}`, preview(m), 'reply');
    input.focus();
  }
  function setEdit(m) {
    replyTo = null; editing = m;
    showBar('Edit message', preview(m), 'edit');
    input.value = m.body; autosize(); input.focus();
  }
  function clearBar() {
    if (editing) { input.value = ''; autosize(); }
    replyTo = null; editing = null; actionBar.hidden = true; actionBar.replaceChildren();
  }
  // Swipe a message right to reply (phones).
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
      row.classList.add('swipe-back'); row.style.transform = ''; row.classList.remove('swipe-ready');
      setTimeout(() => row.classList.remove('swipe-back'), 220);
    };
    row.addEventListener('touchend', end);
    row.addEventListener('touchcancel', end);
  }
  // Tap a message: Reply · Copy · Edit · Unsend · Delete for me.
  function messageActions(m) {
    if (m.deleted_at) {
      return sheet((close) => [h('h2', {}, 'Deleted message'),
        h('div', { class: 'menu-list', style: { marginTop: '10px' } },
          h('button', { class: 'menu-item', onclick: () => { close(); hideForMe(m); } }, icon('trash'), 'Remove from my chat')),
        h('div', { class: 'sheet-actions' }, h('button', { class: 'btn btn-soft btn-block', onclick: close }, 'Close'))], { label: 'Message options' });
    }
    const mine = m.sender_id === me;
    const canReply = !convo.blocked && statusOf(chat.convo) !== 'request';
    const canEdit = !m.photo && mine && !convo.blocked && Date.now() - new Date(m.created_at).getTime() < EDIT_WINDOW;
    sheet((close) => [
      h('p', { class: 'msg-sheet-quote' }, preview(m)),
      h('div', { class: 'menu-list' },
        canReply ? h('button', { class: 'menu-item', onclick: () => { close(); setReply(m); } }, icon('reply'), 'Reply') : null,
        m.photo ? null : h('button', { class: 'menu-item', onclick: async () => { close(); toast((await copyText(m.body)) ? 'Copied' : 'Couldn’t copy', 'copy'); } }, icon('copy'), 'Copy'),
        m.photo && !mine ? h('button', { class: 'menu-item danger', onclick: () => { close(); reportPhoto(m); } }, icon('flag'), 'Report photo') : null,
        canEdit ? h('button', { class: 'menu-item', onclick: () => { close(); setEdit(m); } }, icon('edit'), 'Edit') : null,
        mine ? h('button', { class: 'menu-item danger', onclick: () => { close(); unsend(m); } }, icon('ban'), 'Unsend for everyone') : null,
        h('button', { class: 'menu-item danger', onclick: () => { close(); hideForMe(m); } }, icon('trash'), 'Delete for me')),
      mine && !canEdit && !convo.blocked ? h('p', { class: 'tiny muted', style: { marginTop: '8px' } }, 'Messages can be edited for 15 minutes after sending.') : null,
    ], { label: 'Message options' });
  }
  async function reportPhoto(m) {
    if (!(await confirmSheet({ title: 'Report this photo?', yes: 'Report', danger: true,
      text: 'Our team will review it. You can also block them from the chat menu.' }))) return;
    try { await api.reportPartner(id, 'inappropriate', `Photo message ${m.id}`); toast('Reported. Thanks for keeping treehouse safe', 'shield'); }
    catch (e) { toast(api.friendly(e), 'x'); }
  }
  // Show it straight away as "Sending…" with the local copy, then swap in the saved message.
  async function sendOnePhoto(p) {
    const empty = body.querySelector('.empty'); if (empty) empty.remove();
    const quoted = replyTo; clearBar();
    const temp = h('div', { class: 'msg-row me pending', 'data-at': String(Date.now()), 'data-pending': '1' },
      h('div', { class: 'bubble photo-bubble' }, photos.photoBox({ id: 'local', created_at: new Date().toISOString(), photo_w: p.w, photo_h: p.h }, true, p.url)),
      h('time', {}, clock(new Date().toISOString())));
    body.insertBefore(temp, typing);
    receipt(); scroll();
    try {
      const m = await api.sendPhoto(id, p.blob, p.w, p.h, quoted ? quoted.id : null);
      temp.remove(); add(m); scroll();
    } catch (e) {
      temp.remove(); receipt();
      if (/row-level|policy|chatted enough|42501/i.test(`${e.message} ${e.code || ''}`)) { photoOk = false; paintPhotoBtns(); photos.lockedSheet('chat'); }
      else toast(api.friendly(e), 'x');
    }
  }
  async function unsend(m) {
    if (!(await confirmSheet({ title: 'Unsend this message?', yes: 'Unsend', danger: true,
      text: 'It’s removed for both of you and replaced with “This message was deleted”.' }))) return;
    try { await api.unsendMessage(m.id); update({ ...m, deleted_at: new Date().toISOString(), body: 'This message was deleted', reply_to: null }); refreshList(); }
    catch (e) { toast(api.friendly(e), 'x'); }
  }
  async function hideForMe(m) {
    try {
      await api.hideMessage(m.id);
      const row = body.querySelector(`.msg-row[data-id="${m.id}"]`);
      if (row) row.remove();
      msgs.delete(m.id);
      receipt(); refreshList();
      toast('Deleted for you', 'trash');
    } catch (e) { toast(api.friendly(e), 'x'); }
  }
  const refreshList = () => { loadDating(); };

  // Messenger-style status: Sending (hollow circle) → Sent (outlined tick) → Delivered (filled tick)
  // → Seen (their little avatar under the last message they've read).
  const receipt = () => {
    body.querySelectorAll('.msg-status, .seen-av').forEach((r) => r.remove());
    const c = chat && chat.convo;
    if (!c || c.blocked) return;
    const rows = [...body.querySelectorAll('.msg-row')];
    const mineRows = rows.filter((r) => r.classList.contains('me') && !r.classList.contains('gone'));
    if (!mineRows.length) return;
    const t = (iso) => (iso ? new Date(iso).getTime() : 0);
    const readAt = t(c.other_read_at), deliveredAt = Math.max(t(c.other_delivered_at), readAt);
    const lastRead = [...mineRows].reverse().find((r) => !r.dataset.pending && readAt && Number(r.dataset.at) <= readAt);
    if (lastRead && !rows.slice(rows.indexOf(lastRead) + 1).some((r) => r.classList.contains('them'))) {
      lastRead.after(h('div', { class: 'seen-av', 'aria-label': `Seen by ${nameOf(c)}` }, h('span', {}, 'Seen'), avatar(c.other_handle, nameOf(c), 'xs')));
    }
    const last = mineRows[mineRows.length - 1];
    if (last === lastRead) return;
    const pending = !!last.dataset.pending;
    const delivered = !pending && deliveredAt && Number(last.dataset.at) <= deliveredAt;
    const [ico, label] = pending ? ['dot', 'Sending…'] : delivered ? ['delivered', 'Delivered']
      : statusOf(c) === 'sent' ? ['sent', 'Sent · waiting for them to accept'] : ['sent', 'Sent'];
    last.after(h('div', { class: `msg-status ${pending ? 'pending' : delivered ? 'delivered' : 'sent'}` }, h('span', {}, label), icon(ico, 'sm')));
  };
  chat.receipt = receipt;
  const scroll = () => { body.scrollTop = body.scrollHeight; };
  // Stay pinned to the newest message when the keyboard opens or closes.
  let nearBottom = true;
  body.addEventListener('scroll', () => { nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80; });
  chat.unfit = fitChatToViewport(el, () => { if (nearBottom) requestAnimationFrame(scroll); });
  body.append(typing);

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    if (editing) {
      const m = editing;
      sendBtn.disabled = true;
      try {
        await api.editMessage(m.id, text);
        clearBar(); input.value = ''; autosize();
        update({ ...m, body: text, edited_at: new Date().toISOString() });
        refreshList();
      } catch (e) { toast(api.friendly(e), 'x'); }
      sendBtn.disabled = false;
      input.focus();
      return;
    }
    sendBtn.disabled = true;
    const quoted = replyTo;
    // Show it straight away as "Sending…", then swap in the saved message.
    input.value = ''; autosize(); clearBar();
    const empty = body.querySelector('.empty'); if (empty) empty.remove();
    const temp = h('div', { class: 'msg-row me pending', 'data-at': String(Date.now()), 'data-pending': '1' },
      h('div', { class: 'bubble' }, quoted ? h('span', { class: 'bubble-quote mine' }, h('b', {}, who(quoted.sender_id)), h('span', {}, preview(quoted))) : null, text),
      h('time', {}, clock(new Date().toISOString())));
    body.insertBefore(temp, typing);
    receipt(); scroll();
    try {
      const m = await api.sendMessage(id, text, quoted ? quoted.id : null);
      temp.remove(); add(m); scroll();
      if (statusOf(chat.convo) !== 'chat') refreshChatState(id);
    }
    catch (e) {
      temp.remove(); receipt();
      if (!input.value) { input.value = text; autosize(); }
      if (quoted) setReply(quoted);
      toast(/row-level|policy/i.test(e.message || '') ? 'You can’t send messages in this chat.' : api.friendly(e), 'x');
    }
    sendBtn.disabled = false;
    input.focus();
  }
  const autosize = () => { input.style.height = 'auto'; input.style.height = `${Math.min(120, input.scrollHeight)}px`; };
  input.addEventListener('input', () => { autosize(); if (chat && chat.channel) chat.channel.typing(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); send(); } });

  renderReveal(convo);
  try {
    const msgs = await api.messages(id);
    if (!chat || chat.id !== id) return;
    if (!msgs.length) body.insertBefore(h('div', { class: 'empty', style: { padding: '30px 10px' } },
      h('div', { class: 'empty-art' }, h('span', {}, '👋')), h('h3', {}, 'Say hi!'),
      h('p', {}, statusOf(convo) === 'sent' ? 'Your request is waiting for them to accept.' : isMatch(convo) ? 'You matched. Neither of you knows who the other is yet: start with something fun.' : 'Request accepted. You’re both anonymous: start with something fun.')), typing);
    msgs.forEach(add);
    scroll();
  } catch (e) { toast(api.friendly(e), 'x'); }
  if (composer.tagName === 'FORM') checkPhotos();
  markChatRead(id);
  // Delivered/Seen also update every 20 seconds while the chat is open.
  // Only this chat's status (tiny query), not the whole chat list.
  chat.poll = setInterval(async () => {
    if (document.hidden || !chat || chat.id !== id || api.backingOff()) return;
    try {
      const st = await api.chatStatus(id);
      if (!st || !chat || chat.id !== id) return;
      const before = statusOf(chat.convo);
      Object.assign(chat.convo, { other_read_at: st.other_read_at, other_delivered_at: st.other_delivered_at, other_online: st.other_online, other_active_hours: st.other_active_hours });
      receipt();
      if (chat.showStatus) chat.showStatus();
      if (st.status !== before || st.blocked !== !!chat.convo.blocked || st.they_revealed !== !!chat.convo.they_revealed) refreshChatState(id);
    } catch {}
  }, 45000);
  // A new message for this chat, from either the chat's channel or your own inbox signal
  // (the server now sends each message once, on the recipient's inbox channel). Shown once.
  const incoming = (m) => {
    if (!m || !m.id || shown.has(m.id)) return;
    const empty = body.querySelector('.empty'); if (empty) empty.remove();
      add(m); typing.hidden = true; scroll();
      if (m.sender_id !== me) { markChatRead(id); if (chat && chat.channel) chat.channel.read(); }
      if (chat && statusOf(chat.convo) !== 'chat') refreshChatState(id);
  };
  chat.incoming = incoming;
  chat.channel = api.joinChat(id, me, {
    onMessage: incoming,
    onUpdate: (m) => update(m),
    onTyping: () => { typing.hidden = false; scroll(); clearTimeout(typingTimer); typingTimer = setTimeout(() => { typing.hidden = true; }, 3500); },
    onRead: () => {
      if (!chat || chat.id !== id || !chat.convo) return;
      const now = new Date().toISOString();
      chat.convo.other_read_at = now;
      if (!chat.convo.other_delivered_at || chat.convo.other_delivered_at < now) chat.convo.other_delivered_at = now;
      receipt();
    },
    onPresence: (online) => {
      if (!chat || chat.id !== id) return;
      if (present && !online) { convo.other_online = false; convo.other_active_hours = 0; }
      present = online;
      showStatus();
    },
  });
  if (!convo.blocked && !matchMedia('(pointer: coarse)').matches) input.focus();
}

function back() {
  if (history.length > 1 && window.__hyChatPushed) { window.__hyChatPushed = false; history.back(); }
  else go('matches', { replace: true });
}

// Reveal lives in the chat header, next to their name: a small button while it's possible, a
// highlighted one when they've asked, "Requested" while you wait. Once you've both revealed it
// disappears; the "Revealed" mark is shown on their profile card instead.
async function renderReveal(convo) {
  renderFriend(convo);
  const slot = chat && chat.revealSlot;
  const top = chat && chat.headReveal;
  if (!slot || !top) return;
  slot.replaceChildren(); top.replaceChildren();
  if (convo.blocked || statusOf(convo) === 'request') return;
  if (statusOf(convo) === 'sent') {
    slot.replaceChildren(h('div', { class: 'reveal-card' },
      h('span', { class: 'rc-icon' }, icon('send')), h('div', { class: 'grow' }, h('b', {}, 'Request pending'),
        h('p', {}, 'They’ll see it in their Requests. Once they accept, you can chat freely. You can send up to 3 messages until then.')),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => cancelSent(convo) }, 'Cancel request')));
    return;
  }
  if (convo.i_revealed && convo.they_revealed) {
    let who = null;
    try { who = await api.revealedDetails(convo.conversation_id); } catch {}
    if (who && chat) {
      chat.revealedName = who.name;
      rememberRevealedName(convo.conversation_id, who.name);
      document.querySelectorAll(`[data-chat-name="${convo.conversation_id}"]`).forEach((el) => { if (el.firstChild && el.firstChild.nodeType === 3) el.firstChild.textContent = who.name; });
      if (chat.showStatus) chat.showStatus();
    }
    return;
  }
  if (convo.they_revealed) {
    top.replaceChildren(h('button', { class: 'reveal-pill hot', title: 'They want to reveal identities', onclick: () => doReveal(convo, true) }, icon('eye', 'sm'), 'Reveal'));
  } else if (convo.i_revealed) {
    top.replaceChildren(h('button', { class: 'reveal-pill wait', title: 'Waiting for them to reveal', onclick: () => revealPending(convo) }, icon('clock', 'sm'), 'Requested'));
  } else {
    top.replaceChildren(h('button', { class: 'reveal-pill', title: 'Ask to reveal identities', onclick: () => doReveal(convo, true) }, icon('lock', 'sm'), 'Reveal'));
  }
}

// "Add friend" sits next to Reveal in match chats. When you've both tapped it, the chat becomes a
// friend chat (moves to Friends; you see each other's statuses). The database keeps the request.
async function renderFriend(convo) {
  const top = chat && chat.headFriend;
  if (!top) return;
  top.replaceChildren();
  if (convo.blocked || isFriend(convo) || statusOf(convo) !== 'chat') return;
  const id = convo.conversation_id;
  let st;
  try { st = await api.friendAskState(id); } catch { return; }
  if (!st) return;   // database not updated yet
  if (!chat || !chat.convo || chat.convo.conversation_id !== id) return;
  if (st === 'friends') { loadDating({ force: true }).catch(() => {}); return; }
  const who = nameOf(convo);
  const btn = (cls, label, onclick) => h('button', { class: `friend-btn ${cls}`.trim(), 'aria-label': label, title: label, onclick }, icon('userplus', 'sm'));
  if (st === 'theirs') {
    top.replaceChildren(btn('hot', `${who} wants to add you as a friend`, async () => {
      if (!(await confirmSheet({ title: `${who} wants to be friends`, yes: 'Accept',
        text: 'This chat moves to Friends and you’ll see each other’s statuses. You both stay anonymous until you reveal.' }))) return;
      askFriend(convo, true);
    }));
  } else if (st === 'mine') {
    top.replaceChildren(btn('wait', 'Friend request sent', () => sheet((close) => [h('h2', {}, 'Friend request sent'),
      h('p', { class: 'muted' }, `Waiting for ${who} to accept. Nothing changes until they do.`),
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn btn-soft btn-block', onclick: () => { close(); askFriend(convo, false); } }, 'Cancel request'),
        h('button', { class: 'btn btn-primary btn-block', onclick: close }, 'OK'))], { label: 'Friend request' })));
  } else {
    top.replaceChildren(btn('', 'Add as friend', async () => {
      if (!(await confirmSheet({ title: `Add ${who} as a friend?`, yes: 'Send request',
        text: 'They’ll get a friend request in this chat. If they accept, it moves to Friends and you’ll see each other’s statuses.' }))) return;
      askFriend(convo, true);
    }));
  }
}

async function askFriend(convo, on) {
  const id = convo.conversation_id;
  try {
    const res = await api.askFriend(id, on);
    if (res === 'friends') {
      toast('You’re now friends 🎉', 'userplus');
      await loadDating({ force: true });
      const fresh = state.convos.find((c) => c.conversation_id === id) || convo;
      if (chat) { chat.convo = fresh; renderFriend(fresh); }
      return;
    }
    loadDating({ force: true }).catch(() => {});
    if (on && res === 'asked') {
      // A short note in the chat, so they see it (and get notified) even if they don't open the menu.
      api.sendMessage(id, '👋 I sent you a friend request. Tap the add-friend icon at the top of this chat to accept.').catch(() => {});
      toast('Friend request sent', 'userplus');
    } else if (!on) toast('Friend request cancelled', 'x');
    if (chat && chat.convo && chat.convo.conversation_id === id) renderFriend(chat.convo);
  } catch (e) { toast(api.friendly(e), 'x'); }
}

function revealPending(convo) {
  sheet((close) => [h('h2', {}, 'Reveal requested'),
    h('p', { class: 'muted' }, 'You asked to reveal identities. Nothing is shown until they agree too.'),
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn btn-soft btn-block', onclick: () => { close(); doReveal(convo, false); } }, 'Undo request'),
      h('button', { class: 'btn btn-primary btn-block', onclick: close }, 'OK'))], { label: 'Reveal requested' });
}

async function declineRequest(convo) {
  if (!(await confirmSheet({ title: 'Decline this request?', yes: 'Decline', danger: true,
    text: 'The chat disappears for you and they can’t send you more messages here. They aren’t told. To stop them for good, block them.' }))) return;
  try { await api.declineRequest(convo.conversation_id); await loadDating({ force: true }); toast('Request declined'); closeChat(); go('matches/requests', { replace: true }); }
  catch (e) { toast(api.friendly(e), 'x'); }
}

// A request becomes a chat when someone replies: refresh the state and the banner.
async function refreshChatState(id) {
  if (!chat || chat.id !== id) return;
  const before = statusOf(chat.convo);
  await loadDating({ force: true });
  const fresh = state.convos.find((c) => c.conversation_id === id);
  if (!fresh || !chat || chat.id !== id) return;
  chat.convo = fresh;
  if (chat.receipt) chat.receipt();
  if (statusOf(fresh) !== before) {
    renderReveal(fresh);
    if (before === 'sent' && statusOf(fresh) === 'chat') toast('Your message request was accepted 🎉', 'check');
  }
}

async function doReveal(convo, on) {
  if (on && !(await confirmSheet({ title: 'Reveal your identity?', yes: 'Yes, reveal',
    text: 'Your first name is shown to them only if they also choose to reveal. Until then nothing changes, and you can undo.' }))) return;
  try {
    await api.reveal(convo.conversation_id, on);
    convo.i_revealed = on;
    await loadDating({ force: true });
    const fresh = state.convos.find((c) => c.conversation_id === convo.conversation_id) || convo;
    if (chat) { chat.convo = fresh; renderReveal(fresh); }
    toast(on ? (fresh.they_revealed ? 'You’ve both revealed 🎉' : 'Reveal request sent') : 'Reveal cancelled', 'eye');
  } catch (e) { toast(api.friendly(e), 'x'); }
}

function chatMenu(convo) {
  sheet((close) => [
    h('h2', {}, nameOf(convo)),
    h('p', { class: 'small muted' }, 'Everything here stays between you two. Identities only show when you both reveal.'),
    h('div', { class: 'menu-list', style: { marginTop: '10px' } },
      !convo.blocked && !convo.i_revealed && statusOf(convo) === 'chat' ? h('button', { class: 'menu-item', onclick: () => { close(); doReveal(convo, true); } }, icon('eye'), 'Reveal my identity') : null,
      statusOf(convo) === 'request' ? h('button', { class: 'menu-item', onclick: () => { close(); declineRequest(convo); } }, icon('x'), 'Decline request') : null,
      !convo.blocked && api.features.matching && statusOf(convo) === 'chat' ? h('button', { class: 'menu-item', onclick: async () => {
        close();
        if (!(await confirmSheet({ title: 'Unmatch?', text: 'The chat closes for both of you and they won’t see you in Discover again.', yes: 'Unmatch', danger: true }))) return;
        // Close it straight away; the server catches up in the background.
        const undo = closeChatLocal(convo.conversation_id);
        closeAndBack(); toast('Unmatched');
        api.unmatch(convo.conversation_id).catch((e) => { undo(); toast(api.friendly(e), 'x'); });
      } }, icon('x'), 'Unmatch') : null,
      !convo.blocked ? h('button', { class: 'menu-item danger', onclick: async () => {
        close();
        if (!(await confirmSheet({ title: 'Block this person?', text: 'They can’t message you or see you in Discover. They aren’t told.', yes: 'Block', danger: true }))) return;
        try { await api.blockPartner(convo.conversation_id); toast('Blocked', 'shield'); closeAndBack(); } catch (e) { toast(api.friendly(e), 'x'); }
      } }, icon('shield'), 'Block') : null,
      h('button', { class: 'menu-item', onclick: () => { close(); partnerProfile(convo); } }, icon('user'), 'View profile'),
      h('button', { class: 'menu-item danger', onclick: () => { close(); deleteChat(convo); } }, icon('trash'), 'Delete chat'),
      h('button', { class: 'menu-item danger', onclick: () => { close(); reportSheet(convo); } }, icon('flag'), 'Report')),
  ], { label: 'Chat options' });
}

function closeAndBack() { closeChat(); go('matches', { replace: true }); }

// The dating card of the person you're chatting with (or who sent you a request).
async function partnerProfile(convo) {
  let p = null;
  try { p = await api.chatPartnerProfile(convo.conversation_id); } catch (e) { return toast(api.friendly(e), 'x'); }
  if (!p) return toast('This profile isn’t available anymore', 'x');
  const active = p.available ? activeText(p.online, p.active_hours) : null;
  const ints = p.interests || [];
  sheet((close) => [
    h('div', { class: 'pc' },
      h('div', { class: 'pc-av' }, avatar(p.handle, nameOf(convo), 'xl'), p.online ? h('i') : null),
      nameOf(convo) !== convo.other_handle ? h('h2', {}, nameOf(convo), h('small', { class: 'pc-handle' }, ` · ${p.handle}`)) : h('h2', {}, p.handle),
      h('p', { class: 'pc-sub' }, [p.age ? `${p.age} years` : null, GENDER_LABEL[p.gender], p.location].filter(Boolean).join(' · ')),
      active ? h('span', { class: `pc-status ${p.online ? 'on' : ''}` }, active) : null,
      isFriend(convo) && state.friendStatus[convo.conversation_id] ? h('p', { class: 'pc-friend-status' }, `“${state.friendStatus[convo.conversation_id].body}”`) : null,
      convo.i_revealed && convo.they_revealed ? h('span', { class: 'pc-revealed' }, icon('check', 'sm'), 'Revealed · you both shared first names') : null,
      p.available ? null : h('p', { class: 'tiny muted' }, 'This chat is closed.')),
    h('div', { class: 'pc-about' },
      h('h3', {}, 'About'),
      h('p', { class: 'muted' }, p.bio || 'No bio yet.'),
      h('div', { class: 'pc-facts' },
        p.location ? h('span', {}, icon('pin', 'sm'), p.location) : null,
        p.intent ? h('span', {}, icon('heart', 'sm'), INTENT_LABEL[p.intent]) : null),
      ints.length ? h('div', { class: 'chips' }, ints.map((i) => h('span', { class: 'chip static' }, i))) : null,
      convo.i_revealed && convo.they_revealed ? null : h('p', { class: 'tiny muted', style: { marginTop: '10px' } }, '🎭 Their real name stays hidden until you both reveal.')),
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn btn-soft btn-block', onclick: close }, 'Close')),
  ], { label: `${p.handle}’s profile` });
}

// Delete for me: the chat and its messages go from your Inbox; they keep theirs.
async function deleteChat(convo) {
  if (!(await confirmSheet({ title: 'Delete this chat?', yes: 'Delete', danger: true,
    text: `The chat and its messages are removed for you. ${convo.other_handle} keeps their copy and isn’t told. If they message you again, the chat comes back with only the new messages.` }))) return;
  try {
    await api.deleteConversation(convo.conversation_id);
    state.convos = state.convos.filter((c) => c.conversation_id !== convo.conversation_id);
    emit('dating');
    toast('Chat deleted', 'trash');
    closeAndBack();
  } catch (e) { toast(api.friendly(e), 'x'); }
}

function reportSheet(convo) {
  let reason = null;
  const details = h('textarea', { class: 'textarea', maxlength: '1000', placeholder: 'What happened? (optional)' });
  const block = h('input', { type: 'checkbox', checked: !convo.blocked });
  const send = h('button', { class: 'btn btn-danger btn-block', disabled: true }, 'Send report');
  const err = h('p', { class: 'error', role: 'alert' });
  const opts = h('div', { class: 'chips' }, REPORT_REASONS.map(([v, label]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: (e) => {
    reason = v; send.disabled = false;
    opts.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === e.currentTarget)));
  } }, label)));
  sheet((close) => {
    send.onclick = async () => {
      send.disabled = true;
      try {
        await api.reportPartner(convo.conversation_id, reason, details.value.trim());
        if (block.checked && !convo.blocked) await api.blockPartner(convo.conversation_id);
        close();
        toast('Report sent. Thank you for keeping treehouse safe.', 'flag');
        if (block.checked) closeAndBack();
      } catch (e) { err.textContent = api.friendly(e); send.disabled = false; }
    };
    return [h('h2', {}, 'Report'), h('p', { class: 'small muted' }, 'Reports are reviewed by treehouse. They aren’t told who reported them.'),
      opts, details, convo.blocked ? null : h('label', { class: 'check' }, block, h('span', {}, 'Also block them')), err,
      h('div', { class: 'sheet-actions' }, send, h('button', { class: 'btn btn-soft btn-block', onclick: close }, 'Cancel'))];
  }, { label: 'Report' });
}
