// Nearby: people around you, as a list or on a map. Off by default; you switch it on yourself.
// The phone's position goes to the server once (when you turn Nearby on or refresh your area) and is
// immediately reduced to a protected point (~1 km grid + secret per-person offset). Everything here
// works from what the server returns: rounded distances and protected map points, never raw GPS.
//
// Components: NearbyList · NearbyMap (UserMapMarker) · NearbyProfilePreview · DistanceFilter ·
// LocationPrivacySettings.

import * as api from './hy-api.js';
import { h, icon, avatar, toast, sheet, confirmSheet, emptyState, chipGroup, toggle, store } from './hy-ui.js';
import { state, go, nav, loadDating, GENDERS, GENDER_LABEL, INTENT_LABEL, INTERESTS } from './hy-state.js';
import { composeTo, matchMoment } from './hy-dating.js';

const RADII = [1, 5, 10, 25, 50];
const REPORT_REASONS = [['harassment', 'Harassment'], ['inappropriate', 'Sexual or inappropriate'], ['spam', 'Spam or scam'],
  ['fake', 'Fake profile'], ['underage', 'Seems under 18'], ['other', 'Something else']];
const shortName = (handle) => handle.split(' ').slice(0, 2).join(' ');

// Saved per device: view mode and filters (not location).
const prefs = Object.assign({ mode: 'list', radius: 10, sort: 'distance', minAge: null, maxAge: null, genders: [], interests: [] },
  store.get('hy-nearby', {}));
const savePrefs = () => store.set('hy-nearby', prefs);

let settings = null;          // from nearby_settings()
let people = null;            // last result
let query = '';
let loadingPeople = null;

const distText = (p) => (p.distance_km == null ? 'Nearby' : p.distance_km < 1 ? 'Under 1 km away' : `${p.distance_km.toFixed(1)} km away`);
const distShort = (p) => (p.distance_km == null ? 'near' : p.distance_km < 1 ? '<1 km' : `${p.distance_km.toFixed(1)} km`);
const activeText = (p) => (p.online ? 'Online now' : p.active_hours == null ? null : p.active_hours < 1 ? 'Active in the last hour'
  : p.active_hours < 48 ? `Active ${p.active_hours}h ago` : `Active ${Math.floor(p.active_hours / 24)}d ago`);

// ---- Location -----------------------------------------------------------------------------------
function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location isn’t available on this device.'));
    navigator.geolocation.getCurrentPosition((pos) => resolve(pos.coords), (err) => reject(err),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 });
  });
}
const locationError = (e) => (e && e.code === 1
  ? 'Location is blocked for treehouse. Allow it in your browser or phone settings, then try again.'
  : e && e.code === 3 ? 'Finding your area took too long. Try again outside or with Wi-Fi on.'
    : api.friendly(e));

async function shareArea({ quiet = false } = {}) {
  const c = await currentPosition();
  await api.nearbySetLocation(c.latitude, c.longitude);
  settings = await api.nearbySettings();
  if (!quiet) toast('Your area is updated', 'pin');
}

// Refresh your area when you open Nearby, if it's older than 30 minutes and permission is already
// granted. Never in the background, never continuously.
async function maybeRefreshArea() {
  if (!settings || !settings.enabled || settings.paused) return;
  const age = Date.now() - new Date(settings.updated_at).getTime();
  if (age < 30 * 60 * 1000) return;
  try {
    const perm = navigator.permissions && await navigator.permissions.query({ name: 'geolocation' });
    if (perm && perm.state === 'granted') await shareArea({ quiet: true });
  } catch {}
}

// ---- Screen -------------------------------------------------------------------------------------
export function renderNearby() {
  const wrap = h('div', { class: 'nb' }, h('div', { class: 'nb-loading' }, h('div', { class: 'spinner' })));
  (async () => {
    try { settings = await api.nearbySettings(); }
    catch (e) {
      wrap.replaceChildren(/could not find the function/i.test(e.message || '')
        ? emptyState('🗺️', 'Nearby is coming soon', 'Check back in a little while.')
        : emptyState('📡', 'Couldn’t load Nearby', api.friendly(e)));
      return;
    }
    draw(wrap);
    await maybeRefreshArea();
  })();
  return wrap;
}

