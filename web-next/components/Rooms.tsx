'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Chatrooms list (port of renderRooms/roomRows in anon-inbox/public/hy-rooms.js): your state's room,
// university rooms, rooms open to everyone, age rooms (blurred until a date of birth is saved) and
// "just for you" rooms. Inside a room: components/Room.tsx.
import { useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { state } from '@/lib/state';
import { GENERAL_ROOMS, UNI_ROOMS, LANDMARKS, roomName, stateLabel, ageRoomBlock } from '@/lib/options';
import { go } from '@/lib/nav';
import { hash } from '@/lib/util';
import { Icon, Hero, EmptyState, vars } from './ui';
import { toast, confirmSheet } from './overlay';
import { BellButton } from './Home';

const CAPACITY = 200;
const capOf = (r: any) => r.capacity || (GENERAL_ROOMS[r.state] ? 500 : UNI_ROOMS[r.state] ? 300 : CAPACITY);
const NATIONAL = 'Nigeria';
const NAME_COLORS = ['#ff5fa2', '#c084fc', '#38bdf8', '#34d399', '#fbbf24', '#fb7185', '#a78bfa', '#22d3ee', '#f97316', '#4ade80'];
const roomPath = (s: string) => `rooms/${encodeURIComponent(s)}`;
const shortTitle = (s: string) => (GENERAL_ROOMS[s] ? GENERAL_ROOMS[s].name : UNI_ROOMS[s] ? s : s === 'FCT' ? 'Abuja (FCT)' : stateLabel(s));
const onlineOf = (r: any) => (r.online ?? r.people);
const stateCode = (s: string) => (s === NATIONAL ? 'NG' : s === 'FCT' ? 'FCT' : s.includes(' ') ? s.split(' ').map((w) => w[0]).join('').toUpperCase() : s.slice(0, 2).toUpperCase());

// Remembered between visits, like the live app.
let roomsCache: any[] | null = null;
let kickCache: any = null;

// Kept in step by the room screen (components/Room.tsx).
export const myRoomState = (): string | null => (roomsCache || []).find((r) => r.mine)?.state || null;
export function roomJoined(target: string, people: number) {
  roomsCache = (roomsCache || []).map((r) => ({ ...r, mine: r.state === target, unread: 0, people: r.state === target ? people : r.people }));
  kickCache = null;
}
export function roomLeft() { roomsCache = (roomsCache || []).map((r) => ({ ...r, mine: false })); }
export function roomKicked(target: string) { roomLeft(); kickCache = { state: target, kicked_at: new Date().toISOString() }; }
// One room at a time: moving to another one leaves the room you're in.
async function enter(target: string) {
  const mine = myRoomState();
  if (mine && mine !== target) {
    const ok = await confirmSheet({ title: `Move to ${roomName(target)}?`, text: `You’ll leave ${roomName(mine)}. You can be in one chatroom at a time.`, yes: 'Move' });
    if (!ok) return;
  }
  go(roomPath(target));
}

const UNI_PALETTES = [['#1e3a8a', '#f5b301'], ['#065f46', '#fcd34d'], ['#7f1d1d', '#fbbf24'], ['#4c1d95', '#f9a8d4'], ['#0e7490', '#fde68a'],
  ['#14532d', '#bef264'], ['#1d4ed8', '#e0f2fe'], ['#9a3412', '#fed7aa'], ['#0f172a', '#7dd3fc'], ['#831843', '#fde047'], ['#134e4a', '#99f6e4'], ['#3f3f46', '#fbbf24']];
function UniBadge({ code, cls = '' }: { code: string; cls?: string }) {
  const [bg, fg] = UNI_PALETTES[hash(code) % UNI_PALETTES.length];
  const label = code.replace(/[^A-Za-z]/g, '').toUpperCase();
  const size = label.length <= 2 ? 14 : label.length === 3 ? 12.5 : label.length === 4 ? 10.5 : label.length === 5 ? 8.6 : label.length === 6 ? 7.2 : label.length === 7 ? 6.3 : 5.6;
  return (
    <span className={`st-badge crest ${cls}`.trim()}>
      <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
        <path d="M24 3 L42 9 V23 C42 34 34 41.5 24 45 C14 41.5 6 34 6 23 V9 Z" fill={bg} />
        <path d="M24 6.5 L39 11.4 V23 C39 32.4 32.2 38.8 24 41.8 C15.8 38.8 9 32.4 9 23 V11.4 Z" fill="none" stroke={fg} strokeWidth="1.4" opacity=".85" />
        <path d="M17 15.5 L24 12.5 L31 15.5 L24 18.5 Z M20 17 V20.2 C22 21.6 26 21.6 28 20.2 V17" fill={fg} />
        <text x="24" y={30.5 + size * 0.36} textAnchor="middle" fontFamily="Bricolage Grotesque, Plus Jakarta Sans, system-ui, sans-serif" fontWeight="800" fontSize={size} fill="#fff" letterSpacing="0">{label}</text>
      </svg>
    </span>
  );
}
function StateBadge({ st, cls = '' }: { st: string; cls?: string }) {
  if (UNI_ROOMS[st]) return <UniBadge code={st} cls={cls} />;
  const lm = (LANDMARKS as any)[st];
  if (lm) return <span className={`st-badge photo ${cls}`.trim()} role="img" aria-label={lm.name} title={lm.name} style={{ backgroundImage: `url(/img/landmarks/${lm.file})` }} />;
  const c = NAME_COLORS[hash(st) % NAME_COLORS.length];
  if (GENERAL_ROOMS[st]) return <span className={`st-badge emoji ${cls}`.trim()} style={vars({ '--c': c })}>{GENERAL_ROOMS[st].emoji}</span>;
  return <span className={`st-badge ${cls}`.trim()} style={vars({ '--c': c })}>{stateCode(st)}</span>;
}
const UnreadBadge = ({ r }: { r: any }) => (r.mine && r.unread > 0
  ? <span className="cr-unread" aria-label={`${r.unread} unread message${r.unread === 1 ? '' : 's'}`}>{r.unread > 999 ? '999+' : String(r.unread)}</span> : null);

export default function Rooms() {
  const [rooms, setRooms] = useState<any[] | null>(roomsCache);
  const [kick, setKick] = useState<any>(kickCache);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      api.roomHeartbeat().catch(() => {});
      try {
        const [list, k] = await Promise.all([api.roomList(), api.myRoomKick().catch(() => null)]);
        if (!alive) return;
        roomsCache = list; kickCache = list.some((r: any) => r.mine) ? null : k;
        state.inRoom = list.some((r: any) => r.mine);
        setRooms(list); setKick(kickCache); setError(null);
      } catch (e: any) {
        if (alive && !roomsCache) setError(/could not find the function/i.test(e.message || '') ? 'soon' : api.friendly(e));
      }
    };
    refresh();
    const tick = setInterval(() => { if (!document.hidden && !api.backingOff()) refresh(); }, 60000);
    return () => { alive = false; clearInterval(tick); };
  }, []);
  const mine = rooms && rooms.find((r) => r.mine);
  return (
    <div className="stack-lg cr-screen">
      <Hero title="Chatrooms" sub="Your state’s room, plus rooms for all of Nigeria. One room at a time." actions={<BellButton />}>
        {!mine && kick ? (
          <div className="cr-kicked" role="status">
            <span className="cr-kicked-ico">🚪</span>
            <span className="grow"><b>{`You were kicked out of ${roomName(kick.state)} for inactivity`}</b><span>Rooms remove people who are inactive for 10 minutes.</span></span>
            <span className="cr-kicked-actions">
              <button className="btn btn-white btn-sm" onClick={() => go(roomPath(kick.state))}>Join again</button>
              <button className="btn btn-glass btn-sm" onClick={() => { api.dismissRoomKick(); kickCache = null; setKick(null); }}>Dismiss</button>
            </span>
          </div>
        ) : mine ? (
          <button className="cr-current" onClick={() => go(roomPath(mine.state))}>
            <StateBadge st={mine.state} cls="on-dark" />
            <span className="grow"><small>Your chatroom</small><b>{roomName(mine.state)}</b>
              <span>{mine.unread > 0 ? `${mine.unread > 999 ? '999+' : mine.unread} new message${mine.unread === 1 ? '' : 's'} · tap to catch up` : `${onlineOf(mine)} online · tap to keep chatting`}</span></span>
            {mine.unread > 0 ? <UnreadBadge r={mine} /> : <Icon name="chev" cls="sm" />}
          </button>
        ) : null}
      </Hero>
      <div className="below-hero">
        {error ? (error === 'soon' ? <EmptyState emoji="🚧" title="Chatrooms are opening soon" text="Check back in a little while." /> : <EmptyState emoji="📡" title="Couldn’t load chatrooms" text={error} />)
          : rooms ? <RoomSections rooms={rooms} />
          : <div className="cr-list">{Array.from({ length: 7 }, (_, i) => <div key={i} className="skeleton" style={{ height: '64px', borderRadius: '16px' }} />)}</div>}
      </div>
    </div>
  );
}

