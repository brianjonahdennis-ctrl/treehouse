'use client';
import { useState } from 'react';
import { rpc } from '@/lib/sb';
import { allows } from '@/lib/roles';
import { ago, date, dayLabel, n, pct } from '@/lib/fmt';
import { Bars } from './charts';
import { useMe } from './Gate';
import { useGo } from './Shell';
import { Ask, Btn, Card, Empty, ErrorBox, Field, Modal, PageHead, Pill, Spinner, Switch, Tabs, toast, useAsync } from './ui';

type Top = { code: string; handle: string | null; active: boolean; clicks: number; joined: number; came_back: number; suspended: number; last_joined: string; max_in_an_hour: number };
type Camp = { code: string; campaign: string; note: string; active: boolean; clicks: number; joined: number; came_back: number; created_at: string };
type Data = { enabled: boolean; total_joined: number; joined_period: number; came_back: number; codes: number; daily: { day: string; joined: number }[]; top: Top[]; campaigns: Camp[] };
type Joined = { handle: string | null; joined_at: string; last_seen_at: string | null; suspended: boolean; state: string };

const SITE = 'https://treehouse.ng/r/';

export default function Referrals() {
  const { me } = useMe();
  const go = useGo();
  const [days, setDays] = useState(30);
  const d = useAsync(() => rpc<Data>('staff_referrals', { p_days: days }), [days]);
  const [edit, setEdit] = useState<Camp | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const manage = allows(me.role, 'manage');
  const toggle = async (code: string, on: boolean) => { try { await rpc('staff_referral_code_active', { p_code: code, p_active: on }); toast(on ? 'Code turned on.' : 'Code turned off.'); d.reload(); } catch (e) { toast((e as Error).message, true); } };
  const x = d.data;
  return (
    <>
      <PageHead title="Referrals" sub="Every member has an invite link (treehouse.ng/r/code). Campaign codes are for flyers, influencers and partners."
        actions={<>
          <select className="select" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period"><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select>
          {manage && <Btn kind="primary" icon="plus" onClick={() => setEdit({ code: '', campaign: '', note: '', active: true, clicks: 0, joined: 0, came_back: 0, created_at: '' })}>New campaign code</Btn>}
        </>} />
      {d.error && <ErrorBox text={d.error} retry={d.reload} />}
      {d.loading && !x && <Spinner />}
      {x && <>
        {!x.enabled && <div className="banner amber">Referrals are switched off in Settings. Links still open the app, but nobody is credited.</div>}
        <div className="kpis small">
          <div className="kpi"><span className="kpi-l">Joined with a code</span><div className="kpi-v"><b>{n(x.total_joined)}</b></div><p className="kpi-hint">{n(x.joined_period)} in the last {days} days</p></div>
          <div className="kpi"><span className="kpi-l">Came back after 2 days</span><div className="kpi-v"><b>{pct(x.came_back, x.total_joined)}</b></div><p className="kpi-hint">{n(x.came_back)} people</p></div>
          <div className="kpi"><span className="kpi-l">Member invite links</span><div className="kpi-v"><b>{n(x.codes)}</b></div></div>
          <div className="kpi"><span className="kpi-l">Campaign codes</span><div className="kpi-v"><b>{n(x.campaigns.length)}</b></div></div>
        </div>
        <WeekBoard />
        <Card title="New members from invites" sub={`Per day, last ${days} days`}>
          <Bars height={200} labels={x.daily.map((r) => dayLabel(r.day))} series={[{ name: 'Joined', color: '#ff3f9b', values: x.daily.map((r) => r.joined) }]} />
        </Card>
        <div className="row-2 even">
          <Card title="Top inviters" sub="Watch for bursts: many sign-ups in one hour can mean fake accounts." pad={false}>
            {x.top.length === 0 ? <Empty text="Nobody has invited anyone yet." icon="gift" /> : (
              <table className="tbl"><thead><tr><th>Member</th><th>Joined</th><th>Came back</th><th>Busiest hour</th><th /></tr></thead>
                <tbody>{x.top.map((t) => (
                  <tr key={t.code}>
                    <td><button className="link" onClick={() => t.handle && go(`/members/${encodeURIComponent(t.handle)}`)}><b>{t.handle || '—'}</b></button><small className="muted block">{t.code} · {n(t.clicks)} visits</small></td>
                    <td><button className="link" onClick={() => setWho(t.code)}>{n(t.joined)}</button>{t.suspended > 0 && <small className="muted"> · {t.suspended} suspended</small>}</td>
                    <td>{pct(t.came_back, t.joined)}</td>
                    <td>{t.max_in_an_hour >= 10 ? <Pill tone="red">{t.max_in_an_hour} in 1 h</Pill> : t.max_in_an_hour}</td>
                    <td>{manage && <Switch label="Code on" on={t.active} onChange={(v) => toggle(t.code, v)} />}</td>
                  </tr>))}</tbody></table>
            )}
          </Card>
          <Card title="Campaign codes" pad={false}>
            {x.campaigns.length === 0 ? <Empty text="No campaign codes yet." icon="gift" /> : (
              <table className="tbl"><thead><tr><th>Campaign</th><th>Visits</th><th>Joined</th><th>Came back</th><th /></tr></thead>
                <tbody>{x.campaigns.map((c) => (
                  <tr key={c.code}>
                    <td><b>{c.campaign}</b><small className="muted block">{SITE}{c.code}</small></td>
                    <td>{n(c.clicks)}</td>
                    <td><button className="link" onClick={() => setWho(c.code)}>{n(c.joined)}</button></td>
                    <td>{pct(c.came_back, c.joined)}</td>
                    <td className="nowrap">{manage && <><Btn small kind="ghost" onClick={() => setEdit(c)}>Edit</Btn><Switch label="Code on" on={c.active} onChange={(v) => toggle(c.code, v)} /></>}</td>
                  </tr>))}</tbody></table>
            )}
          </Card>
        </div>
      </>}
      {edit && <CampaignForm c={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); d.reload(); }} />}
      {who && <JoinedList code={who} onClose={() => setWho(null)} />}
    </>
  );
}