function draw(wrap) {
  if (!wrap.isConnected && wrap.parentNode == null && !wrap.dataset.first) wrap.dataset.first = '1';
  if (!settings.enabled) return wrap.replaceChildren(optIn(wrap));
  if (settings.paused) {
    return wrap.replaceChildren(h('div', { class: 'nb-card nb-center' },
      h('div', { class: 'nb-icon' }, icon('pause')),
      h('h2', {}, 'Nearby is paused'),
      h('p', {}, 'Nobody can see you in Nearby, and you can’t see others, until you resume.'),
      h('button', { class: 'btn btn-coral', onclick: async () => { await setSetting({ p_paused: false }); draw(wrap); } }, 'Resume Nearby'),
      h('button', { class: 'btn btn-glass', onclick: () => openNearbySettings(() => draw(wrap)) }, icon('gear', 'sm'), 'Location settings')));
  }
  const list = h('div', { class: 'nb-body' });
  const tabs = h('div', { class: 'nb-mode', role: 'tablist', 'aria-label': 'Nearby view' },
    ['list', 'map'].map((m) => h('button', { role: 'tab', 'aria-selected': String(prefs.mode === m), onclick: () => { prefs.mode = m; savePrefs(); draw(wrap); } },
      icon(m === 'list' ? 'list' : 'map', 'sm'), m === 'list' ? 'List' : 'Map')));
  const where = 'My area';
  const bar = h('div', { class: 'nb-bar' },
    h('button', { class: 'nb-chip', 'aria-label': 'Update my area', title: 'Update my area', onclick: () => updateAreaNow(wrap) }, icon('pin', 'sm'), h('span', {}, where), icon('rewind', 'sm')),
    h('button', { class: 'nb-chip', onclick: () => filterSheet(() => draw(wrap)) }, h('span', {}, `Radius: ${prefs.radius} km`), icon('chev', 'sm')),
    h('button', { class: 'nb-chip nb-icon-chip', 'aria-label': 'Filters', onclick: () => filterSheet(() => draw(wrap)) }, icon('sliders', 'sm'), filterCount() ? h('span', { class: 'badge talk' }, filterCount()) : null),
    h('button', { class: 'nb-chip nb-icon-chip', 'aria-label': 'Location settings', onclick: () => openNearbySettings(() => draw(wrap)) }, icon('gear', 'sm')));
  wrap.replaceChildren(tabs, bar, list);
  list.append(h('div', { class: 'nb-loading' }, h('div', { class: 'spinner' })));
  loadPeople().then(() => {
    if (!list.isConnected) return;
    if (prefs.mode === 'map') list.replaceChildren(nearbyMap(() => draw(wrap)));
    else list.replaceChildren(nearbyList(() => draw(wrap)));
  }).catch((e) => list.replaceChildren(emptyState('📡', 'Couldn’t load people nearby', api.friendly(e))));
}

const filterCount = () => [prefs.minAge || prefs.maxAge, prefs.genders.length, prefs.interests.length, prefs.sort !== 'distance'].filter(Boolean).length;

async function loadPeople() {
  loadingPeople = api.nearbyPeople({ radius: prefs.radius, minAge: prefs.minAge, maxAge: prefs.maxAge, genders: prefs.genders,
    interests: prefs.interests, sort: prefs.sort });
  people = await loadingPeople;
  return people;
}

async function setSetting(args) {
  try { await api.nearbyUpdate(args); settings = await api.nearbySettings(); }
  catch (e) { toast(api.friendly(e), 'x'); }
}

async function updateAreaNow(wrap) {
  try { await shareArea(); draw(wrap); } catch (e) { toast(locationError(e), 'x'); }
}

