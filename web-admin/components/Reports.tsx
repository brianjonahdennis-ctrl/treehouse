'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { rpc } from '@/lib/sb';
import { ago, date, words } from '@/lib/fmt';
import { ChatView, type ChatMsg, type Unsent } from './ChatView';
import { useGo } from './Shell';
import { Ask, Avatar, Btn, Card, Empty, ErrorBox, PageHead, Pill, Spinner, Tabs, toast, useAsync } from './ui';
import { Icon } from './Icon';

type Kind = 'chat' | 'room' | 'link';
type ChatRep = { id: number; created_at: string; status: string; reason: string; details: string; conversation_id: string | null; reporter: string | null; reported: string | null;
  reported_suspended: boolean; reported_room_banned: boolean; reports_against: number; speed: boolean; has_chat: boolean };
type RoomRep = { id: number; room: string; body: string; room_name: string; author: string | null; author_suspended: boolean; author_room_banned: boolean; created_at: string; reports: number; reasons: string[]; first_reported_at: string };
type LinkRep = { id: number; created_at: string; status: string; reason: string; body: string; username: string; link_suspended: boolean; reports_for_link: number };
type Any = ChatRep | RoomRep | LinkRep;

const tone = (r: string) => (r === 'underage' || r === 'threat' || r === 'self_harm' ? 'red' : r === 'harassment' || r === 'sexual' || r === 'hate' ? 'pink' : r === 'spam' ? 'amber' : 'violet');