function RoomSections({ rooms }: { rooms: any[] }) {
  const home = state.profile && state.profile.state;
  const own = rooms.find((r) => !GENERAL_ROOMS[r.state] && !UNI_ROOMS[r.state]);
  const unis = rooms.filter((r) => UNI_ROOMS[r.state]);
  const open = rooms.filter((r) => GENERAL_ROOMS[r.state] && GENERAL_ROOMS[r.state].tag === 'Everyone');
  const ages = rooms.filter((r) => GENERAL_ROOMS[r.state] && GENERAL_ROOMS[r.state].ages);
  const just = rooms.filter((r) => GENERAL_ROOMS[r.state] && GENERAL_ROOMS[r.state].tag !== 'Everyone' && !GENERAL_ROOMS[r.state].ages);
  const myAge = state.profile && Number(state.profile.age);
  const section = (title: string, sub: string, list: any[]) => (list.length ? (
    <section key={title}><div className="section-head"><h2>{title}</h2><span className="small muted">{sub}</span></div>
      <div className="cr-list">{list.map((r) => <Row key={r.state} r={r} myAge={myAge} />)}</div></section>) : null);
  return (
    <div className="cr-sections">
      {section('Your state', 'Only people in your state', own ? [own] : [])}
      {section('Universities', own ? `In ${shortTitle(own.state)}` : 'In your state', unis)}
      {!home ? <p className="small muted center">Add your state to your dating card to unlock your state’s chatroom.</p> : null}
      {section('Open to everyone', 'Across Nigeria', open)}
      {ages.length ? (state.profile && state.profile.birth_date ? section('Age groups', 'Join the one for your age', ages) : (
        <section><div className="section-head"><h2>Age groups</h2><span className="small muted">Add your date of birth to join</span></div>
          <div className="age-lock">
            <div className="cr-list age-blur" aria-hidden="true" inert>{ages.map((r) => <Row key={r.state} r={r} myAge={myAge} />)}</div>
            <div className="age-lock-card"><span className="age-lock-ico">🎂</span><b>Rooms for your age group</b>
              <p>Add your date of birth to join the age room for you. It’s private.</p>
              <button className="btn btn-primary btn-sm" onClick={() => go('profile')}>Add date of birth</button></div>
          </div>
        </section>)) : null}
      {section('Just for you', just.length ? GENERAL_ROOMS[just[0].state].tag : '', just)}
      <p className="tiny muted center">You can be in one chatroom at a time. Inactive for 10 minutes? You’re kicked out and can join again. Your state can change once every 30 days, your date of birth once every 365 days, and your gender once every 90 days.</p>
    </div>
  );
}