// ---- Opt in ---------------------------------------------------------------------------------------
function optIn(wrap) {
  const go1 = h('button', { class: 'btn btn-coral btn-block' }, icon('pin', 'sm'), 'Turn on Nearby');
  const err = h('p', { class: 'error', role: 'alert' });
  go1.onclick = async () => {
    go1.disabled = true; err.textContent = '';
    try { await shareArea({ quiet: true }); toast('Nearby is on', 'pin'); draw(wrap); }
    catch (e) { err.textContent = locationError(e); go1.disabled = false; }
  };
  return h('div', { class: 'nb-card nb-optin' },
    h('div', { class: 'nb-hero-art', 'aria-hidden': 'true' }, h('span', { class: 'nb-ring r1' }), h('span', { class: 'nb-ring r2' }), h('span', { class: 'nb-ring r3' }), h('span', { class: 'nb-dot' })),
    h('h2', {}, 'Meet people near you'),
    h('p', {}, 'See who’s around, how far away they are, and their area on a map. You choose when to share.'),
    h('ul', { class: 'nb-promises' },
      h('li', {}, icon('shield', 'sm'), h('span', {}, h('b', {}, 'Never your exact location. '), 'We round it to an area of about 1 km and move it slightly, so nobody can find your home.')),
      h('li', {}, icon('eye', 'sm'), h('span', {}, h('b', {}, 'Your choice. '), 'Pause, hide your distance or hide from the map any time. Turning Nearby off deletes your location.')),
      h('li', {}, icon('lock', 'sm'), h('span', {}, h('b', {}, 'No tracking. '), 'Your area only updates when you open Nearby. Nothing runs in the background.'))),
    err, go1,
    h('p', { class: 'tiny dark-note center' }, 'Your phone will ask for permission to use your location.'));
}

// ---- NearbyList ----------------------------------------------------------------------------------
function nearbyList(redraw) {
  const search = h('input', { class: 'nb-search-input', type: 'search', placeholder: 'Search nicknames', value: query, 'aria-label': 'Search nearby people', enterkeyhint: 'search' });
  const rows = h('div', { class: 'nb-list' });
  const drawRows = () => {
    const q = query.trim().toLowerCase();
    const shown = (people || []).filter((p) => !q || p.handle.toLowerCase().includes(q));
    rows.replaceChildren(...(shown.length ? shown.map((p) => personRow(p, redraw))
      : [emptyState('🗺️', q ? 'No one by that name' : 'No one nearby yet', q ? 'Try another nickname.'
        : `Nobody within ${prefs.radius} km has Nearby on right now. Try a bigger radius, or check back later.`,
      q ? null : prefs.radius < 50 ? h('button', { class: 'btn btn-glass', onclick: () => { prefs.radius = RADII[RADII.indexOf(prefs.radius) + 1] || 50; savePrefs(); redraw(); } }, `Search ${RADII[RADII.indexOf(prefs.radius) + 1] || 50} km`) : null)]));
  };
  search.addEventListener('input', () => { query = search.value; drawRows(); });
  drawRows();
  return h('div', { class: 'nb-list-wrap' },
    h('label', { class: 'nb-search' }, icon('search', 'sm'), search),
    h('div', { class: 'nb-count' }, h('b', {}, 'People nearby'), h('span', { class: 'nb-pill' }, String((people || []).length)),
      h('button', { class: 'link-btn nb-mapview', onclick: () => { prefs.mode = 'map'; savePrefs(); redraw(); } }, icon('map', 'sm'), 'Map view')),
    rows);
}

function personRow(p, redraw) {
  const heart = h('button', { class: `nb-heart ${p.i_liked ? 'on' : ''}`, 'aria-label': p.i_liked ? 'Liked' : `Like ${p.handle}`, 'aria-pressed': String(!!p.i_liked),
    onclick: (e) => { e.stopPropagation(); like(p, heart); } }, icon('heart', p.i_liked ? 'fill' : ''));
  const act = activeText(p);
  return h('article', { class: 'nb-row', role: 'button', tabindex: '0', onclick: () => preview(p, redraw), onkeydown: (e) => { if (e.key === 'Enter') preview(p, redraw); } },
    h('span', { class: `nb-av ${p.liked_me ? 'likes-you' : ''}` }, avatar(p.handle, p.handle, 'lg'), p.online ? h('i', { class: 'on' }) : null),
    h('span', { class: 'grow' },
      h('b', {}, h('span', { class: 'ellipsis' }, shortName(p.handle)), ` ${p.age}`, p.online ? h('i', { class: 'nb-online', 'aria-label': 'Online' }) : null),
      !p.online && act ? h('span', { class: 'nb-sub' }, act) : null,
      h('span', { class: 'nb-sub' }, icon('pin', 'sm'), distText(p)),
      p.liked_me ? h('span', { class: 'nb-likes' }, '💘 Likes you') : null),
    heart);
}

