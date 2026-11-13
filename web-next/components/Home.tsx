'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Home: the hub (port of anon-inbox/public/hy-home.js). Who you are, the two ways in (Discover,
// Chatrooms), your connections at a glance and recent activity. Pink = dating, blue = talking.
import { MyHomeBadges } from './Reputation';
import { useEffect, useState, type ReactNode } from 'react';
import * as api from '@/lib/api';
import { state, emit, useAppState, messageRequests, statusOf, isMatch, nameOf, friendsList, newNotifCount, type Convo } from '@/lib/state';
import { INTENT_LABEL, GENERAL_ROOMS, UNI_ROOMS, stateLabel } from '@/lib/options';
import { go, openChat } from '@/lib/nav';
import { ago, avatarBg, initials, store } from '@/lib/util';
import { Icon, Logo, Hero, HeroBtn, Avatar, vars } from './ui';
import { useAvatarPicture } from '@/lib/avatars';
import { openSheet, toast } from './overlay';
import { HomeAppCard } from './PushInstall';
import { GamesCard } from './Games';

const firstName = (n: string) => String(n || '').trim().split(/\s+/)[0].slice(0, 24);
function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
}
const shortName = (handle: string) => handle.split(' ').slice(0, 2).join(' ');
const roomTitle = (s: string) => (GENERAL_ROOMS[s] ? GENERAL_ROOMS[s].name : UNI_ROOMS[s] ? s : s === 'FCT' ? 'Abuja (FCT)' : `${stateLabel(s)}`);

export const BellButton = () => <HeroBtn icon="bell" label="Notifications" onClick={() => go('notifications')} badge={newNotifCount()} />;

// Remembered between visits to Home (like the live app's module-level caches).
let myRoomCache: any = null, roomAt = 0;
let peopleCache: any[] | null = null, peopleAt = 0;

export default function Home() {
  const s = useAppState();
  const profile = s.profile;
  const [myRoom, setMyRoom] = useState<any>(myRoomCache);
  useEffect(() => {
    if (Date.now() - roomAt < 20000) return;
    roomAt = Date.now();
    api.roomList().then((rows: any[]) => { myRoomCache = rows.find((r) => r.mine) || null; state.inRoom = !!myRoomCache; setMyRoom(myRoomCache); }).catch(() => {});
  }, []);
  if (!profile) return null;
  const live = s.convos.filter((c) => !c.blocked);
  const requests = messageRequests();
  const matches = live.filter((c) => statusOf(c) === 'chat' && isMatch(c));
  const likes = s.requests.length;

  return (
    <div className="stack-lg home">
      <Hero cls="home-hero" top={<Logo />} actions={<BellButton />}>
        <div className="hm-me">
          <button className="hm-av" aria-label="Your profile" onClick={() => go('profile')}><Avatar seed={profile.handle} cls="xl" /></button>
          <div className="grow">
            <p className="hm-greet">{firstName(profile.name) ? `${greeting()}, ${firstName(profile.name)} 👋` : `${greeting()} 👋`}</p>
            <h1>{shortName(profile.handle)}</h1>
            <MyHomeBadges />
            <StatusPill />
          </div>
        </div>
      </Hero>

      <FriendsStrip />

      <div className="hm-features">
        <FeatureCard kind="date" iconName="flame" title="Discover" text="Meet new people and find meaningful connections." badge={likes ? `${likes} like${likes === 1 ? '' : 's'}` : null} onClick={() => go('discover')} />
        <div className="hm-room-slot">
          <FeatureCard kind="talk" iconName="rooms" title="Chatrooms"
            text={myRoom ? `You’re in ${roomTitle(myRoom.state)} · ${myRoom.online ?? myRoom.people} online` : 'Join your state community, meet people and start conversations.'}
            badge={myRoom && myRoom.unread ? `${myRoom.unread > 99 ? '99+' : myRoom.unread} new` : null}
            onClick={() => go(myRoom ? `rooms/${encodeURIComponent(myRoom.state)}` : 'rooms')} />
        </div>
      </div>

      <GamesCard />

      <section>
        <div className="section-head"><h2>Your connections</h2></div>
        <div className="hm-stats">
          <Stat iconName="heart" kind="date" n={likes} label="Likes" onClick={() => go('matches/likes')} />
          <Stat iconName="sparkles" kind="date" n={matches.length} label="Matches" onClick={() => go('matches/matches')} />
          <FriendsStat />
          <Stat iconName="send" kind="talk" n={requests.length} label="Requests" onClick={() => go('matches/requests')} />
        </div>
      </section>

      <HomeAppCard />

      <section>
        <div className="section-head"><h2>Recent activity</h2><button className="link-btn" onClick={() => go('matches')}>Inbox</button></div>
        <div className="hm-activity"><Activity live={live} requests={requests} myRoom={myRoom} /></div>
      </section>

      <section>
        <div className="section-head"><h2>People to discover</h2><button className="link-btn" onClick={() => go('discover')}>See all</button></div>
        <People />
      </section>
    </div>
  );
}

