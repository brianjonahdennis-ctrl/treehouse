'use client';
import { useEffect, useState } from 'react';
import { rpc } from '@/lib/sb';
import { allows } from '@/lib/roles';
import { ago, n } from '@/lib/fmt';
import { useMe } from './Gate';
import { useGo } from './Shell';
import { Ask, Btn, Card, Empty, ErrorBox, PageHead, Pill, Spinner, Tabs, toast, useAsync } from './ui';
import { Icon } from './Icon';

type Room = { room: string; group: 'state' | 'university' | 'general'; online: number; members: number; messages_24h: number; open_reports: number; closed: boolean; reason: string };
type Msg = { id: number; room_name: string; author: string | null; author_suspended: boolean; body: string; created_at: string; reports: number };

export function Rooms() {
  const go = useGo();
  const [group, setGroup] = useState('general');
  const [q, setQ] = useState('');
  const rooms = useAsync(() => rpc<Room[]>('staff_rooms'), []);
  const list = (rooms.data || []).filter((r) => r.group === group && r.room.toLowerCase().includes(q.toLowerCase()));
  const sum = (k: keyof Room) => (rooms.data || []).reduce((s, r) => s + Number(r[k] || 0), 0);
  return (
    <>
      <PageHead title="Chatrooms" sub="Every room, live. Open one to read along and remove messages." actions={<Btn icon="refresh" onClick={rooms.reload}>Refresh</Btn>} />
      {rooms.data && (
        <div className="kpis small">
          <div className="kpi"><span className="kpi-l">In rooms now</span><div className="kpi-v"><b>{n(sum('online'))}</b></div></div>
          <div className="kpi"><span className="kpi-l">Messages, 24 h</span><div className="kpi-v"><b>{n(sum('messages_24h'))}</b></div></div>
          <div className="kpi"><span className="kpi-l">Open reports</span><div className="kpi-v"><b>{n(sum('open_reports'))}</b></div></div>
          <div className="kpi"><span className="kpi-l">Closed rooms</span><div className="kpi-v"><b>{n(rooms.data.filter((r) => r.closed).length)}</b></div></div>
        </div>
      )}
      <div className="toolbar">
        <Tabs value={group} onChange={setGroup} items={[['general', 'Topics'], ['state', 'States'], ['university', 'Universities']]} />
        <form className="search inline" onSubmit={(e) => e.preventDefault()}><Icon name="search" size={17} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a room…" aria-label="Find a room" /></form>
      </div>
      {rooms.error && <ErrorBox text={rooms.error} retry={rooms.reload} />}
      {rooms.loading && !rooms.data && <Spinner />}
      <div className="room-grid">
        {list.map((r) => (
          <button key={r.room} className={`room-card ${r.closed ? 'closed' : ''}`} onClick={() => go(`/rooms/${encodeURIComponent(r.room)}`)}>
            <div className="rc-h"><b>{r.room}</b>{r.closed ? <Pill tone="red">Closed</Pill> : r.online > 0 ? <Pill tone="green">{r.online} live</Pill> : null}</div>
            <div className="rc-s"><span><Icon name="users" size={14} />{n(r.members)}</span><span><Icon name="chat" size={14} />{n(r.messages_24h)} / 24h</span>
              {r.open_reports > 0 && <span className="warn"><Icon name="flag" size={14} />{r.open_reports}</span>}</div>
          </button>
        ))}
        {rooms.data && list.length === 0 && <Empty text="No rooms match." icon="search" />}
      </div>
    </>
  );
}