async function like(p, btn) {
  if (p.i_liked) return toast('You already liked them 💘', 'heart');
  if (btn) btn.disabled = true;
  try {
    const r = await api.likeProfile(p.handle, true);
    p.i_liked = true;
    if (btn) { btn.classList.add('on', 'pop'); btn.replaceChildren(icon('heart', 'fill')); btn.setAttribute('aria-pressed', 'true'); }
    if (r.matched && r.conversation_id) { await loadDating({ force: true }); matchMoment(p, r.conversation_id); }
    else toast(`You liked ${shortName(p.handle)} 💘`, 'heart');
  } catch (e) { toast(api.friendly(e), 'x'); }
  if (btn) btn.disabled = false;
}

// ---- NearbyMap -----------------------------------------------------------------------------------
let leafletReady = null;
function loadLeaflet() {
  if (window.L && window.L.markerClusterGroup) return Promise.resolve();
  if (leafletReady) return leafletReady;
  const css = (href) => new Promise((ok) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.onload = ok; l.onerror = ok; document.head.append(l); });
  const js = (src) => new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('The map couldn’t load. Check your connection.')); document.head.append(s); });
  leafletReady = Promise.all([css('/vendor/leaflet/leaflet.css'), css('/vendor/leaflet/MarkerCluster.css')])
    .then(() => js('/vendor/leaflet/leaflet.js')).then(() => js('/vendor/leaflet/leaflet.markercluster.js'))
    .catch((e) => { leafletReady = null; throw e; });
  return leafletReady;
}

function nearbyMap(redraw) {
  const box = h('div', { class: 'nb-map', role: 'region', 'aria-label': 'Map of people nearby (approximate areas)' }, h('div', { class: 'nb-loading' }, h('div', { class: 'spinner' })));
  const controls = h('div', { class: 'nb-map-ctrls' });
  const legend = h('div', { class: 'nb-map-note' }, icon('shield', 'sm'), 'Approximate areas only. Exact locations are never shown.');
  const wrap = h('div', { class: 'nb-map-wrap' }, box, controls, legend);
  loadLeaflet().then(() => {
    if (!box.isConnected) return;
    const L = window.L;
    box.replaceChildren();
    const center = [settings.area_lat, settings.area_lng];
    const map = L.map(box, { zoomControl: false, attributionControl: true, minZoom: 6, maxZoom: 15 }).setView(center, zoomFor(prefs.radius));
    // OpenStreetMap tiles (free, no key), darkened to match treehouse in CSS (.nb-tiles).
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, className: 'nb-tiles', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(map);
    // Current-area indicator: your protected area, not your exact spot.
    L.circle(center, { radius: prefs.radius * 1000, color: '#12b9f5', weight: 1.5, opacity: .7, fillColor: '#12b9f5', fillOpacity: .07, interactive: false }).addTo(map);
    L.marker(center, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'nb-me', html: '<span class="nb-me-dot"></span>', iconSize: [28, 28] }) }).addTo(map);
    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false, maxClusterRadius: 56, spiderfyOnMaxZoom: true,
      iconCreateFunction: (c) => L.divIcon({ className: 'nb-cluster', html: `<span>${c.getChildCount()}</span>`, iconSize: [46, 46] }),
    });
    const onMap = (people || []).filter((p) => p.map_lat != null && p.map_lng != null);
    for (const p of onMap) {
      const html = h('div', { class: `nb-pin ${p.liked_me ? 'date' : ''}` },
        h('span', { class: 'nb-pin-av' }, avatar(p.handle, p.handle, 'lg'), p.online ? h('i', { class: 'on' }) : null),
        h('span', { class: 'nb-pin-dist' }, distShort(p)));
      const m = L.marker([p.map_lat, p.map_lng], { title: `${p.handle}, ${distShort(p)}`, icon: L.divIcon({ className: 'nb-pin-wrap', html: '', iconSize: [64, 80], iconAnchor: [32, 40] }) });
      m.on('add', () => { const el = m.getElement(); if (el) el.replaceChildren(html); });
      m.on('click', () => preview(p, redraw));
      cluster.addLayer(m);
    }
    map.addLayer(cluster);
    const btn = (ico, label, fn) => h('button', { class: 'nb-map-btn', 'aria-label': label, title: label, onclick: fn }, icon(ico));
    controls.replaceChildren(
      btn('plus', 'Zoom in', () => map.zoomIn()),
      btn('minus', 'Zoom out', () => map.zoomOut()),
      btn('target', 'Back to my area', () => map.flyTo(center, zoomFor(prefs.radius), { duration: .6 })),
      btn('list', 'Show as list', () => { prefs.mode = 'list'; savePrefs(); redraw(); }));
    const hidden = (people || []).length - onMap.length;
    if (hidden > 0) legend.append(h('span', { class: 'nb-map-hidden' }, `+${hidden} in the list`));
    setTimeout(() => map.invalidateSize(), 50);
  }).catch((e) => box.replaceChildren(emptyState('🗺️', 'The map couldn’t load', api.friendly(e))));
  return wrap;
}
const zoomFor = (km) => (km <= 1 ? 15 : km <= 5 ? 13 : km <= 10 ? 12 : km <= 25 ? 11 : 10);

