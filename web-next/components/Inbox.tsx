'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Inbox: a hub (Chats, Matches, Friends, Nearby, Requests, Updates + Who’s Online) and one screen for
// each. /home/matches/<chats|matches|likes|friends|nearby|requests|announcements|online> opens a screen;
// /home/matches/<chat id> opens a chat on top; /home/matches/announcements/<id> opens one announcement.
import { previewOf } from './Birthday';
import { useState, type ReactNode } from 'react';
import * as api from '@/lib/api';
import { state, emit, useAppState, loadDating, statusOf, messageRequests, matchFriendAsks, isMatch, isFriend, isNearby, friendsList, nameOf, type Convo } from '@/lib/state';
import { INTENT_LABEL } from '@/lib/options';
import { go, openChat } from '@/lib/nav';
import { ago } from '@/lib/util';
import { Icon, Logo, Hero, Avatar, EmptyState, SkeletonList } from './ui';
import { toast, openSheet, confirmSheet } from './overlay';
import { BellButton, statusEditor } from './Home';
import { meta, activeText, shortName, acceptRequest, declineRequest, cancelSent, cancelMatchAsk, askFriend, requestMenu, partnerProfile } from './convo';
import Chat from './Chat';
import AdSlot from './AdSlot';
import { addFriendSheet } from './Username';
import { AnnouncementsTab, AnnDetail } from './Announcements';

const VIEWS = new Set(['requests', 'chats', 'likes', 'matches', 'friends', 'announcements', 'nearby', 'online']);
type View = 'hub' | 'chats' | 'matches' | 'friends' | 'nearby' | 'requests' | 'announcements' | 'online';

// The Inbox is a hub: Chats (every private conversation), then Matches, Friends, Nearby, Requests and
// Updates. They are views of the same conversations: one chat can be a friend, a match AND a Nearby
// chat at once (each comes from its own system) and still appears once in All Chats.
export default function Inbox({ sub, item = null }: { sub: string | null; item?: string | null }) {
  const s = useAppState();
  const chatId = sub && !VIEWS.has(sub) ? sub : null;
  const listSub = chatId ? null : sub;
  const view: View = !listSub ? 'hub' : listSub === 'likes' ? 'matches' : (listSub as View);
  if (view === 'announcements' && item) return <AnnDetail id={item} key={item} />;
  let body: ReactNode;
  if (view === 'chats') body = <ChatsScreen />;
  else if (view === 'matches') body = <MatchesScreen focusLikes={listSub === 'likes'} />;
  else if (view === 'friends') body = <FriendsScreen />;
  else if (view === 'nearby') body = <NearbyScreen />;
  else if (view === 'requests') body = <SubScreen title="Requests" sub="Friend requests and message requests."><RequestsTab requests={messageRequests()} /></SubScreen>;
  else if (view === 'announcements') body = <SubScreen title="Updates" sub="Official news from treehouse."><AnnouncementsTab /></SubScreen>;
  else if (view === 'online') body = <OnlineScreen />;
  else body = <Hub />;
  return (
    <>
      <div className="stack-lg inbox" key={view}>
        {body}
        {s.convosFailing && view !== 'announcements' ? <div className="ib-reconnect" role="status"><span className="ib-spin" aria-hidden="true" />Reconnecting… your chats are safe and will update in a moment.</div> : null}
        <p className="tiny muted center">🎭 Everyone stays anonymous until you both choose to reveal.</p>
      </div>
      {chatId ? <Chat id={chatId} key={chatId} /> : null}
    </>
  );
}

