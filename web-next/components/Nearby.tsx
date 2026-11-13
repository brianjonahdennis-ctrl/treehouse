'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Nearby: people around you, as a list or on a map (port of anon-inbox/public/hy-nearby.js). Off by
// default; you switch it on yourself. The phone's position goes to the server once (when you turn
// Nearby on or refresh your area) and is reduced there to a protected point (~1 km grid + a secret
// per-person offset). Everything here works from what the server returns: rounded distances and
// protected map points, never raw GPS.
import { HandleBadges, ProfileBadges } from './Reputation';
import { useEffect, useRef, useState } from 'react';
import * as api from '@/lib/api';
import { state, loadDating } from '@/lib/state';
import { GENDERS, GENDER_LABEL, INTENT_LABEL, INTERESTS } from '@/lib/options';
import { go, openChat } from '@/lib/nav';
import { store, avatarBg, initials } from '@/lib/util';
import { cachedAvatar } from '@/lib/avatars';
import { normalize, pictureOf } from '@/lib/avatar-core.js';
import { Icon, Hero, Avatar, EmptyState, Chips, Toggle } from './ui';
import { openSheet, confirmSheet, toast } from './overlay';
import { composeTo, matchMoment } from './Discover';

const RADII = [1, 5, 10, 25, 50];
const REPORT_REASONS: [string, string][] = [['harassment', 'Harassment'], ['inappropriate', 'Sexual or inappropriate'], ['spam', 'Spam or scam'],
  ['fake', 'Fake profile'], ['underage', 'Seems under 18'], ['other', 'Something else']];
const shortName = (handle: string) => handle.split(' ').slice(0, 2).join(' ');

// Saved per device: view mode and filters (never the location). Same key as the live app.
type Prefs = { mode: 'list' | 'map'; radius: number; sort: string; minAge: number | null; maxAge: number | null; genders: string[]; interests: string[] };
let prefsCache: Prefs | null = null;
const prefs = (): Prefs => (prefsCache ||= { mode: 'list', radius: 10, sort: 'distance', minAge: null, maxAge: null, genders: [], interests: [], ...(store.get<Partial<Prefs>>('hy-nearby', {}) || {}) });
const savePrefs = (next: Partial<Prefs>) => { prefsCache = { ...prefs(), ...next }; store.set('hy-nearby', prefsCache); };
const filterCount = () => { const p = prefs(); return [p.minAge || p.maxAge, p.genders.length, p.interests.length, p.sort !== 'distance'].filter(Boolean).length; };

let settings: any = null;   // from nearby_settings()
let peopleCache: any[] | null = null;
let query = '';

const distText = (p: any) => (p.distance_km == null ? 'Nearby' : p.distance_km < 1 ? 'Under 1 km away' : `${p.distance_km.toFixed(1)} km away`);
const distShort = (p: any) => (p.distance_km == null ? 'near' : p.distance_km < 1 ? '<1 km' : `${p.distance_km.toFixed(1)} km`);
const activeText = (p: any) => (p.online ? 'Online now' : p.active_hours == null ? null : p.active_hours < 1 ? 'Active in the last hour'
  : p.active_hours < 48 ? `Active ${p.active_hours}h ago` : `Active ${Math.floor(p.active_hours / 24)}d ago`);

// ---- Location -----------------------------------------------------------------------------------
function currentPosition(): Promise<GeolocationCoordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Location isn’t available on this device.')); return; }
    navigator.geolocation.getCurrentPosition((pos) => resolve(pos.coords), (err) => reject(err),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 });
  });
}
const locationError = (e: any) => (e && e.code === 1
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
  if (Date.now() - new Date(settings.updated_at).getTime() < 30 * 60 * 1000) return;
  try {
    const perm = navigator.permissions && await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    if (perm && perm.state === 'granted') await shareArea({ quiet: true });
  } catch {}
}
async function setSetting(args: Record<string, unknown>) {
  try { await api.nearbyUpdate(args); settings = await api.nearbySettings(); }
  catch (e) { toast(api.friendly(e), 'x'); }
}