// ---- Personal status (one at a time, seen by your friends) ----------------------------------------
const SUGGESTED = ['Available to chat 👋', 'Busy at work 💼', 'Feeling happy 😊', 'Chilling with music 🎧', 'Looking for new friends 🤝', 'Out with friends 🍹', 'Studying 📚', 'Travelling ✈️'];
function StatusPill() {
  const st = state.myStatus;
  return (
    <button className={`hm-status ${st ? '' : 'empty'}`} aria-label={st ? 'Edit your status' : 'Set your status'} onClick={() => statusEditor()}>
      <i className="hm-status-dot" />
      <span className="ellipsis grow">{st ? st.body : 'What’s your status?'}</span>
      <Icon name="edit" cls="sm" />
    </button>
  );
}
export function statusEditor() {
  openSheet((close) => <StatusEditor close={close} />, { label: 'Your status' });
}
function StatusEditor({ close }: { close: () => void }) {
  const cur = state.myStatus;
  const [text, setText] = useState(cur ? cur.body : '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h2>Your status</h2>
      <p className="small muted">Your friends see it on their Home. One status at a time: a new one replaces the old.</p>
      <label className="field"><input className="input" maxLength={80} placeholder="What are you up to?" aria-label="Your status" value={text} onChange={(e) => setText(e.target.value)} /><small className="muted">{text.length} / 80</small></label>
      <div className="chips status-suggest">{SUGGESTED.map((t) => <button key={t} type="button" className="chip" onClick={() => setText(t)}>{t}</button>)}</div>
      <p className="error" role="alert">{err}</p>
      <div className="sheet-actions">
        <button className="btn btn-primary btn-block" disabled={busy} onClick={async () => {
          const body = text.trim();
          if (!body) return setErr('Write something first, or pick a suggestion.');
          setBusy(true);
          try { const r = await api.setStatus(body); state.myStatus = r || { body, updated_at: new Date().toISOString() }; close(); emit('dating'); toast('Status updated', 'check'); }
          catch (e) { setErr(api.friendly(e)); setBusy(false); }
        }}>{cur ? 'Update status' : 'Post status'}</button>
        {cur ? <button className="btn btn-soft btn-block danger-text" onClick={async () => {
          close();
          try { await api.clearStatus(); state.myStatus = null; emit('dating'); toast('Status removed', 'trash'); } catch (e) { toast(api.friendly(e), 'x'); }
        }}>Delete status</button> : null}
      </div>
    </>
  );
}

// ---- Friends -------------------------------------------------------------------------------------
function FriendsStat() {
  const fr = friendsList();
  const on = fr.filter((f) => f.other_online).length;
  return (
    <button className={`hm-stat talk ${fr.length ? 'has' : ''}`} onClick={() => go('matches/friends')}>
      <span className="hs-icon"><Icon name="rooms" />{on ? <i className="hs-on" /> : null}</span>
      <b>{fr.length ? `${on}/${fr.length}` : '0'}</b>
      <span>Friends</span>
    </button>
  );
}
function FriendsStrip() {
  const fr = friendsList();
  const online = fr.filter((f) => f.other_online);
  const head = (
    <div className="section-head"><h2>{online.length ? `Friends online (${online.length})` : 'Friends'}</h2>
      <button className="link-btn" onClick={() => go('matches/friends')}>{fr.length ? 'See all' : 'Find friends'}</button></div>
  );
  if (!fr.length) {
    return (
      <section className="below-hero hm-friends">{head}
        <div className="card hm-empty small"><p>No friends yet. Meet people in a chatroom, tap their name and choose Add friend.</p>
          <button className="btn btn-primary btn-sm" onClick={() => go('rooms')}><Icon name="rooms" cls="sm" />Open chatrooms</button></div>
      </section>
    );
  }
  const shown = online.length ? online : fr.slice().sort((a, b) => (a.other_active_hours ?? 1e9) - (b.other_active_hours ?? 1e9));
  return (
    <section className="below-hero hm-friends">{head}
      {online.length ? null : <p className="small muted">None of your friends are online right now.</p>}
      <div className="friend-strip">{shown.slice(0, 12).map((f) => (
        <button key={f.conversation_id} className={`fs-item ${f.other_online ? 'on' : ''}`} onClick={() => openChat(f.conversation_id)} title={f.friend_status ? f.friend_status.body : ''}>
          <span className="fs-av"><Avatar seed={f.other_handle} label={nameOf(f)} cls="lg" />{f.other_online ? <i /> : null}</span>
          <span className="fs-name ellipsis">{shortName(nameOf(f))}</span>
        </button>
      ))}</div>
    </section>
  );
}