// ---- NearbyProfilePreview -------------------------------------------------------------------------
function preview(p, redraw) {
  const ints = p.interests || [];
  const act = activeText(p);
  const heart = h('button', { class: `btn btn-icon nb-pv-heart ${p.i_liked ? 'on' : ''}`, 'aria-label': `Like ${p.handle}`, onclick: () => like(p, heart) }, icon('heart', p.i_liked ? 'fill' : ''));
  sheet((close) => [
    h('div', { class: 'nb-pv' },
      h('span', { class: 'nb-pv-av' }, avatar(p.handle, p.handle, 'xl'), p.online ? h('i', { class: 'on' }) : null),
      h('div', { class: 'grow' },
        h('h2', {}, `${shortName(p.handle)} `, h('span', { class: 'nb-age' }, String(p.age))),
        h('p', { class: 'nb-pv-where' }, icon('pin', 'sm'), [distText(p), p.location].filter(Boolean).join(' · ')),
        act ? h('span', { class: `pc-status ${p.online ? 'on' : ''}` }, act) : null)),
    p.liked_me ? h('p', { class: 'nb-likes-line' }, '💘 They already like you. Like them back to match.') : null,
    h('p', { class: 'nb-pv-bio' }, p.bio || 'No bio yet.'),
    h('div', { class: 'chips' },
      p.intent ? h('span', { class: 'chip static intent-chip' }, INTENT_LABEL[p.intent]) : null,
      ints.slice(0, 3).map((i) => h('span', { class: 'chip static' }, i)),
      ints.length > 3 ? h('span', { class: 'chip static' }, `+${ints.length - 3}`) : null),
    h('div', { class: 'nb-pv-actions' },
      p.conversation_id
        ? h('button', { class: 'btn btn-primary grow', onclick: () => { close(); nav.openChat(p.conversation_id); } }, icon('chat', 'sm'), 'Open chat')
        : h('button', { class: 'btn btn-coral grow', onclick: () => { close(); composeTo(p); } }, icon('send', 'sm'), 'Send Message Request'),
      heart,
      h('button', { class: 'btn btn-icon btn-ghost', 'aria-label': 'More options', onclick: () => { close(); moreMenu(p, redraw); } }, icon('more'))),
  ], { label: `${p.handle}’s profile` });
}

function moreMenu(p, redraw) {
  sheet((close) => [h('h2', {}, p.handle),
    h('div', { class: 'menu-list', style: { marginTop: '10px' } },
      h('button', { class: 'menu-item', onclick: () => { close(); fullProfile(p, redraw); } }, icon('user'), 'View full profile'),
      h('button', { class: 'menu-item danger', onclick: async () => {
        close();
        if (!(await confirmSheet({ title: `Block ${p.handle}?`, text: 'You won’t see each other in Nearby or Discover, and they can’t message you. They aren’t told.', yes: 'Block', danger: true }))) return;
        try { await api.blockProfile(p.handle); toast('Blocked', 'shield'); people = (people || []).filter((x) => x.handle !== p.handle); redraw(); }
        catch (e) { toast(api.friendly(e), 'x'); }
      } }, icon('shield'), 'Block'),
      h('button', { class: 'menu-item danger', onclick: () => { close(); reportProfile(p); } }, icon('flag'), 'Report')),
  ], { label: 'Profile options' });
}

