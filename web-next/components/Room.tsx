'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Inside a chatroom (port of openRoom and friends in anon-inbox/public/hy-rooms.js). Live messages over
// the room's private channel, with a safety-net check; replies (tap or swipe right), reactions, the
// members dropdown and page, profile cards, hide / block / report, leave and invite, "N new messages",
// and the 10-minute inactivity kick. Same database functions and the same rules as the live app.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import * as api from '@/lib/api';
import { state, emit, statusOf } from '@/lib/state';
import { GENERAL_ROOMS, UNI_ROOMS, GENDER_LABEL, roomName, stateLabel } from '@/lib/options';
import { go, openChat } from '@/lib/nav';
import { clock, dayLabel, hash, initials, store, shareOrCopy, formatDob } from '@/lib/util';
import { useAvatarPicture } from '@/lib/avatars';
import { Icon, Logo, EmptyState, DobPicker, dobValue, vars, type Dob } from './ui';
import { openSheet, confirmSheet, toast } from './overlay';
import { ChatFrame } from './Chat';
import { composeTo } from './Discover';
import { BellButton } from './Home';
import { roomJoined, roomLeft, roomKicked, myRoomState } from './Rooms';

const EMOJI = ['❤️', '👍', '🔥', '😂', '😮', '😢'];
const REPORT_REASONS: [string, string][] = [['harassment', 'Harassment or bullying'], ['inappropriate', 'Sexual or inappropriate'], ['spam', 'Spam or scam'],
  ['underage', 'Seems under 18'], ['other', 'Something else']];
const NAME_COLORS = ['#ff5fa2', '#c084fc', '#38bdf8', '#34d399', '#fbbf24', '#fb7185', '#a78bfa', '#22d3ee', '#f97316', '#4ade80'];
const SUPPORT_EMAIL = 'support@treehouse.ng';
const KEEP = ['id', 'handle', 'body', 'created_at', 'mine', 'reactions', 'my_reactions', 'reply_to', 'reply_handle', 'reply_body'];
export const nameColor = (handle: string) => NAME_COLORS[hash(handle) % NAME_COLORS.length];
const shortTitle = (s: string) => (GENERAL_ROOMS[s] ? GENERAL_ROOMS[s].name : UNI_ROOMS[s] ? s : s === 'FCT' ? 'Abuja (FCT)' : stateLabel(s));
const isOnline = (p: any) => p.online !== false;
const coarse = () => matchMedia('(pointer: coarse)').matches;

// Saved on this device, same keys as the live app.
const blocked = () => new Set<string>(store.get<string[]>('hy-room-blocked', []) || []);
const hiddenMsgs = () => new Set<string>((store.get<string[]>('hy-room-hidden', []) || []).map(String));
const rememberRoom = (s: string) => store.set('hy-room-recent', [s, ...(store.get<string[]>('hy-room-recent', []) || []).filter((x) => x !== s)].slice(0, 6));
const friendChat = (handle: string) => state.convos.find((c) => c.other_handle === handle && !c.blocked) || null;

// The room you closed without leaving, kept in memory (never saved on the phone) so opening it again
// shows the chat straight away while the server catches up.
let kept: { state: string; joined: any; at: number; msgs: any[] } | null = null;
let rejoinFor: string | null = null;   // "Join again" was tapped for this room: skip the kicked screen once

type Item = { k: 'msg'; m: any } | { k: 'notice'; id: string; text: ReactNode; cls?: string } | { k: 'unread'; id: string; n: number };