export function RoomPage({ room }: { room: string }) {
  const { me } = useMe();
  const go = useGo();
  const info = useAsync(() => rpc<Room[]>('staff_rooms').then((l) => l.find((r) => r.room === room) || null), [room]);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [err, setErr] = useState('');
  const [ask, setAsk] = useState<null | { type: 'remove' | 'ban' | 'close'; m?: Msg }>(null);
  const canMod = allows(me.role, 'moderate');

  useEffect(() => {
    if (!canMod) return;
    let live = true;
    const load = () => rpc<Msg[]>('staff_room_messages', { p_room: room, p_limit: 120 }).then((l) => { if (live) { setMsgs(l); setErr(''); } }).catch((e) => live && setErr(e.message));
    load();
    const t = setInterval(load, 10000);
    return () => { live = false; clearInterval(t); };
  }, [room, canMod]);

  const r = info.data;
  return (
    <>
      <button className="crumb" onClick={() => go('/rooms')}><Icon name="back" size={15} />Chatrooms</button>
      <PageHead title={room} sub={r ? `${n(r.online)} live · ${n(r.members)} members · ${n(r.messages_24h)} messages in 24 h` : ''} actions={allows(me.role, 'manage') && r && (
        r.closed
          ? <Btn kind="primary" icon="unlock" onClick={async () => { try { await rpc('staff_room_set', { p_room: room, p_closed: false }); toast('Room reopened.'); info.reload(); } catch (e) { toast((e as Error).message, true); } }}>Reopen room</Btn>
          : <Btn kind="danger" icon="lock" onClick={() => setAsk({ type: 'close' })}>Close room</Btn>)} />
      {r?.closed && <div className="banner red"><Icon name="lock" size={18} />Closed{r.reason ? `: “${r.reason}”` : ''}. Members see this message when they try to join.</div>}
      {!canMod ? <Card><Empty text="Reading rooms is for moderators." icon="lock" /></Card> : (
        <Card pad={false} title="Live messages" sub="Refreshes every 10 seconds. Newest at the bottom.">
          {err && <ErrorBox text={err} />}
          {!msgs && !err && <Spinner />}
          {msgs && msgs.length === 0 && <Empty text="No messages in this room yet." icon="chat" />}
          <div className="room-live">
            {msgs?.map((m) => (
              <div key={m.id} className={`rl ${m.reports ? 'flag' : ''}`}>
                <div className="rl-h"><b>{m.room_name}</b><button className="link" onClick={() => m.author && go(`/members/${encodeURIComponent(m.author)}`)}>{m.author || '—'}</button>
                  {m.author_suspended && <Pill tone="red">Suspended</Pill>}{m.reports > 0 && <Pill tone="amber">{m.reports} report{m.reports > 1 ? 's' : ''}</Pill>}<span className="muted">{ago(m.created_at)}</span></div>
                <p>{m.body}</p>
                <div className="rl-a">
                  <Btn small kind="ghost" icon="trash" onClick={() => setAsk({ type: 'remove', m })}>Remove</Btn>
                  {m.author && <Btn small kind="ghost" icon="clock" onClick={() => setAsk({ type: 'ban', m })}>Ban author</Btn>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {ask?.type === 'remove' && ask.m && <Ask title="Remove this message?" text={<blockquote className="quote">{ask.m.body}</blockquote>} confirm="Remove" danger reason
        onDone={async (why) => { await rpc('staff_room_delete_message', { p_id: ask.m!.id, p_reason: why }); toast('Removed.'); setMsgs((l) => l?.filter((x) => x.id !== ask.m!.id) || null); }} onClose={() => setAsk(null)} />}
      {ask?.type === 'ban' && ask.m?.author && <Ask title={`Ban ${ask.m.author} from chatrooms`} confirm="Ban" reason options={[['24', '24 hours'], ['72', '3 days'], ['168', '7 days'], ['720', '30 days']]}
        onDone={async (why, h) => { await rpc('staff_room_ban', { p_handle: ask.m!.author, p_hours: Number(h), p_reason: why }); toast('Banned from rooms.'); }} onClose={() => setAsk(null)} />}
      {ask?.type === 'close' && <Ask title={`Close ${room}?`} text="Everyone in it is moved out and nobody can join or post until you reopen it." confirm="Close room" danger reason reasonLabel="Message members will see"
        onDone={async (why) => { await rpc('staff_room_set', { p_room: room, p_closed: true, p_reason: why }); toast('Room closed.'); info.reload(); }} onClose={() => setAsk(null)} />}
    </>
  );
}
