'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// A private chat (port of openChat in anon-inbox/public/hy-dating.js). Text messages, replies,
// edits (15 minutes), unsend, delete for me, Sent/Delivered/Seen, typing and "online" over the
// chat's private live channel, the request accept bar, reveal and add-friend buttons.
// The + next to the message box sends photos (camera or gallery, once unlocked) and Kickrs challenges.
// Photos are blurred until tapped; swipe a message right to reply.
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as api from '@/lib/api';
import { state, useAppState, loadDating, patchChat, markChatRead, statusOf, nameOf, isMatch, isFriend, rememberRevealedName, type Convo } from '@/lib/state';
import { go } from '@/lib/nav';
import { clock, dayLabel } from '@/lib/util';
import { Icon, Avatar } from './ui';
import { openSheet, confirmSheet, toast } from './overlay';
import { setOpenChatHandler } from './chatBus';
import * as photos from './photos';
import { useSwipeReply } from './swipe';
import { CHALLENGES, CHALLENGE_MS, challengeOf, parseChallenge } from '@/lib/kickrs';
import { meta, activeText, shortName, acceptRequest, declineRequest, blockConvo, cancelSent, askFriend, doReveal, chatMenu, partnerProfile } from './convo';

type Msg = { id: string; sender_id: string; body: string; created_at: string; reply_to: string | null; edited_at: string | null; deleted_at: string | null; photo?: string | null; photo_w?: number; photo_h?: number; pending?: boolean; localUrl?: string };
const EDIT_WINDOW = 15 * 60 * 1000;
const coarse = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export default function Chat({ id }: { id: string }) {
  const s = useAppState();
  const convo: Convo | undefined = s.convos.find((c) => c.conversation_id === id);
  const [looked, setLooked] = useState(!!convo);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (convo || looked) return;
    loadDating({ force: true }).finally(() => setLooked(true));
  }, [convo, looked]);
  if (!mounted) return null;
  const content = !convo
    ? (looked
      ? <div className="empty" style={{ margin: 'auto' }}><div className="empty-art"><span>🤷</span></div><h3>Chat not found</h3><p>It may have been closed.</p><button className="btn btn-primary" onClick={() => go('matches', { replace: true })}>Back to matches</button></div>
      : <div className="chat-head"><div className="spinner" /></div>)
    : <ChatView convo={convo} />;
  return createPortal(<ChatFrame>{content}</ChatFrame>, document.body);
}

// The chat sits on top of the app, sized to the space above the phone's keyboard (see hy-dating.js
// fitChatToViewport for the reasons), with the app behind it switched off.
export function ChatFrame({ children, cls = 'chat', label = 'Chat' }: { children: React.ReactNode; cls?: string; label?: string }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const shell = document.querySelector('.shell');
    shell?.setAttribute('inert', '');
    document.body.classList.add('chat-open');
    document.body.style.overflow = 'hidden';
    const vv = window.visualViewport;
    const fit = () => {
      if (!vv) return;
      el.style.height = `${vv.height}px`;
      const left = parseFloat(getComputedStyle(el).left) || 0;
      el.style.width = `${Math.max(0, vv.width - left)}px`;
      el.style.bottom = 'auto'; el.style.right = 'auto';
      el.style.transform = `translate(${vv.offsetLeft}px, ${vv.offsetTop}px)`;
      el.classList.toggle('kb-open', window.innerHeight - vv.height > 120);
      const b = el.querySelector('.chat-body') as HTMLElement | null;
      if (b && b.dataset.pinned !== '0') b.scrollTop = b.scrollHeight;
    };
    const unscroll = () => { if (window.scrollY) window.scrollTo(0, 0); fit(); };
    vv?.addEventListener('resize', fit); vv?.addEventListener('scroll', unscroll);
    fit();
    return () => {
      vv?.removeEventListener('resize', fit); vv?.removeEventListener('scroll', unscroll);
      document.body.classList.remove('chat-open');
      document.body.style.overflow = '';
      document.querySelector('.shell')?.removeAttribute('inert');
    };
  }, []);
  return <section ref={ref} className={cls} aria-label={label}>{children}</section>;
}

