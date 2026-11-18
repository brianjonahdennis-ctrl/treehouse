'use client';
// Treasure Hunt live view and results (Hydra, 18 Nov 2026). Staff (Admin / Super Admin) see everyone
// registered for a hunt with their profile and progress, the top 20 finishers once it ends, and can
// message every competitor. Every look and every message is written to the staff audit log by the database.
import { useEffect, useMemo, useRef, useState } from 'react';
import { rpc } from '@/lib/sb';
import { ago, date, n } from '@/lib/fmt';
import { useGo } from './Shell';
import { Btn, Card, Empty, ErrorBox, Field, Modal, PageHead, Pill, Spinner, Switch, Tabs, toast, useAsync } from './ui';

type HuntLite = { id: string; title: string; region: string; state: string | null; status: string; starts_at: string; ends_at: string;
  participant_count: number; registration_count?: number; finished_count?: number };
type Person = { place: number; handle: string | null; username: string | null; gender: string | null; age: number | null; state: string | null; suspended: boolean;
  registered_at: string | null; started_at: string | null; checkpoints: number; coins: number; last_claim_at: string | null; finished_at: string | null; took_seconds: number | null; quit_at?: string | null; winner?: boolean };
type Board = { hunt: { id: string; title: string; region: string; state: string | null; status: string; starts_at: string; ends_at: string; checkpoint_count: number; running: boolean; ended: boolean; winners_count?: number; winners_done?: boolean };
  registered: number; started: number; finished: number; people: Person[] };