// ---- Shared lists -----------------------------------------------------------------------------------
const recent = (c: Convo) => new Date(c.last_at).getTime() || 0;
// Hydra's order (15 Nov): unread chats first (online or not, newest first); once read, people online
// now, then everyone else by who was online most recently.
const seenAgo = (c: Convo) => (c.other_online ? -1 : (c.other_active_hours ?? 1e9));
const byInbox = (a: Convo, b: Convo) => {
  const ua = a.unread && !a.blocked ? 1 : 0, ub = b.unread && !b.blocked ? 1 : 0;
  if (ua !== ub) return ub - ua;
  if (ua) return recent(b) - recent(a);
  return seenAgo(a) - seenAgo(b) || recent(b) - recent(a);
};
/** Private conversations you can open (accepted chats with messages, plus closed ones with history). */
const allChats = () => state.convos.filter((c) => (c.blocked ? !!c.last_message : statusOf(c) === 'chat' && !!c.last_message));
const live = () => state.convos.filter((c) => !c.blocked && statusOf(c) === 'chat');
const onlineContacts = () => live().filter((c) => c.other_online)
  .sort((a, b) => (isFriend(b) ? 1 : 0) - (isFriend(a) ? 1 : 0) || recent(b) - recent(a));
const nearbyChats = () => allChats().filter((c) => !c.blocked && isNearby(c));
const newMatchList = () => live().filter((c) => isMatch(c) && !c.last_message);
const unreadIn = (list: Convo[]) => list.filter((c) => !c.blocked && c.unread).length;
const n99 = (n: number) => (n > 99 ? '99+' : String(n));

function SubScreen({ title, sub, actions, children }: { title: string; sub?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <Hero cls="inbox-hero ih-sub" me={false} top={
        <div className="ih-subtop">
          <button className="hero-btn" aria-label="Back to Inbox" onClick={() => go('matches')}><Icon name="back" /></button>
          <h1>{title}</h1>
        </div>} actions={actions}>
        {sub ? <p className="ih-subline">{sub}</p> : null}
      </Hero>
      <div className="below-hero ib-body stack-lg">{children}</div>
    </>
  );
}

// ---- Inbox home ---------------------------------------------------------------------------------------
function Hub() {
  const s = useAppState();
  const chats = allChats();
  const friends = friendsList();
  const friendsOn = friends.filter((f) => f.other_online).length;
  const nearUnread = unreadIn(nearbyChats());
  const reqs = messageRequests().length + matchFriendAsks().length;
  const matchNew = newMatchList().length + s.requests.length;
  const card = (to: string, cls: string, ico: string, title: string, desc: ReactNode, badge: number, aria?: string) => (
    <button className={`ih-card ${cls}`} onClick={() => go(to)} aria-label={aria}>
      <span className="ih-ico"><Icon name={ico} /></span>
      <span className="ih-text"><b>{title}</b><span>{desc}</span></span>
      {badge ? <span className="badge">{n99(badge)}</span> : null}
      {cls.includes('wide') ? <span className="ih-chev"><Icon name="chev" /></span> : null}
    </button>
  );
  return (
    <>
      <Hero top={<Logo />} cls="inbox-hero" title="Inbox" sub="All your conversations, connections and updates." actions={<BellButton />}>
        <nav className="ih-grid" aria-label="Inbox">
          {card('matches/chats', 'ih-chats wide', 'chat', 'Chats', 'All conversations', unreadIn(chats))}
          {card('matches/matches', 'ih-match', 'heart', 'Matches', 'Dating & match chats', matchNew)}
          {card('matches/friends', 'ih-friend', 'rooms', 'Friends', friends.length ? <><i className={`ih-dot ${friendsOn ? 'on' : ''}`} />{`${friendsOn} online`}</> : 'Your accepted friends', 0,
            `Friends, ${friendsOn} online`)}
          {card('matches/nearby', 'ih-near', 'pin', 'Nearby', 'People you met nearby', nearUnread)}
          {card('matches/requests', 'ih-req', 'send', 'Requests', 'Friends & messages', reqs)}
          {card('matches/announcements', 'ih-ann wide', 'megaphone', 'Updates', 'Official news from treehouse', s.annUnread)}
        </nav>
      </Hero>
      <div className="below-hero ib-body stack-lg">
        {s.convosLoaded ? <WhoOnline /> : <SkeletonList n={2} />}
      </div>
    </>
  );
}