export function RoomAvatar({ handle, cls = '' }: { handle: string; cls?: string }) {
  const pic = useAvatarPicture(handle);
  return (
    <span className={`room-av ${cls} ${pic ? 'has-av' : ''}`.trim()} style={vars({ '--c': nameColor(handle) })}>
      {pic ? (
        <span className={`av-svg av-modern av-bg-${pic.bg}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pic.src} alt="" loading="lazy" decoding="async" draggable={false} />
        </span>
      ) : initials(handle)}
    </span>
  );
}

export default function Room({ target }: { target: string }) {
  const [mounted, setMounted] = useState(false);
  const [gen, setGen] = useState(0);   // bumped to start the room over ("Join again")
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return createPortal(<ChatFrame cls="chat room" label={`${roomName(target)} chatroom`}><RoomView key={`${target}:${gen}`} target={target} restart={() => setGen((n) => n + 1)} /></ChatFrame>, document.body);
}

// Everything the live room needs between renders (like the `room` object in hy-rooms.js).
type Live = {
  alive: boolean; handle: string; joined: any; left: boolean; live: boolean;
  messages: Map<string, any>; people: any[]; nearBottom: boolean; catchingUp: boolean; lastPull: number;
  readTimer: ReturnType<typeof setTimeout> | null; noticeN: number;
};

function RoomView({ target, restart }: { target: string; restart: () => void }) {
  const [phase, setPhase] = useState<'loading' | 'kicked' | 'error' | 'ready'>('loading');
  const [error, setError] = useState('');
  const [joined, setJoined] = useState<any>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [count, setCount] = useState('');
  const [unseen, setUnseen] = useState(0);
  const [replyTo, setReplyTo] = useState<any>(null);
  const [drop, setDrop] = useState(false);
  const [dropQ, setDropQ] = useState('');
  const [membersOpen, setMembersOpen] = useState(false);
  const [banner, setBanner] = useState(() => !store.get(`hy-room-banner-${target}`, false));
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [picker, setPicker] = useState<string | null>(null);
  const [, redraw] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const scrollNext = useRef<'bottom' | string | null>(null);
  const R = useRef<Live>({ alive: true, handle: '', joined: null, left: false, live: false, messages: new Map(), people: [], nearBottom: true, catchingUp: false, lastPull: 0, readTimer: null, noticeN: 0 });
  const unseenRef = useRef(0);
  const bumpUnseen = (n: number) => { unseenRef.current = n; setUnseen(n); };

  // ---- the room's life: join, history, live channel, heartbeats ---------------------------------
  const api$ = useRef<{ add: (m: any) => void; pull: () => void; loadPeople: () => void; dropped: () => void; markRead: (soon?: number) => void }>(null as any);
  useEffect(() => {
    const r = R.current;
    // Each run of this effect is its own visit (React may start one, stop it and start again).
    let alive = true;
    r.alive = true;
    r.messages = new Map(); r.handle = ''; r.joined = null; r.left = false;
    setItems([]); unseenRef.current = 0; setUnseen(0);
    const isMine = () => alive && r.alive;
    const lastId = () => { let max = 0; for (const k of r.messages.keys()) { const n = Number(k); if (n > max) max = n; } return max; };
    const markRead = (soon = 4000) => {
      if (!isMine() || document.hidden) return;
      if (r.readTimer) clearTimeout(r.readTimer);
      r.readTimer = setTimeout(() => { if (isMine() && !document.hidden) api.roomMarkRead().catch(() => {}); }, soon);
    };
    const add = (m: any) => {
      if (!isMine() || r.messages.has(String(m.id))) return;
      if (blocked().has(m.handle) || hiddenMsgs().has(String(m.id))) return;
      m = { ...m, id: String(m.id), mine: m.mine ?? m.handle === r.handle, reactions: m.reactions || {}, my_reactions: m.my_reactions || [] };
      r.messages.set(m.id, m);
      setItems((list) => [...list.filter((x) => !(x.k === 'notice' && x.cls === 'empty')), { k: 'msg', m }]);
      if (!document.hidden) markRead();
      if (m.mine) { scrollNext.current = 'bottom'; bumpUnseen(0); }
      else if (r.catchingUp || document.hidden || !r.nearBottom) bumpUnseen(unseenRef.current + 1);
      else scrollNext.current = 'bottom';
    };
    const notice = (text: ReactNode, cls = '') => {
      if (!isMine()) return;
      setItems((list) => [...list.filter((x) => cls === 'me' || !(x.k === 'notice' && x.cls === 'empty')), { k: 'notice', id: `n${r.noticeN++}`, text, cls }]);
      if (r.nearBottom) scrollNext.current = 'bottom';
    };
    const loadPeople = async () => {
      try {
        const list = await api.roomPeople();
        if (!isMine()) return;
        r.people = list;
        setPeople(list);
        setCount(`${list.length.toLocaleString()} ${list.length === 1 ? 'member' : 'members'} · ${list.filter(isOnline).length} online`);
      } catch {}
    };
    // Inactive for 10 minutes: you've been kicked out of the room. Show it, back on the list.
    const dropped = () => {
      if (!isMine()) return;
      r.left = true;
      state.inRoom = false;
      roomKicked(target);
      toast('You were kicked out of this room for inactivity', 'logout');
      go('rooms', { replace: true });
    };
    const pull = async () => {
      if (!isMine() || document.hidden) return;
      r.lastPull = Date.now();
      try { const fresh = await api.roomHistorySince(String(lastId())); if (isMine()) fresh.forEach(add); } catch {}
    };
    api$.current = { add, pull, loadPeople, dropped, markRead };

    let channel: { leave: () => void } | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let beatTimer: ReturnType<typeof setInterval> | null = null;
    let onVisible: (() => void) | null = null;

    (async () => {
      const cached = kept && kept.state === target && Date.now() - kept.at < 8 * 60000 ? kept : null;
      kept = null;
      const still = !!cached || myRoomState() === target;
      const early = still ? api.roomHistory().catch(() => null) : null;
      // Kicked out of this room for inactivity: say so, and only join again when they choose to.
      if (!still && rejoinFor !== target) {
        const k = await api.myRoomKick().catch(() => null);
        if (!isMine()) return;
        if (k && k.state === target) { setPhase('kicked'); return; }
      }
      rejoinFor = null;
      let j: any;
      if (cached) {
        const top = cached.msgs.reduce((a, m) => Math.max(a, Number(m.id) || 0), 0);
        j = { ...cached.joined, rejoined: true, last_read_id: top };
        api.joinRoom(target).then((fresh: any) => {
          if (!isMine() || !fresh) return;
          // You'd been dropped after all: start the room fresh, without the old messages.
          if (!fresh.rejoined) { r.left = true; rejoinFor = target; r.handle = ''; restart(); return; }
          r.joined = fresh; setJoined(fresh);
        }).catch((e: any) => { if (!isMine()) return; toast(api.friendly(e), 'x'); go('rooms', { replace: true }); });
      } else {
        try { j = await api.joinRoom(target); }
        catch (e) { if (!isMine()) return; setError(api.friendly(e)); setPhase('error'); return; }
      }
      if (!isMine() || !j) return;
      r.handle = j.handle; r.joined = j;
      state.inRoom = true;
      roomJoined(target, j.people);
      rememberRoom(target);
      setJoined(j);
      setCount(`${Number(j.people).toLocaleString()} ${j.people === 1 ? 'member' : 'members'}`);
      setPhase('ready');

      // Live updates first, then history, so nothing sent in between is missed.
      channel = api.joinRoomChannel(target, {
        onMessage: (m) => add(m),
        onReaction: (p) => {
          const m = r.messages.get(String(p.id));
          if (!m) return;
          m.reactions = p.reactions || {};
          setItems((list) => list.map((x) => (x.k === 'msg' && x.m.id === m.id ? { k: 'msg', m: { ...m } } : x)));
        },
        onJoin: (p) => {
          if (!isMine() || !p || p.handle === r.handle || blocked().has(p.handle)) return;
          notice(<><b style={{ color: nameColor(p.handle) }}>{p.handle}</b> joined the chat 👋</>);
          loadPeople();
        },
        onStatus: (status) => { if (!isMine()) return; r.live = status === 'SUBSCRIBED'; if (r.live) pull(); },
        onRemove: (p) => { if (isMine() && p && p.id) dropRow(String(p.id)); },
        onLeave: (p) => {
          if (!isMine() || !p || p.handle === r.handle || blocked().has(p.handle)) return;
          notice(<><b style={{ color: nameColor(p.handle) }}>{p.handle}</b>{p.why === 'inactive' ? ' was kicked out for inactivity 🚪' : ' left the room'}</>);
          loadPeople();
        },
      });
      // Safety net: every 2 minutes with the live connection up, every 30 s while it's down.
      poll = setInterval(() => {
        const gap = api.backingOff() ? 180000 : r.live ? 120000 : 30000;
        if (Date.now() - r.lastPull >= gap) pull();
      }, 1000);

      try {
        const history: any[] = cached ? cached.msgs : (early && (await early)) || await api.roomHistory();
        if (!isMine()) return;
        if (cached && early) early.then((fresh: any[] | null) => {
          if (!isMine() || !fresh) return;
          fresh.forEach((m) => {
            const old = r.messages.get(String(m.id));
            if (!old) return add(m);
            if (JSON.stringify(old.reactions) !== JSON.stringify(m.reactions || {}) || String(old.my_reactions) !== String(m.my_reactions || [])) {
              old.reactions = m.reactions || {}; old.my_reactions = m.my_reactions || [];
              setItems((list) => list.map((x) => (x.k === 'msg' && x.m.id === old.id ? { k: 'msg', m: { ...old } } : x)));
            }
          });
        });
        // Coming back to a room you're still in: no "you joined" line, pick up at the last message you
        // saw, and count the ones after it as new.
        const back = !!j.rejoined;
        const readTo = Number(j.last_read_id || 0);
        if (!history.length && !back) setItems([{ k: 'notice', id: 'empty', text: null, cls: 'empty' }]);
        let firstUnread: string | null = null;
        history.forEach((m) => {
          const isNew = back && Number(m.id) > readTo && !m.mine && !blocked().has(m.handle);
          r.catchingUp = isNew;
          add(m);
          if (isNew && !firstUnread) firstUnread = String(m.id);
        });
        r.catchingUp = false;
        if (!back) {
          notice(<>You joined <b>{roomName(target)}</b> as <b style={{ color: nameColor(j.handle) }}>{j.handle}</b></>, 'me');
          scrollNext.current = 'bottom';
        } else if (firstUnread) {
          const n = unseenRef.current;
          setItems((all) => {
            const list = all.filter((x) => x.k !== 'unread');
            const i = list.findIndex((x) => x.k === 'msg' && x.m.id === firstUnread);
            if (i < 0) return list;
            return [...list.slice(0, i), { k: 'unread', id: 'unread-sep', n }, ...list.slice(i)];
          });
          scrollNext.current = 'unread-sep';
          r.nearBottom = false;
        } else scrollNext.current = 'bottom';
        markRead(0);
      } catch (e) { toast(api.friendly(e), 'x'); }
      loadPeople();

      // Keep your seat while the room is open (only an app that's on screen keeps it).
      const beat = async () => {
        if (!isMine() || document.hidden) return;
        try {
          const st = await api.roomHeartbeat();
          if (!st) { dropped(); return; }
          if (!document.hidden) loadPeople();
        } catch {}
      };
      // Coming back to the app: fetch anything the live connection missed; it counts as new.
      const catchUp = async () => {
        if (!isMine()) return;
        await beat();
        if (!isMine() || r.left) return;
        try {
          const fresh = await api.roomHistorySince(String(lastId()));
          if (!isMine()) return;
          r.catchingUp = fresh.some((m: any) => !r.messages.has(String(m.id)) && !m.mine);
          fresh.forEach(add);
          r.catchingUp = false;
        } catch {}
        markRead(0);
      };
      beatTimer = setInterval(beat, 120000);
      onVisible = () => { if (!document.hidden) catchUp(); };
      document.addEventListener('visibilitychange', onVisible);
    })();

    return () => {
      alive = false;
      r.alive = false;
      // Closed without leaving: keep the last messages in memory for a quick return.
      kept = r.handle && !r.left && r.joined ? { state: target, joined: r.joined, at: Date.now(),
        msgs: [...r.messages.values()].slice(-60).map((m) => Object.fromEntries(KEEP.map((k) => [k, m[k]]))) } : null;
      if (r.handle && !r.left) api.roomMarkRead().catch(() => {});
      if (r.readTimer) clearTimeout(r.readTimer);
      channel?.leave();
      if (poll) clearInterval(poll);
      if (beatTimer) clearInterval(beatTimer);
      if (onVisible) document.removeEventListener('visibilitychange', onVisible);
    };
  }, [target]);

  // Scroll after the list changes (to the bottom, or to the "unread" divider).
  useLayoutEffect(() => {
    const b = body.current;
    const want = scrollNext.current;
    if (!b || !want) return;
    scrollNext.current = null;
    if (want === 'bottom') { b.scrollTop = b.scrollHeight; return; }
    const el = b.querySelector(`[data-key="${want}"]`) as HTMLElement | null;
    if (el) el.scrollIntoView({ block: 'start' });
  });

  function dropRow(id: string) {
    R.current.messages.delete(id);
    setItems((list) => list.filter((x) => !(x.k === 'msg' && x.m.id === id)));
  }
  function hideMsg(id: string) {
    const s = hiddenMsgs(); s.add(id); store.set('hy-room-hidden', [...s].slice(-500));
    dropRow(id);
  }
  // Block someone: hidden on this device right away, and on the server so it follows your account.
  async function blockHandle(handle: string, msgId?: string) {
    const b = blocked(); b.add(handle); store.set('hy-room-blocked', [...b]);
    for (const [id, m] of R.current.messages) if (m.handle === handle) R.current.messages.delete(id);
    setItems((list) => list.filter((x) => !(x.k === 'msg' && x.m.handle === handle)));
    if (msgId) api.blockRoomSender(msgId).catch(() => {});
    api$.current?.loadPeople();
    toast(`${handle} is blocked`, 'ban');
  }
  async function react(m: any, emoji: string) {
    try {
      const res = await api.toggleRoomReaction(m.id, emoji);
      if (!res) return;
      const cur = R.current.messages.get(m.id) || m;
      cur.reactions = res.reactions || {};
      const set = new Set<string>(cur.my_reactions); if (res.mine) set.add(emoji); else set.delete(emoji);
      cur.my_reactions = [...set];
      setItems((list) => list.map((x) => (x.k === 'msg' && x.m.id === m.id ? { k: 'msg', m: { ...cur } } : x)));
    } catch (e) { toast(api.friendly(e), 'x'); }
  }
  function setReply(m: any) { setReplyTo(m); input.current?.focus(); }
  function jumpTo(id: string) {
    const el = body.current?.querySelector(`.rmsg[data-id="${id}"]`) as HTMLElement | null;
    if (!el) { toast('That message was sent before you joined', 'reply'); return; }
    el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  async function send() {
    const body$ = text.trim();
    if (!body$ || sending) return;
    setSending(true);
    try {
      const quoted = replyTo;
      const m = await api.sendRoomMessage(body$, quoted ? quoted.id : null);
      setText(''); setReplyTo(null);
      if (input.current) input.current.style.height = '';
      if (m) api$.current.add({ ...m, mine: true, reply_handle: m.reply_handle ?? (quoted && quoted.handle), reply_body: m.reply_body ?? (quoted && quoted.body.slice(0, 140)) });
    } catch (e: any) {
      if (/join a room/i.test(e.message || '')) { api$.current.dropped(); setSending(false); return; }
      toast(api.friendly(e), 'x');
    }
    setSending(false);
    input.current?.focus();
  }

  function leave() {
    R.current.left = true;
    api.leaveRoom().catch(() => {}).finally(() => {
      state.inRoom = false;
      roomLeft();
      toast('You left the chatroom', 'logout');
      go('rooms', { replace: true });
    });
  }
  function invite() {
    shareOrCopy({ title: `${roomName(target)} chatroom on treehouse`, text: `Come chat with people in ${roomName(target)} on treehouse 💬`,
      url: `${location.origin}/home/rooms/${encodeURIComponent(target)}` });
  }
  function roomMenu() {
    openSheet((close) => (
      <>
        <h2>{roomName(target)}</h2>
        <p className="small muted">Chatrooms are public to the people in them. Don’t share your phone number, address or other personal details.</p>
        <div className="sheet-actions">
          <button className="btn btn-soft btn-block" onClick={() => { close(); setMembersOpen(true); api$.current.loadPeople(); }}><Icon name="rooms" cls="sm" />See members</button>
          <button className="btn btn-soft btn-block" onClick={() => { close(); invite(); }}><Icon name="share" cls="sm" />Invite people</button>
          <button className="btn btn-danger btn-block" onClick={() => { close(); leave(); }}><Icon name="logout" cls="sm" />Leave chatroom</button>
          <button className="btn btn-soft btn-block" onClick={close}>Close</button>
        </div>
      </>
    ), { label: 'Chatroom options' });
  }
  function messageMenu(m: any, reportOnly = false) {
    openSheet((close) => (
      <>
        <h2>{reportOnly ? `Report ${m.handle}` : m.handle}</h2>
        <p className="muted">{`“${m.body.length > 140 ? `${m.body.slice(0, 140)}…` : m.body}”`}</p>
        {reportOnly ? null : <div className="rx-quick">{EMOJI.map((e) => <button key={e} onClick={() => { close(); react(m, e); }}>{e}</button>)}</div>}
        {reportOnly ? null : <button className="btn btn-primary btn-block" style={{ marginBottom: '10px' }} onClick={() => { close(); setReply(m); }}><Icon name="reply" cls="sm" />Reply</button>}
        {m.mine && !reportOnly ? (
          <button className="btn btn-soft btn-block danger-text" style={{ marginBottom: '10px' }} onClick={async () => {
            close();
            if (!(await confirmSheet({ title: 'Delete this message?', text: 'It’s removed from the chatroom for everyone.', yes: 'Delete', danger: true }))) return;
            try { await api.deleteRoomMessage(m.id); dropRow(m.id); toast('Message deleted', 'trash'); }
            catch (e) { toast(api.friendly(e), 'x'); }
          }}><Icon name="trash" cls="sm" />Delete message</button>
        ) : null}
        {m.mine || reportOnly ? null : (
          <div className="stack" style={{ gap: '8px', marginBottom: '12px' }}>
            <button className="btn btn-soft btn-block" onClick={() => { close(); hideMsg(m.id); toast('Message hidden', 'eye'); }}>Hide this message</button>
            <button className="btn btn-soft btn-block" onClick={async () => {
              close();
              if (!(await confirmSheet({ title: `Block ${m.handle}?`, text: 'You won’t see their messages in chatrooms, and they can’t message you. They won’t be told.', yes: 'Block', danger: true }))) return;
              await blockHandle(m.handle, m.id);
            }}>{`Block ${m.handle}`}</button>
          </div>
        )}
        {m.mine ? null : <p className="small muted">Report this if it’s abusive, sexual, spam, or from someone who seems under 18. It’s hidden for you straight away, and we review reports within 24 hours.</p>}
        {m.mine ? null : (
          <div className="stack" style={{ gap: '8px' }}>{REPORT_REASONS.map(([value, label]) => (
            <button key={value} className="btn btn-soft btn-block" onClick={async () => {
              close();
              try { await api.reportRoomMessage(m.id, value); hideMsg(m.id); toast('Thanks. It’s hidden and we’ll review it.', 'flag'); }
              catch (e) { toast(api.friendly(e), 'x'); }
            }}>{label}</button>))}</div>
        )}
        {m.mine ? null : <p className="tiny muted center" style={{ marginTop: '10px' }}>Something urgent? Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></p>}
        <div className="sheet-actions"><button className="btn btn-soft btn-block" onClick={close}>{m.mine ? 'Close' : 'Cancel'}</button></div>
      </>
    ), { label: 'Message' });
  }
  async function profileCard(handle: string) {
    let p: any = null;
    try { p = await api.roomProfile(handle); } catch (e) { toast(api.friendly(e), 'x'); return; }
    if (!p) { toast('They’ve left the room', 'x'); return; }
    const lastMsg = [...R.current.messages.values()].reverse().find((m) => m.handle === handle);
    const canMessage = !!state.profile && !p.me;
    const existing = canMessage ? friendChat(p.handle) : null;
    openSheet((close) => (
      <>
        <div className="pc">
          <div className="pc-av"><RoomAvatar handle={p.handle} cls="xl" />{p.online ? <i /> : null}</div>
          <h2>{p.handle}</h2>
          <p className="pc-sub">{[p.place && p.place !== p.room ? p.place : roomName(p.room), p.age ? `${p.age} years` : null].filter(Boolean).join(' · ')}</p>
          <span className={`pc-status ${p.online ? 'on' : ''}`}>{p.online ? 'Online' : 'Away'}</span>
          {p.me ? null : (
            <div className="pc-actions">
              {existing
                ? <button className="btn btn-primary" onClick={() => { close(); openChat(existing.conversation_id); }}><Icon name="chat" cls="sm" />{statusOf(existing) === 'sent' ? 'Request sent · open' : 'Open chat'}</button>
                : <button className={`btn ${canMessage ? 'btn-coral' : 'btn-soft'}`} disabled={!canMessage} onClick={() => { close(); composeTo({ handle: p.handle, age: p.age, gender: p.gender }, { friend: true }); }}><Icon name="userplus" cls="sm" />Add friend</button>}
            </div>
          )}
          {p.me || canMessage ? null : <p className="tiny muted">Set up your profile to add friends.</p>}
        </div>
        <div className="pc-about">
          <h3>About</h3>
          <p className="muted">{p.bio || (p.me ? 'Add a bio to your dating card so people know your vibe.' : 'No bio yet.')}</p>
          <div className="pc-facts">
            <span><Icon name="pin" cls="sm" />{roomName(p.room)}</span>
            {p.age ? <span><Icon name="cake" cls="sm" />{`${p.age} years${p.gender ? ` · ${GENDER_LABEL[p.gender]}` : ''}`}</span> : null}
            <span><Icon name="heart" cls="sm" />{p.dating ? 'Open to dating on treehouse' : 'Here to chat and meet people'}</span>
          </div>
          {(p.interests || []).length ? <div className="chips">{p.interests.map((i: string) => <span key={i} className="chip static">{i}</span>)}</div> : null}
        </div>
        {p.me ? null : (
          <div className="settings-group pc-safety">
            <button className="settings-row" onClick={async () => {
              close();
              if (!(await confirmSheet({ title: `Block ${p.handle}?`, text: 'You won’t see their messages in chatrooms, and they can’t message you. They won’t be told.', yes: 'Block', danger: true }))) return;
              await blockHandle(p.handle, lastMsg && lastMsg.id);
            }}><Icon name="ban" /><span className="grow">Block user</span><span className="chev"><Icon name="chev" cls="sm" /></span></button>
            <button className="settings-row danger" onClick={() => { close(); if (lastMsg) messageMenu(lastMsg, true); else toast('Nothing to report yet: they haven’t sent a message here.', 'flag'); }}>
              <Icon name="flag" /><span className="grow">Report user</span><span className="chev"><Icon name="chev" cls="sm" /></span></button>
          </div>
        )}
      </>
    ), { label: `${p.handle}’s profile` });
  }

  // ---- screens -----------------------------------------------------------------------------------
  if (phase === 'loading') return <div className="chat-head"><div className="spinner" /></div>;
  if (phase === 'kicked') return (
    <div className="empty room-kicked" style={{ margin: 'auto' }}><div className="empty-art"><span>🚪</span></div>
      <h3>You were kicked out of this room for inactivity</h3>
      <p>{`You were inactive in ${roomName(target)} for more than 10 minutes. Join again to keep chatting.`}</p>
      <div className="row center-row">
        <button className="btn btn-primary" onClick={() => { rejoinFor = target; restart(); }}>Join again</button>
        <button className="btn btn-soft" onClick={() => go('rooms', { replace: true })}>Back to chatrooms</button>
      </div>
    </div>
  );
  if (phase === 'error') {
    const dob = /date of birth/i.test(error);
    return (
      <div className="empty" style={{ margin: 'auto' }}><div className="empty-art"><span>🚪</span></div>
        <h3>{`Can’t join ${roomName(target)}`}</h3><p>{error}</p>
        {dob ? <button className="btn btn-primary" onClick={() => askBirthday(restart)}>Add date of birth</button> : null}
        <button className={`btn ${dob ? 'btn-soft' : 'btn-primary'}`} onClick={() => go('rooms', { replace: true })}>Back to chatrooms</button>
      </div>
    );
  }

  const blk = blocked();
  const onNow = people.filter(isOnline).length;
  const dropList = people.filter((p) => !blk.has(p.handle) && (!dropQ.trim() || p.handle.toLowerCase().includes(dropQ.trim().toLowerCase())));
  let lastDay: string | null = null;
  const quoteName = (handle: string) => (handle === R.current.handle ? 'You' : handle);

  return (
    <>
      <div className="room-head2">
        <div className="room-topbar">
          <button className="plain-btn" aria-label="Back" onClick={() => go('rooms')}><Icon name="back" /></button>
          <Logo />
          <span className="grow" />
          <BellButton />
          <button className="plain-btn" aria-label="Room options" onClick={roomMenu}><Icon name="more" /></button>
        </div>
        <button className={`room-pill ${drop ? 'open' : ''}`} aria-expanded={drop} aria-label="Show members" onClick={() => { const open = !drop; setDrop(open); if (open) api$.current.loadPeople(); }}>
          <span className="cr-group"><Icon name="rooms" /></span>
          <span className="grow"><b className="ellipsis">{roomName(target)}</b><span className="rp-count"><i /><span>{count}</span></span></span>
          <span className="rp-chev"><Icon name="chev" cls="sm" /></span>
        </button>
      </div>
      {banner && joined ? (
        <div className="room-banner">
          <span className="rb-pin"><Icon name="pushpin" cls="sm" /></span>
          <p>{GENERAL_ROOMS[target] || UNI_ROOMS[target] ? `Welcome to ${roomName(target)}! You’re ` : `Welcome to ${roomName(target)} chatroom! You’re `}
            <b style={{ color: nameColor(joined.handle) }}>{joined.handle}</b>. Be respectful, keep it fun and meet new people 💙</p>
          <button className="plain-btn" aria-label="Dismiss" onClick={() => { store.set(`hy-room-banner-${target}`, true); setBanner(false); }}><Icon name="x" cls="sm" /></button>
        </div>
      ) : null}
      <div className="room-middle">
        <div ref={body} className="chat-body room-body" role="log" aria-live="polite"
          onClick={() => { if (drop) setDrop(false); }}
          onScroll={(e) => {
            const b = e.currentTarget;
            R.current.nearBottom = b.scrollHeight - b.scrollTop - b.clientHeight < 120;
            b.dataset.pinned = R.current.nearBottom ? '1' : '0';
            if (R.current.nearBottom && !document.hidden && unseenRef.current) bumpUnseen(0);
          }}>
          {items.map((it) => {
            if (it.k === 'notice') {
              if (it.cls === 'empty') return (
                <div key={it.id} className="empty" style={{ padding: '30px 10px' }}><div className="empty-art"><span>👋</span></div>
                  <h3>Say hi!</h3><p>You’ll see messages sent from now on. Earlier messages aren’t shown, and the chat clears when you leave.</p></div>
              );
              return <div key={it.id} className={`room-notice ${it.cls || ''}`.trim()}>{it.text}</div>;
            }
            if (it.k === 'unread') return <div key={it.id} data-key={it.id} className="room-notice unread-sep">{`${it.n} unread message${it.n === 1 ? '' : 's'}`}</div>;
            const m = it.m;
            const day = dayLabel(m.created_at);
            const sep = day !== lastDay ? <div className="day-sep">{day}</div> : null;
            lastDay = day;
            return (
              <Fragment key={m.id}>
                {sep}
                <RoomMessage m={m} quoteName={quoteName} picker={picker === m.id}
                  onCard={() => profileCard(m.handle)} onMenu={() => messageMenu(m)} onReply={() => setReply(m)} onJump={jumpTo}
                  onReact={(e) => react(m, e)} onPicker={(open) => setPicker(open ? m.id : null)} />
              </Fragment>
            );
          })}
        </div>
        {drop ? (
          <div className="members-drop" role="dialog" aria-label="Room members">
            <div className="md-head"><span className="md-icon"><Icon name="rooms" /></span>
              <div className="grow"><b>{`${shortTitle(target)} Members`}</b><p>{`${people.length} members · `}<i className="dot-on" />{`${onNow} online`}</p></div>
              <button className="plain-btn" aria-label="Close" onClick={() => setDrop(false)}><Icon name="x" /></button></div>
            <label className="md-search"><Icon name="search" cls="sm" /><input className="input" type="search" placeholder="Search members…" aria-label="Search members" value={dropQ} onChange={(e) => setDropQ(e.target.value)} /></label>
            <div className="md-list">{dropList.length
              ? dropList.slice(0, 8).map((p) => <MemberRow key={p.handle} p={p} onCard={() => profileCard(p.handle)} />)
              : <p className="small muted center" style={{ padding: '14px' }}>{dropQ.trim() ? 'No one by that name.' : 'Loading…'}</p>}</div>
            <button className="md-all" onClick={() => { setDrop(false); setMembersOpen(true); api$.current.loadPeople(); }}>View All Members<Icon name="chev" cls="sm" /></button>
          </div>
        ) : null}
        {unseen ? <button className="new-pill" onClick={() => { const b = body.current; if (b) b.scrollTop = b.scrollHeight; bumpUnseen(0); }}>{`${unseen > 99 ? '99+' : unseen} new message${unseen === 1 ? '' : 's'}`}<Icon name="chev" cls="sm" /></button> : null}
      </div>
      {replyTo ? (
        <div className="reply-bar" style={vars({ '--c': nameColor(replyTo.handle) })}>
          <div className="grow"><b>{`Replying to ${quoteName(replyTo.handle)}`}</b><span>{replyTo.body.length > 140 ? `${replyTo.body.slice(0, 140)}…` : replyTo.body}</span></div>
          <button type="button" className="plain-btn" aria-label="Cancel reply" onClick={() => setReplyTo(null)}><Icon name="x" cls="sm" /></button>
        </div>
      ) : null}
      <form className="composer room-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea ref={input} className="input" rows={1} maxLength={500} placeholder="Type a message…" aria-label="Message" value={text}
          onChange={(e) => { setText(e.target.value); const t = e.target; t.style.height = 'auto'; t.style.height = `${Math.min(120, t.scrollHeight)}px`; }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !coarse()) { e.preventDefault(); send(); } }} />
        <button className="send" aria-label="Send" disabled={sending} onMouseDown={(e) => e.preventDefault()}><Icon name="send" cls="sm" /></button>
      </form>
      {membersOpen ? <MembersPage target={target} people={people} onClose={() => { setMembersOpen(false); redraw((n) => n + 1); }} onCard={profileCard} /> : null}
    </>
  );
}

function RoomMessage({ m, quoteName, picker, onCard, onMenu, onReply, onJump, onReact, onPicker }: {
  m: any; quoteName: (h: string) => string; picker: boolean; onCard: () => void; onMenu: () => void; onReply: () => void;
  onJump: (id: string) => void; onReact: (e: string) => void; onPicker: (open: boolean) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const t = useRef({ x0: 0, y0: 0, dx: 0, active: false, decided: false, horizontal: false });
  // Drag a message to the right; past ~60px it becomes a reply (with a tick of haptics on phones).
  const onTouchStart = (e: React.TouchEvent) => { const p = e.touches[0]; t.current = { x0: p.clientX, y0: p.clientY, dx: 0, active: true, decided: false, horizontal: false }; };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = t.current; if (!s.active || !row.current) return;
    const p = e.touches[0]; const ddx = p.clientX - s.x0, ddy = p.clientY - s.y0;
    if (!s.decided && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) { s.decided = true; s.horizontal = Math.abs(ddx) > Math.abs(ddy) * 1.3 && ddx > 0; }
    if (!s.horizontal) return;
    s.dx = Math.max(0, Math.min(90, ddx));
    row.current.style.transform = `translateX(${s.dx}px)`;
    row.current.classList.toggle('swipe-ready', s.dx > 60);
  };
  const onTouchEnd = () => {
    const s = t.current; const el = row.current; if (!s.active || !el) return;
    s.active = false;
    if (s.horizontal && s.dx > 60) { onReply(); if (navigator.vibrate) navigator.vibrate(12); }
    el.classList.add('swipe-back'); el.style.transform = ''; el.classList.remove('swipe-ready');
    setTimeout(() => el.classList.remove('swipe-back'), 220);
  };
  useEffect(() => {
    if (!picker) return;
    const off = (ev: MouseEvent) => { if (!row.current?.querySelector('.rx-picker')?.contains(ev.target as Node)) onPicker(false); };
    const id = setTimeout(() => document.addEventListener('click', off), 0);
    return () => { clearTimeout(id); document.removeEventListener('click', off); };
  }, [picker, onPicker]);
  const counts = m.reactions || {};
  const mine = new Set<string>(m.my_reactions || []);
  const chips = EMOJI.filter((e) => counts[e]);
  const gone = m.reply_to && !m.reply_handle;
  return (
    <div ref={row} className={`rmsg ${m.mine ? 'me' : ''}`} data-handle={m.handle} data-id={m.id}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      <button className="rmsg-swipe" aria-label={`Reply to ${m.mine ? 'your message' : m.handle}`} onClick={(e) => { e.stopPropagation(); onReply(); }}><Icon name="reply" cls="sm" /></button>
      <button className="rmsg-av" onClick={onCard} aria-label={`${m.handle}’s profile`}><RoomAvatar handle={m.handle} /></button>
      <div className="rmsg-main">
        <div className="rmsg-top">
          <button className="rmsg-name" style={{ color: nameColor(m.handle) }} onClick={onCard}>{m.mine ? 'You' : m.handle}</button>
          <time dateTime={m.created_at}>{clock(m.created_at)}</time>
        </div>
        {m.reply_to ? (
          <button className={`rmsg-quote ${gone ? 'gone' : ''}`} style={vars({ '--c': gone ? 'var(--muted)' : nameColor(m.reply_handle) })} onClick={(e) => { e.stopPropagation(); onJump(String(m.reply_to)); }}>
            <b>{gone ? 'Message' : quoteName(m.reply_handle)}</b><span>{gone ? 'This message is no longer available' : m.reply_body}</span>
          </button>
        ) : null}
        <p className="rmsg-text" onClick={onMenu}>{m.body}</p>
        <div className="rx-row" hidden={!chips.length}>
          {chips.map((e) => <button key={e} className={`rx ${mine.has(e) ? 'on' : ''}`} onClick={() => onReact(e)}>{e}<span>{String(counts[e])}</span></button>)}
          <button className="rx add" aria-label="Add reaction" onClick={() => onPicker(!picker)}><Icon name="plus" cls="sm" /></button>
          {picker ? <div className="rx-picker" role="menu">{EMOJI.map((e) => <button key={e} onClick={() => { onPicker(false); onReact(e); }}>{e}</button>)}</div> : null}
        </div>
      </div>
    </div>
  );
}

// "Add friend" sends a message request (as in Discover). It needs a dating card on both sides.
function MessageButton({ p }: { p: any }) {
  if (p.me) return null;
  if (!state.profile) return <span className="req-note">Room chat only</span>;
  const existing = friendChat(p.handle);
  if (existing) return <button className="req-btn" onClick={(e) => { e.stopPropagation(); openChat(existing.conversation_id); }}><Icon name="chat" cls="sm" />Chat</button>;
  return <button className="req-btn" onClick={(e) => { e.stopPropagation(); composeTo({ handle: p.handle, age: p.age, gender: p.gender }, { friend: true }); }}><Icon name="userplus" cls="sm" />Add friend</button>;
}
function MemberRow({ p, onCard }: { p: any; onCard: () => void }) {
  return (
    <div className="md-row" role="button" tabIndex={0} onClick={onCard} onKeyDown={(e) => { if (e.key === 'Enter') onCard(); }}>
      <span className="op-av"><RoomAvatar handle={p.handle} />{isOnline(p) ? <i /> : null}</span>
      <span className="grow"><b style={{ color: nameColor(p.handle) }}>{p.me ? `${p.handle} (you)` : p.handle}</b>
        <span className="md-place">{`${p.place || ''}${p.place ? ' • ' : ''}${isOnline(p) ? 'Online' : 'Away'}`}</span></span>
      <MessageButton p={p} />
    </div>
  );
}

// Full members screen: search, and All / Online / Open to dating.
function MembersPage({ target, people: all, onClose, onCard }: { target: string; people: any[]; onClose: () => void; onCard: (h: string) => void }) {
  const [filter, setFilter] = useState<'all' | 'online' | 'dating'>('all');
  const [q, setQ] = useState('');
  const blk = blocked();
  const people = all.filter((p) => !blk.has(p.handle));
  const open = people.filter((p) => p.dating && !p.me);
  const onNow = people.filter(isOnline);
  const shown = (filter === 'dating' ? open : filter === 'online' ? onNow : people).filter((p) => !q.trim() || p.handle.toLowerCase().includes(q.trim().toLowerCase()));
  const tab = (id: typeof filter, label: string) => <button key={id} className={`cr-pill ${filter === id ? 'on' : ''}`} onClick={() => setFilter(id)}>{label}</button>;
  return (
    <section className="members-page" aria-label="Room members">
      <div className="mp-head">
        <button className="plain-btn" aria-label="Back" onClick={onClose}><Icon name="back" /></button>
        <div className="grow"><h2>{`${shortTitle(target)} Members`}</h2><p>{`${people.length} members · `}<i className="dot-on" />{`${onNow.length} online`}</p></div>
      </div>
      <label className="md-search"><Icon name="search" cls="sm" /><input className="input" type="search" placeholder="Search members…" aria-label="Search members" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <div className="cr-pills">{tab('all', `All (${people.length})`)}{tab('online', `Online (${onNow.length})`)}{tab('dating', `Open to dating (${open.length})`)}</div>
      <div className="mp-list">{shown.length ? shown.map((p) => <MemberRow key={p.handle} p={p} onCard={() => onCard(p.handle)} />)
        : <EmptyState emoji={filter === 'dating' ? '💘' : '🔎'} title={filter === 'dating' ? 'No one open to dating here yet' : 'No one by that name'}
          text={filter === 'dating' ? 'People with a dating card can get message requests.' : 'Try another name.'} />}</div>
    </section>
  );
}

// Age rooms need a date of birth (port of askBirthday in hy-onboard.js).
export function askBirthday(onDone?: () => void) {
  openSheet((close) => <BirthdayForm close={close} onDone={onDone} />, { label: 'Add your date of birth' });
}
function BirthdayForm({ close, onDone }: { close: () => void; onDone?: () => void }) {
  const [dob, setDob] = useState<Dob>({ d: '', m: '', y: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setErr('');
    const birth = dobValue(dob);
    if (!birth) { setErr('Choose your day, month and year of birth.'); return; }
    if (birth === 'invalid') { setErr('That date doesn’t exist. Check your date of birth.'); return; }
    if (!(await confirmSheet({ title: `Born on ${formatDob(birth)}?`, yes: 'Yes, that’s right', text: 'Please check it carefully. You can only change your date of birth after 365 days.' }))) return;
    setBusy(true);
    try {
      await api.updateProfile(state.profile.handle, { birth_date: birth });
      state.profile = await api.myProfile();
      close();
      emit('profile');
      if (state.profile.dob_underage_at) return;
      toast('Date of birth saved', 'check');
      if (onDone) onDone();
    } catch (e) { setErr(api.friendly(e)); setBusy(false); }
  };
  return (
    <>
      <h2>🎂 Add your date of birth</h2>
      <p className="muted">Age rooms are for people the same age as you. Your date of birth is private: nobody else sees it. Your age updates on your birthday, so you move up an age room by yourself.</p>
      <div className="field"><span>Date of birth</span><DobPicker value={dob} onChange={setDob} /></div>
      <p className="small muted">You can only change your date of birth after 365 days.</p>
      <p className="error" role="alert">{err}</p>
      <div className="sheet-actions"><button className="btn btn-primary btn-block" disabled={busy} onClick={save}>Save date of birth</button></div>
    </>
  );
}