const ended = (h: HuntLite) => h.status === 'completed' || Date.parse(h.ends_at) <= Date.now();
const stateName = (s: string | null) => (s === 'FCT' ? 'FCT (Abuja)' : s || 'Any state');
export function took(sec: number | null) {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h} h ${m} min` : m ? `${m} min ${s} s` : `${s} s`;
}
const medal = (p: number) => (p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : String(p));

export default function HuntBoard({ mode }: { mode: 'live' | 'results' }) {
  const list = useAsync(() => rpc<HuntLite[]>('staff_treasure_hunts'), []);
  const hunts = useMemo(() => (list.data || []).filter((h) => h.status !== 'draft' && (mode === 'results'
    ? ended(h) && h.status !== 'cancelled'
    : !ended(h) && h.status !== 'cancelled')), [list.data, mode]);
  const [pick, setPick] = useState('');
  const id = pick && hunts.some((h) => h.id === pick) ? pick : hunts[0]?.id || '';
  const title = mode === 'live' ? 'Hunt live' : 'Hunt results';
  const sub = mode === 'live' ? 'Who registered for a hunt, who is playing now and how far each player has got.'
    : 'Every competitor of a finished hunt, the top 20 places and their finish times.';
  if (list.error) return <><PageHead title={title} sub={sub} /><ErrorBox text={list.error} retry={list.reload} /></>;
  if (!list.data) return <Spinner />;
  return (
    <>
      <PageHead title={title} sub={sub} actions={hunts.length ? (
        <select className="select" value={id} onChange={(e) => setPick(e.target.value)} aria-label="Choose a hunt">
          {hunts.map((h) => <option key={h.id} value={h.id}>{h.title} · {stateName(h.state)}</option>)}
        </select>) : null} />
      {!hunts.length ? <Card><Empty icon="gift" text={mode === 'live' ? 'No upcoming or running hunts. Create one in Treasure Hunts.' : 'No hunt has finished yet.'} /></Card>
        : <BoardView key={id} id={id} mode={mode} />}
    </>
  );
}

function BoardView({ id, mode }: { id: string; mode: 'live' | 'results' }) {
  const go = useGo();
  const b = useAsync(() => rpc<Board>('staff_treasure_hunt_board', { p_hunt: id, p_limit: 2000 }), [id]);
  const [show, setShow] = useState('all');
  const [msg, setMsg] = useState(false);
  const [dm, setDm] = useState<string | null>(null);
  const [chatKey, setChatKey] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((x) => x + 1), 30000); return () => window.clearInterval(t); }, []);   // keeps "x min ago" fresh
  if (b.error) return <ErrorBox text={b.error} retry={b.reload} />;
  if (!b.data) return <Spinner />;
  const x = b.data, total = x.hunt.checkpoint_count || 0;
  const people = x.people.filter((p) => show === 'all' ? true : show === 'playing' ? p.started_at && !p.finished_at : show === 'waiting' ? !p.started_at : !!p.finished_at);
  const top = x.people.filter((p) => p.finished_at).slice(0, 20);
  const who = (p: Person) => (
    <>{p.handle ? <button className="link" onClick={() => go(`/members/${encodeURIComponent(p.handle as string)}`)}><b>{p.handle}</b></button> : <b>Deleted account</b>}
      <small className="muted block">{[p.username ? `@${p.username}` : null, p.age ? `${p.age}` : null, p.gender, stateName(p.state)].filter(Boolean).join(' · ')}{p.suspended ? ' · suspended' : ''}</small></>
  );
  return (
    <>
      <div className="hunt-board-head">
        <div><b>{x.hunt.title}</b><span className="muted"> · {x.hunt.region} · {stateName(x.hunt.state)}</span></div>
        <div className="hunt-board-actions">
          <Pill tone={x.hunt.running ? 'green' : x.hunt.ended ? 'grey' : 'blue'}>{x.hunt.running ? 'Running now' : x.hunt.ended ? 'Finished' : `Starts ${ago(x.hunt.starts_at)}`}</Pill>
          <Btn small icon="refresh" onClick={b.reload}>Refresh</Btn>
          <Btn small kind="primary" icon="megaphone" disabled={!x.registered} onClick={() => setMsg(true)}>Message competitors</Btn>
          {!x.hunt.ended ? <Btn small icon="chat" onClick={() => go(`/hunt-chat?h=${id}`)}>Hunt chat</Btn> : null}
        </div>
      </div>
      <p className="small muted">{date(x.hunt.starts_at)} – {date(x.hunt.ends_at)} (Lagos time)</p>
      <div className="kpis small hunt-kpis">
        <div className="kpi"><span className="kpi-l">Registered</span><div className="kpi-v"><b>{n(x.registered)}</b></div></div>
        <div className="kpi"><span className="kpi-l">Started</span><div className="kpi-v"><b>{n(x.started)}</b></div></div>
        <div className="kpi"><span className="kpi-l">Finished</span><div className="kpi-v"><b>{n(x.finished)}</b></div>{x.hunt.winners_count ? <p className="kpi-hint">{x.hunt.winners_done ? 'Winners are in' : `${x.hunt.winners_count} winners`}</p> : null}</div>
        <div className="kpi"><span className="kpi-l">Checkpoints</span><div className="kpi-v"><b>{n(total)}</b></div></div>
      </div>
      {mode === 'results' ? (
        <Card title="Top 20" sub="Ranked by who finished first. Finish times are Lagos time; “took” counts from when they started (or the hunt start, if later)." pad={false}>
          {top.length === 0 ? <Empty text="Nobody finished this hunt." icon="flag" /> : (
            <table className="tbl hunt-tbl"><thead><tr><th>Place</th><th>Member</th><th>Finished at</th><th>Took</th><th>Coins</th></tr></thead>
              <tbody>{top.map((p) => <tr key={`${p.place}-${p.handle}`} className={p.place <= 3 ? 'hl' : ''}>
                <td><b className="hunt-place">{medal(p.place)}</b></td><td>{who(p)}</td><td>{date(p.finished_at)}</td><td>{took(p.took_seconds)}</td><td>{n(p.coins)}</td>
              </tr>)}</tbody></table>
          )}
        </Card>
      ) : null}
      <Card title={mode === 'results' ? 'All competitors' : 'Competitors'} sub={mode === 'results' ? 'Everyone who registered, in finishing order.' : 'Finished players first, then by checkpoints found. Tap Refresh for the latest.'} pad={false}
        action={<Tabs value={show} onChange={setShow} items={[['all', `All ${x.registered}`], ['playing', 'Playing'], ['waiting', 'Not started'], ['done', 'Finished']]} />}>
        {people.length === 0 ? <Empty text={x.registered ? 'Nobody in this group.' : 'Nobody has registered yet.'} icon="users" /> : (
          <table className="tbl hunt-tbl"><thead><tr><th>#</th><th>Member</th><th>Progress</th><th>Coins</th><th>Last check-in</th><th>Status</th>{mode === 'live' ? <th /> : null}</tr></thead>
            <tbody>{people.map((p) => <tr key={`${p.place}-${p.handle}`}>
              <td>{p.place}</td>
              <td>{who(p)}</td>
              <td><div className="hunt-progress" aria-label={`${p.checkpoints} of ${total} checkpoints`}><i style={{ width: `${total ? Math.min(100, (p.checkpoints / total) * 100) : 0}%` }} /></div><small className="muted">{p.checkpoints} of {total}</small></td>
              <td>{n(p.coins)}</td>
              <td>{p.last_claim_at ? ago(p.last_claim_at) : '—'}</td>
              <td>{p.finished_at ? <><Pill tone={p.winner ? 'amber' : 'green'}>{p.winner ? 'Winner' : 'Finished'}</Pill><small className="muted block">took {took(p.took_seconds)}</small></> : p.quit_at ? <Pill tone="red">Quit</Pill> : p.started_at ? <Pill tone="blue">Playing</Pill> : <Pill>Registered {ago(p.registered_at)}</Pill>}</td>
              {mode === 'live' ? <td>{p.handle ? <Btn small icon="chat" onClick={() => setDm(p.handle)}>Message</Btn> : null}</td> : null}
            </tr>)}</tbody></table>
        )}
      </Card>
      {mode === 'live' && !x.hunt.ended ? <HuntChatCard key={chatKey} id={id} /> : null}
      {dm && <PrivateModal id={id} handle={dm} onClose={() => setDm(null)} onSent={() => setChatKey((k) => k + 1)} />}
      {msg && <MessageModal id={id} title={x.hunt.title} registered={x.registered} started={x.started} onClose={() => setMsg(false)} />}
    </>
  );
}

function MessageModal({ id, title, registered, started, onClose }: { id: string; title: string; registered: number; started: number; onClose: () => void }) {
  const [head, setHead] = useState(`${title}: update`);
  const [body, setBody] = useState('');
  const [group, setGroup] = useState<'registered' | 'started'>('registered');
  const [push, setPush] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const count = group === 'started' ? started : registered;
  const send = async () => {
    setErr('');
    if (!head.trim() || !body.trim()) { setErr('Write a title and a message.'); return; }
    setBusy(true);
    try {
      const r = await rpc<{ recipients: number }>('staff_treasure_hunt_message', { p_hunt: id, p_title: head.trim(), p_body: body.trim(), p_group: group, p_push: push });
      toast(`Sent to ${n(r.recipients)} ${r.recipients === 1 ? 'person' : 'people'}.`); onClose();
    } catch (e) { setErr((e as Error).message || 'Could not send.'); setBusy(false); }
  };
  return (
    <Modal title="Message competitors" onClose={onClose} foot={<><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn kind="primary" icon="megaphone" disabled={busy || !count} onClick={send}>{busy ? 'Sending…' : `Send to ${n(count)}`}</Btn></>}>
      <p className="small muted">It arrives in their Inbox → Announcements, with a notification if they allow treehouse updates. It’s saved in the audit log.</p>
      <Field label="Who gets it">
        <select className="select" value={group} onChange={(e) => setGroup(e.target.value as 'registered' | 'started')}>
          <option value="registered">Everyone registered ({n(registered)})</option>
          <option value="started">Only people who started ({n(started)})</option>
        </select>
      </Field>
      <Field label="Title"><input className="input" maxLength={100} value={head} onChange={(e) => setHead(e.target.value)} /></Field>
      <Field label="Message" hint={`${body.length} / 2000`}><textarea className="input" rows={5} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="The start point has moved to the main gate. See you at 4pm!" /></Field>
      <div className="inline-row"><Switch label="Send a notification" on={push} onChange={setPush} /><span className="small">Send a notification too</span></div>
      {err ? <p className="err" role="alert">{err}</p> : null}
    </Modal>
  );
}

type ChatMsg = { id: number; mine: boolean; from_staff: boolean; sender: string; private: boolean; to?: string | null; body: string; at: string };
type Chat = { title: string; rules: string; staff: boolean; messages: ChatMsg[] };

// The hunt's temporary chatroom (named after the hunt). Players never see a member list; staff can
// post, answer, message one player privately and remove messages. It is deleted when the hunt ends.
export function HuntChatCard({ id }: { id: string }) {
  const c = useAsync(() => rpc<Chat>('treasure_hunt_chat', { p_hunt: id, p_after: 0 }), [id]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = useRef(c.reload); reload.current = c.reload;
  useEffect(() => { const t = window.setInterval(() => { if (document.visibilityState === 'visible') reload.current(); }, 15000); return () => window.clearInterval(t); }, [id]);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { await rpc('treasure_hunt_chat_send', { p_hunt: id, p_body: text.trim() }); setText(''); c.reload(); } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  };
  const remove = async (m: number) => { try { await rpc('treasure_hunt_chat_delete', { p_id: m }); toast('Message removed.'); c.reload(); } catch (e) { toast((e as Error).message, true); } };
  return (
    <Card title={c.data ? `Hunt chat · ${c.data.title}` : 'Hunt chat'} sub="Everyone registered is in this chat. They can’t see who else is in it. It’s deleted when the hunt ends.">
      {c.error ? <ErrorBox text={c.error} retry={c.reload} /> : !c.data ? <Spinner /> : <>
        {c.data.rules ? <div className="banner">📌 <b>Rules:</b> {c.data.rules}</div> : <p className="small muted">No rules yet. Add them in Treasure Hunts → edit this hunt.</p>}
        <div className="hunt-chat">
          {c.data.messages.length === 0 ? <p className="small muted">No messages yet.</p> : c.data.messages.map((m) => (
            <div key={m.id} className={`hunt-chat-msg${m.from_staff ? ' staff' : ''}${m.private ? ' private' : ''}`}>
              <small>{m.from_staff ? 'treehouse team' : m.sender}{m.private ? ` → ${m.to || 'player'} (private)` : ''} · {date(m.at)}</small>
              <p>{m.body}</p>
              <button className="link small" onClick={() => void remove(m.id)}>Remove</button>
            </div>))}
        </div>
        <div className="hunt-chat-compose">
          <textarea className="input" rows={2} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Post an update or answer a question…" aria-label="Message the hunt chat" />
          <Btn kind="primary" disabled={busy || !text.trim()} onClick={send}>{busy ? 'Sending…' : 'Post'}</Btn>
        </div>
      </>}
    </Card>
  );
}

function PrivateModal({ id, handle, onClose, onSent }: { id: string; handle: string; onClose: () => void; onSent: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async () => {
    if (!text.trim()) { setErr('Write a message.'); return; }
    setBusy(true); setErr('');
    try { await rpc('treasure_hunt_chat_send', { p_hunt: id, p_body: text.trim(), p_to_handle: handle }); toast(`Sent to ${handle}.`); onSent(); onClose(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Modal title={`Message ${handle}`} onClose={onClose} foot={<><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send privately'}</Btn></>}>
      <p className="small muted">Only {handle} sees this, inside the hunt chat. It’s saved in the audit log. Players can’t message each other.</p>
      <Field label="Message"><textarea className="input" rows={4} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      {err ? <p className="err" role="alert">{err}</p> : null}
    </Modal>
  );
}

// Hunt chat page (menu: Grow → Hunt chat). Every hunt that hasn't ended has a chat, drafts included,
// so staff can post the rules before anyone registers.
export function HuntChatPage() {
  const list = useAsync(() => rpc<HuntLite[]>('staff_treasure_hunts'), []);
  const hunts = useMemo(() => (list.data || []).filter((h) => !ended(h) && h.status !== 'cancelled'), [list.data]);
  const [pick, setPick] = useState(() => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('h') || ''));
  const id = pick && hunts.some((h) => h.id === pick) ? pick : hunts[0]?.id || '';
  const sub = 'Talk to everyone registered for a hunt. They can’t see who else is in the chat. It’s deleted when the hunt ends.';
  if (list.error) return <><PageHead title="Hunt chat" sub={sub} /><ErrorBox text={list.error} retry={list.reload} /></>;
  if (!list.data) return <Spinner />;
  return (
    <>
      <PageHead title="Hunt chat" sub={sub} actions={hunts.length ? (
        <select className="select" value={id} onChange={(e) => setPick(e.target.value)} aria-label="Choose a hunt">
          {hunts.map((h) => <option key={h.id} value={h.id}>{h.title}{h.status === 'draft' ? ' (draft)' : ''} · {n(h.registration_count || 0)} registered</option>)}
        </select>) : null} />
      {!hunts.length ? <Card><Empty icon="chat" text="No upcoming or running hunts. Create one in Treasure Hunts and its chat appears here." /></Card> : <HuntChatCard key={id} id={id} />}
      <p className="small muted">To message one player privately, open Hunt live and tap Message next to their name.</p>
    </>
  );
}