export default function Reports() {
  const params = useSearchParams();
  const first = params.get('open') || '';
  const [kind, setKind] = useState<Kind>((first.split('-')[0] as Kind) || 'chat');
  const [status, setStatus] = useState('open');
  const [sel, setSel] = useState<Any | null>(null);
  const counts = useAsync(() => rpc<{ chat: number; room: number; link: number }>('staff_report_counts'), []);
  const list = useAsync(() => rpc<Any[]>('staff_reports', { p_kind: kind, p_status: status, p_limit: 100 }), [kind, status]);

  useEffect(() => {
    if (!first || !list.data) return;
    const id = Number(first.split('-')[1]);
    const hit = list.data.find((r) => r.id === id);
    if (hit) setSel(hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data]);

  const done = () => { setSel(null); list.reload(); counts.reload(); };
  const c = counts.data;
  return (
    <>
      <PageHead title="Reports" sub="What members flagged. Open one to see the messages around it and act." />
      <div className="toolbar">
        <Tabs value={kind} onChange={(v) => { setKind(v as Kind); setSel(null); }} items={[
          ['chat', <>Chats & profiles{c?.chat ? <em className="badge">{c.chat}</em> : null}</>],
          ['room', <>Chatroom messages{c?.room ? <em className="badge">{c.room}</em> : null}</>],
          ['link', <>Anonymous links{c?.link ? <em className="badge">{c.link}</em> : null}</>],
        ]} />
        <Tabs value={status} onChange={(v) => { setStatus(v); setSel(null); }} items={[['open', 'Open'], ['reviewed', 'Reviewed'], ['actioned', 'Actioned']]} />
      </div>
      <div className={`split ${sel ? 'has' : ''}`}>
        <Card pad={false}>
          {list.error && <ErrorBox text={list.error} retry={list.reload} />}
          {list.loading && !list.data && <Spinner />}
          {list.data && list.data.length === 0 && <Empty text={status === 'open' ? 'Nothing waiting. All clear.' : 'Nothing here.'} />}
          {list.data && list.data.length > 0 && (
            <table className="tbl">
              <thead>
                {kind === 'chat' && <tr><th>Reported</th><th>Reason</th><th>By</th><th>Against them</th><th>When</th></tr>}
                {kind === 'room' && <tr><th>Message</th><th>Room</th><th>Author</th><th>Reports</th><th>When</th></tr>}
                {kind === 'link' && <tr><th>Message</th><th>Link</th><th>Reason</th><th>When</th></tr>}
              </thead>
              <tbody>
                {list.data.map((r) => (
                  <tr key={r.id} className={`click ${sel?.id === r.id ? 'sel' : ''}`} onClick={() => setSel(r)}>
                    {kind === 'chat' && (() => { const x = r as ChatRep; return <>
                      <td><div className="who-cell"><Avatar name={x.reported || '?'} /><div><b>{x.reported || 'deleted account'}</b><small>{x.speed ? 'Speed Dating' : x.has_chat ? 'From a chat' : 'From a profile'}{x.reported_suspended ? ' · suspended' : ''}</small></div></div></td>
                      <td><Pill tone={tone(x.reason)}>{words(x.reason)}</Pill></td>
                      <td className="muted">{x.reporter || '—'}</td>
                      <td>{x.reports_against}</td>
                      <td className="muted">{ago(x.created_at)}</td></>; })()}
                    {kind === 'room' && (() => { const x = r as RoomRep; return <>
                      <td className="clip">{x.body}</td>
                      <td>{x.room}</td>
                      <td><b>{x.author || '—'}</b>{x.author_suspended && <small className="muted"> · suspended</small>}</td>
                      <td><Pill tone={x.reports > 2 ? 'red' : 'amber'}>{x.reports}</Pill></td>
                      <td className="muted">{ago(x.first_reported_at)}</td></>; })()}
                    {kind === 'link' && (() => { const x = r as LinkRep; return <>
                      <td className="clip">{x.body}</td>
                      <td>/u/{x.username}{x.link_suspended && <small className="muted"> · off</small>}</td>
                      <td><Pill tone={tone(x.reason)}>{words(x.reason)}</Pill></td>
                      <td className="muted">{ago(x.created_at)}</td></>; })()}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        {sel && <Detail key={`${kind}-${sel.id}`} kind={kind} r={sel} onClose={() => setSel(null)} onDone={done} />}
      </div>
    </>
  );
}

function Detail({ kind, r, onClose, onDone }: { kind: Kind; r: Any; onClose: () => void; onDone: () => void }) {
  const go = useGo();
  const [ask, setAsk] = useState<null | 'suspend' | 'roomban' | 'remove'>(null);
  const ctx = useAsync(() => (kind === 'link' ? Promise.resolve(null) : rpc<{
    messages: (ChatMsg & { author?: string; room_name?: string; reported?: boolean })[]; unsent?: Unsent[]; reported?: string; reporter?: string; note?: string;
    reports?: { by: string; reason: string; at: string }[]; conversation_id?: string;
  }>('staff_report_context', { p_kind: kind, p_id: r.id })), [r.id]);

  const setStatus = async (s: string) => {
    try { await rpc('staff_report_set', { p_kind: kind, p_id: r.id, p_status: s }); toast(s === 'reviewed' ? 'Marked as reviewed.' : 'Marked as actioned.'); onDone(); } catch (e) { toast((e as Error).message, true); }
  };
  const target = kind === 'chat' ? (r as ChatRep).reported : kind === 'room' ? (r as RoomRep).author : null;

  return (
    <Card className="detail" title={kind === 'chat' ? `Report on ${(r as ChatRep).reported || 'a deleted account'}` : kind === 'room' ? `Message in ${(r as RoomRep).room}` : `Message on /u/${(r as LinkRep).username}`}
      sub={kind === 'chat' ? `${words((r as ChatRep).reason)} · ${date((r as ChatRep).created_at)}` : kind === 'room' ? `${(r as RoomRep).reports} report(s) · ${(r as RoomRep).reasons.map(words).join(', ')}` : `${words((r as LinkRep).reason)} · ${date((r as LinkRep).created_at)}`}
      action={<button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>}>
      {kind === 'chat' && (r as ChatRep).details && <blockquote className="quote">“{(r as ChatRep).details}”<span>— {(r as ChatRep).reporter || 'reporter'}</span></blockquote>}
      {kind === 'link' && <blockquote className="quote">{(r as LinkRep).body}</blockquote>}

      <div className="actions">
        {target && <Btn small icon="user" onClick={() => go(`/members/${encodeURIComponent(target)}`)}>Open member</Btn>}
        {target && <Btn small kind="danger" icon="ban" onClick={() => setAsk('suspend')}>Suspend {target}</Btn>}
        {target && <Btn small icon="clock" onClick={() => setAsk('roomban')}>Ban from rooms</Btn>}
        {kind === 'room' && <Btn small kind="danger" icon="trash" onClick={() => setAsk('remove')}>Remove message</Btn>}
        {kind === 'link' && <Btn small kind="danger" icon="lock" onClick={async () => {
          try { await rpc('staff_link_suspend', { p_report: r.id, p_suspend: !(r as LinkRep).link_suspended }); toast((r as LinkRep).link_suspended ? 'Link turned back on.' : 'Link turned off.'); onDone(); } catch (e) { toast((e as Error).message, true); }
        }}>{(r as LinkRep).link_suspended ? 'Turn link back on' : 'Turn link off'}</Btn>}
        {kind === 'chat' && (r as ChatRep).conversation_id && (r as ChatRep).has_chat && <Btn small icon="chat" onClick={() => go(`/chats/${(r as ChatRep).conversation_id}`)}>Full chat</Btn>}
      </div>
      <div className="actions">
        <Btn small kind="ghost" icon="check" onClick={() => setStatus('reviewed')}>No action needed</Btn>
        <Btn small kind="primary" icon="check" onClick={() => setStatus('actioned')}>Mark actioned</Btn>
      </div>

      {kind !== 'link' && <h4 className="sec-t">{kind === 'chat' ? 'Messages before the report' : 'Messages around it'}</h4>}
      {ctx.loading && kind !== 'link' && <Spinner />}
      {ctx.error && <ErrorBox text={ctx.error} />}
      {ctx.data && kind === 'chat' && (ctx.data.note ? <p className="muted">{ctx.data.note}</p>
        : <ChatView messages={ctx.data.messages} people={[ctx.data.reported || null, ctx.data.reporter || null]} unsent={ctx.data.unsent} highlight={ctx.data.reported} />)}
      {ctx.data && kind === 'room' && (
        <div className="room-feed">
          {ctx.data.messages.map((m) => (
            <div key={m.id} className={`rf ${m.reported ? 'flag' : ''}`}><b>{m.room_name}</b> <span className="muted">({m.author || '—'})</span><p>{m.body}</p><small className="muted">{date(m.created_at)}</small></div>
          ))}
          {ctx.data.reports && <p className="muted">Reported by: {ctx.data.reports.map((x) => `${x.by || '—'} (${words(x.reason)})`).join(', ')}</p>}
        </div>
      )}
      <p className="audit-note"><Icon name="eye" size={14} />Opening this report is recorded in the audit log.</p>

      {ask === 'suspend' && target && <Ask title={`Suspend ${target}?`} text="They can’t chat, join rooms or appear to others until a moderator lifts it. Their open reports are marked actioned." confirm="Suspend" danger reason
        onDone={async (why) => { await rpc('staff_member_suspend', { p_handle: target, p_suspend: true, p_reason: why }); toast(`${target} suspended.`); onDone(); }} onClose={() => setAsk(null)} />}
      {ask === 'roomban' && target && <Ask title={`Ban ${target} from chatrooms`} confirm="Ban from rooms" reason options={[['24', '24 hours'], ['72', '3 days'], ['168', '7 days'], ['720', '30 days'], ['8760', '1 year']]}
        onDone={async (why, hours) => { await rpc('staff_room_ban', { p_handle: target, p_hours: Number(hours), p_reason: why }); toast(`${target} banned from rooms.`); onDone(); }} onClose={() => setAsk(null)} />}
      {ask === 'remove' && <Ask title="Remove this message?" text="It disappears from the room for everyone." confirm="Remove" danger reason
        onDone={async (why) => { await rpc('staff_room_delete_message', { p_id: r.id, p_reason: why }); toast('Message removed.'); onDone(); }} onClose={() => setAsk(null)} />}
    </Card>
  );
}
