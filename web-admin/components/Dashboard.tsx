'use client';
import { useState } from 'react';
import { rpc } from '@/lib/sb';
import { allows } from '@/lib/roles';
import { ago, compact, dayLabel, n, pct, words } from '@/lib/fmt';
import { Bars, Donut, Legend, Ring, Spark } from './charts';
import { useMe } from './Gate';
import { useGo } from './Shell';
import { Avatar, Btn, Card, Empty, ErrorBox, PageHead, Pill, Spinner, useAsync } from './ui';
import { Icon } from './Icon';

type Daily = { date: string; accounts: number; profiles: number; conversations: number; messages: number };
type Dash = {
  days: number; at: string; accounts: number; profiles: number; online_now: number; active_1d: number; active_7d: number; active_30d: number;
  new_today: number; suspended: number; underage_marked: number; room_bans: number; chat_messages_today: number; room_messages_today: number;
  in_rooms_now: number; open_reports: { chat: number; room: number; link: number };
  signups: { day: string; profiles: number }[]; gender: Record<string, number>; top_states: { state: string; people: number }[];
  ads: { active: number; views_today: number; taps_today: number }; referrals: { joined_today: number; joined_period: number };
  dating?: { daily: Daily[]; inRange: { accounts: number; profiles: number; conversations: number; messages: number }; totals: Record<string, number>; intent: { name: string; count: number }[] };
  speed?: { now: { onDates: number; waiting: number }; daily: { date: string; dates: number; matches: number }[]; inRange: { pairings: number; matches: number } };
  deletions?: { inRange: number; daily: { date: string; deleted: number }[] };
  photos?: { stored: number; storedMB: number; sentToday: number };
  platforms?: { people: Record<string, number> };
  reputation?: { needs_review: number; ratings_24h: number };
};
type Report = { id: number; created_at: string; reason: string; reporter: string; reported: string; status: string; speed: boolean };

const C = { pink: '#ff3f9b', blue: '#12b9f5', indigo: '#5b4ff0', navy: '#090d2b', green: '#12a150', amber: '#f59e0b', lav: '#b8b2ff' };

function change(values: number[]) {
  if (values.length < 4) return null;
  const h = Math.floor(values.length / 2);
  const a = values.slice(0, h).reduce((s, v) => s + v, 0);
  const b = values.slice(values.length - h).reduce((s, v) => s + v, 0);
  if (!a) return b ? 100 : 0;
  return Math.round(((b - a) / a) * 1000) / 10;
}

function Kpi({ label, value, icon, tone, values, delta, hint }: { label: string; value: number; icon: string; tone: string; values: number[]; delta: number | null; hint: string }) {
  return (
    <div className="kpi">
      <div className="kpi-h">
        <span className={`kpi-i ${tone}`}><Icon name={icon} size={20} /></span>
        <span className="kpi-l">{label}</span>
      </div>
      <div className="kpi-v">
        <b>{compact(value)}</b>
        {delta !== null && <em className={delta >= 0 ? 'up' : 'down'}><Icon name={delta >= 0 ? 'up' : 'downArrow'} size={13} />{Math.abs(delta)}%</em>}
      </div>
      <p className="kpi-hint">{hint}</p>
      <Spark values={values} color={`var(--${tone})`} />
    </div>
  );
}