function CampaignForm({ c, onClose, onSaved }: { c: Camp; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(c.code);
  const [name, setName] = useState(c.campaign);
  const [note, setNote] = useState(c.note);
  const [err, setErr] = useState('');
  const save = async () => {
    try { await rpc('staff_referral_campaign', { p_code: code, p_campaign: name, p_note: note, p_active: c.active }); toast('Saved.'); onSaved(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal title={c.code ? 'Edit campaign code' : 'New campaign code'} onClose={onClose} foot={<><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={save} disabled={!code || !name}>Save</Btn></>}>
      <Field label="Code" hint={code ? `Link: ${SITE}${code.toLowerCase()}` : '4 to 24 letters or numbers'}><input value={code} disabled={!!c.code} onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase())} maxLength={24} /></Field>
      <Field label="Campaign name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. UNILAG flyers, November" /></Field>
      <Field label="Note"><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
      {err && <ErrorBox text={err} />}
    </Modal>
  );
}

function JoinedList({ code, onClose }: { code: string; onClose: () => void }) {
  const go = useGo();
  const l = useAsync(() => rpc<Joined[]>('staff_referral_joined', { p_code: code }), [code]);
  return (
    <Modal title={`Joined with “${code}”`} onClose={onClose} wide>
      {l.error && <ErrorBox text={l.error} />}
      {l.loading && <Spinner />}
      {l.data && (l.data.length === 0 ? <Empty text="Nobody yet." /> : (
        <table className="tbl"><thead><tr><th>Member</th><th>State</th><th>Joined</th><th>Last seen</th><th /></tr></thead>
          <tbody>{l.data.map((j, i) => (
            <tr key={i} className="click" onClick={() => j.handle && go(`/members/${encodeURIComponent(j.handle)}`)}><td><b>{j.handle || 'deleted'}</b></td><td>{j.state}</td>
              <td className="muted">{date(j.joined_at)}</td><td className="muted">{ago(j.last_seen_at)}</td><td>{j.suspended && <Pill tone="red">Suspended</Pill>}</td></tr>))}</tbody></table>
      ))}
    </Modal>
  );
}

type WRow = { rank: number; handle: string; gender: string; invites: number; title: string; reached_at: string; joined_all: number };
type Week = { week_start: string; week_end: string; current: boolean; announce_at: string; enabled: boolean; min: number; top: WRow[];
  excluded: { handle: string | null; reason: string; by: string | null; at: string }[];
  winner: { handle: string; title: string; invites: number; at: string } | null; winners: { week: string; handle: string; title: string; invites: number }[] };

function WeekBoard() {
  const { me } = useMe();
  const go = useGo();
  const [wk, setWk] = useState('0');
  const w = useAsync(() => rpc<Week>('staff_invite_week', { p_weeks_ago: Number(wk) }), [wk]);
  const [dq, setDq] = useState<string | null>(null);
  const manage = allows(me.role, 'manage');
  const x = w.data;
  const leader = x?.top[0];
  return (
    <Card title="Man & Woman of the Week" sub={x ? `${dayLabel(x.week_start)} – ${dayLabel(x.week_end)} · winner announced to everyone ${date(x.announce_at)}${x.enabled ? '' : ' (switched off in Settings)'}` : 'Weekly invite leaderboard'}
      action={<Tabs value={wk} onChange={setWk} items={[['0', 'This week'], ['1', 'Last week']]} />} pad={false}>
      {w.error && <ErrorBox text={w.error} retry={w.reload} />}
      {w.loading && !x && <Spinner />}
      {x && (
        <>
          <div className="week-head">
            {x.winner ? <div className="week-win"><span>🏆</span><div><small>Announced {date(x.winner.at)}</small><b>{x.winner.title}: {x.winner.handle}</b><p className="muted">{n(x.winner.invites)} friends joined</p></div></div>
              : leader && leader.invites >= x.min ? <div className="week-win"><span>🥇</span><div><small>{x.current ? 'Leading now' : 'Will be announced'}</small><b>{leader.title}: {leader.handle}</b><p className="muted">{n(leader.invites)} friends that count</p></div></div>
              : <div className="week-win"><span>⏳</span><div><small>No winner yet</small><b>Needs at least {x.min} invites that count</b></div></div>}
            <p className="muted">Counts friends who joined with the link that week, came back at least 12 hours later and aren’t suspended. Compare with “all joins” to spot fake accounts.</p>
          </div>
          {x.top.length === 0 ? <Empty text="Nobody on the board for this week." icon="gift" /> : (
            <table className="tbl"><thead><tr><th>#</th><th>Member</th><th>Counts</th><th>All joins</th><th>Title</th><th /></tr></thead>
              <tbody>{x.top.map((r) => (
                <tr key={r.handle}>
                  <td><b>{r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</b></td>
                  <td><button className="link" onClick={() => go(`/members/${encodeURIComponent(r.handle)}`)}><b>{r.handle}</b></button></td>
                  <td><b>{n(r.invites)}</b></td>
                  <td>{r.joined_all > r.invites * 2 ? <Pill tone="amber">{n(r.joined_all)}</Pill> : n(r.joined_all)}</td>
                  <td className="muted">{r.title}</td>
                  <td>{manage && !x.winner && Number(wk) <= 1 && <Btn small kind="ghost" icon="ban" onClick={() => setDq(r.handle)}>Disqualify</Btn>}</td>
                </tr>))}</tbody></table>
          )}
          {x.excluded.length > 0 && (
            <div className="week-ex">
              <h4>Disqualified this week</h4>
              {x.excluded.map((e) => (
                <p key={e.handle || e.at}><b>{e.handle || '—'}</b> · {e.reason} <span className="muted">({e.by || '—'}, {date(e.at)})</span>
                  {manage && !x.winner && e.handle && <Btn small kind="ghost" onClick={async () => { try { await rpc('staff_invite_exclude', { p_handle: e.handle, p_weeks_ago: Number(wk), p_exclude: false }); toast('Back on the board.'); w.reload(); } catch (er) { toast((er as Error).message, true); } }}>Undo</Btn>}</p>
              ))}
            </div>
          )}
          {x.winners.length > 0 && (
            <div className="week-ex"><h4>Past winners</h4>
              <div className="chips">{x.winners.map((v) => <span key={v.week} className="chip">{dayLabel(v.week)} · {v.title}: <b>{v.handle}</b> ({v.invites})</span>)}</div></div>
          )}
        </>
      )}
      {dq && <Ask title={`Disqualify ${dq} for this week?`} text="They drop off the board and can’t be announced for this week. Their invites still count for the people who joined." confirm="Disqualify" danger reason
        onDone={async (why) => { await rpc('staff_invite_exclude', { p_handle: dq, p_weeks_ago: Number(wk), p_exclude: true, p_reason: why }); toast(`${dq} disqualified.`); w.reload(); }} onClose={() => setDq(null)} />}
    </Card>
  );
}