/** Who's Online: my status first, then online friends and chats. Shown on the Inbox and on Chats. */
function WhoOnline() {
  const online = onlineContacts();
  const me = state.myStatus;
  return (
    <section className="ih-online">
      <div className="section-head">
        <h2>Who’s Online</h2>
        <span className="ih-count"><i className="ih-dot on" />{`${online.length} online`}</span>
        {online.length ? <button className="link-btn ih-seeall" onClick={() => go('matches/online')}>See all<Icon name="chev" cls="sm" /></button> : null}
      </div>
      <div className="friend-strip ib-quick">
        <button className="fs-item ib-add" onClick={() => statusEditor()} title={me ? me.body : 'Add your status'}>
          <span className="ib-add-av"><Icon name={me ? 'edit' : 'plus'} /></span>
          <span className="fs-name ellipsis">My status</span>
        </button>
        {online.slice(0, 15).map((c) => (
          <button key={c.conversation_id} className="fs-item on" onClick={() => openChat(c.conversation_id)} title={c.friend_status ? c.friend_status.body : ''}>
            <span className={`fs-av ${isMatch(c) ? 'match' : ''}`}><Avatar seed={c.other_handle} label={nameOf(c)} cls="lg" /><i /></span>
            <span className="fs-name ellipsis">{shortName(nameOf(c))}</span>
          </button>
        ))}
      </div>
      {online.length ? null : <p className="tiny muted">Nobody you chat with is online right now.</p>}
    </section>
  );
}

function OnlineScreen() {
  useAppState();
  const online = onlineContacts();
  return (
    <SubScreen title="Who’s Online" sub={`${online.length} of your chats and friends are online now.`}>
      {online.length ? <div className="card ib-list">{online.map((c) => <ConvoRow key={c.conversation_id} c={c} />)}</div>
        : <EmptyState emoji="🌙" title="Nobody’s online right now" text="When your friends and the people you chat with come online, they’ll show up here." />}
    </SubScreen>
  );
}

function SearchBox({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (v: string) => void }) {
  return <label className="ib-search"><Icon name="search" cls="sm" /><input type="search" placeholder={placeholder} value={value} aria-label={placeholder} onChange={(e) => onChange(e.target.value)} /></label>;
}
const matchQ = (c: Convo, q: string) => !q || nameOf(c).toLowerCase().includes(q) || c.other_handle.toLowerCase().includes(q) || (c.last_message || '').toLowerCase().includes(q);

/** Long lists show 40 at a time ("Show more"). */
function Paged({ list, render }: { list: Convo[]; render: (c: Convo) => ReactNode }) {
  const [n, setN] = useState(40);
  return (
    <>
      <div className="card ib-list">{list.slice(0, n).map(render)}</div>
      {list.length > n ? <button className="btn btn-soft btn-block" onClick={() => setN(n + 40)}>{`Show more (${list.length - n})`}</button> : null}
    </>
  );
}