export default function Dashboard() {
  const { me } = useMe();
  const go = useGo();
  const [days, setDays] = useState(14);
  const { data: d, error, loading, reload } = useAsync(() => rpc<Dash>('staff_dashboard', { p_days: days }), [days]);
  const reports = useAsync(() => (allows(me.role, 'moderate') ? rpc<Report[]>('staff_reports', { p_kind: 'chat', p_status: 'open', p_limit: 6 }) : Promise.resolve([])), []);

  const exportCsv = () => {
    if (!d?.dating) return;
    const rows = [['date', 'accounts', 'profiles', 'conversations', 'messages'], ...d.dating.daily.map((x) => [x.date, x.accounts, x.profiles, x.conversations, x.messages])];
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `treehouse-${days}d.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHead title="Overview" sub={`How treehouse is doing${d ? ` · updated ${ago(d.at)}` : ''}`} actions={<>
        <label className="select-btn"><Icon name="calendar" size={16} />
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
            <option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          </select>
        </label>
        <Btn icon="download" onClick={exportCsv} disabled={!d}>Export</Btn>
        {allows(me.role, 'content') && <Btn kind="primary" icon="megaphone" onClick={() => go('/announcements/new')}>New announcement</Btn>}
      </>} />
      {error && <ErrorBox text={error} retry={reload} />}
      {loading && !d && <Spinner />}
      {d && <Body d={d} days={days} reports={reports.data || []} canModerate={allows(me.role, 'moderate')} go={go} />}
    </>
  );
}

function Body({ d, days, reports, canModerate, go }: { d: Dash; days: number; reports: Report[]; canModerate: boolean; go: (p: string) => void }) {
  const daily = d.dating?.daily || [];
  const labels = daily.map((x) => dayLabel(x.date));
  const profiles = daily.map((x) => x.profiles);
  const messages = daily.map((x) => x.messages);
  const convos = daily.map((x) => x.conversations);
  const accounts = daily.map((x) => x.accounts);
  const speed = (d.speed?.daily || []).map((x) => x.dates);
  const totalStates = d.top_states.reduce((s, x) => s + x.people, 0) || 1;
  const barColors = [C.pink, C.blue, C.indigo, C.green];
  const openTotal = d.open_reports.chat + d.open_reports.room + d.open_reports.link;
  const gender = Object.entries(d.gender);

  return (
    <div className="dash">
      <div className="kpis">
        <Kpi label="Members" value={d.profiles} icon="users" tone="pink" values={profiles}
          delta={change(profiles)} hint={`${n(d.new_today)} joined today · ${n(d.accounts)} accounts`} />
        <Kpi label="Active today" value={d.active_1d} icon="pulse" tone="blue" values={accounts.length ? accounts.map((_, i) => accounts[i] + messages[i] / 10) : [d.active_1d]}
          delta={null} hint={`${n(d.online_now)} online now · ${n(d.active_7d)} this week`} />
        <Kpi label={`New chats · ${days}d`} value={d.dating?.inRange.conversations ?? 0} icon="heart" tone="indigo" values={convos} delta={change(convos)}
          hint={`${n(d.dating?.inRange.messages)} messages in the period`} />
        <Kpi label="Open reports" value={openTotal} icon="flag" tone="amber" values={[d.open_reports.link, d.open_reports.room, d.open_reports.chat, openTotal]} delta={null}
          hint={`${n(d.open_reports.chat)} chats · ${n(d.open_reports.room)} rooms · ${n(d.open_reports.link)} links`} />
      </div>

      <div className="row-2">
        <Card title="Growth overview" sub={<><i className="dot pink" />New activity per day, last {days} days</>} className="grow-card"
          action={<div className="card-stats"><div><b>{compact(d.chat_messages_today)}</b><span>chat messages today</span></div><div><b>{compact(d.room_messages_today)}</b><span>room messages today</span></div></div>}>
          <Legend series={[{ name: 'New members', color: barColors[0] }, { name: 'New chats', color: barColors[1] }, { name: 'Speed dates', color: barColors[2] }]} />
          {daily.length ? (
            <Bars height={330} labels={labels} series={[
              { name: 'New members', color: barColors[0], values: profiles },
              { name: 'New chats', color: barColors[1], values: convos },
              { name: 'Speed dates', color: barColors[2], values: speed },
            ]} />
          ) : <Empty text="No daily figures yet." icon="pulse" />}
        </Card>
        <Card title="Where members are" sub={`${n(d.profiles)} members across Nigeria`} className="states">
          <ul className="plan-list">
            {d.top_states.slice(0, 4).map((s, i) => (
              <li key={s.state}>
                <div><b>{s.state}</b><span>{n(s.people)} members</span></div>
                <div className="r"><b>{pct(s.people, d.profiles)}</b><span>of all members</span></div>
                <span className="meter"><i style={{ width: `${(s.people / totalStates) * 100}%`, background: [C.pink, C.blue, C.indigo, C.green][i] }} /></span>
              </li>
            ))}
          </ul>
          <div className="foot-box">
            <Icon name="chat" size={20} />
            <div><small>Right now</small><b>{n(d.online_now)} online · {n(d.in_rooms_now)} in chatrooms</b></div>
            <span>{n(d.speed?.now.onDates ?? 0)} on speed dates</span>
          </div>
        </Card>
      </div>

      <div className="rings">
        <RingCard title="Active today" value={d.active_1d} max={d.profiles} color={C.pink} sub="% of all members" />
        <RingCard title="Active this week" value={d.active_7d} max={d.profiles} color={C.blue} sub="% of all members" />
        <RingCard title="Active this month" value={d.active_30d} max={d.profiles} color={C.indigo} sub="% of all members" />
        <RingCard title="In chatrooms now" value={d.in_rooms_now} max={d.online_now} color={C.green} sub="% of people online" />
      </div>

      <div className="row-2">
        <Card title="Needs attention" sub="Newest open chat reports" pad={false} className="attention" action={canModerate && <Btn small onClick={() => go('/reports')}>View all <Icon name="chevron" size={14} /></Btn>}>
          {!canModerate ? <Empty text="Reports are for moderators." icon="lock" /> : reports.length === 0 ? <Empty text="No open chat reports. Nice." /> : (
            <table className="tbl">
              <thead><tr><th>Reported</th><th>Reason</th><th>By</th><th>When</th><th>Status</th></tr></thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} className="click" onClick={() => go(`/reports?open=chat-${r.id}`)}>
                    <td><div className="who-cell"><Avatar name={r.reported || '?'} /><div><b>{r.reported || 'deleted account'}</b>{r.speed && <small>Speed Dating</small>}</div></div></td>
                    <td><Pill tone={r.reason === 'underage' ? 'red' : r.reason === 'harassment' ? 'pink' : 'violet'}>{words(r.reason)}</Pill></td>
                    <td className="muted">{r.reporter || '—'}</td>
                    <td className="muted">{ago(r.created_at)}</td>
                    <td><Pill tone="amber">Open</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Safety" sub="Accounts under restriction" className="safety">
          <ul className="inbox-list">
            <SafetyRow icon="ban" tone="red" label="Suspended" value={d.suspended} onClick={canModerate ? () => go('/members?filter=suspended') : undefined} />
            <SafetyRow icon="lock" tone="pink" label="Marked under 18" value={d.underage_marked} onClick={canModerate ? () => go('/members?filter=underage') : undefined} />
            <SafetyRow icon="chat" tone="blue" label="Banned from rooms" value={d.room_bans} onClick={canModerate ? () => go('/members?filter=room_banned') : undefined} />
            <SafetyRow icon="eye" tone="indigo" label="Ratings to review" value={d.reputation?.needs_review ?? 0} />
            <SafetyRow icon="trash" tone="amber" label={`Deleted accounts · ${days}d`} value={d.deletions?.inRange ?? 0} />
          </ul>
        </Card>
      </div>

      <div className="minis">
        <Card title="Members by gender" className="mini-donut">
          <div className="donut-row">
            <Donut center={compact(d.profiles)} sub="members" parts={gender.map(([g, v], i) => ({ name: g, value: v, color: [C.pink, C.blue, C.indigo, C.lav][i % 4] }))} />
            <ul className="mini-list">{gender.map(([g, v], i) => <li key={g}><i style={{ background: [C.pink, C.blue, C.indigo, C.lav][i % 4] }} />{words(g)}<b>{pct(v, d.profiles)}</b></li>)}</ul>
          </div>
        </Card>
        <MiniStat title="Ads today" icon="ad" tone="pink" rows={[['Live ads', d.ads.active], ['Views', d.ads.views_today], ['Taps', d.ads.taps_today]]} foot={`Tap rate ${pct(d.ads.taps_today, d.ads.views_today)}`} onClick={() => go('/ads')} />
        <MiniStat title="Referrals" icon="gift" tone="blue" rows={[['Joined today', d.referrals.joined_today], [`Joined · ${days}d`, d.referrals.joined_period]]} foot="Members inviting friends" onClick={() => go('/referrals')} />
        <MiniStat title="Apps" icon="pulse" tone="indigo" rows={Object.entries(d.platforms?.people || {}).slice(0, 4).map(([k, v]) => [platformName(k), v])} foot={`Photos: ${n(d.photos?.sentToday)} sent today · ${d.photos?.storedMB ?? 0} MB stored`} />
      </div>
    </div>
  );
}

export const platformName = (k: string) => ({ 'android-play': 'Android (Play)', 'android-apk': 'Android (APK)', 'android-app': 'Android (old)', 'ios-app': 'iPhone app', web: 'Web' } as Record<string, string>)[k] || k;

function RingCard({ title, value, max, color, sub }: { title: string; value: number; max: number; color: string; sub: string }) {
  return (
    <div className="ring-card">
      <Ring value={value} max={max} color={color} label={max ? `${Math.round(Math.min(value / max, 1) * 100)}` : '0'} />
      <div><b>{compact(value)}</b><span>{title}</span><small>{sub}</small></div>
    </div>
  );
}

function SafetyRow({ icon, tone, label, value, onClick }: { icon: string; tone: string; label: string; value: number; onClick?: () => void }) {
  return (
    <li className={onClick ? 'click' : ''} onClick={onClick}>
      <span className={`kpi-i ${tone} sm`}><Icon name={icon} size={16} /></span>
      <span className="lbl">{label}</span>
      <b>{n(value)}</b>
      {onClick && <Icon name="chevron" size={15} />}
    </li>
  );
}

function MiniStat({ title, icon, tone, rows, foot, onClick }: { title: string; icon: string; tone: string; rows: [string, number][]; foot: string; onClick?: () => void }) {
  return (
    <div className={`card mini ${onClick ? 'click' : ''}`} onClick={onClick}>
      <div className="mini-h"><span className={`kpi-i ${tone} sm`}><Icon name={icon} size={16} /></span><h3>{title}</h3></div>
      <dl>{rows.length ? rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{n(v)}</dd></div>) : <div><dt>No data yet</dt><dd>—</dd></div>}</dl>
      <p className="muted">{foot}</p>
    </div>
  );
}
