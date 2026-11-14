'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Discover (port of renderDiscover/renderDeck in anon-inbox/public/hy-dating.js): the dark card deck
// with Pass / Like / message request, undo, the location and preference filters, and the match moment.
// Speed Dating starts from the banner (components/speed.js). Not yet here: drag-to-swipe (buttons and ← → keys work).
import { HandleBadges, ProfileBadges } from './Reputation';
import { useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { state, emit, subscribe, useAppState, loadDating, statusOf } from '@/lib/state';
import { STATES, stateLabel, GENDER_LABEL, INTENT_LABEL } from '@/lib/options';
import { go, openChat } from '@/lib/nav';
import { avatarBg, hash, initials } from '@/lib/util';
import { useAvatarPicture } from '@/lib/avatars';
import { Icon, Hero, HeroBtn, Avatar, EmptyState, vars } from './ui';
import SpeedBanner from './SpeedBanner';
import AdSlot from './AdSlot';
import { openSheet, toast } from './overlay';
import { editPrefs } from './Profile';
import { meta, activeText, shortName } from './convo';

// The deck lives outside React so it survives leaving and coming back to Discover (like the live app).
let deck: any[] = [];
let deckLoaded = false, deckLoading = false, emptyAt = 0;
let lastPassed: any = null;
const decided = new Set<string>();
let deckVersion = 0;
const deckSubs = new Set<() => void>();
const redraw = () => { deckVersion++; deckSubs.forEach((f) => f()); };
subscribe((what) => { if (what === 'profile') { deck = []; deckLoaded = false; lastPassed = null; redraw(); } });

async function fill(force = false) {
  if (deckLoading) return;
  if (!force && emptyAt && Date.now() - emptyAt < 10 * 60 * 1000) { deckLoaded = true; return; }
  deckLoading = true;
  try {
    const more = await api.discover(40, [...decided, ...deck.map((p) => p.handle)]);
    emptyAt = more.length ? 0 : Date.now();
    const have = new Set(deck.map((p) => p.handle));
    deck.push(...more.filter((p: any) => !have.has(p.handle) && !decided.has(p.handle)));
  } catch (e) { if (force) toast(api.friendly(e), 'x'); }
  deckLoaded = true; deckLoading = false;
  redraw();
}

async function decide(p: any, like: boolean | null) {
  decided.add(p.handle);
  deck = deck.filter((x) => x.handle !== p.handle);
  lastPassed = like === false ? p : null;
  redraw();
  if (deck.length < 3) fill();
  if (like === null) return;
  try {
    const r = await api.likeProfile(p.handle, like);
    state.requests = state.requests.filter((x) => x.handle !== p.handle);
    if (r.matched && r.conversation_id) { await loadDating({ force: true }); matchMoment(p, r.conversation_id); }
    else if (like) state.pendingLikes += 1;
    emit('dating');
  } catch (e) { toast(api.friendly(e), 'x'); }
}
function rewind() {
  if (!lastPassed) return;
  const p = lastPassed;
  lastPassed = null;
  decided.delete(p.handle);
  deck.unshift(p);
  redraw();
}

export default function Discover() {
  const s = useAppState();
  const [, setV] = useState(0);
  const [leaving, setLeaving] = useState<null | 'like' | 'nope'>(null);
  useEffect(() => { const f = () => setV(deckVersion); deckSubs.add(f); return () => { deckSubs.delete(f); }; }, []);
  useEffect(() => { if (!deckLoaded && !deckLoading) fill(); }, []);
  const top = deck[0];
  const act = (like: boolean | null) => {
    if (!top || leaving) return;
    setLeaving(like === true ? 'like' : 'nope');
    setTimeout(() => { setLeaving(null); decide(top, like); }, 260);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/input|textarea|select/i.test((e.target as HTMLElement).tagName) || document.querySelector('.scrim, .chat, .match-scrim')) return;
      if (e.key === 'ArrowRight' && api.features.matching) act(true);
      if (e.key === 'ArrowLeft') act(api.features.matching ? false : null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const p = s.profile;
  const head = (
    <Hero cls="disc-hero" title="Discover" sub="Anonymous profiles. Like, pass, or send a message request."
      actions={api.features.matching ? <HeroBtn icon="sliders" label="Filters" onClick={() => editPrefs()} /> : null}>
      <div className="disc-tabs" role="tablist" aria-label="Discover sections">
        <button role="tab" aria-selected={false} onClick={() => go('discover/nearby')}><Icon name="pin" cls="sm" />Nearby</button>
        <button role="tab" aria-selected={true}><Icon name="flame" cls="sm" />Discover</button>
        <button role="tab" aria-selected={false} onClick={() => go('matches/matches')}><Icon name="heart" cls="sm" />Matches</button>
      </div>
    </Hero>
  );
  if (!p) return null;
  if (p.suspended) return <div className="stack">{head}<div className="notice warn">⚠️ Your dating profile is suspended after reports, so you can’t use Discover.</div></div>;

  let deckEl;
  if (!deckLoaded) deckEl = <div className="deck"><div className="swipe-card" style={vars({ '--av': 'linear-gradient(160deg,#2a1866,#170a38)' })}><div className="card-info"><div className="spinner" /></div></div></div>;
  else if (!deck.length) {
    deckEl = (
      <EmptyState emoji="🌙" title="You’ve seen everyone for now" text={api.features.matching
        ? (p.pref_state ? `No new people in ${stateLabel(p.pref_state)} right now. Try another state or anywhere in Nigeria.` : 'New people join all the time. Check your requests in Matches, or widen who you see.')
        : 'New people join all the time. Check back soon.'}>
        {lastPassed ? <button className="btn btn-glass" onClick={rewind}><Icon name="rewind" cls="sm" />Go back</button> : null}
        {api.features.states && p.pref_state ? <button className="btn btn-glass" onClick={() => saveFilter(null)}><Icon name="pin" cls="sm" />Anywhere in Nigeria</button> : null}
        <button className="btn btn-white" onClick={() => { deckLoaded = false; emptyAt = 0; decided.clear(); redraw(); fill(true); }}>Refresh</button>
      </EmptyState>
    );
  } else {
    const shown = deck.slice(0, 3).reverse();
    deckEl = (
      <>
        <div className="deck">
          {shown.map((c, i) => {
            const depth = shown.length - 1 - i;
            return <SwipeCard key={c.handle} p={c} depth={depth} leaving={depth === 0 ? leaving : null} />;
          })}
          {api.features.matching ? (
            <div className="deck-actions">
              <button className="round-btn sm" title="Undo pass" aria-label="Go back to the last person you passed" disabled={!lastPassed} onClick={rewind}><Icon name="rewind" /></button>
              <button className="round-btn pass" title="Pass" aria-label="Pass" onClick={() => act(false)}><Icon name="x" /></button>
              <button className="round-btn big" title="Like" aria-label="Like" onClick={() => act(true)}><Icon name="heart" /></button>
              <button className="round-btn talk" title="Send a message request" aria-label={`Send ${top.handle} a message request`} onClick={() => composeTo(top)}><Icon name="send" /></button>
            </div>
          ) : (
            <div className="deck-actions">
              <button className="round-btn" aria-label="Next" onClick={() => act(null)}><Icon name="x" /></button>
              <button className="btn btn-coral" onClick={() => composeTo(top)}><Icon name="chat" cls="sm" />Message anonymously</button>
            </div>
          )}
        </div>
        <div className="deck-legend" aria-hidden="true"><span>Undo</span><span>Pass</span><span className="date">Like</span><span className="talk">Request</span></div>
      </>
    );
  }
  return (
    <div className="stack">{head}
      {api.features.states ? <LocationBar /> : null}
      {!p.is_active ? <div className="notice"><Icon name="pause" cls="sm" /><span>Your dating profile is paused, so others can’t see you. Turn it on in Profile.</span></div> : null}
      <SpeedBanner />
      <div>{deckEl}</div>
      <AdSlot placement="discover" />
    </div>
  );
}

function whoLabel(p: any) {
  const who: string[] = p.interested_in || [];
  if (!who.length || who.length >= 3) return 'Everyone';
  return who.map((g) => ({ female: 'Women', male: 'Men', other: 'Non-binary' } as Record<string, string>)[g]).join(' & ');
}
async function saveFilter(st: string | null) {
  const p = state.profile;
  const prev = p.pref_state;
  p.pref_state = st || null;
  try { await api.updateProfile(p.handle, { pref_state: p.pref_state }); emit('profile'); toast(`Showing ${stateLabel(p.pref_state)}`, 'pin'); }
  catch (e) { p.pref_state = prev; toast(api.friendly(e), 'x'); }
}
function LocationBar() {
  const p = state.profile;
  return (
    <div className="stack" style={{ gap: '10px' }}>
      {!p.state ? <div className="notice"><Icon name="pin" cls="sm" /><span className="grow"><b>Add your state. </b>People nearby can find you, and you can filter by location.</span>
        <button className="btn btn-white btn-sm" onClick={() => pickState('mine')}>Choose</button></div> : null}
      <div className="loc-row" role="group" aria-label="Discovery filters">
        <button className="loc-chip" onClick={() => pickState('filter')}><Icon name="pin" cls="sm" /><span>{stateLabel(p.pref_state)}</span><Icon name="chev" cls="sm" /></button>
        {api.features.matching ? <button className="loc-chip" onClick={() => editPrefs()}><span>{`Ages ${p.min_age}–${p.max_age >= 99 ? '99+' : p.max_age}`}</span></button> : null}
        {api.features.matching ? <button className="loc-chip" onClick={() => editPrefs()}><span>{whoLabel(p)}</span></button> : null}
        {p.pref_state && p.state && p.pref_state !== p.state ? <button className="link-btn small loc-back" onClick={() => saveFilter(p.state)}>{`Back to ${stateLabel(p.state)}`}</button> : null}
      </div>
    </div>
  );
}
function pickState(mode: 'filter' | 'mine') { openSheet((close) => <StatePicker mode={mode} close={close} />, { label: mode === 'filter' ? 'Location filter' : 'Your state' }); }
function StatePicker({ mode, close }: { mode: 'filter' | 'mine'; close: () => void }) {
  const p = state.profile;
  const current = (mode === 'filter' ? p.pref_state : p.state) || '';
  const [q, setQ] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => { api.stateCounts().then(setCounts).catch(() => {}); }, []);
  const choose = async (value: string) => {
    close();
    if (mode === 'filter') return saveFilter(value);
    try {
      const fields: Record<string, string> = { state: value, location: value };
      if (!p.pref_state) fields.pref_state = value;
      await api.updateProfile(p.handle, fields);
      Object.assign(p, fields); emit('profile'); toast(`Your state: ${stateLabel(value)}`, 'pin');
    } catch (e) { toast(api.friendly(e), 'x'); }
  };
  const option = (value: string, label: string, n?: number) => (
    <button key={`o-${value}-${label}`} className={`state-opt ${current === value ? 'on' : ''}`} onClick={() => choose(value)}>
      <span className="grow">{label}</span>{n ? <span className="tiny muted">{`${n} ${n === 1 ? 'person' : 'people'}`}</span> : null}{current === value ? <Icon name="check" cls="sm" /> : null}
    </button>
  );
  const ql = q.trim().toLowerCase();
  const rows = STATES.filter((st) => !ql || stateLabel(st).toLowerCase().includes(ql));
  return (
    <>
      <h2>{mode === 'filter' ? 'Show people in' : 'Your state'}</h2>
      <p className="small muted">{mode === 'filter' ? 'Discover only shows people in the state you pick.' : 'Shown on your card. Only your state, never your exact location.'}</p>
      <input className="input" type="search" placeholder="Search states…" aria-label="Search states" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="state-list">
        {mode === 'filter' && !ql ? option('', 'Anywhere in Nigeria') : null}
        {mode === 'filter' && p.state && !ql ? option(p.state, `${stateLabel(p.state)} · your state`, counts[p.state]) : null}
        {rows.filter((st) => !(mode === 'filter' && st === p.state && !ql)).map((st) => option(st, stateLabel(st), counts[st]))}
      </div>
    </>
  );
}

// No photos: each card gets artwork made from the person's handle (same colours every time).
function CardArt({ p }: { p: any }) {
  const n = hash(p.handle);
  const pic = useAvatarPicture(p.handle, 640);
  const blob = (i: number, color: string) => <span className="blob" style={{
    width: `${180 + ((n >> i) % 120)}px`, height: `${180 + ((n >> (i + 2)) % 120)}px`,
    left: `${((n >> (i * 3)) % 70) - 10}%`, top: `${((n >> (i * 2 + 1)) % 50) - 5}%`, background: color,
  }} />;
  return (
    <div className="swipe-art">
      {blob(1, 'rgba(255,255,255,.35)')}{blob(4, 'rgba(255,95,162,.55)')}{blob(7, 'rgba(56,189,248,.45)')}
      <span className={`big-initials ${pic ? 'has-av' : ''}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {pic ? <span className={`av-svg av-modern av-bg-${pic.bg}`}><img src={pic.src} alt="" decoding="async" draggable={false} /></span> : initials(p.handle)}
      </span>
    </div>
  );
}
function SwipeCard({ p, depth, leaving }: { p: any; depth: number; leaving: null | 'like' | 'nope' }) {
  const likesYou = state.requests.some((r) => r.handle === p.handle);
  const ints: string[] = p.interests || [];
  const dir = leaving === 'like' ? 1 : -1;
  const style = leaving ? { transform: `translate(${dir * 140}%, -30px) rotate(${dir * 24}deg)`, opacity: 0 } : {};
  const active = activeText(p.online, p.active_hours);
  return (
    <article className={`swipe-card ${depth === 1 ? 'behind' : depth === 2 ? 'behind-2' : ''} ${leaving ? 'animating' : ''}`} style={{ ...vars({ '--av': avatarBg(p.handle) }), ...style }} aria-label={`${p.handle}, ${meta(p)}`}>
      <CardArt p={p} />
      <span className="stamp like" style={leaving === 'like' ? { opacity: 1 } : undefined}>LIKE</span>
      <span className="stamp nope" style={leaving === 'nope' ? { opacity: 1 } : undefined}>NOPE</span>
      <div className="card-badge">🎭 Anonymous until you both reveal<button aria-label="How anonymous dating works" onClick={(e) => { e.stopPropagation(); anonInfo(); }}>i</button></div>
      {likesYou ? <span className="liked-you">💘 Likes you</span> : null}
      <div className="card-info">
        <button className="card-more" aria-label={`View ${p.handle}’s profile`} onClick={(e) => { e.stopPropagation(); cardProfile(p); }}><Icon name="info" /></button>
        <h2>{`${shortName(p.handle)}, ${p.age}`}{p.online ? <i className="online-dot-inline" role="img" aria-label="Online" /> : null}</h2>
        {active ? <span className={`active-line ${p.online ? 'on' : ''}`}>{active}</span> : null}
        <HandleBadges handle={p.handle} />
        <span className="where"><Icon name="pin" cls="sm" />{[p.location, GENDER_LABEL[p.gender]].filter(Boolean).join(' · ')}</span>
        {p.bio ? <p className="bio">{p.bio}</p> : null}
        <div className="chips">
          <span className="chip static intent">{INTENT_LABEL[p.intent]}</span>
          {ints.slice(0, 2).map((i) => <span key={i} className="chip static">{i}</span>)}
          {ints.length > 2 ? <span className="chip static">{`+${ints.length - 2}`}</span> : null}
        </div>
      </div>
    </article>
  );
}

function anonInfo() {
  openSheet((close) => (
    <>
      <h2>🎭 Anonymous until you both reveal</h2>
      <p className="muted">You see a nickname, age, area, what they’re looking for and their bio. Their name stays hidden, and so does yours.</p>
      <div className="stack" style={{ marginTop: '12px' }}>
        <p>💘 Like them: if they like you back, it’s a match and a chat opens.</p>
        <p>📩 Or message them: it arrives as a message request and becomes a chat when they reply.</p>
        <p>🔓 Names are shown only after you both tap “Reveal”.</p>
        <p>🛡️ You can unmatch, block or report from any chat.</p>
      </div>
      <div className="sheet-actions"><button className="btn btn-primary btn-block" onClick={close}>Got it</button></div>
    </>
  ), { label: 'How it works' });
}

function cardProfile(p: any) {
  const ints: string[] = p.interests || [];
  const active = activeText(p.online, p.active_hours);
  const likesYou = state.requests.some((r) => r.handle === p.handle);
  openSheet((close) => (
    <>
      <div className="pc">
        <div className="pc-av"><Avatar seed={p.handle} cls="xl" />{p.online ? <i /> : null}</div>
        <h2>{p.handle}</h2>
        <p className="pc-sub">{[`${p.age}`, GENDER_LABEL[p.gender], p.location].filter(Boolean).join(' · ')}</p>
        <ProfileBadges dating={p.handle} />
        {active ? <span className={`pc-status ${p.online ? 'on' : ''}`}>{active}</span> : null}
        {likesYou ? <span className="pc-likes">💘 Likes you</span> : null}
      </div>
      <div className="pc-about">
        <h3>About</h3>
        <p className="muted">{p.bio || 'No bio yet.'}</p>
        <div className="pc-facts"><span><Icon name="heart" cls="sm" />{`Looking for: ${INTENT_LABEL[p.intent] || 'Not set'}`}</span>{p.location ? <span><Icon name="pin" cls="sm" />{p.location}</span> : null}</div>
        {ints.length ? <div className="chips">{ints.map((i) => <span key={i} className="chip static">{i}</span>)}</div> : null}
        <p className="tiny muted" style={{ marginTop: '8px' }}>🎭 Names stay hidden until you both choose to reveal.</p>
      </div>
      {api.features.matching ? (
        <div className="sheet-actions two">
          <button className="btn btn-coral" onClick={() => { close(); if (deck[0] && deck[0].handle === p.handle) decide(p, true); else likeOnly(p); }}><Icon name="heart" cls="sm" />Like</button>
          <button className="btn btn-primary" onClick={() => { close(); composeTo(p); }}><Icon name="send" cls="sm" />Message request</button>
        </div>
      ) : null}
    </>
  ), { label: `${p.handle}’s profile` });
}
async function likeOnly(p: any) {
  try {
    const r = await api.likeProfile(p.handle, true);
    if (r.matched && r.conversation_id) { await loadDating({ force: true }); matchMoment(p, r.conversation_id); } else toast('Like sent 💘', 'heart');
  } catch (e) { toast(api.friendly(e), 'x'); }
}

// Message request (or friend request) with a first message.
export function composeTo(p: any, { friend = false } = {}) { openSheet((close) => <Compose p={p} friend={friend} close={close} />, { label: `Message ${p.handle}` }); }
function Compose({ p, friend, close }: { p: any; friend: boolean; close: () => void }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const likedMe = !friend && state.requests.some((r) => r.handle === p.handle);
  return (
    <>
      <div className="row"><Avatar seed={p.handle} cls="lg" /><div className="grow"><h2>{friend ? `Add ${shortName(p.handle)} as a friend` : likedMe ? `Message ${shortName(p.handle)}` : 'Message request'}</h2>
        <p className="small muted">{[p.handle, meta(p)].filter(Boolean).join(' · ')}</p></div></div>
      <p className="small muted" style={{ margin: '10px 0' }}>{friend
        ? 'They’ll get a friend request with your message. If they accept, you’re friends: chat any time, and you can both reveal your first names. You stay anonymous until then.'
        : likedMe ? '💘 They already liked you, so this opens a chat straight away.'
        : 'They’ll see it in their Requests and can accept or decline. If they accept, you can chat. You stay anonymous either way.'}</p>
      <textarea className="textarea" maxLength={1000} placeholder={friend ? 'Say hi and why you’d like to be friends…' : 'Say something that gets a reply…'} value={text} onChange={(e) => setText(e.target.value)} />
      <p className="error" role="alert">{err}</p>
      <div className="sheet-actions">
        <button className="btn btn-primary btn-block" disabled={busy} onClick={async () => {
          const body = text.trim();
          if (!body) return setErr('Write a message first.');
          setBusy(true);
          try {
            const conv = friend ? await api.startFriend(p.handle) : await api.startChat(p.handle);
            await api.sendMessage(conv, body);
            await loadDating({ force: true });
            close();
            const c = state.convos.find((x) => x.conversation_id === conv);
            if (c && statusOf(c) === 'chat') openChat(conv);
            else toast(friend ? 'Friend request sent 👋' : 'Message request sent 📩', friend ? 'userplus' : 'send');
            decided.add(p.handle);
            deck = deck.filter((x) => x.handle !== p.handle);
            redraw(); emit('dating');
          } catch (e) { setErr(api.friendly(e)); setBusy(false); }
        }}><Icon name={friend ? 'userplus' : 'send'} cls="sm" />{friend ? 'Send friend request' : likedMe ? 'Send message' : 'Send message request'}</button>
      </div>
    </>
  );
}

// ---- The match moment -------------------------------------------------------------------------------
export function matchMoment(p: any, conversationId: string) {
  const colors = ['#ff3f9b', '#12b9f5', '#b8b2ff', '#ffffff', '#ff6fb4'];
  const confetti = Array.from({ length: 40 }, (_, i) => ({ left: `${Math.random() * 100}%`, background: colors[i % colors.length], animationDuration: `${2.2 + Math.random() * 2}s`, animationDelay: `${Math.random() * 0.6}s` }));
  if (navigator.vibrate) navigator.vibrate([30, 40, 60]);
  openSheet((close) => (
    <div className="match-scrim" role="dialog" aria-modal="true" aria-label="It’s a match">
      {confetti.map((st, i) => <i key={i} className="confetti" style={st} />)}
      <div className="match-box">
        <div className="match-avatars"><Avatar seed={state.profile.handle} /><span className="match-heart"><Icon name="heart" /></span><Avatar seed={p.handle} /></div>
        <p className="match-kicker">Mutual like</p>
        <h1>It’s a match!</h1>
        <p>{`You and ${p.handle} like each other. You’re both still anonymous: say hi and see where it goes.`}</p>
        <div className="match-actions">
          <button className="btn btn-coral btn-block" onClick={() => { close(); openChat(conversationId); }}><Icon name="chat" cls="sm" />Send a message</button>
          <button className="btn btn-glass btn-block" onClick={close}>Keep discovering</button>
        </div>
      </div>
    </div>
  ), { label: 'It’s a match', raw: true });
}