function Row({ r, myAge }: { r: any; myAge: number | null }) {
  const full = r.people >= capOf(r) && !r.mine;
  const g = GENERAL_ROOMS[r.state];
  const blocked = !r.mine && state.profile && state.profile.birth_date ? ageRoomBlock(r.state, myAge) : null;
  return (
    <button className={`cr-row ${r.mine ? 'mine' : ''} ${blocked ? 'locked' : ''}`} disabled={full} aria-disabled={blocked ? 'true' : undefined}
      onClick={() => (blocked ? toast(blocked, 'lock') : enter(r.state))}>
      <StateBadge st={r.state} />
      <span className="grow">
        <b>{shortTitle(r.state)}
          {r.mine ? <span className="cr-tag">You’re here</span> : g ? (g.ages ? (blocked ? null : <span className="cr-tag soft">Your age</span>) : g.tag !== 'Everyone' ? <span className="cr-tag soft">{g.tag}</span> : null) : UNI_ROOMS[r.state] ? null : <span className="cr-tag soft"><Icon name="pin" cls="sm" />Your state</span>}
        </b>
        {g ? <span className="cr-blurb">{g.blurb}</span> : UNI_ROOMS[r.state] ? <span className="cr-blurb">{UNI_ROOMS[r.state].name}</span> : null}
        <span className="cr-online">{onlineOf(r) ? <i /> : <i className="off" />}
          {full ? `Full (${capOf(r)} people)` : `${onlineOf(r).toLocaleString()} online · ${r.people.toLocaleString()} member${r.people === 1 ? '' : 's'}`}</span>
      </span>
      <UnreadBadge r={r} />
      <span className="chev"><Icon name={blocked ? 'lock' : 'chev'} cls="sm" /></span>
    </button>
  );
}