function fullProfile(p, redraw) {
  const act = activeText(p);
  sheet((close) => [
    h('div', { class: 'pc' },
      h('div', { class: 'pc-av' }, avatar(p.handle, p.handle, 'xl'), p.online ? h('i') : null),
      h('h2', {}, p.handle),
      h('p', { class: 'pc-sub' }, [`${p.age}`, GENDER_LABEL[p.gender], p.location].filter(Boolean).join(' · ')),
      act ? h('span', { class: `pc-status ${p.online ? 'on' : ''}` }, act) : null),
    h('div', { class: 'pc-about' },
      h('h3', {}, 'About'), h('p', { class: 'muted' }, p.bio || 'No bio yet.'),
      h('div', { class: 'pc-facts' },
        h('span', {}, icon('pin', 'sm'), distText(p)),
        p.intent ? h('span', {}, icon('heart', 'sm'), `Looking for: ${INTENT_LABEL[p.intent]}`) : null),
      (p.interests || []).length ? h('div', { class: 'chips' }, p.interests.map((i) => h('span', { class: 'chip static' }, i))) : null,
      h('p', { class: 'tiny muted', style: { marginTop: '8px' } }, '🎭 Names stay hidden until you both choose to reveal.')),
    h('div', { class: 'sheet-actions two' },
      h('button', { class: 'btn btn-coral', onclick: () => { close(); like(p); } }, icon('heart', 'sm'), 'Like'),
      p.conversation_id ? h('button', { class: 'btn btn-primary', onclick: () => { close(); nav.openChat(p.conversation_id); } }, icon('chat', 'sm'), 'Open chat')
        : h('button', { class: 'btn btn-primary', onclick: () => { close(); composeTo(p); } }, icon('send', 'sm'), 'Message request')),
  ], { label: `${p.handle}’s profile` });
}

function reportProfile(p) {
  let reason = null;
  const details = h('textarea', { class: 'textarea', maxlength: '1000', placeholder: 'What happened? (optional)' });
  const block = h('input', { type: 'checkbox', checked: true });
  const send = h('button', { class: 'btn btn-danger btn-block', disabled: true }, 'Send report');
  const opts = h('div', { class: 'chips' }, REPORT_REASONS.map(([v, label]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: (e) => {
    reason = v; send.disabled = false;
    opts.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === e.currentTarget)));
  } }, label)));
  sheet((close) => {
    send.onclick = async () => {
      send.disabled = true;
      try {
        await api.reportProfile(p.handle, reason, details.value.trim());
        if (block.checked) { await api.blockProfile(p.handle); people = (people || []).filter((x) => x.handle !== p.handle); }
        close(); toast('Thanks. We’ll review your report.', 'flag');
        if (block.checked) nav.rerender();
      } catch (e) { toast(api.friendly(e), 'x'); send.disabled = false; }
    };
    return [h('h2', {}, `Report ${p.handle}`), h('p', { class: 'small muted' }, 'Reports are private. They aren’t told who reported them.'),
      opts, details, h('label', { class: 'check' }, block, 'Also block them'), h('div', { class: 'sheet-actions' }, send)];
  }, { label: 'Report' });
}