// ---- Screen -------------------------------------------------------------------------------------
export default function Nearby() {
  const p = state.profile;
  const [phase, setPhase] = useState<'loading' | 'ready' | 'soon' | 'error'>(settings ? 'ready' : 'loading');
  const [error, setError] = useState('');
  const [v, setV] = useState(0);
  const redraw = () => setV((n) => n + 1);
  useEffect(() => {
    let alive = true;
    api.nearbySettings().then(async (s: any) => {
      if (!alive) return;
      settings = s; setPhase('ready');
      await maybeRefreshArea();
      if (alive) redraw();
    }).catch((e: any) => {
      if (!alive) return;
      if (/could not find the function/i.test(e.message || '')) setPhase('soon');
      else { setError(api.friendly(e)); setPhase('error'); }
    });
    return () => { alive = false; };
  }, []);

  const head = (
    <Hero cls="disc-hero" title="Discover" sub="Meet people around you, safely and anonymously.">
      <div className="disc-tabs" role="tablist" aria-label="Discover sections">
        <button role="tab" aria-selected={true}><Icon name="pin" cls="sm" />Nearby</button>
        <button role="tab" aria-selected={false} onClick={() => go('discover')}><Icon name="flame" cls="sm" />Discover</button>
        <button role="tab" aria-selected={false} onClick={() => go('matches/matches')}><Icon name="heart" cls="sm" />Matches</button>
      </div>
    </Hero>
  );
  if (!p) return null;
  if (p.suspended) return <div className="stack">{head}<div className="notice warn">⚠️ Your dating profile is suspended after reports, so you can’t use Nearby.</div></div>;
  let body;
  if (phase === 'loading') body = <div className="nb-loading"><div className="spinner" /></div>;
  else if (phase === 'soon') body = <EmptyState emoji="🗺️" title="Nearby is coming soon" text="Check back in a little while." />;
  else if (phase === 'error') body = <EmptyState emoji="📡" title="Couldn’t load Nearby" text={error} />;
  else body = <NearbyBody key={v} redraw={redraw} />;
  return <div className="stack">{head}<div className="nb">{body}</div></div>;
}

