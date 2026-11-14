'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { rpc } from '@/lib/sb';
import { allows, ROLE_LABEL, type Role } from '@/lib/roles';
import { ago, date, n, words } from '@/lib/fmt';
import { platformName } from './Dashboard';
import { ChatView, type ChatMsg, type Unsent } from './ChatView';
import { useMe } from './Gate';
import { useGo } from './Shell';
import { Ask, Avatar, Btn, Card, Empty, ErrorBox, Field, Modal, PageHead, Pill, Spinner, Tabs, toast, useAsync } from './ui';
import { Icon } from './Icon';

type Row = { handle: string; gender: string; age: number; state: string; intent: string; created_at: string; last_seen_at: string | null; suspended: boolean;
  is_active: boolean; underage: boolean; room_ban_until: string | null; open_reports: number; staff_role: Role | null };

const FILTERS: [string, string][] = [['all', 'All'], ['online', 'Online now'], ['new', 'New this week'], ['reported', 'Reported'], ['suspended', 'Suspended'], ['room_banned', 'Room bans'], ['underage', 'Under 18'], ['staff', 'Staff']];

export function Members() {
  const params = useSearchParams();
  const go = useGo();
  const { me } = useMe();
  const [q, setQ] = useState(params.get('q') || '');
  const [term, setTerm] = useState(params.get('q') || '');
  const [filter, setFilter] = useState(params.get('filter') || 'all');
  const [page, setPage] = useState(0);
  const list = useAsync(() => rpc<Row[]>('staff_members', { p_q: term, p_filter: filter, p_limit: 50, p_offset: page * 50 }), [term, filter, page]);
  return (
    <>
      <PageHead title="Members" sub={allows(me.role, 'manage') ? 'Search by handle, or by exact email address.' : 'Search by handle.'} />
      <div className="toolbar">
        <form className="search inline" onSubmit={(e) => { e.preventDefault(); setPage(0); setTerm(q.trim()); }}>
          <Icon name="search" size={17} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Handle or email…" aria-label="Search members" />
        </form>
        <div className="chips">{FILTERS.map(([id, l]) => <button key={id} className={`chip ${filter === id ? 'on' : ''}`} onClick={() => { setPage(0); setFilter(id); }}>{l}</button>)}</div>
      </div>
      <Card pad={false}>
        {list.error && <ErrorBox text={list.error} retry={list.reload} />}
        {list.loading && !list.data && <Spinner />}
        {list.data && list.data.length === 0 && <Empty text="No members match." icon="search" />}
        {list.data && list.data.length > 0 && (
          <table className="tbl">
            <thead><tr><th>Member</th><th>Age</th><th>State</th><th>Looking for</th><th>Joined</th><th>Last seen</th><th>Status</th></tr></thead>
            <tbody>
              {list.data.map((m) => (
                <tr key={m.handle} className="click" onClick={() => go(`/members/${encodeURIComponent(m.handle)}`)}>
                  <td><div className="who-cell"><Avatar name={m.handle} /><div><b>{m.handle}</b><small>{words(m.gender)}{m.staff_role ? ` · ${ROLE_LABEL[m.staff_role]}` : ''}</small></div></div></td>
                  <td>{m.age}</td><td>{m.state || '—'}</td><td>{words(m.intent)}</td>
                  <td className="muted">{date(m.created_at, false)}</td><td className="muted">{ago(m.last_seen_at)}</td>
                  <td><Status m={m} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <div className="pager">
        <Btn small disabled={page === 0} onClick={() => setPage((p) => p - 1)} icon="back">Newer</Btn>
        <span className="muted">Page {page + 1}</span>
        <Btn small disabled={!list.data || list.data.length < 50} onClick={() => setPage((p) => p + 1)}>Older <Icon name="chevron" size={14} /></Btn>
      </div>
    </>
  );
}

function Status({ m }: { m: Row }) {
  if (m.underage) return <Pill tone="red">Under 18</Pill>;
  if (m.suspended) return <Pill tone="red">Suspended</Pill>;
  if (m.room_ban_until) return <Pill tone="amber">Room ban</Pill>;
  if (m.open_reports) return <Pill tone="pink">{m.open_reports} report{m.open_reports > 1 ? 's' : ''}</Pill>;
  if (m.last_seen_at && Date.now() - new Date(m.last_seen_at).getTime() < 300000) return <Pill tone="green">Online</Pill>;
  if (!m.is_active) return <Pill>Paused</Pill>;
  return <Pill tone="blue">Active</Pill>;
}

type Detail = {
  handle: string; gender: string; age: number; state: string; location: string; intent: string; bio: string | null; interests: string[] | null;
  created_at: string; last_seen_at: string | null; is_active: boolean; suspended: boolean; underage_at: string | null; age_changed_at: string | null;
  signed_up_at: string; last_sign_in_at: string | null; sign_in_blocked: boolean; staff_role: Role | null; room_ban: { until: string; reason: string } | null;
  counts: Record<string, number>; reputation: { score: number; raters: number; band: string } | null; bird_level: number | null; kickrs: boolean; platforms: string[];
  referral: { code: string | null; joined: number; came_from: string | null };
  reports: { id: number; created_at: string; reason: string; details: string; status: string; by: string | null; conversation_id: string | null }[];
  notes: { at: string; by: string | null; body: string }[];
  name?: string; email?: string; birth_date?: string; providers?: string[];
};
type ChatItem = { id: string; kind: string; created_at: string; accepted_at: string | null; partner: string | null; messages: number; last_at: string | null; reported: boolean };

export function Member({ handle }: { handle: string }) {
  const { me } = useMe();
  const go = useGo();
  const m = useAsync(() => rpc<Detail>('staff_member', { p_handle: handle }), [handle]);
  const [tab, setTab] = useState('reports');
  const [ask, setAsk] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const chats = useAsync(() => (tab === 'chats' ? rpc<ChatItem[]>('staff_member_chats', { p_handle: handle }) : Promise.resolve(null)), [tab, handle]);
  if (m.error) return <><PageHead title={handle} /><ErrorBox text={m.error} retry={m.reload} /></>;
  if (!m.data) return <Spinner />;
  const d = m.data;
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); m.reload(); } catch (e) { toast((e as Error).message, true); } };

  return (
    <>
      <button className="crumb" onClick={() => go('/members')}><Icon name="back" size={15} />Members</button>
      <div className="member-top card">
        <Avatar name={d.handle} size={64} />
        <div className="mt-main">
          <h1>{d.handle}{d.staff_role && <Pill tone="violet">{ROLE_LABEL[d.staff_role]}</Pill>}</h1>
          <p className="muted">{words(d.gender)} · {d.age} · {d.state || 'No state'}{d.location ? ` (${d.location})` : ''} · looking for {words(d.intent)}</p>
          <div className="mt-pills">
            {d.underage_at && <Pill tone="red">Marked under 18 · {date(d.underage_at, false)}</Pill>}
            {d.suspended && <Pill tone="red">Suspended</Pill>}
            {d.sign_in_blocked && <Pill tone="red">Sign-in blocked</Pill>}
            {d.room_ban && <Pill tone="amber">Room ban until {date(d.room_ban.until)}</Pill>}
            {!d.is_active && <Pill>Profile paused</Pill>}
            {d.kickrs && <Pill tone="blue">Kickrs connected</Pill>}
            {d.reputation && <Pill tone={d.reputation.band === 'review' ? 'amber' : 'green'}>★ {d.reputation.score} ({d.reputation.raters})</Pill>}
            {d.bird_level != null && <Pill tone="violet">Bird level {d.bird_level}</Pill>}
          </div>
        </div>
        <div className="mt-actions">
          {d.suspended
            ? <Btn icon="unlock" onClick={() => act(() => rpc('staff_member_suspend', { p_handle: d.handle, p_suspend: false }), 'Suspension lifted.')}>Lift suspension</Btn>
            : <Btn kind="danger" icon="ban" onClick={() => setAsk('suspend')}>Suspend</Btn>}
          {d.room_ban
            ? <Btn icon="chat" onClick={() => act(() => rpc('staff_room_ban', { p_handle: d.handle, p_hours: 0 }), 'Room ban lifted.')}>Lift room ban</Btn>
            : <Btn icon="clock" onClick={() => setAsk('roomban')}>Ban from rooms</Btn>}
          <Btn kind="ghost" icon="calendar" onClick={() => act(() => rpc('staff_member_reset_dob_clock', { p_handle: d.handle }), 'They can change their date of birth again.')}>Reset birthday clock</Btn>
          {allows(me.role, 'manage') && (d.sign_in_blocked
            ? <Btn kind="ghost" icon="unlock" onClick={() => act(() => rpc('staff_member_block_sign_in', { p_handle: d.handle, p_block: false }), 'They can sign in again.')}>Allow sign-in</Btn>
            : <Btn kind="ghost" icon="lock" onClick={() => setAsk('block')}>Block sign-in</Btn>)}
          {allows(me.role, 'super') && <Btn kind="ghost" icon="trash" onClick={() => setAsk('delete')}>Delete account</Btn>}
        </div>
      </div>

      <div className="member-grid">
        <Card title="Account">
          <dl className="facts">
            {d.name !== undefined && <><dt>Real name</dt><dd>{d.name}</dd></>}
            {d.email !== undefined && <><dt>Email</dt><dd>{d.email || '—'}</dd></>}
            {d.providers && <><dt>Signs in with</dt><dd>{d.providers.map(words).join(', ') || '—'}</dd></>}
            {d.birth_date !== undefined && <><dt>Date of birth</dt><dd>{d.birth_date ? date(d.birth_date, false) : '—'}</dd></>}
            <dt>Joined</dt><dd>{date(d.signed_up_at)}</dd>
            <dt>Last seen</dt><dd>{ago(d.last_seen_at)}</dd>
            <dt>Last sign-in</dt><dd>{ago(d.last_sign_in_at)}</dd>
            <dt>Apps (30 days)</dt><dd>{d.platforms.map(platformName).join(', ') || '—'}</dd>
            <dt>Invite code</dt><dd>{d.referral.code || '—'}{d.referral.joined ? ` · brought ${d.referral.joined}` : ''}</dd>
            <dt>Came via</dt><dd>{d.referral.came_from || '—'}</dd>
          </dl>
          {d.bio && <p className="bio">“{d.bio}”</p>}
          {d.interests && d.interests.length > 0 && <div className="chips">{d.interests.map((i) => <span key={i} className="chip">{i}</span>)}</div>}
        </Card>
        <Card title="Activity">
          <div className="stat-grid">
            {[['Chats', 'chats'], ['Pending requests', 'requests'], ['Friends', 'friends'], ['Messages sent', 'messages_sent'], ['Room messages', 'room_messages'],
              ['Blocked others', 'blocked_others'], ['Blocked by', 'blocked_by'], ['Reports against', 'reports_against'], ['Reports made', 'reports_made'], ['Push devices', 'push_devices']]
              .map(([l, k]) => <div key={k}><b>{n(d.counts[k])}</b><span>{l}</span></div>)}
          </div>
        </Card>
      </div>

      <Tabs value={tab} onChange={setTab} items={[['reports', `Reports (${d.reports.length})`], ['notes', `Staff notes (${d.notes.length})`], ...(allows(me.role, 'super') ? [['chats', 'Chats'] as [string, string]] : [])]} />
      {tab === 'reports' && (
        <Card pad={false}>
          {d.reports.length === 0 ? <Empty text="Nobody has reported them." /> : (
            <table className="tbl"><thead><tr><th>Reason</th><th>Details</th><th>By</th><th>When</th><th>Status</th><th /></tr></thead>
              <tbody>{d.reports.map((r) => (
                <tr key={r.id}><td>{words(r.reason)}</td><td className="clip">{r.details || '—'}</td><td>{r.by || '—'}</td><td className="muted">{ago(r.created_at)}</td>
                  <td><Pill tone={r.status === 'open' ? 'amber' : r.status === 'actioned' ? 'green' : 'grey'}>{words(r.status)}</Pill></td>
                  <td>{r.conversation_id && <Btn small kind="ghost" icon="chat" onClick={() => go(`/chats/${r.conversation_id}`)}>Chat</Btn>}</td></tr>
              ))}</tbody></table>
          )}
        </Card>
      )}
      {tab === 'notes' && (
        <Card>
          <form className="note-form" onSubmit={async (e) => { e.preventDefault(); if (!note.trim()) return; await act(() => rpc('staff_member_note', { p_handle: d.handle, p_body: note.trim() }), 'Note saved.'); setNote(''); }}>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note other staff will see (not the member)…" maxLength={1000} />
            <Btn kind="primary" type="submit" icon="note">Save note</Btn>
          </form>
          {d.notes.map((x, i) => <div key={i} className="note"><p>{x.body}</p><span className="muted">{x.by || '—'} · {date(x.at)}</span></div>)}
        </Card>
      )}
      {tab === 'chats' && (
        <Card pad={false} title="Their chats" sub="Opening a chat nobody reported needs a written reason, and is logged.">
          {chats.loading && <Spinner />}
          {chats.error && <ErrorBox text={chats.error} />}
          {chats.data && (chats.data.length === 0 ? <Empty text="No chats." icon="chat" /> : (
            <table className="tbl"><thead><tr><th>With</th><th>Type</th><th>Messages</th><th>Last message</th><th /></tr></thead>
              <tbody>{chats.data.map((c) => (
                <tr key={c.id} className="click" onClick={() => go(`/chats/${c.id}`)}><td><b>{c.partner || 'deleted account'}</b></td><td>{words(c.kind)}{!c.accepted_at && ' (request)'}</td>
                  <td>{n(c.messages)}</td><td className="muted">{ago(c.last_at)}</td><td>{c.reported && <Pill tone="amber">Reported</Pill>}</td></tr>
              ))}</tbody></table>
          ))}
        </Card>
      )}

      {ask === 'suspend' && <Ask title={`Suspend ${d.handle}?`} text="They can’t chat, join rooms or appear to others until it’s lifted." confirm="Suspend" danger reason
        onDone={async (why) => { await rpc('staff_member_suspend', { p_handle: d.handle, p_suspend: true, p_reason: why }); toast('Suspended.'); m.reload(); }} onClose={() => setAsk(null)} />}
      {ask === 'roomban' && <Ask title={`Ban ${d.handle} from chatrooms`} confirm="Ban" reason options={[['24', '24 hours'], ['72', '3 days'], ['168', '7 days'], ['720', '30 days'], ['8760', '1 year']]}
        onDone={async (why, h) => { await rpc('staff_room_ban', { p_handle: d.handle, p_hours: Number(h), p_reason: why }); toast('Banned from rooms.'); m.reload(); }} onClose={() => setAsk(null)} />}
      {ask === 'block' && <Ask title={`Block ${d.handle} from signing in?`} text="Their account stays, but they can’t sign in on any device. Use this for scams and repeat offenders." confirm="Block sign-in" danger reason
        onDone={async (why) => { await rpc('staff_member_block_sign_in', { p_handle: d.handle, p_block: true, p_reason: why }); toast('Sign-in blocked.'); m.reload(); }} onClose={() => setAsk(null)} />}
      {ask === 'delete' && <Ask title={`Delete ${d.handle}’s account?`} text={<><b>This can’t be undone.</b> Their profile, chats (on both sides) and messages are removed.</>} confirm="Delete forever" danger reason
        onDone={async (why) => { await rpc('staff_member_delete', { p_handle: d.handle, p_reason: why }); toast('Account deleted.'); go('/members'); }} onClose={() => setAsk(null)} />}
    </>
  );
}

type Chat = { id: string; kind: string; created_at: string; reported: boolean; people: (string | null)[]; messages: ChatMsg[]; unsent: Unsent[] };

export function ChatPage({ id }: { id: string }) {
  const { me } = useMe();
  const go = useGo();
  const [reason, setReason] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const chat = useAsync(() => (asked === null ? rpc<Chat>('staff_chat', { p_conversation: id }) : rpc<Chat>('staff_chat', { p_conversation: id, p_reason: asked })), [id, asked]);
  const needsReason = chat.error && /reason|why/i.test(chat.error);
  return (
    <>
      <button className="crumb" onClick={() => history.back()}><Icon name="back" size={15} />Back</button>
      <PageHead title="Chat" sub={chat.data ? `${chat.data.people.map((p) => p || 'deleted account').join(' and ')} · ${words(chat.data.kind)} · since ${date(chat.data.created_at, false)}` : 'Private conversation'}
        actions={chat.data && <>{chat.data.people.map((p) => p && <Btn key={p} small icon="user" onClick={() => go(`/members/${encodeURIComponent(p)}`)}>{p}</Btn>)}</>} />
      {needsReason && allows(me.role, 'super') && (
        <Modal title="Why do you need to open this chat?" onClose={() => history.back()} foot={<>
          <Btn kind="ghost" onClick={() => history.back()}>Cancel</Btn>
          <Btn kind="primary" disabled={reason.trim().length < 5} onClick={() => setAsked(reason.trim())}>Open chat</Btn></>}>
          <p className="muted">Nobody reported this chat. Super Admins can still open it, but the reason and your name go in the audit log.</p>
          <Field label="Reason"><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Police request ref …, or safety check after a complaint by phone" autoFocus /></Field>
        </Modal>
      )}
      {chat.error && !needsReason && <ErrorBox text={chat.error} />}
      {chat.loading && <Spinner />}
      {chat.data && (
        <Card pad={false} title={chat.data.reported ? <span>Reported chat <Pill tone="amber">Reported</Pill></span> : 'Chat opened by Super Admin'} sub="Newest 80 messages. Viewing is recorded in the audit log.">
          <ChatView messages={chat.data.messages} people={chat.data.people} unsent={chat.data.unsent} />
        </Card>
      )}
    </>
  );
}