// ---- Chats ------------------------------------------------------------------------------------------
type Filter = 'all' | 'friends' | 'matches' | 'nearby';
let chatFilter: Filter = 'all', chatQuery = '';
function ChatsScreen() {
  const s = useAppState();
  const [f, setF] = useState<Filter>(chatFilter);
  const [q, setQ] = useState(chatQuery);
  const [searching, setSearching] = useState(!!chatQuery);
  const all = allChats().sort(byInbox);
  const lists: Record<Filter, Convo[]> = {
    all, friends: all.filter(isFriend), matches: all.filter(isMatch), nearby: all.filter(isNearby),
  };
  const query = q.trim().toLowerCase();
  const list = lists[f].filter((c) => matchQ(c, query));
  const chip = (id: Filter, label: string) => (
    <button key={id} role="tab" aria-selected={f === id} className={`ih-filter f-${id}`} onClick={() => { chatFilter = id; setF(id); }}>
      {label}{unreadIn(lists[id]) ? <span className="ih-fn">{n99(unreadIn(lists[id]))}</span> : null}
    </button>
  );
  const empty: Record<Filter, [string, string, string]> = {
    all: ['💬', 'No conversations yet', 'Start connecting: match in Discover, add friends in Chatrooms, or accept a request.'],
    friends: ['👋', 'No friend chats yet', 'Chats with people who accepted your friend request (or whose request you accepted) appear here.'],
    matches: ['💘', 'No match chats yet', 'When you and someone both like each other, your chat appears here.'],
    nearby: ['📍', 'No Nearby chats yet', 'Conversations you start with people discovered through Nearby will appear here.'],
  };
  return (
    <SubScreen title="Chats" actions={<>
      <button className="hero-btn" aria-label="Search chats" aria-pressed={searching} onClick={() => setSearching(!searching)}><Icon name="search" /></button>
      <button className="hero-btn" aria-label="Start a new chat" onClick={newChatSheet}><Icon name="edit" /></button>
    </>}>
      <div className="ih-filters" role="tablist" aria-label="Show chats">{chip('all', 'All Chats')}{chip('friends', 'Friends')}{chip('matches', 'Matches')}{chip('nearby', 'Nearby')}</div>
      {searching ? <SearchBox placeholder="Search conversations" value={q} onChange={(v) => { chatQuery = v; setQ(v); }} /> : null}
      {f === 'all' && !query ? <WhoOnline /> : null}
      {f === 'all' && !query ? <AdSlot placement="inbox" /> : null}
      <section className="stack">
        <div className="section-head"><h2>{f === 'all' ? 'All Conversations' : f === 'friends' ? 'Friend Chats' : f === 'matches' ? 'Match Chats' : 'Nearby Chats'}</h2>
          <span className="small muted">{`(${lists[f].length})`}</span></div>
        {!s.convosLoaded ? <SkeletonList n={5} />
          : list.length ? <Paged list={list} render={(c) => <ConvoRow key={c.conversation_id} c={c} />} />
          : query ? <div className="card ib-empty"><p>No chats match your search.</p></div>
          : <EmptyState emoji={empty[f][0]} title={empty[f][1]} text={empty[f][2]}>
              {f === 'nearby' ? <button className="btn btn-primary btn-sm" onClick={() => go('discover/nearby')}><Icon name="pin" cls="sm" />Explore Nearby</button>
                : f === 'friends' ? <button className="btn btn-primary btn-sm" onClick={() => go('rooms')}><Icon name="rooms" cls="sm" />Chatrooms</button>
                : <button className="btn btn-coral btn-sm" onClick={() => go('discover')}><Icon name="flame" cls="sm" />Discover</button>}
            </EmptyState>}
      </section>
    </SubScreen>
  );
}
function newChatSheet() {
  openSheet((close) => (
    <>
      <h2>Start a new chat</h2>
      <p className="small muted">On treehouse, chats start with a request, a match or a friendship, so nobody gets messages they didn’t agree to.</p>
      <div className="menu-list" style={{ marginTop: '10px' }}>
        <button className="menu-item" onClick={() => { close(); go('matches/friends'); }}><Icon name="rooms" />Message a friend</button>
        <button className="menu-item" onClick={() => { close(); addFriendSheet(); }}><Icon name="userplus" />Add a friend by username</button>
        <button className="menu-item" onClick={() => { close(); go('discover'); }}><Icon name="flame" />Find someone in Discover</button>
        <button className="menu-item" onClick={() => { close(); go('discover/nearby'); }}><Icon name="pin" />Meet people Nearby</button>
        <button className="menu-item" onClick={() => { close(); go('rooms'); }}><Icon name="userplus" />Add friends in Chatrooms</button>
      </div>
    </>
  ), { label: 'Start a new chat' });
}
/** Small labels: where this relationship comes from (a chat can have more than one). */
function RelTags({ c }: { c: Convo }) {
  return (
    <span className="ih-tags">
      {isMatch(c) ? <span className="ib-match" title="Match" aria-label="Match"><Icon name="heart" cls="fill" /></span> : null}
      {isFriend(c) ? <span className="ib-friend" title="Friend" aria-label="Friend">👋</span> : null}
      {isNearby(c) ? <span className="ih-near-tag" title="Met on Nearby" aria-label="Nearby"><Icon name="pin" cls="sm" /></span> : null}
    </span>
  );
}
function ConvoRow({ c, lastActive = false }: { c: Convo; lastActive?: boolean }) {
  const st = statusOf(c);
  const away = lastActive && !c.blocked && !c.other_online ? activeText(false, c.other_active_hours) : null;
  const preview = c.blocked ? 'Chat closed' : `${c.last_from_me ? 'You: ' : ''}${previewOf(c.last_message) || (isMatch(c) ? 'You matched. Say hi 👋' : isFriend(c) ? 'You’re friends. Say hi 👋' : 'Say hi 👋')}`;
  const seen = !c.blocked && c.last_from_me && c.other_read_at && new Date(c.other_read_at) >= new Date(c.last_at);
  const delivered = !seen && !c.blocked && c.last_from_me && c.other_delivered_at && new Date(c.other_delivered_at) >= new Date(c.last_at);
  return (
    <button className={`ib-row ${c.unread ? 'unread' : ''} ${c.blocked ? 'closed' : ''}`} onClick={() => openChat(c.conversation_id)}>
      <span className="ib-av"><Avatar seed={c.other_handle} label={nameOf(c)} cls="lg" />{c.other_online && !c.blocked ? <i className="on" /> : null}</span>
      <span className="grow">
        <span className="row-between">
          <b><span className="ellipsis">{nameOf(c)}</span><RelTags c={c} /></b>
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

// ---- Nearby -----------------------------------------------------------------------------------------
let nearQuery = '';
function NearbyScreen() {
  const s = useAppState();
  const [q, setQ] = useState(nearQuery);
  const chats = nearbyChats().sort(byInbox);
  const waiting = state.convos.filter((c) => !c.blocked && statusOf(c) === 'sent' && isNearby(c));
  const incoming = messageRequests().filter(isNearby).length;
  const query = q.trim().toLowerCase();
  const list = chats.filter((c) => matchQ(c, query));
  return (
    <SubScreen title="Nearby" sub="Conversations with people you’ve discovered nearby.">
      {incoming ? <button className="ib-note ih-note-btn" onClick={() => go('matches/requests')}><span>📩</span><span>{`${incoming} Nearby message request${incoming === 1 ? '' : 's'} waiting in Requests`}</span><Icon name="chev" cls="sm" /></button> : null}
      {chats.length > 3 ? <SearchBox placeholder="Search Nearby chats" value={q} onChange={(v) => { nearQuery = v; setQ(v); }} /> : null}
      {!s.convosLoaded ? <SkeletonList n={4} />
        : list.length ? <Paged list={list} render={(c) => <ConvoRow key={c.conversation_id} c={c} lastActive />} />
        : query ? <div className="card ib-empty"><p>No Nearby chats match your search.</p></div>
        : <EmptyState emoji="📍" title="No Nearby chats yet" text="Conversations you start with people discovered through Nearby will appear here.">
            <button className="btn btn-primary btn-sm" onClick={() => go('discover/nearby')}><Icon name="pin" cls="sm" />Explore Nearby</button>
          </EmptyState>}
      {waiting.length ? (
        <section className="stack">
          <div className="section-head"><h2>Waiting for a reply</h2><span className="small muted">{`${waiting.length} pending`}</span></div>
          <div className="card ib-list">{waiting.map((c) => <ConvoRow key={c.conversation_id} c={c} />)}</div>
        </section>
      ) : null}
    </SubScreen>
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
      {c.last_message ? <p className="req-msg">{previewOf(c.last_message)}</p> : null}
      <div className="req-actions">
        <BusyButton cls="btn btn-primary btn-sm" onClick={() => acceptRequest(c)}><Icon name="check" cls="sm" />Accept</BusyButton>
        <BusyButton cls="btn btn-ghost btn-sm" onClick={() => declineRequest(c)}>Decline</BusyButton>
        <button className="btn btn-ghost btn-sm btn-icon" aria-label="More options" onClick={() => requestMenu(c)}><Icon name="more" /></button>
      </div>
    </article>
  );
}

// ---- Friends ----------------------------------------------------------------------------------------
let friendQuery = '';
function FriendsScreen() {
  const s = useAppState();
  const all = friendsList();
  const online = all.filter((f) => f.other_online);
  const [q, setQ] = useState(friendQuery);
  const query = q.trim().toLowerCase();
  const list = all.filter((f) => !query || nameOf(f).toLowerCase().includes(query) || f.other_handle.toLowerCase().includes(query))
    .slice().sort(byInbox);
  return (
    <SubScreen title="Friends" sub="People who accepted your friend request, or whose request you accepted."
      actions={<button className="hero-btn" aria-label="Add a friend by username" onClick={addFriendSheet}><Icon name="userplus" /></button>}>
      {!s.convosLoaded ? <SkeletonList n={4} /> : !all.length ? (
        <EmptyState emoji="👋" title="No Friends Yet" text="People who accept your friend requests will appear here. Add a friend by their username, or meet people in Chatrooms: tap someone’s name, then Add friend.">
          <button className="btn btn-primary" onClick={addFriendSheet}><Icon name="userplus" cls="sm" />Add by username</button>
          <button className="btn btn-soft" onClick={() => go('rooms')}><Icon name="rooms" cls="sm" />Go to Chatrooms</button>
        </EmptyState>
      ) : (
        <>
          <div className="card friends-sum">
            <div className="fsum"><b>{String(all.length)}</b><span>{all.length === 1 ? 'Friend' : 'Friends'}</span></div>
            <div className="fsum on"><b><i />{String(online.length)}</b><span>Online</span></div>
          </div>
          {online.length ? (
            <section><div className="section-head"><h2>Online Friends</h2></div>
              <div className="friend-strip ib-quick">{online.map((f) => (
                <button key={f.conversation_id} className="fs-item on" onClick={() => openChat(f.conversation_id)} aria-label={`Message ${nameOf(f)}`}>
                  <span className="fs-av"><Avatar seed={f.other_handle} label={nameOf(f)} cls="lg" /><i /></span>
                  <span className="fs-name ellipsis">{shortName(nameOf(f))}</span>
                </button>
              ))}</div>
            </section>
          ) : null}
          <section className="stack">
            <div className="section-head"><h2>All Friends</h2><span className="small muted">{`(${all.length})`}</span></div>
            {all.length > 3 ? <SearchBox placeholder="Search friends" value={q} onChange={(v) => { friendQuery = v; setQ(v); }} /> : null}
            {list.length ? <div className="card ib-list friend-list">{list.map((f) => <FriendRow key={f.conversation_id} f={f} />)}</div>
              : <div className="card ib-empty"><p>No friend by that name.</p></div>}
          </section>
          <FriendActivity all={all} />
        </>
      )}
    </SubScreen>
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
          {st && !f.other_online ? <span className="fr-away">{activeText(false, f.other_active_hours)}</span> : null}</span>
      </button>
      <button className="btn btn-soft btn-sm fr-msg" onClick={() => openChat(f.conversation_id)} aria-label={`Message ${nameOf(f)}`}><Icon name="chat" cls="sm" /><span className="fr-msg-t">Message</span></button>
      <button className="btn btn-ghost btn-sm btn-icon" aria-label={`More options for ${nameOf(f)}`} onClick={() => friendMenu(f)}><Icon name="more" /></button>
    </div>
  );
}

function friendMenu(f: Convo) {
  openSheet((close) => (
    <>
      <h2>{nameOf(f)}</h2>
      <div className="menu-list" style={{ marginTop: '10px' }}>
        <button className="menu-item" onClick={() => { close(); openChat(f.conversation_id); }}><Icon name="chat" />Message</button>
        <button className="menu-item" onClick={() => { close(); partnerProfile(f); }}><Icon name="user" />View profile</button>
        <button className="menu-item danger" onClick={async () => {
          close();
          if (!(await confirmSheet({ title: `Remove ${nameOf(f)} as a friend?`, yes: 'Remove friend', danger: true,
            text: 'You won’t be friends any more, and they aren’t told. Your chat stays (you can delete or block it separately).' }))) return;
          try { await api.removeFriend(f.conversation_id); await loadDating({ force: true }); toast('Removed from friends', 'x'); }
          catch (e) { toast(api.friendly(e), 'x'); }
        }}><Icon name="minus" />Remove friend</button>
      </div>
    </>
  ), { label: 'Friend options' });
}

// ---- Matches + Likes you ---------------------------------------------------------------------------
let matchTab: 'matches' | 'likes' = 'matches';
function MatchesScreen({ focusLikes }: { focusLikes: boolean }) {
  const s = useAppState();
  const [tab, setTab] = useState<'matches' | 'likes'>(focusLikes ? 'likes' : matchTab);
  const fresh = newMatchList();
  const chats = allChats().filter((c) => isMatch(c) && !c.blocked).sort(byInbox);
  const seg = (id: 'matches' | 'likes', label: string, n: number) => (
    <button className={`ih-filter f-matches`} role="tab" aria-selected={tab === id} onClick={() => { matchTab = id; setTab(id); }}>{label}{n ? <span className="ih-fn">{n99(n)}</span> : null}</button>
  );
  return (
    <SubScreen title="Matches" sub="Dating connections: you both liked each other.">
      <div className="ih-filters" role="tablist" aria-label="Matches">
        {seg('matches', 'Your Matches', fresh.length + unreadIn(chats))}
        {seg('likes', 'Likes You', s.requests.length)}
        <button className="ih-filter" onClick={() => go('discover')}><Icon name="flame" cls="sm" />Discover</button>
      </div>
      {tab === 'likes' ? <section id="likes-you" className="stack"><Likes /></section> : !s.convosLoaded ? <SkeletonList n={4} /> : (
        <>
          {fresh.length ? (
            <section><div className="section-head"><h2>New Matches</h2><span className="small muted">Say hi first</span></div>
              <div className="story-row">{fresh.map((c) => (
                <button key={c.conversation_id} className="story new" onClick={() => openChat(c.conversation_id)}>
                  <span className="story-av"><Avatar seed={c.other_handle} cls="lg" /><span className="heart-dot"><Icon name="heart" cls="fill" /></span></span>
                  <span>{shortName(c.other_handle)}</span>
                </button>
              ))}</div>
            </section>
          ) : null}
          <section className="stack"><div className="section-head"><h2>Match Chats</h2><span className="small muted">{`(${chats.length})`}</span></div>
            {chats.length ? <Paged list={chats} render={(c) => <ConvoRow key={c.conversation_id} c={c} />} />
              : fresh.length ? <div className="card ib-empty"><p>Say hi to a new match above to start chatting.</p></div>
              : <EmptyState emoji="💘" title="No Matches Yet" text="Your dating matches and conversations will appear here. When you both like each other, you match.">
                  <button className="btn btn-coral btn-sm" onClick={() => go('discover')}><Icon name="flame" cls="sm" />Go to Discover</button>
                </EmptyState>}
          </section>
        </>
      )}
    </SubScreen>
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