function FeatureCard({ kind, iconName, title, text, badge, onClick }: { kind: 'date' | 'talk'; iconName: string; title: string; text: string; badge: string | null; onClick: () => void }) {
  return (
    <button className={`hm-feature ${kind}`} onClick={onClick}>
      <span className="hf-top"><span className="hf-icon"><Icon name={iconName} cls={kind === 'date' ? 'fill' : ''} /></span>{badge ? <span className="hf-badge">{badge}</span> : null}</span>
      <b>{title}</b>
      <span className="hf-text">{text}</span>
      <span className="hf-go">{kind === 'date' ? 'Start discovering' : 'Open chatrooms'}<Icon name="chev" cls="sm" /></span>
    </button>
  );
}
function Stat({ iconName, kind, n, label, onClick }: { iconName: string; kind: string; n: number; label: string; onClick: () => void }) {
  return (
    <button className={`hm-stat ${kind} ${n ? 'has' : ''}`} onClick={onClick}>
      <span className="hs-icon"><Icon name={iconName} cls={kind === 'date' && iconName === 'heart' ? 'fill' : ''} /></span>
      <b>{n > 999 ? '999+' : String(n)}</b>
      <span>{label}</span>
    </button>
  );
}

// ---- Recent activity: matches, requests, chats and your chatroom, newest first ---------------------
function ActRow({ handle, kind, iconName, title, sub, at, onClick, pill, strong = false }: { handle: string; kind: string; iconName: string; title: string; sub: string; at: string; onClick: () => void; pill?: string | null; strong?: boolean }) {
  return (
    <button className="act-row" onClick={onClick}>
      <span className="act-av"><Avatar seed={handle} /><span className={`act-kind ${kind}`}><Icon name={iconName} cls="sm" /></span></span>
      <span className="grow">
        <span className="row-between"><b className="ellipsis">{title}</b><span className="when">{ago(at)}</span></span>
        <span className={`act-sub ellipsis ${strong ? 'strong' : ''}`}>{sub}</span>
      </span>
      {pill ? <span className={`act-pill ${kind} ${strong ? 'strong' : ''}`}>{pill}</span> : null}
    </button>
  );
}
function Activity({ live, requests, myRoom }: { live: Convo[]; requests: Convo[]; myRoom: any }) {
  const items: { at: string; key: string; el: ReactNode }[] = [];
  for (const c of requests) items.push({ at: c.last_at, key: `r${c.conversation_id}`, el: <ActRow handle={c.other_handle} kind="talk" iconName="send" title={c.other_handle} sub="sent you a message request" at={c.last_at} onClick={() => openChat(c.conversation_id)} pill="Review" /> });
  for (const c of live) {
    const st = statusOf(c);
    if (st === 'chat' && !c.last_message) items.push({ at: c.last_at, key: `c${c.conversation_id}`, el: <ActRow handle={c.other_handle} kind="date" iconName="sparkles" title={c.other_handle} sub={isMatch(c) ? 'You matched! Say hi 👋' : 'Request accepted. Say hi 👋'} at={c.last_at} onClick={() => openChat(c.conversation_id)} pill="Say hi" /> });
    else if (st === 'chat' || st === 'sent') items.push({ at: c.last_at, key: `c${c.conversation_id}`, el: <ActRow handle={c.other_handle} kind="talk" iconName="chat" title={nameOf(c)} sub={`${c.last_from_me ? 'You: ' : ''}${c.last_message || ''}`} at={c.last_at} onClick={() => openChat(c.conversation_id)} pill={c.unread ? String(c.unread) : st === 'sent' ? 'Pending' : null} strong={!!c.unread} /> });
  }
  for (const f of friendsList()) {
    if (f.friend_status) items.push({ at: f.friend_status.updated_at, key: `s${f.conversation_id}`, el: <ActRow handle={f.other_handle} kind="talk" iconName="chat" title={`${nameOf(f)} posted a status`} sub={`“${f.friend_status.body}”`} at={f.friend_status.updated_at} onClick={() => openChat(f.conversation_id)} /> });
    if (f.accepted_at && !f.last_message) items.push({ at: f.accepted_at, key: `f${f.conversation_id}`, el: <ActRow handle={f.other_handle} kind="talk" iconName="userplus" title={nameOf(f)} sub="You’re now friends 🎉" at={f.accepted_at} onClick={() => openChat(f.conversation_id)} pill="Say hi" /> });
  }
  if (myRoom && myRoom.unread) items.push({ at: new Date().toISOString(), key: 'room', el: (
    <button className="act-row" onClick={() => go(`rooms/${encodeURIComponent(myRoom.state)}`)}>
      <span className="act-av room"><Icon name="rooms" /></span>
      <span className="grow"><b>{roomTitle(myRoom.state)} chatroom</b><span className="act-sub ellipsis">{myRoom.unread} new message{myRoom.unread === 1 ? '' : 's'} since you left</span></span>
      <span className="act-pill talk strong">{String(myRoom.unread > 99 ? '99+' : myRoom.unread)}</span>
    </button>) });
  items.sort((a, b) => +new Date(b.at) - +new Date(a.at));
  if (!items.length) {
    return (
      <div className="card hm-empty">
        <p>Nothing here yet. Like someone in Discover, or say hi in your state’s chatroom: your matches, requests and chats will show up here.</p>
        <div className="row">
          <button className="btn btn-coral btn-sm" onClick={() => go('discover')}><Icon name="flame" cls="sm" />Discover</button>
          <button className="btn btn-primary btn-sm" onClick={() => go('rooms')}><Icon name="rooms" cls="sm" />Chatrooms</button>
        </div>
      </div>
    );
  }
  return <div className="card act-list">{items.slice(0, 6).map((i) => <div key={i.key} style={{ display: 'contents' }}>{i.el}</div>)}</div>;
}