// ---- DistanceFilter (and the other filters) -------------------------------------------------------
function filterSheet(apply) {
  let radius = prefs.radius, sort = prefs.sort, genders = prefs.genders.slice(), interests = prefs.interests.slice();
  const radiusEl = h('div', { class: 'nb-radius', role: 'radiogroup', 'aria-label': 'Distance' });
  const drawRadius = () => radiusEl.replaceChildren(...RADII.map((r) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(radius === r), onclick: () => { radius = r; drawRadius(); } }, `${r} km`)));
  drawRadius();
  const min = h('input', { class: 'input', type: 'number', min: '18', max: '99', inputmode: 'numeric', placeholder: String((state.profile && state.profile.min_age) || 18), value: prefs.minAge || '' });
  const max = h('input', { class: 'input', type: 'number', min: '18', max: '99', inputmode: 'numeric', placeholder: String(Math.min((state.profile && state.profile.max_age) || 99, 99)), value: prefs.maxAge || '' });
  const g = chipGroup(GENDERS, { selected: genders, multi: true, onChange: (v) => { genders = v; } });
  const i = chipGroup(INTERESTS.map((x) => [x, x]), { selected: interests, multi: true, max: 10, onChange: (v) => { interests = v; } });
  const sortEl = h('div', { class: 'segmented' }, [['distance', 'Distance'], ['active', 'Recently active']].map(([v, label]) =>
    h('button', { 'aria-selected': String(sort === v), onclick: (e) => { sort = v; e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b === e.currentTarget))); } }, label)));
  sheet((close) => [h('h2', {}, 'Nearby filters'),
    h('div', { class: 'field' }, h('span', {}, 'Distance'), radiusEl),
    h('div', { class: 'row' }, h('label', { class: 'field grow' }, h('span', {}, 'From age'), min), h('label', { class: 'field grow' }, h('span', {}, 'To age'), max)),
    h('div', { class: 'field' }, h('span', {}, 'Show me (leave empty for everyone)'), g.el),
    h('div', { class: 'field' }, h('span', {}, 'Interests (any of)'), i.el),
    h('div', { class: 'field' }, h('span', {}, 'Sort by'), sortEl),
    h('div', { class: 'sheet-actions two' },
      h('button', { class: 'btn btn-soft', onclick: () => { Object.assign(prefs, { radius: 10, sort: 'distance', minAge: null, maxAge: null, genders: [], interests: [] }); savePrefs(); close(); apply(); } }, 'Reset'),
      h('button', { class: 'btn btn-dark', onclick: () => {
        const a = Number(min.value) || null, b = Number(max.value) || null;
        if ((a && a < 18) || (b && b < 18) || (a && b && b < a)) return toast('Ages start at 18, and “to” must be at least “from”.', 'x');
        Object.assign(prefs, { radius, sort, minAge: a, maxAge: b, genders, interests }); savePrefs(); close(); apply();
      } }, 'Show results'))], { label: 'Nearby filters' });
}

// ---- LocationPrivacySettings ----------------------------------------------------------------------
export async function openNearbySettings(after = () => {}) {
  try { settings = await api.nearbySettings(); } catch (e) { return toast(api.friendly(e), 'x'); }
  const row = (ico, title, sub, on, key) => h('div', { class: 'settings-row', style: { cursor: 'default' } }, icon(ico),
    h('span', { class: 'grow' }, title, h('span', { class: 'sub' }, sub)),
    toggle(on, async (v, input) => { await setSetting({ [key]: v }); input.checked = !!settings[key.replace('p_', '')]; after(); }, title));
  sheet((close) => [h('h2', {}, 'Nearby & location'),
    h('p', { class: 'small muted' }, 'Your exact location is never shared. People only see a distance and an area of about 1 km.'),
    settings.enabled ? h('div', { class: 'settings-group', style: { marginTop: '12px' } },
      row('pause', 'Pause location sharing', 'Hide from Nearby for now; nothing is deleted', settings.paused, 'p_paused'),
      row('eye', 'Hide my distance', 'You appear in the list as “Nearby”, and not on the map', settings.hide_distance, 'p_hide_distance'),
      row('map', 'Hide me on the map', 'You still appear in the list with your distance', settings.hide_on_map, 'p_hide_on_map'),
      h('button', { class: 'settings-row', onclick: async () => { try { await shareArea(); after(); } catch (e) { toast(locationError(e), 'x'); } } },
        icon('pin'), h('span', { class: 'grow' }, 'Update my area now', h('span', { class: 'sub' }, settings.updated_at ? `Last updated ${new Date(settings.updated_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : '')), h('span', { class: 'chev' }, icon('chev', 'sm'))))
      : h('p', { class: 'muted', style: { margin: '14px 0' } }, 'Nearby is off. Turn it on from Discover → Nearby.'),
    h('div', { class: 'sheet-actions' },
      settings.enabled ? h('button', { class: 'btn btn-danger btn-block', onclick: async () => {
        if (!(await confirmSheet({ title: 'Turn off Nearby?', text: 'Your location is deleted straight away and you disappear from Nearby.', yes: 'Turn off', danger: true }))) return;
        await setSetting({ p_enabled: false }); close(); toast('Nearby is off. Your location was deleted.', 'shield'); after();
      } }, icon('logout', 'sm'), 'Turn off Nearby & delete my location') : h('button', { class: 'btn btn-coral btn-block', onclick: () => { close(); go('discover/nearby'); } }, 'Go to Nearby'),
      h('button', { class: 'btn btn-soft btn-block', onclick: close }, 'Done'))], { label: 'Nearby & location' });
}
