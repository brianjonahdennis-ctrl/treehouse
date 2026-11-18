'use client';
// Treasure Hunt live view and results (Hydra, 18 Nov 2026). Staff (Admin / Super Admin) see everyone
// registered for a hunt with their profile and progress, the top 20 finishers once it ends, and can
// message every competitor. Every look and every message is written to the staff audit log by the database.
import { useEffect, useMemo, useState } from 'react';
import { rpc } from '@/lib/sb';
import { ago, date, n } from '@/lib/fmt';
import { useGo } from './Shell';
import { Btn, Card, Empty, ErrorBox, Field, Modal, PageHead, Pill, Spinner, Switch, Tabs, toast, useAsync } from './ui';

type HuntLite = { id: string; title: string; region: string; state: string | null; status: string; starts_at: string; ends_at: string;
  participant_count: number; registration_count?: number; finished_count?: number };
type Person = { place: number; handle: string | null; username: string | null; gender: string | null; age: number | null; state: string | null; suspended: boolean;
  registered_at: string | null; started_at: string | null; checkpoints: number; coins: number; last_claim_at: string | null; finished_at: string | null; took_seconds: number | null };
type Board = { hunt: { id: string; title: string; region: string; state: string | null; status: string; starts_at: string; ends_at: string; checkpoint_count: number; running: boolean; ended: boolean };
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
        </div>
      </div>
      <p className="small muted">{date(x.hunt.starts_at)} – {date(x.hunt.ends_at)} (Lagos time)</p>
      <div className="kpis small hunt-kpis">
        <div className="kpi"><span className="kpi-l">Registered</span><div className="kpi-v"><b>{n(x.registered)}</b></div></div>
        <div className="kpi"><span className="kpi-l">Started</span><div className="kpi-v"><b>{n(x.started)}</b></div></div>
        <div className="kpi"><span className="kpi-l">Finished</span><div className="kpi-v"><b>{n(x.finished)}</b></div></div>
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
          <table className="tbl hunt-tbl"><thead><tr><th>#</th><th>Member</th><th>Progress</th><th>Coins</th><th>Last check-in</th><th>Status</th></tr></thead>
            <tbody>{people.map((p) => <tr key={`${p.place}-${p.handle}`}>
              <td>{p.place}</td>
              <td>{who(p)}</td>
              <td><div className="hunt-progress" aria-label={`${p.checkpoints} of ${total} checkpoints`}><i style={{ width: `${total ? Math.min(100, (p.checkpoints / total) * 100) : 0}%` }} /></div><small className="muted">{p.checkpoints} of {total}</small></td>
              <td>{n(p.coins)}</td>
              <td>{p.last_claim_at ? ago(p.last_claim_at) : '—'}</td>
              <td>{p.finished_at ? <><Pill tone="green">Finished</Pill><small className="muted block">took {took(p.took_seconds)}</small></> : p.started_at ? <Pill tone="blue">Playing</Pill> : <Pill>Registered {ago(p.registered_at)}</Pill>}</td>
            </tr>)}</tbody></table>
        )}
      </Card>
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
