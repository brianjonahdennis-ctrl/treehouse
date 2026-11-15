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
        <TreehouseBoard days={days} />
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

// ---- My Treehouse: referral networks (levels), suspicious activity, disqualify and audited corrections ----
type TH = { window_days: number; referred: number; counting: number; network: number; campaign: number; by_source: Record<string, number>; clicks: number;
  disqualified: { handle: string | null; reason: string; by: string | null; at: string }[];
  top_networks: { handle: string; direct: number; total: number }[];
  suspicious: { handle: string; joined: number; never_came_back: number; max_in_an_hour: number }[] };

function TreehouseBoard({ days }: { days: number }) {
  const { me } = useMe();
  const go = useGo();
  const t = useAsync(() => rpc<TH>('staff_treehouse', { p_days: days }), [days]);
  const manage = allows(me.role, 'manage');
  const [dq, setDq] = useState(false);
  const [fix, setFix] = useState(false);
  const [win, setWin] = useState(false);
  const x = t.data;
  return (
    <Card title="My Treehouse networks" sub={x ? `Member referral trees. A referral counts when the account has a profile, isn’t suspended or under 18 and isn’t disqualified. Credited only for accounts under ${x.window_days} days old.` : 'Member referral trees'}
      action={manage ? <div className="nowrap"><Btn small kind="ghost" onClick={() => setWin(true)}>Window</Btn><Btn small kind="ghost" icon="ban" onClick={() => setDq(true)}>Disqualify</Btn><Btn small kind="ghost" onClick={() => setFix(true)}>Correct inviter</Btn></div> : undefined} pad={false}>
      {t.error && <ErrorBox text={t.error} retry={t.reload} />}
      {t.loading && !x && <Spinner />}
      {x && <>
        <div className="kpis small" style={{ padding: 16 }}>
          <div className="kpi"><span className="kpi-l">Referrals that count</span><div className="kpi-v"><b>{n(x.counting)}</b></div><p className="kpi-hint">of {n(x.referred)} invited by members</p></div>
          <div className="kpi"><span className="kpi-l">Network (level 2+)</span><div className="kpi-v"><b>{n(x.network)}</b></div><p className="kpi-hint">invited by someone who was invited</p></div>
          <div className="kpi"><span className="kpi-l">Link visits → joins</span><div className="kpi-v"><b>{pct(x.referred, x.clicks)}</b></div><p className="kpi-hint">{n(x.clicks)} visits · QR {n(x.by_source.qr || 0)} · link {n(x.by_source.link || 0)}</p></div>
          <div className="kpi"><span className="kpi-l">Disqualified</span><div className="kpi-v"><b>{n(x.disqualified.length)}</b></div></div>
        </div>
        <div className="row-2 even">
          <div>
            <h4 style={{ margin: '0 16px 8px' }}>Biggest networks</h4>
            {x.top_networks.length === 0 ? <Empty text="No networks yet." icon="gift" /> : (
              <table className="tbl"><thead><tr><th>Member</th><th>Direct</th><th>Whole network</th></tr></thead>
                <tbody>{x.top_networks.map((r) => (
                  <tr key={r.handle} className="click" onClick={() => go(`/members/${encodeURIComponent(r.handle)}`)}><td><b>{r.handle}</b></td><td>{n(r.direct)}</td><td><b>{n(r.total)}</b></td></tr>))}</tbody></table>
            )}
          </div>
          <div>
            <h4 style={{ margin: '0 16px 8px' }}>Worth a look (last {days} days)</h4>
            {x.suspicious.length === 0 ? <Empty text="Nothing unusual." icon="check" /> : (
              <table className="tbl"><thead><tr><th>Inviter</th><th>Joined</th><th>Never came back</th><th>Busiest hour</th></tr></thead>
                <tbody>{x.suspicious.map((r) => (
                  <tr key={r.handle} className="click" onClick={() => go(`/members/${encodeURIComponent(r.handle)}`)}><td><b>{r.handle}</b></td><td>{n(r.joined)}</td>
                    <td>{r.never_came_back * 2 > r.joined ? <Pill tone="amber">{n(r.never_came_back)}</Pill> : n(r.never_came_back)}</td>
                    <td>{r.max_in_an_hour >= 5 ? <Pill tone="red">{r.max_in_an_hour} in 1 h</Pill> : r.max_in_an_hour}</td></tr>))}</tbody></table>
            )}
          </div>
        </div>
        {x.disqualified.length > 0 && (
          <div className="week-ex"><h4>Disqualified from referral counts</h4>
            {x.disqualified.map((d) => (
              <p key={d.handle || d.at}><b>{d.handle || '—'}</b> · {d.reason} <span className="muted">({d.by || '—'}, {date(d.at)})</span>
                {manage && d.handle && <Btn small kind="ghost" onClick={async () => { try { await rpc('staff_referral_disqualify', { p_handle: d.handle, p_on: false, p_reason: '' }); toast('Counts again.'); t.reload(); } catch (e) { toast((e as Error).message, true); } }}>Undo</Btn>}</p>))}
          </div>
        )}
      </>}
      {dq && <DisqualifyForm onClose={() => setDq(false)} onDone={() => { setDq(false); t.reload(); }} />}
      {fix && <FixForm onClose={() => setFix(false)} onDone={() => { setFix(false); t.reload(); }} />}
      {win && x && <WindowForm days={x.window_days} onClose={() => setWin(false)} onDone={() => { setWin(false); t.reload(); }} />}
    </Card>
  );
}

function DisqualifyForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [h, setH] = useState(''); const [why, setWhy] = useState(''); const [err, setErr] = useState('');
  const save = async () => { try { await rpc('staff_referral_disqualify', { p_handle: h.trim(), p_on: true, p_reason: why }); toast(`${h.trim()} no longer counts as a referral.`); onDone(); } catch (e) { setErr((e as Error).message); } };
  return (
    <Modal title="Disqualify a referral" onClose={onClose} foot={<><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={save} disabled={!h.trim() || why.trim().length < 3}>Disqualify</Btn></>}>
      <p className="muted">The member stops counting in the tree of whoever invited them (and everyone above). People they invited still count. Logged in the audit log.</p>
      <Field label="Member (nickname)"><input value={h} onChange={(e) => setH(e.target.value)} placeholder="e.g. Brave Panther 502" /></Field>
      <Field label="Reason"><textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={300} placeholder="e.g. duplicate account" /></Field>
      {err && <ErrorBox text={err} />}
    </Modal>
  );
}

function FixForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [h, setH] = useState(''); const [p, setP] = useState(''); const [why, setWhy] = useState(''); const [err, setErr] = useState('');
  const save = async () => { try { await rpc('staff_referral_fix', { p_handle: h.trim(), p_parent: p.trim() || null, p_reason: why }); toast('Inviter corrected.'); onDone(); } catch (e) { setErr((e as Error).message); } };
  return (
    <Modal title="Correct who invited a member" onClose={onClose} foot={<><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={save} disabled={!h.trim() || why.trim().length < 3}>Save correction</Btn></>}>
      <p className="muted">Only for mistakes (for example a member who signed up with the wrong link). Loops are refused. The old and new inviter and your reason go into the audit log.</p>
      <Field label="Member (nickname)"><input value={h} onChange={(e) => setH(e.target.value)} /></Field>
      <Field label="New inviter (nickname)" hint="Leave empty to remove their inviter."><input value={p} onChange={(e) => setP(e.target.value)} /></Field>
      <Field label="Reason"><textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={300} /></Field>
      {err && <ErrorBox text={err} />}
    </Modal>
  );
}

function WindowForm({ days, onClose, onDone }: { days: number; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState(String(days)); const [err, setErr] = useState('');
  const save = async () => { try { await rpc('staff_setting_set', { p_key: 'referral_account_days', p_value: Number(v) }); toast('Saved.'); onDone(); } catch (e) { setErr((e as Error).message); } };
  return (
    <Modal title="Referral window" onClose={onClose} foot={<><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={save}>Save</Btn></>}>
      <p className="muted">A new member is credited to the link they used only if their account is younger than this. The link itself is remembered on their phone for 30 days.</p>
      <Field label="Days (1 to 30)"><input type="number" min={1} max={30} value={v} onChange={(e) => setV(e.target.value)} /></Field>
      {err && <ErrorBox text={err} />}
    </Modal>
  );
}