function NearbyBody({ redraw }: { redraw: () => void }) {
  const [people, setPeople] = useState<any[] | null>(peopleCache);
  const [err, setErr] = useState('');
  const pr = prefs();
  useEffect(() => {
    if (!settings.enabled || settings.paused) return;
    let alive = true;
    api.nearbyPeople({ radius: pr.radius, minAge: pr.minAge, maxAge: pr.maxAge, genders: pr.genders, interests: pr.interests, sort: pr.sort })
      .then((list: any[]) => { if (alive) { peopleCache = list; setPeople(list); } })
      .catch((e: any) => { if (alive) setErr(api.friendly(e)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!settings.enabled) return <OptIn redraw={redraw} />;
  if (settings.paused) return (
    <div className="nb-card nb-center">
      <div className="nb-icon"><Icon name="pause" /></div>
      <h2>Nearby is paused</h2>
      <p>Nobody can see you in Nearby, and you can’t see others, until you resume.</p>
      <button className="btn btn-coral" onClick={async () => { await setSetting({ p_paused: false }); redraw(); }}>Resume Nearby</button>
      <button className="btn btn-glass" onClick={() => openNearbySettings(redraw)}><Icon name="gear" cls="sm" />Location settings</button>
    </div>
  );
  const n = filterCount();
  const remove = (handle: string) => { peopleCache = (peopleCache || []).filter((x) => x.handle !== handle); setPeople(peopleCache); };
  return (
    <>
      <div className="nb-mode" role="tablist" aria-label="Nearby view">
        {(['list', 'map'] as const).map((m) => (
          <button key={m} role="tab" aria-selected={pr.mode === m} onClick={() => { savePrefs({ mode: m }); redraw(); }}><Icon name={m} cls="sm" />{m === 'list' ? 'List' : 'Map'}</button>))}
      </div>
      <div className="nb-bar">
        <button className="nb-chip" aria-label="Update my area" title="Update my area" onClick={async () => { try { await shareArea(); redraw(); } catch (e) { toast(locationError(e), 'x'); } }}><Icon name="pin" cls="sm" /><span>My area</span><Icon name="rewind" cls="sm" /></button>
        <button className="nb-chip" onClick={() => filterSheet(redraw)}><span>{`Radius: ${pr.radius} km`}</span><Icon name="chev" cls="sm" /></button>
        <button className="nb-chip nb-icon-chip" aria-label="Filters" onClick={() => filterSheet(redraw)}><Icon name="sliders" cls="sm" />{n ? <span className="badge talk">{n}</span> : null}</button>
        <button className="nb-chip nb-icon-chip" aria-label="Location settings" onClick={() => openNearbySettings(redraw)}><Icon name="gear" cls="sm" /></button>
      </div>
      <div className="nb-body">
        {err ? <EmptyState emoji="📡" title="Couldn’t load people nearby" text={err} />
          : !people ? <div className="nb-loading"><div className="spinner" /></div>
            : pr.mode === 'map' ? <NearbyMap people={people} redraw={redraw} onRemove={remove} />
              : <NearbyList people={people} redraw={redraw} onRemove={remove} />}
      </div>
    </>
  );
}

// ---- Opt in ---------------------------------------------------------------------------------------
function OptIn({ redraw }: { redraw: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div className="nb-card nb-optin">
      <div className="nb-hero-art" aria-hidden="true"><span className="nb-ring r1" /><span className="nb-ring r2" /><span className="nb-ring r3" /><span className="nb-dot" /></div>
      <h2>Meet people near you</h2>
      <p>See who’s around, how far away they are, and their area on a map. You choose when to share.</p>
      <ul className="nb-promises">
        <li><Icon name="shield" cls="sm" /><span><b>Never your exact location. </b>We round it to an area of about 1 km and move it slightly, so nobody can find your home.</span></li>
        <li><Icon name="eye" cls="sm" /><span><b>Your choice. </b>Pause, hide your distance or hide from the map any time. Turning Nearby off deletes your location.</span></li>
        <li><Icon name="lock" cls="sm" /><span><b>No tracking. </b>Your area only updates when you open Nearby. Nothing runs in the background.</span></li>
      </ul>
      <p className="error" role="alert">{err}</p>
      <button className="btn btn-coral btn-block" disabled={busy} onClick={async () => {
        setBusy(true); setErr('');
        try { await shareArea({ quiet: true }); toast('Nearby is on', 'pin'); peopleCache = null; redraw(); }
        catch (e) { setErr(locationError(e)); setBusy(false); }
      }}><Icon name="pin" cls="sm" />Turn on Nearby</button>
      <p className="tiny dark-note center">Your phone will ask for permission to use your location.</p>
    </div>
  );
}

// ---- NearbyList ----------------------------------------------------------------------------------
function NearbyList({ people, redraw, onRemove }: { people: any[]; redraw: () => void; onRemove: (h: string) => void }) {
  const [q, setQ] = useState(query);
  const pr = prefs();
  const shown = people.filter((p) => !q.trim() || p.handle.toLowerCase().includes(q.trim().toLowerCase()));
  const next = RADII[RADII.indexOf(pr.radius) + 1] || 50;
  return (
    <div className="nb-list-wrap">
      <label className="nb-search"><Icon name="search" cls="sm" /><input className="nb-search-input" type="search" placeholder="Search nicknames" value={q} aria-label="Search nearby people" enterKeyHint="search"
        onChange={(e) => { query = e.target.value; setQ(e.target.value); }} /></label>
      <div className="nb-count"><b>People nearby</b><span className="nb-pill">{String(people.length)}</span>
        <button className="link-btn nb-mapview" onClick={() => { savePrefs({ mode: 'map' }); redraw(); }}><Icon name="map" cls="sm" />Map view</button></div>
      <div className="nb-list">
        {shown.length ? shown.map((p) => <PersonRow key={p.handle} p={p} onOpen={() => preview(p, onRemove)} />)
          : <EmptyState emoji="🗺️" title={q.trim() ? 'No one by that name' : 'No one nearby yet'}
            text={q.trim() ? 'Try another nickname.' : `Nobody within ${pr.radius} km has Nearby on right now. Try a bigger radius, or check back later.`}>
            {!q.trim() && pr.radius < 50 ? <button className="btn btn-glass" onClick={() => { savePrefs({ radius: next }); peopleCache = null; redraw(); }}>{`Search ${next} km`}</button> : null}
          </EmptyState>}
      </div>
    </div>
  );
}
function PersonRow({ p, onOpen }: { p: any; onOpen: () => void }) {
  const [, bump] = useState(0);
  const act = activeText(p);
  return (
    <article className="nb-row" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
      <span className={`nb-av ${p.liked_me ? 'likes-you' : ''}`}><Avatar seed={p.handle} cls="lg" />{p.online ? <i className="on" /> : null}</span>
      <span className="grow">
        <b><span className="ellipsis">{shortName(p.handle)}</span>{` ${p.age}`}{p.online ? <i className="nb-online" aria-label="Online" /> : null}</b>
        {!p.online && act ? <span className="nb-sub">{act}</span> : null}
        <span className="nb-sub"><Icon name="pin" cls="sm" />{distText(p)}</span>
        <HandleBadges handle={p.handle} />
        {p.liked_me ? <span className="nb-likes">💘 Likes you</span> : null}
      </span>
      <HeartButton p={p} cls="nb-heart" onDone={() => bump((n) => n + 1)} />
    </article>
  );
}
function HeartButton({ p, cls, onDone }: { p: any; cls: string; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [pop, setPop] = useState(false);
  return (
    <button className={`${cls} ${p.i_liked ? 'on' : ''} ${pop ? 'pop' : ''}`.trim()} disabled={busy} aria-label={p.i_liked ? 'Liked' : `Like ${p.handle}`} aria-pressed={!!p.i_liked}
      onClick={async (e) => { e.stopPropagation(); setBusy(true); if (await like(p)) setPop(true); setBusy(false); onDone?.(); }}>
      <Icon name="heart" cls={p.i_liked ? 'fill' : ''} />
    </button>
  );
}
async function like(p: any) {
  if (p.i_liked) { toast('You already liked them 💘', 'heart'); return false; }
  try {
    const r = await api.likeProfile(p.handle, true);
    p.i_liked = true;
    if (r.matched && r.conversation_id) { await loadDating({ force: true }); matchMoment(p, r.conversation_id); }
    else toast(`You liked ${shortName(p.handle)} 💘`, 'heart');
    return true;
  } catch (e) { toast(api.friendly(e), 'x'); return false; }
}

// ---- NearbyMap (Leaflet, served from our own address for the security policy) ---------------------
let leafletReady: Promise<void> | null = null;
function loadLeaflet() {
  const w = window as any;
  if (w.L && w.L.markerClusterGroup) return Promise.resolve();
  if (leafletReady) return leafletReady;
  const css = (href: string) => new Promise<void>((ok) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.onload = () => ok(); l.onerror = () => ok(); document.head.append(l); });
  const js = (src: string) => new Promise<void>((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = () => ok(); s.onerror = () => bad(new Error('The map couldn’t load. Check your connection.')); document.head.append(s); });
  leafletReady = Promise.all([css('/vendor/leaflet/leaflet.css'), css('/vendor/leaflet/MarkerCluster.css')])
    .then(() => js('/vendor/leaflet/leaflet.js')).then(() => js('/vendor/leaflet/leaflet.markercluster.js'))
    .catch((e) => { leafletReady = null; throw e; });
  return leafletReady;
}
const zoomFor = (km: number) => (km <= 1 ? 15 : km <= 5 ? 13 : km <= 10 ? 12 : km <= 25 ? 11 : 10);
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
// The pin's picture: their custom avatar if we have it, otherwise initials (our own markup, escaped).
function pinHtml(p: any) {
  const cfg = cachedAvatar(p.handle);
  const face = cfg
    ? (() => { const c = normalize(cfg); return `<span class="avatar lg has-av"><span class="av-svg av-modern av-bg-${esc(c.b)}"><img src="${esc(pictureOf(c, 96))}" alt="" draggable="false"></span></span>`; })()
    : `<span class="avatar lg" data-h="${esc(p.handle)}">${esc(initials(p.handle))}</span>`;
  return `<div class="nb-pin ${p.liked_me ? 'date' : ''}"><span class="nb-pin-av">${face}${p.online ? '<i class="on"></i>' : ''}</span><span class="nb-pin-dist">${esc(distShort(p))}</span></div>`;
}

function NearbyMap({ people, redraw, onRemove }: { people: any[]; redraw: () => void; onRemove: (h: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState('');
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<any>(null);
  const pr = prefs();
  const onMap = people.filter((p) => p.map_lat != null && p.map_lng != null);
  const center: [number, number] = [settings.area_lat, settings.area_lng];
  useEffect(() => {
    let alive = true;
    loadLeaflet().then(() => {
      if (!alive || !box.current) return;
      const L = (window as any).L;
      setLoading(false);
      const map = L.map(box.current, { zoomControl: false, attributionControl: true, minZoom: 6, maxZoom: 15 }).setView(center, zoomFor(pr.radius));
      mapRef.current = map;
      // OpenStreetMap tiles (free, no key), darkened to match treehouse in CSS (.nb-tiles).
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, className: 'nb-tiles', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(map);
      // Current-area indicator: your protected area, not your exact spot.
      L.circle(center, { radius: pr.radius * 1000, color: '#12b9f5', weight: 1.5, opacity: 0.7, fillColor: '#12b9f5', fillOpacity: 0.07, interactive: false }).addTo(map);
      L.marker(center, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'nb-me', html: '<span class="nb-me-dot"></span>', iconSize: [28, 28] }) }).addTo(map);
      const cluster = L.markerClusterGroup({
        showCoverageOnHover: false, maxClusterRadius: 56, spiderfyOnMaxZoom: true,
        iconCreateFunction: (c: any) => L.divIcon({ className: 'nb-cluster', html: `<span>${c.getChildCount()}</span>`, iconSize: [46, 46] }),
      });
      for (const p of onMap) {
        const m = L.marker([p.map_lat, p.map_lng], { title: `${p.handle}, ${distShort(p)}`, icon: L.divIcon({ className: 'nb-pin-wrap', html: pinHtml(p), iconSize: [64, 80], iconAnchor: [32, 40] }) });
        m.on('click', () => preview(p, onRemove));
        cluster.addLayer(m);
      }
      map.addLayer(cluster);
      // Initials pins: colour from the name, set here (not inline in the HTML string).
      map.on('layeradd', () => box.current?.querySelectorAll<HTMLElement>('.nb-pin .avatar[data-h]').forEach((el) => {
        el.style.setProperty('--av', avatarBg(el.dataset.h || ''));
      }));
      setTimeout(() => map.invalidateSize(), 50);
    }).catch((e) => { if (alive) { setLoading(false); setFailed(api.friendly(e)); } });
    return () => { alive = false; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const hidden = people.length - onMap.length;
  const btn = (ico: string, label: string, fn: () => void) => <button key={ico} className="nb-map-btn" aria-label={label} title={label} onClick={fn}><Icon name={ico} /></button>;
  return (
    <div className="nb-map-wrap">
      <div ref={box} className="nb-map" role="region" aria-label="Map of people nearby (approximate areas)">
        {loading ? <div className="nb-loading"><div className="spinner" /></div> : null}
        {failed ? <EmptyState emoji="🗺️" title="The map couldn’t load" text={failed} /> : null}
      </div>
      <div className="nb-map-ctrls">{loading || failed ? null : [
        btn('plus', 'Zoom in', () => mapRef.current?.zoomIn()),
        btn('minus', 'Zoom out', () => mapRef.current?.zoomOut()),
        btn('target', 'Back to my area', () => mapRef.current?.flyTo(center, zoomFor(pr.radius), { duration: 0.6 })),
        btn('list', 'Show as list', () => { savePrefs({ mode: 'list' }); redraw(); })]}</div>
      <div className="nb-map-note"><Icon name="shield" cls="sm" />Approximate areas only. Exact locations are never shown.
        {hidden > 0 ? <span className="nb-map-hidden">{`+${hidden} in the list`}</span> : null}</div>
    </div>
  );
}

// ---- NearbyProfilePreview -------------------------------------------------------------------------
function preview(p: any, onRemove: (h: string) => void) {
  const ints: string[] = p.interests || [];
  const act = activeText(p);
  openSheet((close) => (
    <>
      <div className="nb-pv">
        <span className="nb-pv-av"><Avatar seed={p.handle} cls="xl" />{p.online ? <i className="on" /> : null}</span>
        <div className="grow">
          <h2>{`${shortName(p.handle)} `}<span className="nb-age">{String(p.age)}</span></h2>
          <p className="nb-pv-where"><Icon name="pin" cls="sm" />{[distText(p), p.location].filter(Boolean).join(' · ')}</p>
          {act ? <span className={`pc-status ${p.online ? 'on' : ''}`}>{act}</span> : null}
        </div>
      </div>
      {p.liked_me ? <p className="nb-likes-line">💘 They already like you. Like them back to match.</p> : null}
      <p className="nb-pv-bio">{p.bio || 'No bio yet.'}</p>
      <div className="chips">
        {p.intent ? <span className="chip static intent-chip">{INTENT_LABEL[p.intent]}</span> : null}
        {ints.slice(0, 3).map((i) => <span key={i} className="chip static">{i}</span>)}
        {ints.length > 3 ? <span className="chip static">{`+${ints.length - 3}`}</span> : null}
      </div>
      <div className="nb-pv-actions">
        {p.conversation_id
          ? <button className="btn btn-primary grow" onClick={() => { close(); openChat(p.conversation_id); }}><Icon name="chat" cls="sm" />Open chat</button>
          : <button className="btn btn-coral grow" onClick={() => { close(); composeTo(p); }}><Icon name="send" cls="sm" />Send Message Request</button>}
        <HeartButton p={p} cls="btn btn-icon nb-pv-heart" />
        <button className="btn btn-icon btn-ghost" aria-label="More options" onClick={() => { close(); moreMenu(p, onRemove); }}><Icon name="more" /></button>
      </div>
    </>
  ), { label: `${p.handle}’s profile` });
}

function moreMenu(p: any, onRemove: (h: string) => void) {
  openSheet((close) => (
    <>
      <h2>{p.handle}</h2>
      <div className="menu-list" style={{ marginTop: '10px' }}>
        <button className="menu-item" onClick={() => { close(); fullProfile(p); }}><Icon name="user" />View full profile</button>
        <button className="menu-item danger" onClick={async () => {
          close();
          if (!(await confirmSheet({ title: `Block ${p.handle}?`, text: 'You won’t see each other in Nearby or Discover, and they can’t message you. They aren’t told.', yes: 'Block', danger: true }))) return;
          try { await api.blockProfile(p.handle); toast('Blocked', 'shield'); onRemove(p.handle); }
          catch (e) { toast(api.friendly(e), 'x'); }
        }}><Icon name="shield" />Block</button>
        <button className="menu-item danger" onClick={() => { close(); openSheet((c) => <ReportForm p={p} close={c} onRemove={onRemove} />, { label: 'Report' }); }}><Icon name="flag" />Report</button>
      </div>
    </>
  ), { label: 'Profile options' });
}

function fullProfile(p: any) {
  const act = activeText(p);
  openSheet((close) => (
    <>
      <div className="pc">
        <div className="pc-av"><Avatar seed={p.handle} cls="xl" />{p.online ? <i /> : null}</div>
        <h2>{p.handle}</h2>
        <p className="pc-sub">{[`${p.age}`, GENDER_LABEL[p.gender], p.location].filter(Boolean).join(' · ')}</p>
        <ProfileBadges dating={p.handle} />
        {act ? <span className={`pc-status ${p.online ? 'on' : ''}`}>{act}</span> : null}
      </div>
      <div className="pc-about">
        <h3>About</h3><p className="muted">{p.bio || 'No bio yet.'}</p>
        <div className="pc-facts">
          <span><Icon name="pin" cls="sm" />{distText(p)}</span>
          {p.intent ? <span><Icon name="heart" cls="sm" />{`Looking for: ${INTENT_LABEL[p.intent]}`}</span> : null}
        </div>
        {(p.interests || []).length ? <div className="chips">{p.interests.map((i: string) => <span key={i} className="chip static">{i}</span>)}</div> : null}
        <p className="tiny muted" style={{ marginTop: '8px' }}>🎭 Names stay hidden until you both choose to reveal.</p>
      </div>
      <div className="sheet-actions two">
        <button className="btn btn-coral" onClick={() => { close(); like(p); }}><Icon name="heart" cls="sm" />Like</button>
        {p.conversation_id
          ? <button className="btn btn-primary" onClick={() => { close(); openChat(p.conversation_id); }}><Icon name="chat" cls="sm" />Open chat</button>
          : <button className="btn btn-primary" onClick={() => { close(); composeTo(p); }}><Icon name="send" cls="sm" />Message request</button>}
      </div>
    </>
  ), { label: `${p.handle}’s profile` });
}

function ReportForm({ p, close, onRemove }: { p: any; close: () => void; onRemove: (h: string) => void }) {
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [block, setBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h2>{`Report ${p.handle}`}</h2>
      <p className="small muted">Reports are private. They aren’t told who reported them.</p>
      <Chips options={REPORT_REASONS} value={reason} onChange={(v) => setReason(v)} />
      <textarea className="textarea" maxLength={1000} placeholder="What happened? (optional)" value={details} onChange={(e) => setDetails(e.target.value)} />
      <label className="check"><input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} />Also block them</label>
      <div className="sheet-actions">
        <button className="btn btn-danger btn-block" disabled={!reason || busy} onClick={async () => {
          setBusy(true);
          try {
            await api.reportProfile(p.handle, reason!, details.trim());
            if (block) { await api.blockProfile(p.handle); onRemove(p.handle); }
            close(); toast('Thanks. We’ll review your report.', 'flag');
          } catch (e) { toast(api.friendly(e), 'x'); setBusy(false); }
        }}>Send report</button>
      </div>
    </>
  );
}

// ---- DistanceFilter (and the other filters) -------------------------------------------------------
function filterSheet(apply: () => void) {
  openSheet((close) => <Filters close={close} apply={apply} />, { label: 'Nearby filters' });
}
function Filters({ close, apply }: { close: () => void; apply: () => void }) {
  const pr = prefs();
  const [radius, setRadius] = useState(pr.radius);
  const [sort, setSort] = useState(pr.sort);
  const [genders, setGenders] = useState<string[]>(pr.genders.slice());
  const [interests, setInterests] = useState<string[]>(pr.interests.slice());
  const [min, setMin] = useState(pr.minAge ? String(pr.minAge) : '');
  const [max, setMax] = useState(pr.maxAge ? String(pr.maxAge) : '');
  const done = () => { peopleCache = null; close(); apply(); };
  return (
    <>
      <h2>Nearby filters</h2>
      <div className="field"><span>Distance</span>
        <div className="nb-radius" role="radiogroup" aria-label="Distance">{RADII.map((r) => <button key={r} type="button" role="radio" aria-checked={radius === r} onClick={() => setRadius(r)}>{`${r} km`}</button>)}</div></div>
      <div className="row">
        <label className="field grow"><span>From age</span><input className="input" type="number" min="18" max="99" inputMode="numeric" placeholder={String((state.profile && state.profile.min_age) || 18)} value={min} onChange={(e) => setMin(e.target.value)} /></label>
        <label className="field grow"><span>To age</span><input className="input" type="number" min="18" max="99" inputMode="numeric" placeholder={String(Math.min((state.profile && state.profile.max_age) || 99, 99))} value={max} onChange={(e) => setMax(e.target.value)} /></label>
      </div>
      <div className="field"><span>Show me (leave empty for everyone)</span><Chips options={GENDERS as [string, string][]} value={genders} multi onChange={(v) => setGenders(v)} /></div>
      <div className="field"><span>Interests (any of)</span><Chips options={INTERESTS.map((x: string) => [x, x] as [string, string])} value={interests} multi max={10} onChange={(v) => setInterests(v)} /></div>
      <div className="field"><span>Sort by</span>
        <div className="segmented">{[['distance', 'Distance'], ['active', 'Recently active']].map(([v, label]) => <button key={v} aria-selected={sort === v} onClick={() => setSort(v)}>{label}</button>)}</div></div>
      <div className="sheet-actions two">
        <button className="btn btn-soft" onClick={() => { savePrefs({ radius: 10, sort: 'distance', minAge: null, maxAge: null, genders: [], interests: [] }); done(); }}>Reset</button>
        <button className="btn btn-dark" onClick={() => {
          const a = Number(min) || null, b = Number(max) || null;
          if ((a && a < 18) || (b && b < 18) || (a && b && b < a)) { toast('Ages start at 18, and “to” must be at least “from”.', 'x'); return; }
          savePrefs({ radius, sort, minAge: a, maxAge: b, genders, interests }); done();
        }}>Show results</button>
      </div>
    </>
  );
}

// ---- LocationPrivacySettings (also opened from Profile) -------------------------------------------
export async function openNearbySettings(after: () => void = () => {}) {
  try { settings = await api.nearbySettings(); } catch (e) { toast(api.friendly(e), 'x'); return; }
  openSheet((close) => <NearbySettings close={close} after={after} />, { label: 'Nearby & location' });
}
function NearbySettings({ close, after }: { close: () => void; after: () => void }) {
  const [, bump] = useState(0);
  const s = settings;
  const row = (ico: string, title: string, sub: string, key: string) => (
    <div className="settings-row" style={{ cursor: 'default' }}><Icon name={ico} /><span className="grow">{title}<span className="sub">{sub}</span></span>
      <Toggle checked={!!s[key]} label={title} onChange={async (v) => { await setSetting({ [`p_${key}`]: v }); bump((n) => n + 1); after(); }} /></div>
  );
  return (
    <>
      <h2>Nearby & location</h2>
      <p className="small muted">Your exact location is never shared. People only see a distance and an area of about 1 km.</p>
      {s.enabled ? (
        <div className="settings-group" style={{ marginTop: '12px' }}>
          {row('pause', 'Pause location sharing', 'Hide from Nearby for now; nothing is deleted', 'paused')}
          {row('eye', 'Hide my distance', 'You appear in the list as “Nearby”, and not on the map', 'hide_distance')}
          {row('map', 'Hide me on the map', 'You still appear in the list with your distance', 'hide_on_map')}
          <button className="settings-row" onClick={async () => { try { await shareArea(); bump((n) => n + 1); after(); } catch (e) { toast(locationError(e), 'x'); } }}>
            <Icon name="pin" /><span className="grow">Update my area now<span className="sub">{s.updated_at ? `Last updated ${new Date(s.updated_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : ''}</span></span><span className="chev"><Icon name="chev" cls="sm" /></span></button>
        </div>
      ) : <p className="muted" style={{ margin: '14px 0' }}>Nearby is off. Turn it on from Discover → Nearby.</p>}
      <div className="sheet-actions">
        {s.enabled ? (
          <button className="btn btn-danger btn-block" onClick={async () => {
            if (!(await confirmSheet({ title: 'Turn off Nearby?', text: 'Your location is deleted straight away and you disappear from Nearby.', yes: 'Turn off', danger: true }))) return;
            await setSetting({ p_enabled: false }); peopleCache = null; close(); toast('Nearby is off. Your location was deleted.', 'shield'); after();
          }}><Icon name="logout" cls="sm" />Turn off Nearby & delete my location</button>
        ) : <button className="btn btn-coral btn-block" onClick={() => { close(); go('discover/nearby'); }}>Go to Nearby</button>}
        <button className="btn btn-soft btn-block" onClick={close}>Done</button>
      </div>
    </>
  );
}