// "People to discover" is remembered on this device for 3 hours (same key as the live app).
function People() {
  const [list, setList] = useState<any[] | null>(peopleCache);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const me = state.profile?.handle;
    if (!peopleCache) {
      const saved = store.get<any>('hy-people', null);
      if (saved && saved.me === me && Date.now() - saved.at < 3 * 3600 * 1000) { peopleCache = saved.list; peopleAt = saved.at; setList(peopleCache); }
    }
    if (!peopleCache || Date.now() - peopleAt > 3 * 3600 * 1000) {
      api.discover(8).then((rows: any[]) => {
        peopleCache = rows; peopleAt = Date.now();
        store.set('hy-people', { me, at: peopleAt, list: rows });
        setList(rows);
      }).catch(() => setFailed(true));
    }
  }, []);
  if (failed) return <p className="small muted">Couldn’t load people right now.</p>;
  if (!list) return <div className="h-scroll">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton person-sk" />)}</div>;
  if (!list.length) return <p className="small muted">No new people right now. Check back soon, or widen who you see in Profile.</p>;
  return (
    <div className="h-scroll">{list.map((p) => (
      <button key={p.handle} className="person-tile" style={vars({ '--av': avatarBg(p.handle) })} onClick={() => go('discover')}>
        <span className="pt-art"><PersonArt handle={p.handle} />{p.online ? <i className="pt-on" aria-label="Online" /> : null}</span>
        <span className="pt-info"><b>{`${shortName(p.handle)}, ${p.age}`}</b><span>{[p.location, INTENT_LABEL[p.intent]].filter(Boolean).join(' · ')}</span></span>
      </button>
    ))}</div>
  );
}
function PersonArt({ handle }: { handle: string }) {
  // Same as the live app: initials until the person's custom avatar arrives.
  const pic = useAvatarPicture(handle);
  return (
    <span className={`pt-initials ${pic ? 'has-av' : ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {pic ? <span className={`av-svg av-modern av-bg-${pic.bg}`}><img src={pic.src} alt="" loading="lazy" decoding="async" draggable={false} /></span> : initials(handle)}
    </span>
  );
}