function ChatView({ convo }: { convo: Convo }) {
  const id = convo.conversation_id as string;
  const me = state.user.id as string;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [typing, setTyping] = useState(false);
  const [present, setPresent] = useState(false);
  const [text, setText] = useState('');
  const [bar, setBar] = useState<{ kind: 'reply' | 'edit'; m: Msg } | null>(null);
  const [sending, setSending] = useState(false);
  const [, bump] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const channel = useRef<ReturnType<typeof api.joinChat> | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMsg = useRef<Msg | null>(null);
  // Photos: greyed out until the two of you have chatted enough (the database decides).
  const [photoOk, setPhotoOk] = useState(false);
  const photoCheck = useRef<Promise<boolean> | null>(null);
  const sinceCheck = useRef(0);
  const [unblurred, setUnblurred] = useState(0);   // bumps when a photo is tapped to view
  const [older, setOlder] = useState<Record<string, Msg>>({});   // quoted messages from before what's loaded

  const scroll = useCallback(() => requestAnimationFrame(() => { const b = body.current; if (b) b.scrollTop = b.scrollHeight; }), []);
  const checkPhotos = useCallback(() => {
    if (photoCheck.current) return photoCheck.current;
    const c = state.convos.find((x) => x.conversation_id === id);
    photoCheck.current = (c && statusOf(c) === 'chat' ? api.photosUnlocked(id) : Promise.resolve(false))
      .then((v: boolean) => { setPhotoOk(v); sinceCheck.current = 0; return v; })
      .catch(() => false)
      .finally(() => { photoCheck.current = null; });
    return photoCheck.current!;
  }, [id]);
  const add = useCallback((m: Msg) => {
    if (!m.photo && ++sinceCheck.current >= 6) checkPhotos();
    setMsgs((list) => (list.some((x) => x.id === m.id) ? list : [...list.filter((x) => !(x.pending && m.sender_id === me && x.body === m.body)), m]));
    if (!lastMsg.current || new Date(m.created_at) >= new Date(lastMsg.current.created_at)) lastMsg.current = m;
  }, [me, checkPhotos]);
  const update = useCallback((m: Partial<Msg> & { id: string }) => setMsgs((list) => list.map((x) => (x.id === m.id ? { ...x, ...m } : x))), []);

  // A request becomes a chat when someone replies, etc.: refresh this chat's state from the list.
  const refreshChatState = useCallback(async () => {
    const before = statusOf(convo);
    await loadDating({ force: true });
    const fresh = state.convos.find((c) => c.conversation_id === id);
    if (fresh && before === 'sent' && statusOf(fresh) === 'chat') toast('Your message request was accepted 🎉', 'check');
  }, [convo, id]);

  // Load, go live, keep receipts fresh; leave cleanly.
  useEffect(() => {
    state.openChat = id;
    let alive = true;
    api.messages(id).then((rows: Msg[]) => { if (!alive) return; rows.forEach(add); setLoaded(true); scroll(); }).catch((e: any) => { setLoaded(true); toast(api.friendly(e), 'x'); });
    markChatRead(id);
    const incoming = (m: Msg) => {
      if (!m || !m.id) return;
      add(m); setTyping(false); scroll();
      if (m.sender_id !== me) { markChatRead(id); channel.current?.read(); }
      const c = state.convos.find((x) => x.conversation_id === id);
      if (c && statusOf(c) !== 'chat') refreshChatState();
    };
    setOpenChatHandler(id, incoming);
    channel.current = api.joinChat(id, me, {
      onMessage: incoming,
      onUpdate: (m) => update(m),
      onTyping: () => { setTyping(true); scroll(); if (typingTimer.current) clearTimeout(typingTimer.current); typingTimer.current = setTimeout(() => setTyping(false), 3500); },
      onRead: () => {
        const c = state.convos.find((x) => x.conversation_id === id); if (!c) return;
        const now = new Date().toISOString();
        c.other_read_at = now;
        if (!c.other_delivered_at || c.other_delivered_at < now) c.other_delivered_at = now;
        bump((n) => n + 1);
      },
      onPresence: (online) => {
        const c = state.convos.find((x) => x.conversation_id === id);
        setPresent((was) => { if (was && !online && c) { c.other_online = false; c.other_active_hours = 0; } return online; });
      },
    });
    // Delivered/Seen and online status every 45 seconds (only this chat's tiny status query).
    const poll = setInterval(async () => {
      if (document.hidden || api.backingOff()) return;
      try {
        const st: any = await api.chatStatus(id);
        const c = state.convos.find((x) => x.conversation_id === id);
        if (!st || !c) return;
        const before = statusOf(c);
        Object.assign(c, { other_read_at: st.other_read_at, other_delivered_at: st.other_delivered_at, other_online: st.other_online, other_active_hours: st.other_active_hours });
        bump((n) => n + 1);
        if (st.status !== before || st.blocked !== !!c.blocked || st.they_revealed !== !!c.they_revealed) refreshChatState();
      } catch {}
    }, 45000);
    if (!convo.blocked && !coarse()) setTimeout(() => input.current?.focus(), 50);
    if (!convo.blocked && statusOf(convo) !== 'request') checkPhotos();
    return () => {
      alive = false;
      clearInterval(poll);
      channel.current?.leave(); channel.current = null;
      setOpenChatHandler(null);
      state.openChat = null;
      const last = lastMsg.current;
      if (last && !last.deleted_at && !last.pending) setTimeout(() => patchChat(id, { body: last.body, at: last.created_at, fromMe: last.sender_id === me }), 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Both revealed: fetch and remember their first name.
  useEffect(() => {
    if (!(convo.i_revealed && convo.they_revealed) || convo.other_name) return;
    api.revealedDetails(id).then((w: any) => { if (w && w.name) rememberRevealedName(id, w.name); }).catch(() => {});
  }, [convo.i_revealed, convo.they_revealed, convo.other_name, id]);

  const who = (senderId: string) => (senderId === me ? 'You' : (convo.other_name && convo.i_revealed && convo.they_revealed ? convo.other_name : shortName(convo.other_handle)));
  const preview = (m: Msg) => (m.deleted_at ? 'This message was deleted' : m.body.length > 120 ? `${m.body.slice(0, 120)}…` : m.body);
  const byId = new Map(msgs.map((m) => [m.id, m]));
  const st = statusOf(convo);
  const canTalk = !convo.blocked && st !== 'request';

  const setReply = (m: Msg) => { if (!canTalk || m.deleted_at) return; setBar({ kind: 'reply', m }); input.current?.focus(); };
  const setEdit = (m: Msg) => { setBar({ kind: 'edit', m }); setText(m.body); input.current?.focus(); };
  const clearBar = () => { if (bar && bar.kind === 'edit') setText(''); setBar(null); };

  async function send() {
    const t = text.trim();
    if (!t || sending) return;
    if (bar && bar.kind === 'edit') {
      const m = bar.m;
      setSending(true);
      try { await api.editMessage(m.id, t); setBar(null); setText(''); update({ id: m.id, body: t, edited_at: new Date().toISOString() }); loadDating(); }
      catch (e) { toast(api.friendly(e), 'x'); }
      setSending(false); input.current?.focus();
      return;
    }
    const quoted = bar && bar.kind === 'reply' ? bar.m : null;
    setText(''); setBar(null); setSending(true);
    const temp: Msg = { id: `pending-${Date.now()}`, sender_id: me, body: t, created_at: new Date().toISOString(), reply_to: quoted ? quoted.id : null, edited_at: null, deleted_at: null, pending: true };
    setMsgs((list) => [...list, temp]); scroll();
    try {
      const m = await api.sendMessage(id, t, quoted ? quoted.id : null);
      setMsgs((list) => list.filter((x) => x.id !== temp.id));
      add(m); scroll();
      if (statusOf(convo) !== 'chat') refreshChatState();
    } catch (e: any) {
      setMsgs((list) => list.filter((x) => x.id !== temp.id));
      setText((cur) => cur || t);
      if (quoted) setBar({ kind: 'reply', m: quoted });
      toast(/row-level|policy/i.test(e.message || '') ? 'You can’t send messages in this chat.' : api.friendly(e), 'x');
    }
    setSending(false); input.current?.focus();
  }

  async function photoTap(source: 'camera' | 'library') {
    if (!photoOk) {
      // Maybe it just unlocked: ask once more before saying no. (Then they tap again to pick.)
      if (await checkPhotos()) { toast('Photos unlocked 🎉 Tap again to send one', 'image'); return; }
      photos.lockedSheet(statusOf(convo) === 'chat' ? 'chat' : 'request');
      return;
    }
    const files = await photos.pickPhotos(source);
    if (!files.length) return;
    const ready = await photos.reviewPhotos(files);
    for (const p of ready) await sendOnePhoto(p);
  }
  // Show it straight away as "Sending…" with the local copy, then swap in the saved message.
  async function sendOnePhoto(p: photos.Prepared) {
    const quoted = bar && bar.kind === 'reply' ? bar.m : null;
    setBar(null);
    const temp: Msg = { id: `pending-ph-${Date.now()}`, sender_id: me, body: '📷 Photo', created_at: new Date().toISOString(), reply_to: null, edited_at: null, deleted_at: null, pending: true, photo: 'local', photo_w: p.w, photo_h: p.h, localUrl: p.url };
    setMsgs((list) => [...list, temp]); scroll();
    try {
      const m = await api.sendPhoto(id, p.blob, p.w, p.h, quoted ? quoted.id : null);
      setMsgs((list) => list.filter((x) => x.id !== temp.id));
      add(m); scroll();
    } catch (e: any) {
      setMsgs((list) => list.filter((x) => x.id !== temp.id));
      if (/row-level|policy|chatted enough|42501/i.test(`${e.message} ${e.code || ''}`)) { setPhotoOk(false); photos.lockedSheet('chat'); }
      else toast(api.friendly(e), 'x');
    }
  }
  // First tap on their photo un-blurs it; after that a tap opens it full screen.
  function photoClick(m: Msg) {
    if (m.pending) return;
    if (photos.expired(m)) { messageActions(m); return; }
    if (m.sender_id !== me && !photos.wasSeen(m.id)) { photos.markSeen(m.id); setUnblurred((n) => n + 1); return; }
    photos.openViewer(m, { onMore: () => messageActions(m) });
  }
  async function reportPhoto(m: Msg) {
    if (!(await confirmSheet({ title: 'Report this photo?', yes: 'Report', danger: true, text: 'Our team will review it. You can also block them from the chat menu.' }))) return;
    try { await api.reportPartner(id, 'inappropriate', `Photo message ${m.id}`); toast('Reported. Thanks for keeping treehouse safe', 'shield'); }
    catch (e) { toast(api.friendly(e), 'x'); }
  }
  function jumpTo(mid: string) {
    const row = body.current?.querySelector(`.msg-row[data-id="${mid}"]`) as HTMLElement | null;
    if (!row) { toast('That message is further back in the chat', 'reply'); return; }
    row.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
  }

  // The + next to the message box: photos (camera or gallery) and games.
  function plusMenu() {
    const talking = statusOf(convo) === 'chat';
    openSheet((close) => (
      <>
        <h2>Send</h2>
        <div className="ph-sources">
          <button className="ph-source cam" onClick={() => { close(); photoTap('camera'); }}><Icon name={photoOk ? 'camera' : 'lock'} /><span>Camera</span></button>
          <button className="ph-source lib" onClick={() => { close(); photoTap('library'); }}><Icon name={photoOk ? 'image' : 'lock'} /><span>Photos</span></button>
        </div>
        {talking ? (
          <div className="menu-list" style={{ marginTop: '12px' }}>
            {Object.entries(CHALLENGES).map(([game, c]) => (
              <button key={game} className="menu-item kick-item" onClick={() => { close(); go(`games/${game}?challenge=${encodeURIComponent(id)}&back=${encodeURIComponent(id)}`); }}>
                <span className="kc-art" aria-hidden="true">{c.art}</span>
                <span className="grow"><b>{c.menu}</b><small className="muted">{game === 'trivia' ? `Quiz ${shortName(convo.other_handle)} on Kickrs: 7 questions, 10 seconds each.` : `Play ${shortName(convo.other_handle)} on Kickrs. They get a Play button here.`}</small></span>
              </button>
            ))}
          </div>
        ) : null}
        {!photoOk ? <p className="tiny muted" style={{ marginTop: '10px' }}>Photos unlock once you two have chatted enough.</p> : null}
      </>
    ), { label: 'Send' });
  }

  function messageActions(m: Msg) {
    if (m.deleted_at) {
      openSheet((close) => (<><h2>Deleted message</h2>
        <div className="menu-list" style={{ marginTop: '10px' }}><button className="menu-item" onClick={() => { close(); hideForMe(m); }}><Icon name="trash" />Remove from my chat</button></div>
        <div className="sheet-actions"><button className="btn btn-soft btn-block" onClick={close}>Close</button></div></>), { label: 'Message options' });
      return;
    }
    const mine = m.sender_id === me;
    const canEdit = !m.photo && mine && !convo.blocked && Date.now() - new Date(m.created_at).getTime() < EDIT_WINDOW;
    openSheet((close) => (
      <>
        <p className="msg-sheet-quote">{preview(m)}</p>
        <div className="menu-list">
          {canTalk ? <button className="menu-item" onClick={() => { close(); setReply(m); }}><Icon name="reply" />Reply</button> : null}
          {m.photo ? null : <button className="menu-item" onClick={async () => { close(); let ok = false; try { await navigator.clipboard.writeText(m.body); ok = true; } catch {} toast(ok ? 'Copied' : 'Couldn’t copy', 'copy'); }}><Icon name="copy" />Copy</button>}
          {m.photo && !mine ? <button className="menu-item danger" onClick={() => { close(); reportPhoto(m); }}><Icon name="flag" />Report photo</button> : null}
          {canEdit ? <button className="menu-item" onClick={() => { close(); setEdit(m); }}><Icon name="edit" />Edit</button> : null}
          {mine ? <button className="menu-item danger" onClick={() => { close(); unsend(m); }}><Icon name="ban" />Unsend for everyone</button> : null}
          <button className="menu-item danger" onClick={() => { close(); hideForMe(m); }}><Icon name="trash" />Delete for me</button>
        </div>
        {mine && !canEdit && !convo.blocked ? <p className="tiny muted" style={{ marginTop: '8px' }}>Messages can be edited for 15 minutes after sending.</p> : null}
      </>
    ), { label: 'Message options' });
  }
  async function unsend(m: Msg) {
    if (!(await confirmSheet({ title: 'Unsend this message?', yes: 'Unsend', danger: true, text: 'It’s removed for both of you and replaced with “This message was deleted”.' }))) return;
    try { await api.unsendMessage(m.id); update({ id: m.id, deleted_at: new Date().toISOString(), body: 'This message was deleted', reply_to: null }); loadDating(); }
    catch (e) { toast(api.friendly(e), 'x'); }
  }
  async function hideForMe(m: Msg) {
    try { await api.hideMessage(m.id); setMsgs((list) => list.filter((x) => x.id !== m.id)); loadDating(); toast('Deleted for you', 'trash'); }
    catch (e) { toast(api.friendly(e), 'x'); }
  }

  // ---- Receipts: Sending → Sent → Delivered → Seen (their avatar under the last message read) ----
  const t = (iso?: string | null) => (iso ? new Date(iso).getTime() : 0);
  const readAt = t(convo.other_read_at), deliveredAt = Math.max(t(convo.other_delivered_at), readAt);
  const mineIdx = msgs.map((m, i) => (m.sender_id === me && !m.deleted_at ? i : -1)).filter((i) => i >= 0);
  let seenIdx = -1;
  for (let k = mineIdx.length - 1; k >= 0; k--) { const m = msgs[mineIdx[k]]; if (!m.pending && readAt && t(m.created_at) <= readAt) { seenIdx = mineIdx[k]; break; } }
  if (seenIdx >= 0 && msgs.slice(seenIdx + 1).some((m) => m.sender_id !== me)) seenIdx = -1;
  const lastMineIdx = mineIdx.length ? mineIdx[mineIdx.length - 1] : -1;
  const receiptFor = (i: number) => {
    if (convo.blocked) return null;
    if (i === seenIdx) return <div className="seen-av" aria-label={`Seen by ${nameOf(convo)}`}><span>Seen</span><Avatar seed={convo.other_handle} label={nameOf(convo)} cls="xs" /></div>;
    if (i !== lastMineIdx) return null;
    const m = msgs[i];
    const delivered = !m.pending && deliveredAt && t(m.created_at) <= deliveredAt;
    const [ico, label] = m.pending ? ['dot', 'Sending…'] : delivered ? ['delivered', 'Delivered'] : st === 'sent' ? ['sent', 'Sent · waiting for them to accept'] : ['sent', 'Sent'];
    return <div className={`msg-status ${m.pending ? 'pending' : delivered ? 'delivered' : 'sent'}`}><span>{label}</span><Icon name={ico} cls="sm" /></div>;
  };

  const online = !convo.blocked && (present || convo.other_online);
  const metaText = meta({ age: convo.other_age, gender: convo.other_gender, location: convo.other_location });
  const active = convo.blocked ? null : activeText(false, convo.other_active_hours);
  let lastDay: string | null = null;

  return (
    <>
      <div className="chat-head">
        <button className="plain-btn" aria-label="Back" onClick={back}><Icon name="back" /></button>
        <button className="chat-who" aria-label={`View ${convo.other_handle}’s profile`} onClick={() => partnerProfile(convo)}>
          <Avatar seed={convo.other_handle} label={nameOf(convo)} />
          <span className="grow">
            <b className="ellipsis name-dot">{nameOf(convo)}<span className="name-dot-slot">{online ? <i className="online-dot-inline" role="img" aria-label="Online" /> : null}</span></b>
            <span className="status">{online ? <><i />Online</> : (active ? `${active} · ${metaText}` : metaText)}</span>
          </span>
        </button>
        <FriendButton convo={convo} />
        <RevealPill convo={convo} />
        <button className="plain-btn" aria-label="Chat options" onClick={() => chatMenu(convo)}><Icon name="more" /></button>
      </div>

      <div ref={body} className="chat-body" role="log" aria-live="polite" onScroll={(e) => { const b = e.currentTarget; b.dataset.pinned = b.scrollHeight - b.scrollTop - b.clientHeight < 80 ? '1' : '0'; }}>
        {loaded && !msgs.length ? (
          <div className="empty" style={{ padding: '30px 10px' }}><div className="empty-art"><span>👋</span></div><h3>Say hi!</h3>
            <p>{st === 'sent' ? 'Your request is waiting for them to accept.' : isMatch(convo) ? 'You matched. Neither of you knows who the other is yet: start with something fun.' : 'Request accepted. You’re both anonymous: start with something fun.'}</p></div>
        ) : null}
        {msgs.map((m, i) => {
          const day = dayLabel(m.created_at);
          const sep = day !== lastDay ? <div className="day-sep">{day}</div> : null;
          lastDay = day;
          const mine = m.sender_id === me, gone = !!m.deleted_at;
          const q = m.reply_to ? (byId.get(m.reply_to) || older[m.reply_to] || null) : null;
          if (m.reply_to && !q && !gone && !(m.reply_to in older)) {   // older than what's loaded: fetch it once
            const rid = m.reply_to;
            setTimeout(() => { setOlder((o) => (rid in o ? o : { ...o, [rid]: null as any })); api.messageById(rid).then((x: any) => { if (x) setOlder((o) => ({ ...o, [rid]: x })); }).catch(() => {}); }, 0);
          }
          const quote = m.reply_to && !gone
            ? <button className={`bubble-quote ${q && q.sender_id === me ? 'mine' : ''}`} onClick={(e) => { e.stopPropagation(); jumpTo(m.reply_to!); }}><b>{q ? who(q.sender_id) : 'Message'}</b><span>{q ? preview(q) : 'Earlier message'}</span></button> : null;
          return (
            <Fragment key={m.id}>
              {sep}
              <MsgRow m={m} mine={mine} gone={gone} canSwipe={canTalk && !gone && !m.pending} onReply={() => setReply(m)}>
                {m.photo && !gone
                  ? <div className="bubble photo-bubble" onClick={() => photoClick(m)}>{quote}<photos.PhotoBox key={unblurred} m={m} mine={mine} localUrl={m.localUrl} blur={!photos.wasSeen(m.id)} /></div>
                  : <div className="bubble" onClick={() => !m.pending && messageActions(m)}>
                    {quote}
                    {gone ? <span className="gone-text"><Icon name="ban" cls="sm" />{mine ? 'You unsent a message' : 'This message was deleted'}</span> : <Body m={m} mine={mine} chatId={id} />}
                  </div>}
              </MsgRow>
              {receiptFor(i)}
            </Fragment>
          );
        })}
        <div className="typing" hidden={!typing} aria-label="Typing"><i /><i /><i /></div>
      </div>

      {st === 'sent' && !convo.blocked ? (
        <div className="reveal-card"><span className="rc-icon"><Icon name="send" /></span>
          <div className="grow"><b>Request pending</b><p>They’ll see it in their Requests. Once they accept, you can chat freely. You can send up to 3 messages until then.</p></div>
          <button className="btn btn-ghost btn-sm" onClick={() => cancelSent(convo)}>Cancel request</button></div>
      ) : null}

      {convo.blocked ? <div className="chat-closed">This chat is closed. Neither of you can send messages.</div>
        : st === 'request' ? (
          <div className="accept-bar">
            <p><b>{isFriend(convo) ? `${shortName(convo.other_handle)} wants to be friends.` : `${shortName(convo.other_handle)} wants to chat with you.`}</b> Accept to reply. If you decline, they aren’t told.</p>
            <div className="accept-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => declineRequest(convo)}>Decline</button>
              <button className="btn btn-ghost btn-sm" onClick={() => blockConvo(convo)}><Icon name="shield" cls="sm" />Block</button>
              <button className="btn btn-primary btn-sm grow" onClick={() => acceptRequest(convo)}><Icon name="check" cls="sm" />Accept</button>
            </div>
          </div>
        ) : (
          <>
            {bar ? (
              <div className={`reply-bar ${bar.kind}`}>
                <div className="grow"><b>{bar.kind === 'edit' ? 'Edit message' : `Replying to ${who(bar.m.sender_id) === 'You' ? 'yourself' : who(bar.m.sender_id)}`}</b><span>{preview(bar.m)}</span></div>
                <button type="button" className="plain-btn" aria-label="Cancel" onClick={clearBar}><Icon name="x" cls="sm" /></button>
              </div>
            ) : null}
            <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <button type="button" className="composer-plus" aria-label="Photos and games" onMouseDown={(e) => e.preventDefault()} onClick={plusMenu}><Icon name="plus" /></button>
              <textarea ref={input} className="input" rows={1} maxLength={1000} placeholder="Type a message…" aria-label="Message" value={text}
                onChange={(e) => { setText(e.target.value); const el = e.target; el.style.height = 'auto'; el.style.height = `${Math.min(120, el.scrollHeight)}px`; channel.current?.typing(); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !coarse()) { e.preventDefault(); send(); } }} />
              {/* Keep the keyboard open when tapping Send (see keepKeyboardOnSend in hy-dating.js). */}
              <button className="send" aria-label="Send" disabled={sending} onMouseDown={(e) => e.preventDefault()}><Icon name="send" cls="sm" /></button>
            </form>
          </>
        )}
    </>
  );
}

function back() {
  if (window.history.length > 1) window.history.back();
  else go('matches', { replace: true });
}

// Reveal pill in the chat header: ask, waiting, or "they asked" (hot).
function RevealPill({ convo }: { convo: Convo }) {
  if (convo.blocked || statusOf(convo) !== 'chat' || (convo.i_revealed && convo.they_revealed)) return <span className="head-reveal" />;
  let btn;
  if (convo.they_revealed) btn = <button className="reveal-pill hot" title="They want to reveal identities" onClick={() => doReveal(convo, true)}><Icon name="eye" cls="sm" />Reveal</button>;
  else if (convo.i_revealed) btn = <button className="reveal-pill wait" title="Waiting for them to reveal" onClick={() => openSheet((close) => (<><h2>Reveal requested</h2>
    <p className="muted">You asked to reveal identities. Nothing is shown until they agree too.</p>
    <div className="sheet-actions"><button className="btn btn-soft btn-block" onClick={() => { close(); doReveal(convo, false); }}>Undo request</button><button className="btn btn-primary btn-block" onClick={close}>OK</button></div></>), { label: 'Reveal requested' })}><Icon name="clock" cls="sm" />Requested</button>;
  else btn = <button className="reveal-pill" title="Ask to reveal identities" onClick={() => doReveal(convo, true)}><Icon name="lock" cls="sm" />Reveal</button>;
  return <span className="head-reveal">{btn}</span>;
}

// "Add friend" next to Reveal in match chats (both tapping it turns the chat into a friend chat).
function FriendButton({ convo }: { convo: Convo }) {
  const [askState, setAskState] = useState<string | null>(null);
  const id = convo.conversation_id;
  const eligible = !convo.blocked && !isFriend(convo) && statusOf(convo) === 'chat';
  useEffect(() => {
    if (!eligible) return;
    let alive = true;
    api.friendAskState(id).then((st: any) => { if (!alive) return; if (st === 'friends') loadDating({ force: true }).catch(() => {}); else setAskState(st); }).catch(() => {});
    return () => { alive = false; };
  }, [eligible, id, convo.friendAsk]);
  if (!eligible || !askState) return <span className="head-reveal head-friend" />;
  const who = nameOf(convo);
  const btn = (cls: string, label: string, onClick: () => void) => <button className={`friend-btn ${cls}`.trim()} aria-label={label} title={label} onClick={onClick}><Icon name="userplus" cls="sm" /></button>;
  let el;
  if (askState === 'theirs') el = btn('hot', `${who} wants to add you as a friend`, async () => {
    if (!(await confirmSheet({ title: `${who} wants to be friends`, yes: 'Accept', text: 'This chat moves to Friends and you’ll see each other’s statuses. You both stay anonymous until you reveal.' }))) return;
    await askFriend(convo, true);
  });
  else if (askState === 'mine') el = btn('wait', 'Friend request sent', () => openSheet((close) => (<><h2>Friend request sent</h2>
    <p className="muted">{`Waiting for ${who} to accept. Nothing changes until they do.`}</p>
    <div className="sheet-actions"><button className="btn btn-soft btn-block" onClick={() => { close(); askFriend(convo, false).then(() => setAskState('none')); }}>Cancel request</button><button className="btn btn-primary btn-block" onClick={close}>OK</button></div></>), { label: 'Friend request' }));
  else el = btn('', 'Add as friend', async () => {
    if (!(await confirmSheet({ title: `Add ${who} as a friend?`, yes: 'Send request', text: 'They’ll get a friend request in this chat. If they accept, it moves to Friends and you’ll see each other’s statuses.' }))) return;
    await askFriend(convo, true); setAskState('mine');
  });
  return <span className="head-reveal head-friend">{el}</span>;
}

// One message row; swipe it right to reply.
function MsgRow({ m, mine, gone, canSwipe, onReply, children }: { m: Msg; mine: boolean; gone: boolean; canSwipe: boolean; onReply: () => void; children: React.ReactNode }) {
  const { ref, handlers } = useSwipeReply(onReply, canSwipe);
  return (
    <div ref={ref} className={`msg-row ${mine ? 'me' : 'them'} ${gone ? 'gone' : ''} ${m.pending ? 'pending' : ''}`} data-id={m.id} {...handlers}>
      {!m.pending ? <button className="msg-swipe" aria-label="Reply" tabIndex={-1} onClick={(e) => { e.stopPropagation(); onReply(); }}><Icon name="reply" cls="sm" /></button> : null}
      {children}
      <time dateTime={m.created_at}>{m.edited_at && !gone ? `Edited · ${clock(m.created_at)}` : clock(m.created_at)}</time>
    </div>
  );
}

// A message with a Kickrs challenge link shows as a card with a Play button (open for 10 minutes).
function Body({ m, mine, chatId }: { m: Msg; mine: boolean; chatId: string }) {
  const c = parseChallenge(m.body);
  if (!c) return <>{m.body}</>;
  const open = Date.now() - new Date(m.created_at).getTime() < CHALLENGE_MS;
  const play = (e: React.MouseEvent) => { e.stopPropagation(); go(`games/${c.game}?join=${c.code}&back=${encodeURIComponent(chatId)}`); };
  const again = (e: React.MouseEvent) => { e.stopPropagation(); go(`games/${c.game}?challenge=${encodeURIComponent(chatId)}&back=${encodeURIComponent(chatId)}`); };
  const info = challengeOf(c.game);
  return (
    <span className="kick-card">
      <span className="kc-art" aria-hidden="true">{info.art}</span>
      <span className="kc-text"><b>{info.title}</b><span>{mine ? (open ? 'Challenge sent · waiting for them' : 'Your challenge expired') : open ? 'You’ve been challenged on Kickrs' : 'This challenge expired'}</span></span>
      {!mine && open ? <button type="button" className="btn btn-sm kc-play" onClick={play}>Play</button> : null}
      {!open ? <button type="button" className="btn btn-sm kc-play" onClick={again}>{mine ? 'Send again' : 'Challenge back'}</button> : null}
    </span>
  );
}
