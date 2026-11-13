'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Inbox (port of renderMatches and its tabs in anon-inbox/public/hy-dating.js): Chats, Requests,
// Friends, Matches + Likes you. /home/matches/<chat id> opens the chat on top.
import { ConvoBird } from './Reputation';
import { useEffect, useState, type ReactNode } from 'react';
import * as api from '@/lib/api';
import { state, emit, useAppState, loadDating, statusOf, messageRequests, matchFriendAsks, isMatch, isFriend, friendsList, nameOf, type Convo } from '@/lib/state';
import { INTENT_LABEL } from '@/lib/options';
import { go, openChat } from '@/lib/nav';
import { ago } from '@/lib/util';
import { Icon, Logo, Hero, Avatar, EmptyState } from './ui';
import { toast } from './overlay';
import { BellButton, statusEditor } from './Home';
import { meta, activeText, shortName, acceptRequest, declineRequest, cancelSent, cancelMatchAsk, askFriend, requestMenu, partnerProfile } from './convo';
import Chat from './Chat';

const VIEWS = new Set(['requests', 'chats', 'likes', 'matches', 'friends']);

export default function Inbox({ sub }: { sub: string | null }) {
  const s = useAppState();
  const chatId = sub && !VIEWS.has(sub) ? sub : null;
  const listSub = chatId ? null : sub;
  const view = listSub === 'requests' ? 'requests' : listSub === 'friends' ? 'friends' : (listSub === 'matches' || listSub === 'likes') ? 'matches' : 'chats';
  const live = s.convos.filter((c) => !c.blocked);
  const requests = messageRequests();
  const chats = s.convos.filter((c) => c.blocked ? !!c.last_message : statusOf(c) === 'chat' && !!c.last_message);
  const fresh = live.filter((c) => statusOf(c) === 'chat' && !c.last_message && !isFriend(c));
  const friends = friendsList();
  const friendsOn = friends.filter((f) => f.other_online).length;
  const unread = chats.reduce((n, c) => n + (c.unread ? 1 : 0), 0);

  const tab = (id: string, label: string, ico: string, kind: string, badge: number, extra?: ReactNode) => (
    <button key={id} className={`ib-tab t-${kind}`} role="tab" aria-selected={view === id} onClick={() => { if (view !== id) go(id === 'chats' ? 'matches' : `matches/${id}`); }}>
      <span className="ib-tab-ico"><Icon name={ico} cls={id === 'matches' && view === id ? 'fill' : ''} /></span>
      <span className="ib-tab-label">{label}</span>
      {extra || null}
      {badge ? <span className={`badge ${kind === 'match' ? 'date' : 'talk'}`}>{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  );
  let body: ReactNode;
  if (view === 'requests') body = <RequestsTab requests={requests} />;
  else if (view === 'matches') body = <MatchesTab fresh={fresh} focusLikes={listSub === 'likes'} />;
  else if (view === 'friends') body = <FriendsTab />;
  else body = <ChatsTab chats={chats} live={live} />;
  return (
    <>
      <div className="stack-lg inbox">
        <Hero top={<Logo />} cls="inbox-hero" title="Inbox" sub="Messages, friends, requests and matches." actions={<BellButton />}>
          <div className="ib-tabs" role="tablist" aria-label="Inbox sections">
            {tab('chats', 'Chats', 'chat', 'chat', unread)}
            {tab('requests', 'Requests', 'send', 'req', requests.length + matchFriendAsks().length)}
            {tab('friends', 'Friends', 'rooms', 'friend', 0,
              <span className="ib-tab-count" aria-label={`${friendsOn} of ${friends.length} friends online`}>{friendsOn ? <i className="ib-tab-on" /> : null}{`${friendsOn} / ${friends.length}`}</span>)}
            {tab('matches', 'Matches', 'heart', 'match', fresh.length + s.requests.length)}
          </div>
        </Hero>
        <div className="below-hero ib-body" key={view}>{body}</div>
        <p className="tiny muted center">🎭 Everyone stays anonymous until you both choose to reveal.</p>
      </div>
      {chatId ? <Chat id={chatId} key={chatId} /> : null}
    </>
  );
}

function SearchBox({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (v: string) => void }) {
  return <label className="ib-search"><Icon name="search" cls="sm" /><input type="search" placeholder={placeholder} value={value} aria-label={placeholder} onChange={(e) => onChange(e.target.value)} /></label>;
}

// ---- Chats ------------------------------------------------------------------------------------------
const recent = (c: Convo) => new Date(c.last_at).getTime() || 0;
function chatOrder(a: Convo, b: Convo) {
  const rank = (c: Convo) => (c.blocked ? 2 : c.other_online ? 0 : 1);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (rank(a) === 1) {
    const ha = a.other_active_hours ?? Infinity, hb = b.other_active_hours ?? Infinity;
    if (ha !== hb) return ha - hb;
  }
  return recent(b) - recent(a);
}
let chatQuery = '';
function ChatsTab({ chats, live }: { chats: Convo[]; live: Convo[] }) {
  const [q, setQ] = useState(chatQuery);
  const onlineNow = live.filter((c) => statusOf(c) === 'chat' && c.other_online)
    .sort((a, b) => (isFriend(b) ? 1 : 0) - (isFriend(a) ? 1 : 0) || recent(b) - recent(a));
  const me = state.myStatus;
  const quick = (
    <section>
      <div className="section-head"><h2>Quick view</h2></div>
      <div className="friend-strip ib-quick">
        <button className="fs-item ib-add" onClick={() => statusEditor()} title={me ? me.body : 'Add your status'}>
          <span className="ib-add-av"><Icon name={me ? 'edit' : 'plus'} /></span>
          <span className="fs-name ellipsis">{me ? 'My status' : 'Add status'}</span>
        </button>
        {onlineNow.slice(0, 15).map((c) => (
          <button key={c.conversation_id} className="fs-item on" onClick={() => openChat(c.conversation_id)} title={c.friend_status ? c.friend_status.body : ''}>
            <span className={`fs-av ${isMatch(c) ? 'match' : ''}`}><Avatar seed={c.other_handle} label={nameOf(c)} cls="lg" /><i /></span>
            <span className="fs-name ellipsis">{shortName(nameOf(c))}</span>
          </button>
        ))}
      </div>
      {onlineNow.length ? null : <p className="tiny muted">Nobody you chat with is online right now.</p>}
    </section>
  );
  if (!chats.length) {
    return (
      <div className="stack-lg">{quick}
        <EmptyState emoji="💬" title="No conversations yet" text="Start connecting with people: match in Discover, add friends in Chatrooms, or accept a request.">
          <div className="row center-row">
            <button className="btn btn-coral btn-sm" onClick={() => go('discover')}><Icon name="flame" cls="sm" />Discover</button>
            <button className="btn btn-primary btn-sm" onClick={() => go('rooms')}><Icon name="rooms" cls="sm" />Chatrooms</button>
          </div>
        </EmptyState>
      </div>
    );
  }
  const query = q.trim().toLowerCase();
  const list = chats.filter((c) => !query || nameOf(c).toLowerCase().includes(query) || c.other_handle.toLowerCase().includes(query) || (c.last_message || '').toLowerCase().includes(query));
  return (
    <div className="stack-lg">{quick}
      <section className="stack">
        <div className="section-head"><h2>Recent chats</h2><span className="small muted">{`${chats.length} chat${chats.length === 1 ? '' : 's'}`}</span></div>
        {chats.length > 3 ? <SearchBox placeholder="Search conversations" value={q} onChange={(v) => { chatQuery = v; setQ(v); }} /> : null}
        {list.length ? <ChatList list={list} /> : <div className="card ib-empty"><p>No chats match your search.</p></div>}
      </section>
    </div>
  );
}
function ChatList({ list }: { list: Convo[] }) {
  const sorted = [...list].sort(chatOrder);
  const online = sorted.filter((c) => !c.blocked && c.other_online);
  const rest = sorted.filter((c) => c.blocked || !c.other_online);
  const label = (text: string, n?: number) => <div className="ib-group"><span>{text}</span>{n != null ? <span className="ib-group-n">{String(n)}</span> : null}</div>;
  return (
    <div className="card ib-list">
      {online.length ? label('Online now', online.length) : null}
      {online.map((c) => <ConvoRow key={c.conversation_id} c={c} />)}
      {online.length && rest.length ? label('Other chats') : null}
      {rest.map((c) => <ConvoRow key={c.conversation_id} c={c} lastActive />)}
    </div>
  );
}
function ConvoRow({ c, lastActive = false }: { c: Convo; lastActive?: boolean }) {
  const st = statusOf(c);
  const away = lastActive && !c.blocked && !c.other_online ? activeText(false, c.other_active_hours) : null;
  const preview = c.blocked ? 'Chat closed' : `${c.last_from_me ? 'You: ' : ''}${c.last_message || (isMatch(c) ? 'You matched. Say hi 👋' : isFriend(c) ? 'You’re friends. Say hi 👋' : 'Say hi 👋')}`;
  const seen = !c.blocked && c.last_from_me && c.other_read_at && new Date(c.other_read_at) >= new Date(c.last_at);
  const delivered = !seen && !c.blocked && c.last_from_me && c.other_delivered_at && new Date(c.other_delivered_at) >= new Date(c.last_at);
  return (
    <button className={`ib-row ${c.unread ? 'unread' : ''} ${c.blocked ? 'closed' : ''}`} onClick={() => openChat(c.conversation_id)}>
      <span className="ib-av"><Avatar seed={c.other_handle} label={nameOf(c)} cls="lg" />{c.other_online && !c.blocked ? <i className="on" /> : null}</span>
      <span className="grow">
        <span className="row-between">
          <b><span className="ellipsis">{nameOf(c)}</span>{isMatch(c) ? <span className="ib-match" title="Match"><Icon name="heart" cls="fill" /></span> : isFriend(c) ? <span className="ib-friend" title="Friend">👋</span> : null}</b>
          <span className="when">{ago(c.last_at)}</span>
        </span>
        <span className="row-between">
          <span className="preview">
            {c.last_from_me && !c.blocked && !seen ? <span className={`tick ${delivered ? 'delivered' : ''}`} aria-label={delivered ? 'Delivered' : 'Sent'}><Icon name={delivered ? 'delivered' : 'sent'} cls="sm" /></span> : null}
            <span className="ellipsis">{preview}</span>
          </span>
          {c.unread ? <span className="badge talk">{c.unread}</span> : st === 'sent' ? <span className="pill">Pending</span>
            : seen ? <span className="list-seen" aria-label="Seen"><Avatar seed={c.other_handle} cls="xs" /></span> : null}
        </span>
        {away ? <span className="ib-away">{away}</span> : null}
      </span>
    </button>
  );
}

// ---- Requests ---------------------------------------------------------------------------------------
let reqChoice: 'friend' | 'message' | null = null;
function RequestsTab({ requests }: { requests: Convo[] }) {
  const sent = state.convos.filter((c) => !c.blocked && statusOf(c) === 'sent');
  const askIn = matchFriendAsks();
  const askOut = state.convos.filter((c) => !c.blocked && c.friendAsk === 'mine' && !isFriend(c));
  const inFriend = [...requests.filter(isFriend), ...askIn], inMsg = requests.filter((c) => !isFriend(c));
  const sentFriend = [...sent.filter(isFriend), ...askOut], sentMsg = sent.filter((c) => !isFriend(c));
  const [reqView, setReqView] = useState<'friend' | 'message'>(reqChoice || (inFriend.length || (!inMsg.length && sentFriend.length) ? 'friend' : 'message'));
  const friend = reqView === 'friend';
  const incoming = friend ? inFriend : inMsg, out = friend ? sentFriend : sentMsg;
  const seg = (id: 'friend' | 'message', label: string, ico: string, n: number) => (
    <button className={`ib-subtab t-${id}`} role="tab" aria-selected={reqView === id} onClick={() => { reqChoice = id; setReqView(id); }}>
      <Icon name={ico} cls="sm" />{label}{n ? <span className="badge talk">{n}</span> : null}
    </button>
  );
  return (
    <div className="stack-lg">
      <div className="ib-subtabs" role="tablist" aria-label="Request type">{seg('friend', 'Friends', 'userplus', inFriend.length)}{seg('message', 'Messages', 'mail', inMsg.length)}</div>
      <div className="ib-note"><span>{friend ? '👋' : '✉️'}</span><span>{friend
        ? 'Accepting a friend request makes you friends: you see each other’s status and can chat. Opening a request doesn’t accept it.'
        : 'Accepting a message request lets you chat, but doesn’t make you friends. They can’t see that you’ve opened it.'}</span></div>
      <section className="stack">
        <div className="section-head"><h2>{friend ? 'Friend requests' : 'Message requests'}</h2>{incoming.length ? <span className="small muted">{`${incoming.length} waiting`}</span> : null}</div>
        {incoming.length ? <div className="list">{incoming.map((c) => (c.friendAsk === 'theirs' ? <MatchAskCard key={c.conversation_id} c={c} /> : <RequestCard key={c.conversation_id} c={c} />))}</div>
          : <div className="card ib-empty"><p>You’re all caught up. New requests will appear here.</p>
            {friend ? <button className="btn btn-primary btn-sm" onClick={() => go('rooms')}><Icon name="rooms" cls="sm" />Meet people in Chatrooms</button> : null}</div>}
      </section>
      {out.length ? (
        <section className="stack">
          <div className="section-head"><h2>You sent</h2><span className="small muted">{`${out.length} pending`}</span></div>
          <div className="card ib-list">{out.map((c) => (
            <div key={c.conversation_id} className="sent-row"><ConvoRow c={c} />
              {c.friendAsk === 'mine' ? <span className="pill friend sent-pending">Pending</span> : null}
              <button className="btn btn-ghost btn-sm sent-cancel" aria-label={`Cancel your request to ${c.other_handle}`} onClick={() => (c.friendAsk === 'mine' ? cancelMatchAsk(c) : cancelSent(c))}>Cancel</button>
            </div>
          ))}</div>
        </section>
      ) : null}
    </div>
  );
}
function BusyButton({ cls, onClick, children, label }: { cls: string; onClick: () => Promise<unknown>; children: ReactNode; label?: string }) {
  const [busy, setBusy] = useState(false);
  return <button className={cls} aria-label={label} disabled={busy} onClick={async () => { setBusy(true); try { await onClick(); } finally { setBusy(false); } }}>{children}</button>;
}
function MatchAskCard({ c }: { c: Convo }) {
  return (
    <article className="req-card">
      <button className="req-top" onClick={() => openChat(c.conversation_id)} aria-label={`Open your chat with ${nameOf(c)}`}>
        <span className="ib-av"><Avatar seed={c.other_handle} label={nameOf(c)} cls="lg" />{c.other_online ? <i className="on" /> : null}</span>
        <span className="grow">
          <span className="row-between"><b className="ellipsis">{nameOf(c)}<span className="pill friend">👋 Friend</span></b><span className="when">{ago(c.last_at)}</span></span>
          <span className="req-meta">Your match wants to be friends</span>
        </span>
      </button>
      <div className="req-actions">
        <BusyButton cls="btn btn-primary btn-sm" onClick={() => askFriend(c, true)}><Icon name="check" cls="sm" />Accept</BusyButton>
        <BusyButton cls="btn btn-ghost btn-sm" onClick={async () => {
          try { await api.askFriend(c.conversation_id, false); await loadDating({ force: true }); toast('Friend request declined', 'x'); }
          catch (e) { toast(api.friendly(e), 'x'); }
        }}>Decline</BusyButton>
      </div>
    </article>
  );
}
function RequestCard({ c }: { c: Convo }) {
  return (
    <article className={`req-card ${c.unread ? 'unread' : ''}`}>
      <button className="req-top" onClick={() => openChat(c.conversation_id)} aria-label={`Open request from ${c.other_handle}`}>
        <span className="ib-av"><Avatar seed={c.other_handle} cls="lg" />{c.other_online ? <i className="on" /> : null}</span>
        <span className="grow">
          <span className="row-between"><b className="ellipsis">{c.other_handle}<span className={`pill ${isFriend(c) ? 'friend' : 'msg'}`}>{isFriend(c) ? '👋 Friend' : '✉️ Message'}</span></b><span className="when">{ago(c.last_at)}</span></span>
          <span className="req-meta">{meta({ age: c.other_age, gender: c.other_gender, location: c.other_location })}{c.other_intent ? ` · ${INTENT_LABEL[c.other_intent]}` : ''}</span>
        </span>
      </button>
      {c.last_message ? <p className="req-msg">{c.last_message}</p> : null}
      <div className="req-actions">
        <BusyButton cls="btn btn-primary btn-sm" onClick={() => acceptRequest(c)}><Icon name="check" cls="sm" />Accept</BusyButton>
        <BusyButton cls="btn btn-ghost btn-sm" onClick={() => declineRequest(c)}>Decline</BusyButton>
        <button className="btn btn-ghost btn-sm btn-icon" aria-label="More options" onClick={() => requestMenu(c)}><Icon name="more" /></button>
      </div>
    </article>
  );
}

// ---- Friends ----------------------------------------------------------------------------------------
let friendFilter: 'all' | 'online' = 'all', friendQuery = '';
function FriendsTab() {
  const all = friendsList();
  const online = all.filter((f) => f.other_online);
  const [filter, setFilter] = useState(friendFilter);
  const [q, setQ] = useState(friendQuery);
  if (!all.length) {
    return (
      <div className="stack-lg">
        <EmptyState emoji="👋" title="No friends yet" text="Meet people in your chatrooms and send friend requests: tap someone’s name, then Add friend.">
          <button className="btn btn-primary" onClick={() => go('rooms')}><Icon name="rooms" cls="sm" />Go to Chatrooms</button>
        </EmptyState>
      </div>
    );
  }
  const query = q.trim().toLowerCase();
  const list = (filter === 'online' ? online : all).filter((f) => !query || nameOf(f).toLowerCase().includes(query) || f.other_handle.toLowerCase().includes(query))
    .slice().sort((a, b) => (b.other_online ? 1 : 0) - (a.other_online ? 1 : 0) || (a.other_active_hours ?? 1e9) - (b.other_active_hours ?? 1e9));
  const chip = (id: 'all' | 'online', label: string) => <button className={`chip ${filter === id ? 'on' : ''}`} onClick={() => { friendFilter = id; setFilter(id); }}>{label}</button>;
  return (
    <div className="stack-lg">
      <div className="card friends-sum">
        <div className="fsum"><b>{String(all.length)}</b><span>{all.length === 1 ? 'Friend' : 'Friends'}</span></div>
        <div className="fsum on"><b><i />{String(online.length)}</b><span>Online</span></div>
        <div className="chips">{chip('all', 'All')}{chip('online', 'Online')}</div>
      </div>
      <SearchBox placeholder="Search friends" value={q} onChange={(v) => { friendQuery = v; setQ(v); }} />
      {list.length ? <div className="card ib-list friend-list">{list.map((f) => <FriendRow key={f.conversation_id} f={f} />)}</div>
        : <div className="card ib-empty"><p>{query ? 'No friend by that name.' : 'None of your friends are online right now.'}</p></div>}
      <FriendActivity all={all} />
    </div>
  );
}
function FriendActivity({ all }: { all: Convo[] }) {
  const items: { at: string; f: Convo; kind: 'status' | 'friends' }[] = [];
  for (const f of all) {
    if (f.friend_status) items.push({ at: f.friend_status.updated_at, f, kind: 'status' });
    if (f.accepted_at) items.push({ at: f.accepted_at, f, kind: 'friends' });
  }
  if (!items.length) return null;
  items.sort((a, b) => +new Date(b.at) - +new Date(a.at));
  return (
    <section className="stack"><div className="section-head"><h2>Friend activity</h2></div>
      <div className="card ib-list">{items.slice(0, 6).map(({ f, kind, at }) => (
        <button key={`${kind}${f.conversation_id}`} className="ib-row fa-row" onClick={() => (kind === 'status' ? partnerProfile(f) : openChat(f.conversation_id))}>
          <span className={`fa-ico ${kind}`}><Icon name={kind === 'status' ? 'chat' : 'userplus'} /></span>
          <span className="grow">
            <span className="row-between"><b><span className="ellipsis">{kind === 'status' ? `${nameOf(f)} updated their status` : `You and ${nameOf(f)} are now friends`}</span></b><span className="when">{ago(at)}</span></span>
            <span className="preview"><span className="ellipsis">{kind === 'status' ? `“${f.friend_status.body}”` : f.last_message ? 'Tap to open your chat' : 'Say hi 👋'}</span></span>
          </span>
        </button>
      ))}</div>
    </section>
  );
}
function FriendRow({ f }: { f: Convo }) {
  const st = f.friend_status;
  const sub = st ? `“${st.body}”` : f.other_online ? 'Online now' : activeText(false, f.other_active_hours) || 'Offline';
  return (
    <div className="friend-row">
      <button className="fr-main" onClick={() => partnerProfile(f)} aria-label={`${nameOf(f)}’s profile`}>
        <span className="ib-av"><Avatar seed={f.other_handle} label={nameOf(f)} cls="lg" />{f.other_online ? <i className="on" /> : null}</span>
        <span className="grow"><b className="ellipsis">{nameOf(f)}</b>
          <span className={`fr-sub ellipsis ${st ? 'status' : ''}`}>{sub}</span>
          {st && !f.other_online ? <span className="fr-away">{activeText(false, f.other_active_hours)}</span> : null}
          <ConvoBird id={f.conversation_id} /></span>
      </button>
      <button className="btn btn-soft btn-sm fr-msg" onClick={() => openChat(f.conversation_id)} aria-label={`Message ${nameOf(f)}`}><Icon name="chat" cls="sm" /><span className="fr-msg-t">Message</span></button>
    </div>
  );
}

// ---- Matches + Likes you ---------------------------------------------------------------------------
function MatchesTab({ fresh, focusLikes }: { fresh: Convo[]; focusLikes: boolean }) {
  const matches = state.convos.filter((c) => !c.blocked && statusOf(c) === 'chat' && isMatch(c));
  useEffect(() => {
    if (!focusLikes) return;
    const t = setTimeout(() => document.getElementById('likes-you')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
    return () => clearTimeout(t);
  }, [focusLikes]);
  return (
    <div className="stack-lg">
      {fresh.length ? (
        <section><div className="section-head"><h2>New connections</h2><span className="small muted">Say hi first</span></div>
          <div className="story-row">{fresh.map((c) => (
            <button key={c.conversation_id} className="story new" onClick={() => openChat(c.conversation_id)}>
              <span className="story-av"><Avatar seed={c.other_handle} cls="lg" /><span className="heart-dot"><Icon name={isMatch(c) ? 'heart' : 'check'} cls="fill" /></span></span>
              <span>{shortName(c.other_handle)}</span>
            </button>
          ))}</div>
        </section>
      ) : null}
      <section id="likes-you"><div className="section-head"><h2>Likes you</h2>{state.requests.length ? <span className="pill date">{state.requests.length}</span> : null}</div><Likes /></section>
      <section><div className="section-head"><h2>Your matches</h2><span className="small muted">You both liked each other</span></div>
        {matches.length ? <div className="card ib-list">{matches.map((c) => <ConvoRow key={c.conversation_id} c={c} />)}</div>
          : <div className="card ib-empty"><p>No matches yet. Keep discovering people: when you both like each other, you’ll match.</p>
            <button className="btn btn-coral btn-sm" onClick={() => go('discover')}><Icon name="flame" cls="sm" />Go to Discover</button></div>}
      </section>
    </div>
  );
}
function Likes() {
  if (!api.features.matching) return <EmptyState emoji="💘" title="Likes are switching on" text="Soon, people who like you will show up here." />;
  if (!state.requests.length) return <div className="card ib-empty"><p>No likes yet. When someone likes you, their anonymous card shows up here. Like them back to match.</p></div>;
  return (
    <div className="list">{state.requests.map((r: any) => (
      <article key={r.handle} className="like-card">
        <div className="row"><Avatar seed={r.handle} cls="lg" />
          <div className="grow"><h3 className="ellipsis">{r.handle}</h3><p className="small muted">{meta(r)}</p><p className="tiny muted">{`Liked you ${ago(r.requested_at)} ago`}</p></div>
          <span className="pill date">{INTENT_LABEL[r.intent]}</span></div>
        {r.bio ? <p className="like-bio">{r.bio}</p> : null}
        {r.interests && r.interests.length ? <div className="chips">{r.interests.slice(0, 4).map((i: string) => <span key={i} className="chip static">{i}</span>)}</div> : null}
        <div className="request-actions">
          <BusyButton cls="btn btn-ghost btn-sm" onClick={() => answer(r, false)}>Pass</BusyButton>
          <BusyButton cls="btn btn-coral btn-sm" onClick={() => answer(r, true)}><Icon name="heart" cls="sm" />Like back</BusyButton>
        </div>
      </article>
    ))}</div>
  );
}
export async function answer(r: any, accept: boolean) {
  try {
    const res = await api.likeProfile(r.handle, accept);
    state.requests = state.requests.filter((x) => x.handle !== r.handle);
    if (accept && res.conversation_id) { await loadDating({ force: true }); toast(`It’s a match with ${shortName(r.handle)}! 💘`, 'heart'); openChat(res.conversation_id); }
    else toast('Passed', 'x');
    emit('dating');
  } catch (e) { toast(api.friendly(e), 'x'); }
}
